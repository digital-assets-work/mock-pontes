import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import type { H3Event } from "h3";
import { randomUUID } from "node:crypto";
import type { MockStore, Draft } from "../state/mock-store.js";
import type { AuthContext } from "../auth/jwt-middleware.js";
import type { DcwCaller } from "../state/dcw.js";
import { resolveDraftId } from "../state/draft-id.js";
import { DirectRtgsWorkflow } from "../workflows/direct-rtgs.js";
import { isWorkflowRejection } from "../workflows/workflow.js";
import { track } from "../http/route-registry.js";

function sendRejection(event: H3Event, e: unknown): { businessErrors: unknown } {
  if (isWorkflowRejection(e)) {
    setResponseStatus(event, e.statusCode);
    return { businessErrors: e.businessErrors };
  }
  throw e;
}

function callerOf(event: H3Event): DcwCaller | undefined {
  const entity = (event.context.auth as AuthContext | undefined)?.entityBIC;
  return entity ? { entityBIC: entity } : undefined;
}

/**
 * Build the per-status-event map (`common.HistoricStatus`) that
 * `GetDirectRTGSPaymentInstruction.historicStatus` declares, from the generic
 * `Draft.historicStatus`/`timestamps` lifecycle trail already populated by
 * `Workflow.lifecycleAppend()` (workbench issue #113). `rootCause`/
 * `systemStatus` are not modeled by this mock — `null`, matching the spec's
 * own example.
 */
function historicStatusMap(d: Draft): Record<string, unknown> | undefined {
  if (!d.historicStatus) return undefined;
  const out: Record<string, unknown> = {};
  for (const status of d.historicStatus) {
    const t = d.timestamps?.[status];
    out[status] = {
      businessDate: t?.businessDate ?? null,
      date: t?.businessDate ?? null,
      rootCause: null,
      status,
      systemStatus: null,
      timestamp: t?.calendarDate ?? null,
    };
  }
  return out;
}

/**
 * `triggermanagement.DirectRTGSPaymentInstructionResponse` — the thin shape
 * returned by create and by `GET .../payments-drafts/{id}` (workbench #113).
 * Wallet aliases are intentionally NOT included: the spec doesn't declare them
 * on this schema (they remain available internally on the `Draft` for the
 * workflow's own credit/debit logic).
 */
function rtgsResponseView(store: MockStore, d: Draft): Record<string, unknown> {
  return {
    id: d.id,
    amount: d.amount,
    currency: d.currency,
    correlationId: d.correlationId ?? "",
    // Real backend uses `creationDate` for the business date of the payment
    // (not a draft-vs-settled distinction) — mirrors `transferView` (#109).
    creationDate: store.getBusinessDay().businessDate,
    // Server-asserted, never trusted from the client — this is always a
    // two-step draft (mirrors the funding/defunding create response).
    fourEyesType: "DRAFT",
    includeSubmit: false,
    initiatorUserUUID: d.initiatorUserUUID ?? "",
    instructingPartyID: d.instructingPartyID ?? "",
    isCanceled: d.status === "CANCELED",
    payerBank: d.payerBank ?? "",
    receiverBank: d.receiverBank ?? "",
    signature: d.signature ?? "",
    signerPEM: d.signerPEM ?? "",
    source: "Payment",
    // Same UUID as `id` per the spec's own example.
    techPaymentId: d.id,
    type: "Direct RTGS Payment",
  };
}

/**
 * `triggermanagement.GetDirectRTGSPaymentInstruction` — the richer shape
 * returned by `GET .../payments/{id}` (non-drafts path, workbench #113).
 * Fields with no equivalent concept in this mock (`approvalTimeOut`,
 * `isManualDefunding`, `marketDLTOperatorBuyer/Seller`, `rootCause`) are
 * blank/false, matching the established not-yet-modeled convention used
 * elsewhere (e.g. `t2AccountReference`). `supplementaryData` was dropped
 * from this schema in ECB spec v1.1 (workbench issue #132) — no longer
 * part of the documented response shape.
 */
function rtgsGetView(store: MockStore, d: Draft): Record<string, unknown> {
  return {
    amount: d.amount,
    approvalTimeOut: "",
    approverUserName: d.approverUserName ?? "",
    approverUserUUID: d.approverUserUUID ?? "",
    correlationId: d.correlationId ?? "",
    creationDate: store.getBusinessDay().businessDate,
    currency: d.currency,
    historicStatus: historicStatusMap(d),
    id: d.id,
    includeSubmit: false,
    initiatorUserName: d.initiatorUserName ?? "",
    initiatorUserUUID: d.initiatorUserUUID ?? "",
    instructingPartyID: d.instructingPartyID ?? "",
    isCanceled: d.status === "CANCELED",
    isManualDefunding: false,
    lastUpdatedBusinessDate: store.getBusinessDay().businessDate,
    lastUpdatedTime: d.updatedAt,
    marketDLTOperatorBuyer: "",
    marketDLTOperatorSeller: "",
    payerBank: d.payerBank ?? "",
    receiverBank: d.receiverBank ?? "",
    rootCause: "",
    signature: d.signature ?? "",
    signerPEM: d.signerPEM ?? "",
    source: "Payment",
    status: d.status,
    techPaymentId: d.id,
    type: "Direct RTGS Payment",
  };
}

/**
 * Direct RTGS payment router (issue #19). Composite defund(source)+fund(target).
 * Two-step (octopus/tms) and one-step (bridge) variants, both NRO-signed on
 * create (signature over `id + amount + payerBank + receiverBank`).
 */
