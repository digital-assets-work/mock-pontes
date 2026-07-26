import {
  createRouter,
  defineEventHandler,
  readBody,
  setResponseStatus,
} from "h3";
import { randomUUID } from "node:crypto";
import type { MockStore } from "../state/mock-store.js";

export function createAdminTransfersRouter(store: MockStore) {
  const router = createRouter();

  // POST /admin/transfers — Simulate transfer between wallets
  router.post(
    "/admin/transfers",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const { fromWallet, toWallet, amount } = body;

      if (!fromWallet || !toWallet || !amount) {
        setResponseStatus(event, 400);
        return { error: "Missing required fields: fromWallet, toWallet, amount" };
      }

      const source = store.getWallet(fromWallet);
      const dest = store.getWallet(toWallet);

      if (!source) {
        setResponseStatus(event, 404);
        return { error: `Source wallet ${fromWallet} not found` };
      }
      if (!dest) {
        setResponseStatus(event, 404);
        return { error: `Destination wallet ${toWallet} not found` };
      }

      const transferAmount = parseFloat(amount);
      const sourceBalance = (parseFloat(source.balance) - transferAmount).toFixed(2);
      const destBalance = (parseFloat(dest.balance) + transferAmount).toFixed(2);

      store.upsertWallet({ ...source, balance: sourceBalance });
      store.upsertWallet({ ...dest, balance: destBalance });

      const tx = {
        id: `TX-${randomUUID()}`,
        type: "TRANSFER" as const,
        status: "SETTLED" as const,
        amount: transferAmount.toFixed(2),
        currency: "EUR",
        creditedWalletAlias: toWallet,
        debitedWalletAlias: fromWallet,
        createdAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
      };
      store.addTransaction(tx);

      return {
        transaction: tx,
        fromWallet: store.getWallet(fromWallet),
        toWallet: store.getWallet(toWallet),
      };
    }),
  );

  return router;
}
