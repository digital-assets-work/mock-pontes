import {
  createRouter,
  defineEventHandler,
  readBody,
  setResponseStatus,
} from "h3";
import { randomUUID } from "node:crypto";
import type { MockStore, Wallet } from "../state/mock-store.js";

function ensureWallet(store: MockStore, alias: string, managerNCB: string): void {
  if (!alias || store.getWallet(alias)) return;
  const wallet: Wallet = {
    alias,
    ownerBIC: "UNKNOWN",
    ownerEntityID: "UNKNOWN",
    managerNCB,
    balance: "0.00",
    currency: "EUR",
    isMainWallet: true,
    createdAt: new Date().toISOString(),
  };
  store.upsertWallet(wallet);
  console.log(`[mock-pontes] Auto-created wallet ${alias}`);
}

/**
 * Bridge Cash Token Payments router.
 * 1-step payment endpoint — no draft/approve cycle.
 * POST /dlt/:ncb/api/bridge/cash-token/payments
 */
export function createBridgePaymentsRouter(store: MockStore) {
  const router = createRouter();

  router.post(
    "/dlt/:ncb/api/bridge/cash-token/payments",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const now = new Date().toISOString();

      const {
        paymentID,
        debitedCashWalletAlias,
        debitedCashWalletManagerID,
        creditedCashWalletAlias,
        creditedCashWalletManagerID,
        amount,
        currency,
      } = body;

      // Validate required fields
      if (!debitedCashWalletAlias || !creditedCashWalletAlias || !amount) {
        setResponseStatus(event, 400);
        return {
          businessErrors: [
            { errorCode: "HL-VAL-001", errorDescription: "Missing required fields: debitedCashWalletAlias, creditedCashWalletAlias, amount" },
          ],
        };
      }

      // Auto-create wallets if needed
      ensureWallet(store, debitedCashWalletAlias, debitedCashWalletManagerID || "UNKNOWN");
      ensureWallet(store, creditedCashWalletAlias, creditedCashWalletManagerID || "UNKNOWN");

      // Execute payment immediately (1-step)
      const debitedWallet = store.getWallet(debitedCashWalletAlias);
      const creditedWallet = store.getWallet(creditedCashWalletAlias);
      const amountNum = parseFloat(amount);

      if (debitedWallet) {
        const newBalance = (parseFloat(debitedWallet.balance) - amountNum).toFixed(2);
        store.upsertWallet({ ...debitedWallet, balance: newBalance });
      }
      if (creditedWallet) {
        const newBalance = (parseFloat(creditedWallet.balance) + amountNum).toFixed(2);
        store.upsertWallet({ ...creditedWallet, balance: newBalance });
      }

      const finalPaymentID = paymentID || randomUUID();

      // Record as a settled transaction
      store.addTransaction({
        id: `TX-${finalPaymentID}`,
        type: "TRANSFER",
        status: "SETTLED",
        amount: amount,
        currency: currency || "EUR",
        creditedWalletAlias: creditedCashWalletAlias,
        debitedWalletAlias: debitedCashWalletAlias,
        createdAt: now,
        settledAt: now,
      });

      setResponseStatus(event, 201);
      return {
        paymentID: finalPaymentID,
        status: "SETTLED",
        amount,
        currency: currency || "EUR",
        debitedCashWalletAlias,
        creditedCashWalletAlias,
        settledAt: now,
      };
    }),
  );

  return router;
}
