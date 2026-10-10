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
import { resolveParticipantWallet } from "../state/participant-wallet.js";
import { track } from "../http/route-registry.js";
import { XvpWorkflow, type XvpTransactionType } from "../workflows/xvp.js";
import { isWorkflowRejection, unknownWalletMessage } from "../workflows/workflow.js";

/** Legacy direct-RTGS XvP init only (see note on the handler registration below). */
function ensureWallet(store: MockStore, alias: string, ownerEntityID?: string): void {
  if (!alias || store.getWallet(alias)) return;
  store.ensureWallet(alias, { ownerEntityID, ownerBIC: ownerEntityID });
  console.log(`[mock-pontes] Auto-created wallet ${alias}`);
}

/**
 * Resolve a participant's cash wallet for cash-token XvP (issue #139), shared
 * by seller init and buyer payment, and shape a failure into the route's
 * standard `{ businessErrors }` body. `side` only affects the unknown/
 * mismatched-alias error wording ("Debit" for the buyer, "Credit" for the
 * seller) — it does not change the resolution policy itself.
 */
function resolveXvpWallet(
  event: H3Event,
  store: MockStore,
  bic: string | undefined,
  explicitAlias: unknown,
  side: "Debit" | "Credit",
): { alias: string } | { businessErrors: { errorCode: string; errorDescription: string }[] } {
  const alias = typeof explicitAlias === "string" && explicitAlias ? explicitAlias : undefined;
  const result = resolveParticipantWallet(store, bic, alias);
  if (result.ok) return { alias: result.wallet.alias };
  setResponseStatus(event, 422);
  if (result.reason === "NO_PARTICIPANT_WALLET") {
    return {
      businessErrors: [
        {
          errorCode: "HL-WAL-007",
          errorDescription:
            `No cash wallet found for participant ${bic ?? "(unknown BIC)"}. Supply an explicit ` +
            `cashWalletAlias or create one first via POST /dlt/{ncb}/api/octopus/ams/wallets/one-step.`,
        },
      ],
    };
  }
  // Unknown alias, or one owned by a different participant (masked identically —
  // the caller does not learn that the alias belongs to someone else).
  return {
    businessErrors: [{ errorCode: side === "Debit" ? "HL-WAL-002" : "HL-WAL-003", errorDescription: unknownWalletMessage(side, alias ?? "") }],
  };
}

