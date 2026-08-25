import {
  createRouter,
  defineEventHandler,
  getQuery,
  getRouterParam,
  readBody,
  setResponseStatus,
} from "h3";
import type { H3Event } from "h3";
import { randomUUID } from "node:crypto";
import type { MockStore } from "../state/mock-store.js";
import { track } from "../http/route-registry.js";
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
  const router = track(createRouter());
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

    const sellerBic = body.seller?.bic || body.sellerBIC;
    const buyerBic = body.buyer?.bic || body.buyerBIC;
    // The seller names the wallet where they want to be PAID. The buyer is
    // identified by BIC only at init — their wallet is named at payment.
    const sellerWallet =
      body.seller?.cashWalletAlias ||
      body.sellerCashWalletRef ||
      body.seller?.cashWalletRef ||
      (sellerBic ? `${sellerBic}-XVP-CASH` : undefined);
    // Spec: xvpTransactionId is a UUID (format:uuid); server-generated. A
    // client-supplied id is tolerated.
    const xvpTransactionId = body.xvpTransactionId || randomUUID();
    const transactionType = (body.type || body.transactionType || "DVP") as XvpTransactionType;

    if (!body.amount || !body.currency || !sellerWallet || !sellerBic || !buyerBic) {
      setResponseStatus(event, 400);
      return {
        businessErrors: [
          {
            errorCode: "HL-VAL-001",
            errorDescription:
              "Missing required fields: amount, currency, seller (bic + cashWalletAlias), buyer bic",
          },
        ],
      };
    }

    // Ensure the seller's receive wallet exists (credit side); no funds move at init.
    ensureWallet(store, sellerWallet, sellerBic);

    try {
      const result = workflow.init({
        xvpTransactionId,
        transactionType,
        amount: body.amount,
        currency: body.currency,
        sellerWalletAlias: sellerWallet,
        sellerBic,
        buyerBic,
        seller: body.seller,
        buyer: body.buyer,
        timeoutSec: body.timeoutSec,
      });
      // Official success is 200 + XvPInitResponse (echoes buyer/seller/amount/
      // currency/type alongside the hash-lock params). The preimage keys are a
      // mock convenience, outside the official schema.
      setResponseStatus(event, 200);
      return {
        xvpTransactionId: result.xvpTransactionId,
        executionHash: result.executionHash,
        cancellationHash: result.cancellationHash,
        timeout: result.timeout,
        buyer: body.buyer,
        seller: body.seller,
        amount: body.amount,
        currency: body.currency,
        type: transactionType,
        status: result.status,
        executionKey: result.executionKey,
        cancellationKey: result.cancellationKey,
      };
    } catch (e) {
      return reject(event, e);
    }
  });

  router.post("/igw/:ncb/v1/xvps", initHandler);
  router.post("/igw/:ncb/v1/direct-rtgs/xvps", initHandler);

  // GET XvP status — official XvPInitResponse shape.
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
        executionHash: rec.executionHash,
        cancellationHash: rec.cancellationHash,
        timeout: rec.timeout,
        buyer: rec.buyer,
        seller: rec.seller,
        amount: rec.amount,
        currency: rec.currency,
        type: rec.transactionType,
      };
    }),
  );

  // POST payment — official "Execute payment for a given XvP" (one-step): the
  // BUYER pays. Debits the buyer's named wallet and credits the seller's wallet,
  // returning the PaymentResponse + HLC secrets.
  router.post(
    "/igw/:ncb/v1/xvps/:id/payment",
    defineEventHandler(async (event) => {
      const id = getRouterParam(event, "id")!;
      const body = await readBody(event);
      const buyerBic = body.buyer?.bic || body.buyerBIC;
      const sellerBic = body.seller?.bic || body.sellerBIC;
      // The buyer names the wallet to be DEBITED (spec PaymentRequest.buyer).
      const buyerWallet =
        body.buyer?.cashWalletAlias || body.buyerCashWalletRef || body.buyer?.cashWalletRef;
      if (!buyerWallet || !body.amount || !body.currency) {
        setResponseStatus(event, 400);
        return {
          businessErrors: [
            { errorCode: "HL-VAL-001", errorDescription: "Missing required fields: buyer.cashWalletAlias, amount, currency" },
          ],
        };
      }
      try {
        const result = workflow.pay(id, {
          buyerWalletAlias: buyerWallet,
          buyerBic,
          sellerBic,
          amount: body.amount,
          currency: body.currency,
          caller: buyerBic ? { entityBIC: buyerBic } : undefined,
        });
        // Per PaymentResponse: executionKey is returned (to the buyer) on SETTLED.
        return {
          xvpTransactionId: id,
          payment: {
            id: result.paymentId,
            status: "SETTLED",
            reason: "Cash leg settled",
          },
          executionKey: result.executionKey,
        };
      } catch (e) {
        return reject(event, e);
      }
    }),
  );

  // GET payment status — official PaymentResponse. The required `key` query
  // (EXECUTION|CANCELLATION) selects which HLC secret the caller wants; the key
  // is only returned when its status allows it: executionKey to the buyer once
  // SETTLED; cancellationKey to the seller once the payment is UNSETTLED/BURNED
  // — which includes a passed timeout.
  router.get(
    "/igw/:ncb/v1/xvps/:id/payment",
    defineEventHandler((event) => {
      const id = getRouterParam(event, "id")!;
      const rec = workflow.get(id);
      if (!rec) {
        setResponseStatus(event, 404);
        return { businessErrors: [{ errorCode: "HL-XVP-002", errorDescription: `XvP transaction ${id} not found` }] };
      }
      const requested = String(getQuery(event).key || "").toUpperCase();
      const timedOut = !!rec.timeout && Date.parse(rec.timeout) < Date.now();
      // Terminal-but-unsettled state: a payment that was attempted → UNSETTLED;
      // a timeout with no payment ever attempted → BURNED (the spec burns the
      // payment on timeout to release the seller's cancellation key).
      const status =
        rec.status === "SETTLED"
          ? "SETTLED"
          : rec.status === "INITIALIZED" && !timedOut
            ? "PENDING"
            : rec.paymentAttempted
              ? "UNSETTLED"
              : "BURNED";
      const keys: { executionKey?: string; cancellationKey?: string } = {};
      if (status === "SETTLED" && requested !== "CANCELLATION") keys.executionKey = rec.executionKey;
      if ((status === "UNSETTLED" || status === "BURNED") && requested !== "EXECUTION")
        keys.cancellationKey = rec.cancellationKey;
      return {
        xvpTransactionId: rec.id,
        payment: { id: rec.paymentId, status, reason: `XvP ${status.toLowerCase()}` },
        ...keys,
      };
    }),
  );

  return router;
}
