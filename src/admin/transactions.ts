import { createRouter, defineEventHandler } from "h3";
import type { MockStore } from "../state/mock-store.js";

export function createAdminTransactionsRouter(store: MockStore) {
  const router = createRouter();

  // GET /admin/transactions — List all mock transactions
  router.get(
    "/admin/transactions",
    defineEventHandler(() => {
      return { transactions: store.getTransactions() };
    }),
  );

  return router;
}
