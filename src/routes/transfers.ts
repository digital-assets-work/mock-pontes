import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  setResponseHeader,
} from "h3";
import { randomUUID } from "node:crypto";
import type { H3Event } from "h3";
import type { MockStore, Draft } from "../state/mock-store.js";
import type { AuthContext } from "../auth/jwt-middleware.js";
import type { DcwCaller } from "../state/dcw.js";
import { resolveDraftId } from "../state/draft-id.js";
import { track } from "../http/route-registry.js";
import { TransferWorkflow } from "../workflows/transfer.js";
import { isWorkflowRejection } from "../workflows/workflow.js";

/** Build the DCW debit-rights caller from the authenticated request. */
function authCaller(event: H3Event): { caller?: DcwCaller; approverUserUUID?: string } {
  const auth = event.context.auth as AuthContext | undefined;
  return {
    caller: auth?.entityBIC ? { entityBIC: auth.entityBIC } : undefined,
    approverUserUUID: auth?.userUUID,
  };
}

/** Translate a workflow rejection into this router's error response shape. */
function sendRejection(event: H3Event, e: unknown): { businessErrors: unknown } {
  if (isWorkflowRejection(e)) {
    setResponseStatus(event, e.statusCode);
    return { businessErrors: e.businessErrors };
  }
  throw e;
}

function badRequest(event: H3Event, message: string): { businessErrors: unknown[] } {
  setResponseStatus(event, 400);
  return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: message }] };
}

/**
 * Network id echoed on every transfer/settlement view — single-network mock.
 * Exported (workbench issue #114) so `wallets.ts`'s Settlement view can reuse
 * the same id rather than duplicating the env-var lookup.
 */
export function networkId(): string {
  return process.env.PONTES_MOCK_NETWORK_ID || "mock-pontes";
}

/**
 * Build the `requestvalidation.OperationRequest`-shaped response (a HAR-capture
 * delta against the official spec). Fields sourced from the persisted
 * `Draft` are echoed as stored; a handful are always computed at view time
 * rather than persisted (`creationDate`, `senderID`, network ids, and the
 * fixed constants the real backend always returns for this mock's scope).
 *
 * `etatsUXOverride` lets the create handler present the transient
 * "INITIALIZED" state for the very first response while the persisted
 * `draft.status` is already "PENDING_APPROVAL" — confirmed by the real HAR
 * capture, which shows both states sharing the same initial timestamp.
 */
function transferView(
  store: MockStore,
  d: Draft,
  opts: { etatsUXOverride?: string } = {},
): Record<string, unknown> {
  return {
    instructionID: d.id,
    type: "TRANSFER",
    etatsUX: opts.etatsUXOverride ?? d.status,
    amountTransferred: d.amount,
    currency: d.currency,
    creditedCashWalletAlias: d.creditedWalletAlias,
    debitedCashWalletAlias: d.debitedWalletAlias,
    creditedCashWalletManagerID: d.creditedCashWalletManagerID,
    debitedCashWalletManagerID: d.debitedCashWalletManagerID,
    creditedNetworkID: networkId(),
    debitedNetworkID: networkId(),
    senderID: d.debitedCashWalletManagerID,
    instructingPartyID: d.instructingPartyID,
    onBehalfUser: d.onBehalfUser,
    cbdcRequestType: d.cbdcRequestType,
    operationContext: d.operationContext,
    ISD: d.ISD,
    ISDTimestamp: d.ISDTimestamp,
    fundingRequestID: d.fundingRequestID,
    paymentInstructionID: d.paymentInstructionID,
    techCBDCOperationID: d.techCBDCOperationID,
    historicStatus: d.historicStatus,
    timestamps: d.timestamps,
    creationDate: store.getBusinessDay().businessDate,
    initiatorUserUUID: d.initiatorUserUUID,
    approverUserUUID: d.approverUserUUID,
    isValidated: true,
    validationErrorsReport: "",
    cbdcTipsiTxID: "",
    toBeRouted: false,
    settlementType: "CLRG",
    poaID: "",
    bizMsgID: "",
    supplementaryData: d.supplementaryData,
  };
}

// Spec `type` vocabulary (requestvalidation.OperationDraftRequestDTO example:
// "ISSUANCE") is upper-case and differs from the internal Draft.type workflow
// vocabulary. `etatsUX` needs no such mapping — the schema's own examples
// (SETTLED, PENDING_APPROVAL, INITIALIZED) are the same tokens as Draft.status.
const IMS_TYPE_BY_DRAFT_TYPE: Record<Exclude<Draft["type"], "XVP">, string> = {
  FUNDING: "ISSUANCE",
  DEFUNDING: "REDEMPTION",
  TRANSFER: "TRANSFER",
  DIRECT_RTGS: "PAYMENT",
  PFOD: "PAYMENT",
};