/**
 * XvP (hash-link / hashed time-lock) router on the IGW surface (issue #21).
 *
 *   POST /igw/{ncb}/v1/xvps                         → init (locks funds)
 *   POST /igw/{ncb}/v1/direct-rtgs/xvps             → init (direct-RTGS variant)
 *   GET  /igw/{ncb}/v1/xvps/{id}                    → XvP status
 *   POST /igw/{ncb}/v1/xvps/{id}/payment            → execute (debit buyer, credit seller)
 *   GET  /igw/{ncb}/v1/xvps/{id}/payment            → payment status + conditional key disclosure
 *
 * There is no cancellation *endpoint* here: cancellation is driven by the
 * seller off-ledger (e.g. on the asset leg) once the cancellation key is
 * disclosed via the GET above after a timeout — this mock does not itself
 * reverse/burn anything cash-side when that happens. Also no cross-ledger
 * atomicity is implemented or claimed: the cash and asset legs are entirely
 * independent systems from this mock's point of view.
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

  /**
   * Shared init body-shaping, used by both rail-specific handlers below: run
   * the workflow once a seller wallet alias has been decided by the caller.
   */
  async function runInit(
    event: H3Event,
    sellerWallet: string,
    sellerBic: string | undefined,
    buyerBic: string | undefined,
    body: Record<string, unknown>,
  ) {
    const xvpTransactionId = (body.xvpTransactionId as string) || randomUUID();
    const transactionType = ((body.type as string) || (body.transactionType as string) || "DVP") as XvpTransactionType;
    try {
      const result = workflow.init({
        xvpTransactionId,
        transactionType,
        amount: body.amount as string,
        currency: body.currency as string,
        sellerWalletAlias: sellerWallet,
        sellerBic,
        buyerBic,
        seller: body.seller,
        buyer: body.buyer,
        timeoutSec: body.timeoutSec as number | undefined,
      });
      // Official success is 200 + XvPInitResponse (echoes buyer/seller/amount/
      // currency/type alongside the hash-lock params). Issue #140: the
      // execution/cancellation secrets are deliberately NOT echoed here —
      // they are disclosed only via the payment-outcome query (conditional
      // disclosure: executionKey once SETTLED, cancellationKey once
      // UNSETTLED/BURNED). They remain stored internally (workflow.init()
      // persists them) for that later retrieval.
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
      };
    } catch (e) {
      return reject(event, e);
    }
  }

  // POST /igw/{ncb}/v1/xvps — cash-token XvP init. The seller names the
  // existing wallet where they want to be PAID (issue #139: an explicit
  // `cashWalletAlias` must already exist and be theirs; absent that, their own
  // main wallet — else their first wallet — is used; no fallback alias and no
  // auto-creation). The buyer is identified by BIC only at init — their
  // wallet is named at payment.
  router.post(
    "/igw/:ncb/v1/xvps",
    defineEventHandler(async (event: H3Event) => {
      const body = await readBody(event);
      const sellerBic = body.seller?.bic || body.sellerBIC;
      const buyerBic = body.buyer?.bic || body.buyerBIC;
      if (!body.amount || !body.currency || !sellerBic || !buyerBic) {
        setResponseStatus(event, 400);
        return {
          businessErrors: [
            { errorCode: "HL-VAL-001", errorDescription: "Missing required fields: amount, currency, seller.bic, buyer.bic" },
          ],
        };
      }
      const resolved = resolveXvpWallet(event, store, sellerBic, body.seller?.cashWalletAlias, "Credit");
      if ("businessErrors" in resolved) return resolved;
      return runInit(event, resolved.alias, sellerBic, buyerBic, body);
    }),
  );

  // POST /igw/{ncb}/v1/direct-rtgs/xvps — direct-RTGS XvP init. Deliberately
  // NOT migrated to the cash-token wallet-resolution policy above (issue
  // #139 scope note): the official `RTGSParticipant` schema has no
  // `cashWalletAlias` at all — RTGS settles outside the DCW system — so a
  // strict existing-wallet requirement would reject every real RTGS caller.
  // Preserves the pre-#139 behavior (default-alias guess + auto-create)
  // unchanged until dedicated RTGS settlement work (out of scope here)
  // addresses this rail properly.
  router.post(
    "/igw/:ncb/v1/direct-rtgs/xvps",
    defineEventHandler(async (event: H3Event) => {
      const body = await readBody(event);
      const sellerBic = body.seller?.bic || body.sellerBIC;
      const buyerBic = body.buyer?.bic || body.buyerBIC;
      const sellerWallet = body.seller?.cashWalletAlias || (sellerBic ? `${sellerBic}-XVP-CASH` : undefined);
      if (!body.amount || !body.currency || !sellerWallet || !sellerBic || !buyerBic) {
        setResponseStatus(event, 400);
        return {
          businessErrors: [
            {
              errorCode: "HL-VAL-001",
              errorDescription: "Missing required fields: amount, currency, seller (bic + cashWalletAlias), buyer bic",
            },
          ],
        };
      }
      ensureWallet(store, sellerWallet, sellerBic);
      return runInit(event, sellerWallet, sellerBic, buyerBic, body);
    }),
  );

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
  // returning the PaymentResponse + HLC secrets. Buyer wallet resolution
  // (issue #139) follows the same policy as the seller at init: an explicit
  // `cashWalletAlias` must already exist and be theirs; absent that, their own
  // main wallet — else their first wallet — is used; no auto-creation.
  router.post(
    "/igw/:ncb/v1/xvps/:id/payment",
    defineEventHandler(async (event) => {
      const id = getRouterParam(event, "id")!;
      const body = await readBody(event);
      const buyerBic = body.buyer?.bic || body.buyerBIC;
      const sellerBic = body.seller?.bic || body.sellerBIC;
      if (!buyerBic || !body.amount || !body.currency) {
        setResponseStatus(event, 400);
        return {
          businessErrors: [
            { errorCode: "HL-VAL-001", errorDescription: "Missing required fields: buyer.bic, amount, currency" },
          ],
        };
      }
      const resolved = resolveXvpWallet(event, store, buyerBic, body.buyer?.cashWalletAlias, "Debit");
      if ("businessErrors" in resolved) return resolved;
      const buyerWallet = resolved.alias;
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
      // Issue #142: `key` must be exactly one of the official KeyType enum
      // values, verbatim. Missing, empty, repeated/multivalued (h3 parses
      // `?key=A&key=B` as an array), or case-mismatched ("execution") values
      // are all rejected with a normalised 400 — before the record is even
      // looked up, so no secret can be disclosed either way. We never coerce
      // (e.g. uppercase) an arbitrary string into a valid enum value.
      const rawKey = getQuery(event).key;
      if (rawKey !== "EXECUTION" && rawKey !== "CANCELLATION") {
        setResponseStatus(event, 400);
        return {
          businessErrors: [
            {
              errorCode: "HL-VAL-001",
              errorDescription: "Query parameter 'key' is required and must be exactly 'EXECUTION' or 'CANCELLATION'.",
            },
          ],
        };
      }
      const requested = rawKey;
      const rec = workflow.get(id);
      if (!rec) {
        setResponseStatus(event, 404);
        return { businessErrors: [{ errorCode: "HL-XVP-002", errorDescription: `XvP transaction ${id} not found` }] };
      }
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
