import {
  createRouter,
  defineEventHandler,
  readBody,
  setResponseStatus,
} from "h3";
import type { H3Event } from "h3";
import type { MockStore, Draft } from "../state/mock-store.js";
import { track } from "../http/route-registry.js";
import type { AuthContext } from "../auth/jwt-middleware.js";
import { PfodWorkflow } from "../workflows/pfod.js";
import { isWorkflowRejection, unknownWalletMessage } from "../workflows/workflow.js";

/** Match window before an unmatched PFoD leg is considered expired. */
const PFOD_MATCH_WINDOW_SEC = Number(process.env.PONTES_PFOD_MATCH_WINDOW_SEC || 3600);

const deliverId = (tradeID: string) => `PFOD-${tradeID}-DELI`;
const receiveId = (tradeID: string) => `PFOD-${tradeID}-RECE`;

function expired(leg: Draft, now: number): boolean {
  return !!leg.expiresAt && Date.parse(leg.expiresAt) < now;
}

/**
 * PFoD (Payment Free of Delivery) — matched 2-sided (issue #20).
 *
 * Two one-sided legs (deliver = seller, receive = buyer) are submitted
 * independently and matched on `tradeID`. Each leg persists as a `PENDING_MATCH`
 * PFOD draft; when its counterpart arrives (consistent `amount`/`currency`) the
 * matched wallet payment fires (debit seller, credit buyer) → `SETTLED`. An
 * unmatched leg past its window is lazily marked `EXPIRED`.
 */
export function createPfodRouter(store: MockStore) {
  const router = track(createRouter());
  const workflow = new PfodWorkflow(store);

  function reject(event: H3Event, e: unknown): { businessErrors: unknown } {
    if (isWorkflowRejection(e)) {
      setResponseStatus(event, e.statusCode);
      return { businessErrors: e.businessErrors };
    }
    throw e;
  }

  /** Persist a leg as a PENDING_MATCH draft. */
  function storeLeg(id: string, tradeID: string, amount: string, currency: string, debited: string, credited: string, initiatorUUID?: string): Draft {
    const now = new Date();
    const leg: Draft = {
      id,
      type: "PFOD",
      status: "PENDING_MATCH",
      amount,
      currency,
      creditedWalletAlias: credited,
      debitedWalletAlias: debited,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      initiatorUserUUID: initiatorUUID,
      expiresAt: new Date(now.getTime() + PFOD_MATCH_WINDOW_SEC * 1000).toISOString(),
      supplementaryData: tradeID,
    };
    store.addDraft(leg);
    return leg;
  }

  /**
   * Attempt to match + settle the two legs for a trade. Returns a response body.
   */
  function tryMatch(event: H3Event, tradeID: string): Record<string, unknown> {
    const deliver = store.getDraft(deliverId(tradeID));
    const receive = store.getDraft(receiveId(tradeID));
    if (!deliver || !receive) {
      return { tradeID, status: "PENDING_MATCH" };
    }
    const now = Date.now();
    if (expired(deliver, now) || expired(receive, now)) {
      if (expired(deliver, now)) store.updateDraft(deliver.id, { status: "EXPIRED" });
      if (expired(receive, now)) store.updateDraft(receive.id, { status: "EXPIRED" });
      setResponseStatus(event, 410);
      return { tradeID, status: "EXPIRED" };
    }
    if (deliver.status !== "PENDING_MATCH" || receive.status !== "PENDING_MATCH") {
      return { tradeID, status: deliver.status === "SETTLED" ? "SETTLED" : deliver.status };
    }
    if (deliver.amount !== receive.amount || deliver.currency !== receive.currency) {
      setResponseStatus(event, 422);
      return {
        businessErrors: [
          { errorCode: "HL-PFOD-001", errorDescription: `PFoD legs for trade ${tradeID} are inconsistent (amount/currency)` },
        ],
      };
    }
    // Match → settle: debit seller (deliver.debited), credit buyer (receive.credited).
    const seller = deliver.debitedWalletAlias;
    const buyer = receive.creditedWalletAlias;
    const sellerWallet = store.getWallet(seller);
    const caller = sellerWallet?.ownerEntityID ? { entityBIC: sellerWallet.ownerEntityID } : undefined;
    try {
      workflow.execute(
        { id: `PFOD-${tradeID}`, amount: deliver.amount, currency: deliver.currency, creditedWalletAlias: buyer, debitedWalletAlias: seller },
        { caller },
      );
    } catch (e) {
      return reject(event, e);
    }
    store.updateDraft(deliver.id, { status: "SETTLED" });
    store.updateDraft(receive.id, { status: "SETTLED" });
    return { tradeID, status: "SETTLED", debitedCashWalletAlias: seller, creditedCashWalletAlias: buyer, amount: deliver.amount, currency: deliver.currency };
  }

  // POST /dlt/:ncb/api/bridge/initpfoddeli — Deliver (seller) leg
  router.post(
    "/dlt/:ncb/api/bridge/initpfoddeli",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const { tradeID, amount, currency, sellerCashTokenWalletRef } = body;
      if (!tradeID || !amount || !currency || !sellerCashTokenWalletRef) {
        setResponseStatus(event, 400);
        return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "Missing required fields: tradeID, amount, currency, sellerCashTokenWalletRef" }] };
      }
      // The seller cash wallet is the DEBIT side of the matched settlement and
      // must already exist (issue #93) — it is never auto-created.
      if (!store.getWallet(sellerCashTokenWalletRef)) {
        setResponseStatus(event, 422);
        return { businessErrors: [{ errorCode: "HL-WAL-002", errorDescription: unknownWalletMessage("Debit", sellerCashTokenWalletRef) }] };
      }
      storeLeg(deliverId(tradeID), tradeID, amount, currency, sellerCashTokenWalletRef, "", (event.context.auth as AuthContext | undefined)?.userUUID);
      setResponseStatus(event, 201);
      return tryMatch(event, tradeID);
    }),
  );

  // POST /dlt/:ncb/api/bridge/initpfodrece — Receive (buyer) leg
  router.post(
    "/dlt/:ncb/api/bridge/initpfodrece",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const { tradeID, amount, currency, buyerCashTokenWalletRef } = body;
      if (!tradeID || !amount || !currency || !buyerCashTokenWalletRef) {
        setResponseStatus(event, 400);
        return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "Missing required fields: tradeID, amount, currency, buyerCashTokenWalletRef" }] };
      }
      // The buyer cash wallet is the CREDIT side of the matched settlement and
      // must already exist (issue #93) — it is never auto-created.
      if (!store.getWallet(buyerCashTokenWalletRef)) {
        setResponseStatus(event, 422);
        return { businessErrors: [{ errorCode: "HL-WAL-003", errorDescription: unknownWalletMessage("Credit", buyerCashTokenWalletRef) }] };
      }
      storeLeg(receiveId(tradeID), tradeID, amount, currency, "", buyerCashTokenWalletRef, (event.context.auth as AuthContext | undefined)?.userUUID);
      setResponseStatus(event, 201);
      return tryMatch(event, tradeID);
    }),
  );

  return router;
}
