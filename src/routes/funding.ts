import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  createError,
} from "h3";
import type { H3Event } from "h3";
import type { MockStore } from "../state/mock-store.js";
import type { AuthContext } from "../auth/jwt-middleware.js";
import { FundingWorkflow, DefundingWorkflow } from "../workflows/funding.js";
import { isWorkflowRejection } from "../workflows/workflow.js";
import { track } from "../http/route-registry.js";

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

/** UUID of the approving user (for the four-eyes check). */
function approverUUID(event: H3Event): string | undefined {
  return (event.context.auth as AuthContext | undefined)?.userUUID;
}

/** Acting entity from the verified JWT, for DCW authorisation (issue #56). */
function callerOf(event: H3Event): { entityBIC: string } | undefined {
  const entity = (event.context.auth as AuthContext | undefined)?.entityBIC;
  return entity ? { entityBIC: entity } : undefined;
}

/**
 * Auto-create a wallet if it doesn't exist (mock-only convenience).
 */
function ensureWallet(store: MockStore, alias: string, body: any): void {
  if (!alias || store.getWallet(alias)) return;
  const owner = body.creditedCashWalletOwnerID || body.debitedCashWalletOwnerID || "UNKNOWN";
  store.ensureWallet(alias, {
    ownerBIC: owner,
    ownerEntityID: owner,
    managerNCB: body.creditedCashWalletManagerID || body.debitedCashWalletManagerID || "UNKNOWN",
    currency: body.currency || "EUR",
  });
  console.log(`[mock-pontes] Auto-created wallet ${alias}`);
}

export function createFundingRouter(store: MockStore) {
  const router = track(createRouter());
  const funding = new FundingWorkflow(store);
  const defunding = new DefundingWorkflow(store);

  // Funding source model (mock):
  // The token-issuance wallet `WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET` is the DCA
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

      // Auto-create credited wallet if it doesn't exist (mock convenience)
      ensureWallet(store, body.creditedCashWalletAlias, body);

      const draft = funding.create(
        {
          id,
          amount: body.amount || "0.00",
          currency: "EUR",
          creditedWalletAlias: body.creditedCashWalletAlias || "",
          debitedWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
          // Initiator is the authenticated caller (four-eyes), never the body (#28).
          initiatorUserUUID: approverUUID(event),
        },
        { caller: callerOf(event) },
      );

      setResponseStatus(event, 201);
      return {
        id: draft.id,
        techFundRequestID: body.techFundRequestID,
        status: draft.status,
        type: "FUNDING",
        amount: draft.amount,
        currency: draft.currency,
        creditedCashWalletAlias: draft.creditedWalletAlias,
        creditedCashWalletManagerID: body.creditedCashWalletManagerID || "",
        creditedCashWalletOwnerID: body.creditedCashWalletOwnerID || "",
        debitedCashWalletAlias: draft.debitedWalletAlias,
        debitedCashWalletManagerID: body.debitedCashWalletManagerID || "ECBFDEFFXXX",
        debitedCashWalletOwnerID: body.debitedCashWalletOwnerID || "ECBFDEFFXXX",
        createdAt: draft.createdAt,
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
          funding.approve(id, { approverUserUUID: approverUUID(event) });
          return { id, status: "SETTLED" };
        }
        if (status === "cancel" || status === "canceled" || status === "cancelled") {
          funding.cancel(id);
          return { id, status: "CANCELED" };
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

      const draft = defunding.create({
        id,
        amount: body.amount || "0.00",
        currency: "EUR",
        creditedWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
        debitedWalletAlias: body.debitedCashWalletAlias || "",
        // Initiator is the authenticated caller (four-eyes), never the body (#28).
        initiatorUserUUID: approverUUID(event),
      });

      setResponseStatus(event, 201);
      return {
        id: draft.id,
        status: draft.status,
        type: "DEFUNDING",
        amount: draft.amount,
        currency: draft.currency,
        debitedCashWalletAlias: draft.debitedWalletAlias,
        createdAt: draft.createdAt,
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
          });
          return { id, status: "SETTLED" };
        }
        if (status === "cancel" || status === "canceled" || status === "cancelled") {
          defunding.cancel(id);
          return { id, status: "CANCELED" };
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
  // funding OR defunding draft by id. Also served without the `-drafts` suffix.
  const readByIdHandler = defineEventHandler((event: H3Event) => {
    const id = getRouterParam(event, "id")!;
    const draft = store.getDraft(id);
    if (!draft || (draft.type !== "FUNDING" && draft.type !== "DEFUNDING")) {
      throw createError({
        statusCode: 404,
        data: { businessErrors: [{ errorDescription: `Request ${id} not found` }] },
      });
    }
    return {
      id: draft.id,
      status: draft.status,
      type: draft.type,
      amount: draft.amount,
      currency: draft.currency,
      creditedCashWalletAlias: draft.creditedWalletAlias,
      debitedCashWalletAlias: draft.debitedWalletAlias,
      initiatorUserUUID: draft.initiatorUserUUID,
      approverUserUUID: draft.approverUserUUID,
      createdAt: draft.createdAt,
    };
  });
  router.get("/dlt/:ncb/api/octopus/tms/funding-defunding-requests-drafts/:id", readByIdHandler);
  router.get("/dlt/:ncb/api/octopus/tms/funding-defunding-requests/:id", readByIdHandler);

  // PUT /dlt/:ncb/api/octopus/tms/funding-requests-drafts/:id/cancel — handled by
  // the generic {status} route above (kept as a comment for endpoint discoverability).

  return router;
}