export function createDirectRtgsRouter(store: MockStore) {
  const router = track(createRouter());
  const workflow = new DirectRtgsWorkflow(store);

  function buildInit(body: any, id: string, initiatorUserUUID?: string, initiatorUserName?: string) {
    // Both wallets must already exist (issue #93): the workflow rejects an
    // unknown credit/debit wallet (422 HL-WAL-002/003) rather than auto-creating
    // it — the error points at POST .../ams/wallets/one-step.
    return {
      id,
      amount: body.amount || "0.00",
      currency: body.currency || "EUR",
      creditedWalletAlias: body.creditedCashWalletAlias || "",
      debitedWalletAlias: body.debitedCashWalletAlias || "",
      // Initiator is the authenticated caller (four-eyes), never the body (#28).
      initiatorUserUUID,
      initiatorUserName,
      correlationId: body.correlationId,
      payerBank: body.payerBank,
      receiverBank: body.receiverBank,
      instructingPartyID: body.instructingPartyID,
      signature: body.signature,
      signerPEM: body.signerPEM,
    };
  }

  // POST /dlt/:ncb/api/octopus/tms/direct-rtgs/payments — Create 2-step draft (NRO)
  router.post(
    "/dlt/:ncb/api/octopus/tms/direct-rtgs/payments",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      // Honour a client-supplied id (also part of the NRO-signed payload);
      // mint a daily-sequence id when absent. Duplicate → 409.
      let id: string;
      try {
        id = resolveDraftId(store, "DRTGS", body.id);
      } catch (e) {
        return sendRejection(event, e);
      }
      const auth = event.context.auth as AuthContext | undefined;
      const now = new Date().toISOString();
      const businessDate = store.getBusinessDay().businessDate;
      const draft = workflow.create({
        ...buildInit(body, id, auth?.userUUID, auth?.username),
        // Lifecycle trail (workbench #113), same seed as TransferWorkflow (#109)
        // — `Workflow.lifecycleAppend()` extends it generically on approve/cancel.
        historicStatus: ["INITIALIZED", "PENDING_APPROVAL"],
        timestamps: {
          INITIALIZED: { calendarDate: now, businessDate },
          PENDING_APPROVAL: { calendarDate: now, businessDate },
        },
      });
      setResponseStatus(event, 201);
      return rtgsResponseView(store, draft);
    }),
  );

  // PUT /dlt/:ncb/api/octopus/tms/direct-rtgs/payments-drafts/:id/:status — Transition
  router.put(
    "/dlt/:ncb/api/octopus/tms/direct-rtgs/payments-drafts/:id/:status",
    defineEventHandler((event) => {
      const id = getRouterParam(event, "id")!;
      const status = (getRouterParam(event, "status") || "").toLowerCase();
      const auth = event.context.auth as AuthContext | undefined;
      try {
        if (status === "approve" || status === "approved") {
          workflow.approve(id, {
            caller: callerOf(event),
            approverUserUUID: auth?.userUUID,
            approverUserName: auth?.username,
          });
          // Spec response is a plain JSON string, not an object.
          setResponseHeader(event, "content-type", "application/json");
          return JSON.stringify("Direct RTGS Payment Draft Approved Successfully");
        }
        if (status === "cancel" || status === "canceled" || status === "cancelled") {
          workflow.cancel(id);
          setResponseHeader(event, "content-type", "application/json");
          return JSON.stringify("Direct RTGS Payment Draft Cancelled Successfully");
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

  // GET /dlt/:ncb/api/octopus/tms/direct-rtgs/payments-drafts/:id — Read a
  // single draft, thin `DirectRTGSPaymentInstructionResponse` shape.
  router.get(
    "/dlt/:ncb/api/octopus/tms/direct-rtgs/payments-drafts/:id",
    defineEventHandler((event: H3Event) => {
      const id = getRouterParam(event, "id")!;
      const draft = store.getDraft(id, callerOf(event));
      if (!draft || draft.type !== "DIRECT_RTGS") {
        setResponseStatus(event, 404);
        return { businessErrors: [{ errorCode: "HL-GER-001", errorDescription: `Direct RTGS payment ${id} not found` }] };
      }
      return rtgsResponseView(store, draft);
    }),
  );

  // GET /dlt/:ncb/api/octopus/tms/direct-rtgs/payments/:id — Read a single
  // payment, richer `GetDirectRTGSPaymentInstruction` shape (workbench #113).
  router.get(
    "/dlt/:ncb/api/octopus/tms/direct-rtgs/payments/:id",
    defineEventHandler((event: H3Event) => {
      const id = getRouterParam(event, "id")!;
      const draft = store.getDraft(id, callerOf(event));
      if (!draft || draft.type !== "DIRECT_RTGS") {
        setResponseStatus(event, 404);
        return { businessErrors: [{ errorCode: "HL-GER-001", errorDescription: `Direct RTGS payment ${id} not found` }] };
      }
      return rtgsGetView(store, draft);
    }),
  );

  // POST /dlt/:ncb/api/bridge/direct-rtgs/payments — 1-step variant (immediate, NRO)
  router.post(
    "/dlt/:ncb/api/bridge/direct-rtgs/payments",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const id = body.id || body.paymentID || randomUUID();
      const auth = event.context.auth as AuthContext | undefined;
      try {
        workflow.execute(buildInit(body, id, auth?.userUUID, auth?.username), { caller: callerOf(event) });
      } catch (e) {
        return sendRejection(event, e);
      }
      // JSON string response (issue #82) so `response.json()` works; the ECB
      // spec's "Succesfully" spelling is intentional — do NOT "correct" it.
      setResponseStatus(event, 200);
      setResponseHeader(event, "content-type", "application/json");
      return JSON.stringify("Direct RTGS Payment Settled Succesfully");
    }),
  );

  return router;
}
