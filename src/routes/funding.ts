import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  setResponseHeader,
  createError,
} from "h3";
import type { H3Event } from "h3";
import type { MockStore, Draft } from "../state/mock-store.js";
import type { AuthContext } from "../auth/jwt-middleware.js";
import { FundingWorkflow, DefundingWorkflow } from "../workflows/funding.js";
import { isWorkflowRejection } from "../workflows/workflow.js";
import { track } from "../http/route-registry.js";
import { ISSUANCE_WALLET_ALIAS, ISSUANCE_WALLET_BIC } from "../state/issuance-wallet.js";

/** Convert a workflow rejection into the h3 createError shape used by this router. */
function rejectAsError(e: unknown): never {
  if (isWorkflowRejection(e)) {
    throw createError({
      statusCode: e.statusCode,
      // Preserve errorCode (not just the description) so it survives to the
      // normalised ErrorResponse (issue #33).
      data: { businessErrors: e.businessErrors },
    });
  }
  throw e;
}

/**
 * Send a spec-shaped plain JSON string confirmation (application/json,
 * type: string) rather than an object, per the official spec for the
 * draft-transition endpoints below.
 */
function stringResponse(event: H3Event, message: string): string {
  setResponseHeader(event, "content-type", "application/json");
  return JSON.stringify(message);
}

/** UUID of the approving user (for the four-eyes check). */
function approverUUID(event: H3Event): string | undefined {
  return (event.context.auth as AuthContext | undefined)?.userUUID;
}

/** Username of the acting user (workbench issue #113), from the JWT. */
function actingUsername(event: H3Event): string | undefined {
  return (event.context.auth as AuthContext | undefined)?.username;
}

/** Acting entity from the verified JWT, for DCW authorisation (issue #56). */
function callerOf(event: H3Event): { entityBIC: string } | undefined {
  const entity = (event.context.auth as AuthContext | undefined)?.entityBIC;
  return entity ? { entityBIC: entity } : undefined;
}

/**
 * Auto-create the credited wallet if it doesn't exist yet (mock convenience,
 * issue #23) — owned by the **caller's own entity** (issue #77), taken from the
 * verified JWT, never from the request body. Other money-movement routes do NOT
 * auto-create: crediting an unknown wallet is rejected there.
 */
function ensureWallet(store: MockStore, alias: string, ownerEntity: string, managerNCB: string, currency: string): void {
  if (!alias || store.getWallet(alias)) return;
  store.ensureWallet(alias, {
    ownerBIC: ownerEntity,
    ownerEntityID: ownerEntity,
    managerNCB,
    currency,
  });
  console.log(`[mock-pontes] Auto-created wallet ${alias} for entity ${ownerEntity}`);
}

/**
 * Build the funding/defunding single-read view (workbench #113). `rich`
 * selects the fuller `triggermanagement.FundingRequest` shape returned by
 * `GET .../funding-defunding-requests/{id}`; when false it returns the
 * thinner `*RequestResponse` shape instead (also used by create), returned by
 * `GET .../funding-defunding-requests-drafts/{id}`. Reused for both FUNDING
 * and DEFUNDING since the two schemas declare identical field names, differing
 * only in `type`/`defundingRequestType`.
 */
function fundingReadView(store: MockStore, d: Draft, opts: { rich: boolean }): Record<string, unknown> {
  const isDefunding = d.type === "DEFUNDING";
  const base: Record<string, unknown> = {
    id: d.id,
    amount: d.amount,
    currency: d.currency,
    type: d.type,
    creditedCashWalletAlias: d.creditedWalletAlias,
    creditedCashWalletManagerID: d.creditedCashWalletManagerID ?? "",
    creditedCashWalletOwnerID: d.creditedCashWalletOwnerID ?? "",
    debitedCashWalletAlias: d.debitedWalletAlias,
    debitedCashWalletManagerID: d.debitedCashWalletManagerID ?? "",
    debitedCashWalletOwnerID: d.debitedCashWalletOwnerID ?? "",
    initiatorUserUUID: d.initiatorUserUUID ?? "",
    instructingPartyID: d.instructingPartyID ?? "",
    signature: d.signature ?? "",
    signerPEM: d.signerPEM ?? "",
    // Derived from the (not-yet-modeled) T2 Account link of the credited
    // wallet — blank until T2 Accounts are implemented.
    t2AccountReference: "",
    techFundRequestID: d.techFundRequestID ?? "",
  };
  if (isDefunding) base.defundingRequestType = "D";
  if (!opts.rich) return base;
  return {
    ...base,
    fourEyesType: "DRAFT",
    status: d.status,
    historicStatus: d.historicStatus ?? null,
    timestamps: d.timestamps ?? {},
    initiatorUserName: d.initiatorUserName ?? "",
    approverUserUUID: d.approverUserUUID ?? "",
    approverUserName: d.approverUserName ?? "",
    creationDate: store.getBusinessDay().businessDate,
    settledTime: d.status === "SETTLED" ? d.updatedAt ?? "" : "",
    settledDate: d.status === "SETTLED" ? store.getBusinessDay().businessDate : "",
    rootCause: "",
  };
}