/**
 * Build the `requestvalidation.OperationDraftRequestDTO`-shaped list-row view
 * returned by `GET .../ims/transactions` (workbench issue #114). Distinct
 * from `transferView()` above: this schema uses a different field vocabulary
 * for a few overlapping concepts (`instructionLTID` not `instructionID`,
 * `requestType` not `cbdcRequestType`, `onBehalfOwner` not `onBehalfUser`) and
 * adds owner/country-code/approver/settlement fields with no equivalent
 * concept yet modeled in this mock — those are blank/null, matching the
 * established not-yet-modeled convention used elsewhere (e.g.
 * `t2AccountReference` in `funding.ts`).
 */
function imsTransactionView(store: MockStore, d: Draft & { type: Exclude<Draft["type"], "XVP"> }): Record<string, unknown> {
  const businessDate = store.getBusinessDay().businessDate;
  const settled = d.status === "SETTLED";
  return {
    instructionLTID: d.id,
    type: IMS_TYPE_BY_DRAFT_TYPE[d.type],
    etatsUX: d.status,
    etatsUXRootCause: null,
    amountTransferred: d.amount,
    currency: d.currency,
    creditedCashWalletAlias: d.creditedWalletAlias,
    creditedCashWalletManagerID: d.creditedCashWalletManagerID,
    creditedCashWalletOwnerID: d.creditedCashWalletOwnerID ?? "",
    creditedCountryCode: "",
    creditedNetworkID: networkId(),
    debitedCashWalletAlias: d.debitedWalletAlias,
    debitedCashWalletManagerID: d.debitedCashWalletManagerID,
    debitedCountryCode: "",
    debitedNetworkID: networkId(),
    debitedT2AccountID: "",
    creationDate: d.createdAt,
    fundingRequestID: d.fundingRequestID,
    historicStatus: d.historicStatus ?? null,
    initiatorUserName: d.initiatorUserName ?? "",
    initiatorUserUUID: d.initiatorUserUUID ?? "",
    instructingPartyID: d.instructingPartyID,
    onBehalfOwner: d.onBehalfUser,
    operationContext: d.operationContext,
    requestType: d.cbdcRequestType,
    senderID: d.debitedCashWalletManagerID,
    settlementDate: settled ? businessDate : "",
    settlementTime: settled ? d.updatedAt ?? "" : "",
    settlementType: "CLRG",
    supplementaryData: d.supplementaryData,
    timestamps: d.timestamps ?? {},
    approverUserName: d.approverUserName ?? "",
    approverUserUUID: d.approverUserUUID ?? "",
    // Mock-only extras, kept for backward compatibility with existing
    // consumers of this endpoint (harmless superset per #109/#113's precedent).
    paymentInstructionID: d.paymentInstructionID,
    techCBDCOperationID: d.techCBDCOperationID,
    ISD: d.ISD,
    ISDTimestamp: d.ISDTimestamp,
    // Non-spec aliases of `onBehalfOwner`/`requestType` above, kept alongside
    // per #114's "rename or add alongside" guidance — existing consumers of
    // this endpoint (and this repo's own tests) already read these names.
    onBehalfUser: d.onBehalfUser,
    cbdcRequestType: d.cbdcRequestType,
  };
}

