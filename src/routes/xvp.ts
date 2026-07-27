import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
} from "h3";
import type { H3Event } from "h3";
import type { MockStore } from "../state/mock-store.js";
import { XvpWorkflow, type XvpTransactionType } from "../workflows/xvp.js";
import { isWorkflowRejection } from "../workflows/workflow.js";

function ensureWallet(store: MockStore, alias: string, ownerEntityID?: string): void {
  if (!alias || store.getWallet(alias)) return;
  store.ensureWallet(alias, { ownerEntityID, ownerBIC: ownerEntityID });
  console.log(`[mock-pontes] Auto-created wallet ${alias}`);
}

/**
 * XvP (hash-link / hashed time-lock) router on the IGW surface (issue #21).
 *
 *   POST /igw/{ncb}/v1/xvps                         → init (locks funds)
 *   POST /igw/{ncb}/v1/direct-rtgs/xvps             → init (direct-RTGS variant)
 *   GET  /igw/{ncb}/v1/xvps/{id}                    → XvP status
 *   POST /igw/{ncb}/v1/xvps/{id}/payment            → execute / cancel (preimage)
 *   GET  /igw/{ncb}/v1/xvps/{id}/payment            → payment status
 */
export function createXvpRouter(store: MockStore) {
  const router = createRouter();
  const workflow = new XvpWorkflow(store);

  function reject(event: H3Event, e: unknown): { businessErrors: unknown } {
    if (isWorkflowRejection(e)) {
      setResponseStatus(event, e.statusCode);
      return { businessErrors: e.businessErrors };
    }
    throw e;
  }

  const initHandler = defineEventHandler(async (event: H3Event) => {
    const body = await readBody(event);
    const source = body.sellerCashWalletRef || body.seller?.cashWalletRef || body.seller?.cashTokenWalletRef;
    const target = body.buyerCashWalletRef || body.buyer?.cashWalletRef || body.buyer?.cashTokenWalletRef;
    const sellerBic = body.seller?.bic || body.sellerBIC;
    const buyerBic = body.buyer?.bic || body.buyerBIC;
    const xvpTransactionId = body.xvpTransactionId;

    if (!xvpTransactionId || !body.amount || !body.currency || !source || !target) {
      setResponseStatus(event, 400);
      return {
        businessErrors: [
          { errorCode: "HL-VAL-001", errorDescription: "Missing required fields: xvpTransactionId, amount, currency, seller/buyer cash wallet refs" },
        ],
      };
    }

    ensureWallet(store, source, sellerBic);
    ensureWallet(store, target, buyerBic);

    try {
      const result = workflow.init({
        xvpTransactionId,
        transactionType: (body.transactionType || "DVP") as XvpTransactionType,
        amount: body.amount,
        currency: body.currency,
        sourceWalletAlias: source,
        targetWalletAlias: target,
        timeoutSec: body.timeoutSec,
        caller: sellerBic ? { entityBIC: sellerBic } : undefined,
      });
      setResponseStatus(event, 201);
      return result;
    } catch (e) {
      return reject(event, e);
    }
  });

  router.post("/igw/:ncb/v1/xvps", initHandler);
  router.post("/igw/:ncb/v1/direct-rtgs/xvps", initHandler);

  // GET XvP status
  router.get(
    "/igw/:ncb/v1/xvps/:id",
    defineEventHandler((event) => {
      const id = getRouterParam(event, "id")!;
      const rec = workflow.get(id);
      if (!rec) {
        setResponseStatus(event, 404);
        return { businessErrors: [{ errorCode: "HL-XVP-002", errorDescription: `XvP transaction ${id} not found` }] };
      }
      return {
        xvpTransactionId: rec.id,
        status: rec.status,
        transactionType: rec.transactionType,
        amount: rec.amount,
        currency: rec.currency,
        executionHash: rec.executionHash,
        cancellationHash: rec.cancellationHash,
        timeout: rec.timeout,
      };
    }),
  );

  // POST payment (execute/cancel via preimage)
  router.post(
    "/igw/:ncb/v1/xvps/:id/payment",
    defineEventHandler(async (event) => {
      const id = getRouterParam(event, "id")!;
      const body = await readBody(event);
      const preimage = body.key || body.preimage || body.executionKey || body.cancellationKey;
      if (!preimage) {
        setResponseStatus(event, 400);
        return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "Missing required field: key (preimage)" }] };
      }
      try {
        return workflow.payment(id, preimage);
      } catch (e) {
        return reject(event, e);
      }
    }),
  );

  // GET payment status
  router.get(
    "/igw/:ncb/v1/xvps/:id/payment",
    defineEventHandler((event) => {
      const id = getRouterParam(event, "id")!;
      const rec = workflow.get(id);
      if (!rec) {
        setResponseStatus(event, 404);
        return { businessErrors: [{ errorCode: "HL-XVP-002", errorDescription: `XvP transaction ${id} not found` }] };
      }
      const paymentStatus =
        rec.status === "SETTLED" ? "SETTLED" : rec.status === "INITIALIZED" ? "PENDING" : "UNSETTLED";
      return { xvpTransactionId: rec.id, status: rec.status, paymentStatus };
    }),
  );

  return router;
}