export function createFundingRouter(store: MockStore) {
  const router = track(createRouter());
  const funding = new FundingWorkflow(store);
  const defunding = new DefundingWorkflow(store);

  // Funding source model (mock):
  // The token-issuance wallet (`ISSUANCE_WALLET_ALIAS`) is the DCA
  // that sources the funds for a funding request. In this mock it is treated as
  // having an INFINITE balance available — funding approvals always credit the
  // target wallet and never debit or balance-check the issuance wallet. This is
  // why funding is the supported way to seed cash into the mock (there is no
  // separate admin "fund" shortcut). Defunding does the reverse: it debits the
  // target wallet and credits the (infinite) issuance wallet.

  // POST /dlt/:ncb/api/octopus/tms/funding-requests — Create funding draft
  router.post(
    "/dlt/:ncb/api/octopus/tms/funding-requests",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const id = store.nextId("FRQ");
      const caller = callerOf(event);

      // Auto-create the credited wallet if unknown — owned by the caller's own
      // entity (issue #77), with the NCB manager from the body or path.
      if (caller?.entityBIC) {
        ensureWallet(
          store,
          body.creditedCashWalletAlias,
          caller.entityBIC,
          body.creditedCashWalletManagerID || "UNKNOWN",
          body.currency || "EUR",
        );
      }

      const now = new Date().toISOString();
      const businessDate = store.getBusinessDay().businessDate;
      const draft = funding.create(
        {
          id,
          amount: body.amount || "0.00",
          currency: "EUR",
          creditedWalletAlias: body.creditedCashWalletAlias || "",
          debitedWalletAlias: ISSUANCE_WALLET_ALIAS,
          // Initiator is the authenticated caller (four-eyes), never the body (#28).
          initiatorUserUUID: approverUUID(event),
          initiatorUserName: actingUsername(event),
          techFundRequestID: body.techFundRequestID,
          instructingPartyID: body.instructingPartyID,
          signature: body.signature,
          signerPEM: body.signerPEM,
          creditedCashWalletManagerID: body.creditedCashWalletManagerID,
          creditedCashWalletOwnerID: body.creditedCashWalletOwnerID,
          debitedCashWalletManagerID: body.debitedCashWalletManagerID || ISSUANCE_WALLET_BIC,
          debitedCashWalletOwnerID: body.debitedCashWalletOwnerID || ISSUANCE_WALLET_BIC,
          // Lifecycle trail (workbench #113), same seed as TransferWorkflow (#109)
          // — kept on the `Draft` for the richer single-GET view even though the
          // create response itself still reports `historicStatus: null` (below),
          // matching the real captured create response.
          historicStatus: ["INITIALIZED", "PENDING_APPROVAL"],
          timestamps: {
            INITIALIZED: { calendarDate: now, businessDate },
            PENDING_APPROVAL: { calendarDate: now, businessDate },
          },
        },
        { caller },
      );

      setResponseStatus(event, 201);
      return {
        id: draft.id,
        // Server-asserted, not trusted from the client body — this is a
        // two-step (four-eyes) draft, consistent with other draft-creating
        // endpoints in this mock.
        fourEyesType: "DRAFT",
        status: draft.status,
        // No transition has happened yet — null until the draft is approved
        // or canceled, matching the real captured response.
        historicStatus: null,
        timestamps: {},
        // Echo the client's own draft timestamp (the real UI reuses its local
        // draft object, computed client-side, as the POST body) rather than
        // deriving a new one server-side.
        lastUpdated: typeof body.lastUpdated === "number" ? body.lastUpdated : Date.now(),
        initiatorUserUUID: draft.initiatorUserUUID,
        initiatorUserName: "",
        approverUserUUID: "",
        approverUserName: "",
        techFundRequestID: body.techFundRequestID,
        instructingPartyID: body.instructingPartyID || "",
        amount: draft.amount,
        currency: draft.currency,
        type: "FUNDING",
        creditedCashWalletAlias: draft.creditedWalletAlias,
        creditedCashWalletManagerID: body.creditedCashWalletManagerID || "",
        creditedCashWalletOwnerID: body.creditedCashWalletOwnerID || "",
        debitedCashWalletAlias: draft.debitedWalletAlias,
        debitedCashWalletManagerID: body.debitedCashWalletManagerID || ISSUANCE_WALLET_BIC,
        debitedCashWalletOwnerID: body.debitedCashWalletOwnerID || ISSUANCE_WALLET_BIC,
        // The real API uses `creationDate` (blank at draft stage) instead of
        // the mock's former `createdAt`.
        creationDate: "",
        // Echoed back verbatim, as sent by the client (NRO signature + signer cert).
        signature: body.signature || "",
        signerPEM: body.signerPEM || "",
        // Only meaningful for the analogous defunding-creation flow; blank here.
        defundingRequestType: "",
        settledTime: "",
        settledDate: "",
        // Derived from the (not-yet-modeled) T2 Account link of the credited
        // wallet — blank until T2 Accounts are implemented.
        t2AccountReference: "",
        rootCause: "",
      };
    }),
  );

  // PUT /dlt/:ncb/api/octopus/tms/funding-requests-drafts/:id/:status — Transition
  // funding draft. Generic {status} per the official spec: approve|cancel
  // (case-insensitive, plus APPROVED/CANCELED). Approval enforces four-eyes and
  // credits the target from the infinite issuance wallet (no availability check).
  router.put(
    "/dlt/:ncb/api/octopus/tms/funding-requests-drafts/:id/:status",
    defineEventHandler((event) => {
      const id = getRouterParam(event, "id")!;
      const status = (getRouterParam(event, "status") || "").toLowerCase();
      try {
        if (status === "approve" || status === "approved") {
          funding.approve(id, { approverUserUUID: approverUUID(event), approverUserName: actingUsername(event) });
          // Spec response is a plain JSON string, not an object.
          return stringResponse(event, "Funding Request Draft Approved Succesfully");
        }
        if (status === "cancel" || status === "canceled" || status === "cancelled") {
          funding.cancel(id);
          return stringResponse(event, "Funding Request Draft Cancelled Succesfully");
        }
        throw createError({
          statusCode: 400,
          data: { businessErrors: [{ errorDescription: `Unsupported status transition '${status}'` }] },
        });
      } catch (e) {
        rejectAsError(e);
      }
    }),
  );

  // POST /dlt/:ncb/api/octopus/tms/defunding-requests — Create defunding draft
  router.post(
    "/dlt/:ncb/api/octopus/tms/defunding-requests",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const id = store.nextId("DRQ");

      // Defunding debits the source (debit side) — per issue #23 it is NOT
      // auto-created; the workflow raises a condition error if it doesn't exist.

      const now = new Date().toISOString();
      const businessDate = store.getBusinessDay().businessDate;
      const draft = defunding.create({
        id,
        amount: body.amount || "0.00",
        currency: "EUR",
        creditedWalletAlias: ISSUANCE_WALLET_ALIAS,
        debitedWalletAlias: body.debitedCashWalletAlias || "",
        // Initiator is the authenticated caller (four-eyes), never the body (#28).
        initiatorUserUUID: approverUUID(event),
        initiatorUserName: actingUsername(event),
        techFundRequestID: body.techFundRequestID,
        instructingPartyID: body.instructingPartyID,
        signature: body.signature,
        signerPEM: body.signerPEM,
        creditedCashWalletManagerID: ISSUANCE_WALLET_BIC,
        creditedCashWalletOwnerID: ISSUANCE_WALLET_BIC,
        debitedCashWalletManagerID: body.debitedCashWalletManagerID,
        debitedCashWalletOwnerID: body.debitedCashWalletOwnerID,
        // Lifecycle trail (workbench #113) — see the matching comment on the
        // FUNDING create handler above; same rationale applies here.
        historicStatus: ["INITIALIZED", "PENDING_APPROVAL"],
        timestamps: {
          INITIALIZED: { calendarDate: now, businessDate },
          PENDING_APPROVAL: { calendarDate: now, businessDate },
        },
      });

      setResponseStatus(event, 201);
      return {
        id: draft.id,
        // Mirrors the FUNDING create response shape (workbench #113) — the two
        // workflows are structural twins, so defunding's create response is
        // built the same way, with roles reversed.
        fourEyesType: "DRAFT",
        status: draft.status,
        historicStatus: null,
        timestamps: {},
        lastUpdated: typeof body.lastUpdated === "number" ? body.lastUpdated : Date.now(),
        initiatorUserUUID: draft.initiatorUserUUID,
        initiatorUserName: "",
        approverUserUUID: "",
        approverUserName: "",
        techFundRequestID: body.techFundRequestID || "",
        instructingPartyID: body.instructingPartyID || "",
        amount: draft.amount,
        currency: draft.currency,
        type: "DEFUNDING",
        creditedCashWalletAlias: draft.creditedWalletAlias,
        creditedCashWalletManagerID: ISSUANCE_WALLET_BIC,
        creditedCashWalletOwnerID: ISSUANCE_WALLET_BIC,
        debitedCashWalletAlias: draft.debitedWalletAlias,
        debitedCashWalletManagerID: body.debitedCashWalletManagerID || "",
        debitedCashWalletOwnerID: body.debitedCashWalletOwnerID || "",
        creationDate: "",
        signature: body.signature || "",
        signerPEM: body.signerPEM || "",
        // Only meaningful for this defunding-creation flow (the only value
        // the spec declares for this field).
        defundingRequestType: "D",
        settledTime: "",
        settledDate: "",
        t2AccountReference: "",
        rootCause: "",
      };
    }),
  );

  // PUT /dlt/:ncb/api/octopus/tms/defunding-requests-drafts/:id/:status — Transition
  // defunding draft. Generic {status}: approve|cancel (case-insensitive +
  // APPROVED/CANCELED). Approval enforces four-eyes and debits the source via the
  // checked DCW op (availability + debit rights verified now).
  router.put(
    "/dlt/:ncb/api/octopus/tms/defunding-requests-drafts/:id/:status",
    defineEventHandler((event) => {
      const id = getRouterParam(event, "id")!;
      const status = (getRouterParam(event, "status") || "").toLowerCase();
      const auth = event.context.auth as AuthContext | undefined;
      try {
        if (status === "approve" || status === "approved") {
          defunding.approve(id, {
            caller: auth?.entityBIC ? { entityBIC: auth.entityBIC } : undefined,
            approverUserUUID: auth?.userUUID,
            approverUserName: auth?.username,
          });
          // Spec response is a plain JSON string, not an object.
          return stringResponse(event, "Defunding Request Draft Approved Successfully");
        }
        if (status === "cancel" || status === "canceled" || status === "cancelled") {
          defunding.cancel(id);
          return stringResponse(event, "Defunding Request Draft Cancelled Successfully");
        }
        throw createError({
          statusCode: 400,
          data: { businessErrors: [{ errorDescription: `Unsupported status transition '${status}'` }] },
        });
      } catch (e) {
        rejectAsError(e);
      }
    }),
  );

  // GET /dlt/:ncb/api/octopus/tms/funding-defunding-requests-drafts/:id — Read a
  // funding OR defunding draft by id, thin `*RequestResponse` shape.
  router.get(
    "/dlt/:ncb/api/octopus/tms/funding-defunding-requests-drafts/:id",
    defineEventHandler((event: H3Event) => {
      const id = getRouterParam(event, "id")!;
      const draft = store.getDraft(id, callerOf(event));
      if (!draft || (draft.type !== "FUNDING" && draft.type !== "DEFUNDING")) {
        throw createError({
          statusCode: 404,
          data: { businessErrors: [{ errorDescription: `Request ${id} not found` }] },
        });
      }
      return fundingReadView(store, draft, { rich: false });
    }),
  );

  // GET /dlt/:ncb/api/octopus/tms/funding-defunding-requests/:id — Read a
  // funding OR defunding request by id, richer `FundingRequest` shape
  // (workbench #113; reused for both types per the official spec).
  router.get(
    "/dlt/:ncb/api/octopus/tms/funding-defunding-requests/:id",
    defineEventHandler((event: H3Event) => {
      const id = getRouterParam(event, "id")!;
      const draft = store.getDraft(id, callerOf(event));
      if (!draft || (draft.type !== "FUNDING" && draft.type !== "DEFUNDING")) {
        throw createError({
          statusCode: 404,
          data: { businessErrors: [{ errorDescription: `Request ${id} not found` }] },
        });
      }
      return fundingReadView(store, draft, { rich: true });
    }),
  );

  // PUT /dlt/:ncb/api/octopus/tms/funding-requests-drafts/:id/cancel — handled by
  // the generic {status} route above (kept as a comment for endpoint discoverability).

  return router;
}