export function createTransfersRouter(store: MockStore) {
  const router = track(createRouter());
  const workflow = new TransferWorkflow(store);

  // POST /dlt/:ncb/api/octopus/rvs/transactions-requests — Create transfer draft
  router.post(
    "/dlt/:ncb/api/octopus/rvs/transactions-requests",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const { caller } = authCaller(event);

      // Field validation ahead of the workflow (a HAR-capture delta against the official spec): these
      // are request-shape checks, distinct from the wallet-manager business
      // rules enforced by TransferWorkflow.conditions().
      if (!body.currency || body.currency !== "EUR") {
        return badRequest(event, "currency is required and must be 'EUR'");
      }
      if (!caller?.entityBIC || body.instructingPartyID !== caller.entityBIC) {
        return badRequest(event, "instructingPartyID must match the authenticated caller");
      }
      if (body.cbdcRequestType !== "PAYMENT" && body.cbdcRequestType !== "OPERATION") {
        return badRequest(event, "cbdcRequestType must be 'PAYMENT' or 'OPERATION'");
      }
      const businessDate = store.getBusinessDay().businessDate;
      if (body.ISD && body.ISD !== businessDate) {
        return badRequest(event, `ISD must be the current business date (${businessDate})`);
      }

      // Honour a client-supplied instruction id only to detect a duplicate
      //: a non-duplicate value is ignored and a fresh
      // daily-sequence id is minted instead. Duplicate → 409.
      let id: string;
      try {
        id = resolveDraftId(store, "TR", body.instructionID);
      } catch (e) {
        return sendRejection(event, e);
      }

      const now = new Date().toISOString();
      // Both wallets must already exist (issue #93): the workflow rejects an
      // unknown credit/debit wallet (422 HL-WAL-002/003) rather than
      // auto-creating it — the error points at POST .../ams/wallets/one-step.
      // Manager-mismatch/cbdcRequestType-consistency checks run inside
      // TransferWorkflow.conditions() (HL-WAL-004/005/006).
      let draft: Draft;
      try {
        draft = workflow.create({
          id,
          amount: body.amountTransferred || "0.00",
          currency: "EUR",
          creditedWalletAlias: body.creditedCashWalletAlias || "",
          debitedWalletAlias: body.debitedCashWalletAlias || "",
          // Initiator is the authenticated caller (four-eyes), never the body (#28).
          initiatorUserUUID: (event.context.auth as AuthContext | undefined)?.userUUID,
          supplementaryData: body.supplementaryData,
          debitedCashWalletManagerID: body.debitedCashWalletManagerID,
          creditedCashWalletManagerID: body.creditedCashWalletManagerID,
          instructingPartyID: body.instructingPartyID,
          onBehalfUser: body.onBehalfUser,
          cbdcRequestType: body.cbdcRequestType,
          operationContext: body.operationContext,
          ISD: body.ISD || undefined,
          fundingRequestID: body.fundingRequestID,
          paymentInstructionID: body.paymentInstructionID,
          techCBDCOperationID: randomUUID(),
          historicStatus: ["INITIALIZED", "PENDING_APPROVAL"],
          timestamps: {
            INITIALIZED: { calendarDate: now, businessDate },
            PENDING_APPROVAL: { calendarDate: now, businessDate },
          },
        });
      } catch (e) {
        return sendRejection(event, e);
      }

      setResponseStatus(event, 201);
      // The persisted status is already PENDING_APPROVAL, but the very first
      // response presents the transient INITIALIZED state (confirmed by the
      // real HAR capture).
      return transferView(store, draft, { etatsUXOverride: "INITIALIZED" });
    }),
  );

  // GET /dlt/:ncb/api/octopus/ims/transactions — Retrieve Cash Token Transaction
  // List (any status, including PENDING_APPROVAL). Mirrors the real Pontes
  // `ims/transactions` query endpoint used to surface in-flight drafts.
  //
  // XvP HTLC records belong to the separate `/igw` domain and are read via
  // GET /igw/{ncb}/v1/xvps/{id}; they are not Cash Token Transactions and their
  // supplementaryData carries the execution/cancellation keys, so they must
  // never surface through this list.
  router.get(
    "/dlt/:ncb/api/octopus/ims/transactions",
    defineEventHandler((event) => {
      const { caller } = authCaller(event);
      return store
        .getDrafts(caller)
        .filter((d): d is Draft & { type: Exclude<Draft["type"], "XVP"> } => d.type !== "XVP")
        .map((d) => imsTransactionView(store, d));
    }),
  );

  // GET /dlt/:ncb/api/octopus/rvs/transactions-drafts/:id — Read a single draft
  router.get(
    "/dlt/:ncb/api/octopus/rvs/transactions-drafts/:id",
    defineEventHandler((event) => {
      const id = getRouterParam(event, "id")!;
      const { caller } = authCaller(event);
      const draft = store.getDraft(id, caller);
      if (!draft || draft.type !== "TRANSFER") {
        setResponseStatus(event, 404);
        return { businessErrors: [{ errorCode: "HL-GER-001", errorDescription: `Draft ${id} not found` }] };
      }
      return transferView(store, draft);
    }),
  );

  // PUT /dlt/:ncb/api/octopus/rvs/transactions-drafts/:id/:status — Transition draft.
  // Generic {status} path per the official spec; `approve`/`cancel` (and the
  // uppercase target states APPROVED/CANCELED) are accepted as aliases.
  router.put(
    "/dlt/:ncb/api/octopus/rvs/transactions-drafts/:id/:status",
    defineEventHandler((event) => {
      const id = getRouterParam(event, "id")!;
      const status = (getRouterParam(event, "status") || "").toLowerCase();
      try {
        if (status === "approve" || status === "approved") {
          const { caller, approverUserUUID } = authCaller(event);
          workflow.approve(id, { caller, approverUserUUID });
          // Spec response is a plain JSON string, not an object.
          setResponseHeader(event, "content-type", "application/json");
          return JSON.stringify("Cash Token Transaction Draft Approved Succesfully");
        }
        if (status === "cancel" || status === "canceled" || status === "cancelled") {
          workflow.cancel(id);
          setResponseHeader(event, "content-type", "application/json");
          return JSON.stringify("Cash Token Transaction Draft Cancelled Succesfully");
        }
        setResponseStatus(event, 400);
        return {
          businessErrors: [
            { errorCode: "HL-VAL-003", errorDescription: `Unsupported status transition '${status}'` },
          ],
        };
      } catch (e) {
        return sendRejection(event, e);
      }
    }),
  );

  return router;
}

