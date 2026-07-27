import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
} from "h3";
import type { H3Event } from "h3";
import type { MockStore, Draft } from "../state/mock-store.js";
import { TransferWorkflow } from "../workflows/transfer.js";
import { isWorkflowRejection } from "../workflows/workflow.js";

function ensureWallet(store: MockStore, alias: string, ownerBIC: string, managerNCB: string): void {
  if (!alias || store.getWallet(alias)) return;
  store.ensureWallet(alias, { ownerBIC, ownerEntityID: ownerBIC, managerNCB });
  console.log(`[mock-pontes] Auto-created wallet ${alias}`);
}

/** Translate a workflow rejection into this router's error response shape. */
function sendRejection(event: H3Event, e: unknown): { businessErrors: unknown } {
  if (isWorkflowRejection(e)) {
    setResponseStatus(event, e.statusCode);
    return { businessErrors: e.businessErrors };
  }
  throw e;
}

function transferView(d: Draft, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instructionID: d.id,
    status: d.status,
    type: "TRANSFER",
    amountTransferred: d.amount,
    currency: d.currency,
    creditedCashWalletAlias: d.creditedWalletAlias,
    debitedCashWalletAlias: d.debitedWalletAlias,
    ...extra,
  };
}

export function createTransfersRouter(store: MockStore) {
  const router = createRouter();
  const workflow = new TransferWorkflow(store);

  // POST /dlt/:ncb/api/octopus/rvs/transactions-requests — Create transfer draft
  router.post(
    "/dlt/:ncb/api/octopus/rvs/transactions-requests",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const now = new Date().toISOString();
      const id = `TR${now.slice(2, 10).replace(/-/g, "")}${String(Math.floor(Math.random() * 999999)).padStart(6, "0")}`;

      // Auto-create wallets if they don't exist (mock convenience)
      ensureWallet(store, body.creditedCashWalletAlias, body.creditedCashWalletOwnerID || "UNKNOWN", body.creditedCashWalletManagerID || "UNKNOWN");
      ensureWallet(store, body.debitedCashWalletAlias, body.debitedCashWalletOwnerID || "UNKNOWN", body.debitedCashWalletManagerID || "UNKNOWN");

      const draft = workflow.create({
        id,
        amount: body.amountTransferred || "0.00",
        currency: "EUR",
        creditedWalletAlias: body.creditedCashWalletAlias || "",
        debitedWalletAlias: body.debitedCashWalletAlias || "",
        initiatorUserUUID: body.initiatorUserUUID,
        supplementaryData: body.supplementaryData,
      });

      setResponseStatus(event, 201);
      return transferView(draft, {
        createdAt: draft.createdAt,
        supplementaryData: draft.supplementaryData,
      });
    }),
  );

  // GET /dlt/:ncb/api/octopus/ims/transactions — Retrieve Cash Token Transaction
  // List (any status, including PENDING_APPROVAL). Mirrors the real Pontes
  // `ims/transactions` query endpoint used to surface in-flight drafts.
  router.get(
    "/dlt/:ncb/api/octopus/ims/transactions",
    defineEventHandler(() => {
      return store.getDrafts().map((d) => ({
        instructionLTID: d.id,
        type: d.type,
        etatsUX: d.status,
        amountTransferred: d.amount,
        currency: d.currency,
        creditedCashWalletAlias: d.creditedWalletAlias,
        debitedCashWalletAlias: d.debitedWalletAlias,
        creationDate: d.createdAt,
        supplementaryData: d.supplementaryData,
      }));
    }),
  );

  // PUT /dlt/:ncb/api/octopus/rvs/transactions-drafts/:id/approve — Approve draft
  router.put(
    "/dlt/:ncb/api/octopus/rvs/transactions-drafts/:id/approve",
    defineEventHandler((event) => {
      const id = getRouterParam(event, "id")!;
      try {
        const settled = workflow.approve(id, undefined);
        return transferView(settled, { settledAt: new Date().toISOString() });
      } catch (e) {
        return sendRejection(event, e);
      }
    }),
  );

  // PUT /dlt/:ncb/api/octopus/rvs/transactions-drafts/:id/cancel — Cancel draft
  router.put(
    "/dlt/:ncb/api/octopus/rvs/transactions-drafts/:id/cancel",
    defineEventHandler((event) => {
      const id = getRouterParam(event, "id")!;
      try {
        const canceled = workflow.cancel(id);
        return transferView(canceled);
      } catch (e) {
        return sendRejection(event, e);
      }
    }),
  );

  return router;
}
