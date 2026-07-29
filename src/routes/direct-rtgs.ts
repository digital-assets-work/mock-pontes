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

function rtgsView(d: Draft, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: d.id,
    status: d.status,
    type: "DIRECT_RTGS",
    amount: d.amount,
    currency: d.currency,
    creditedCashWalletAlias: d.creditedWalletAlias,
    debitedCashWalletAlias: d.debitedWalletAlias,
    ...extra,
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

  function buildInit(body: any, id: string, initiatorUserUUID?: string) {
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
      const draft = workflow.create(buildInit(body, id, (event.context.auth as AuthContext | undefined)?.userUUID));
      setResponseStatus(event, 201);
      return rtgsView(draft, { createdAt: draft.createdAt });
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
          const settled = workflow.approve(id, {
            caller: callerOf(event),
            approverUserUUID: auth?.userUUID,
          });
          return rtgsView(settled, { settledAt: new Date().toISOString() });
        }
        if (status === "cancel" || status === "canceled" || status === "cancelled") {
          return rtgsView(workflow.cancel(id));
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

  // GET /dlt/:ncb/api/octopus/tms/direct-rtgs/payments(-drafts)/:id — Read by id
  const readByIdHandler = defineEventHandler((event: H3Event) => {
    const id = getRouterParam(event, "id")!;
    const draft = store.getDraft(id, callerOf(event));
    if (!draft || draft.type !== "DIRECT_RTGS") {
      setResponseStatus(event, 404);
      return { businessErrors: [{ errorCode: "HL-GER-001", errorDescription: `Direct RTGS payment ${id} not found` }] };
    }
    return rtgsView(draft, {
      createdAt: draft.createdAt,
      initiatorUserUUID: draft.initiatorUserUUID,
      approverUserUUID: draft.approverUserUUID,
    });
  });
  router.get("/dlt/:ncb/api/octopus/tms/direct-rtgs/payments-drafts/:id", readByIdHandler);
  router.get("/dlt/:ncb/api/octopus/tms/direct-rtgs/payments/:id", readByIdHandler);

  // POST /dlt/:ncb/api/bridge/direct-rtgs/payments — 1-step variant (immediate, NRO)
  router.post(
    "/dlt/:ncb/api/bridge/direct-rtgs/payments",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const id = body.id || body.paymentID || randomUUID();
      try {
        workflow.execute(buildInit(body, id, (event.context.auth as AuthContext | undefined)?.userUUID), { caller: callerOf(event) });
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
