import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
} from "h3";
import { randomUUID } from "node:crypto";
import type { MockStore } from "../state/mock-store.js";

export function createAdminWalletsRouter(store: MockStore) {
  const router = createRouter();

  // GET /admin/wallets — List all mock wallets
  router.get(
    "/admin/wallets",
    defineEventHandler(() => {
      return { wallets: store.getWallets() };
    }),
  );

  // GET /admin/wallets/:alias — Wallet detail with transaction log
  router.get(
    "/admin/wallets/:alias",
    defineEventHandler((event) => {
      const alias = getRouterParam(event, "alias")!;
      const wallet = store.getWallet(alias);
      if (!wallet) {
        setResponseStatus(event, 404);
        return { error: `Wallet ${alias} not found` };
      }
      const transactions = store.getWalletTransactions(alias);
      return { wallet, transactions };
    }),
  );

  // POST /admin/wallets/:alias/fund — Simulate funding (credit wallet)
  router.post(
    "/admin/wallets/:alias/fund",
    defineEventHandler(async (event) => {
      const alias = getRouterParam(event, "alias")!;
      const body = await readBody(event);
      const amount = body.amount || "0.00";

      let wallet = store.getWallet(alias);
      if (!wallet) {
        // Auto-create wallet on fund
        wallet = {
          alias,
          ownerBIC: body.ownerBIC || "UNKNOWNXXXXX",
          ownerEntityID: body.ownerEntityID || alias,
          managerNCB: body.managerNCB || "BDF",
          balance: "0.00",
          currency: "EUR",
          isMainWallet: true,
          createdAt: new Date().toISOString(),
        };
      }

      const newBalance = (parseFloat(wallet.balance) + parseFloat(amount)).toFixed(2);
      store.upsertWallet({ ...wallet, balance: newBalance });

      const tx = {
        id: `TX-${randomUUID()}`,
        type: "FUNDING" as const,
        status: "SETTLED" as const,
        amount,
        currency: "EUR",
        creditedWalletAlias: alias,
        debitedWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
        createdAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
      };
      store.addTransaction(tx);

      return { wallet: store.getWallet(alias), transaction: tx };
    }),
  );

  // POST /admin/wallets/:alias/defund — Simulate defunding (debit wallet)
  router.post(
    "/admin/wallets/:alias/defund",
    defineEventHandler(async (event) => {
      const alias = getRouterParam(event, "alias")!;
      const body = await readBody(event);
      const amount = body.amount || "0.00";

      const wallet = store.getWallet(alias);
      if (!wallet) {
        setResponseStatus(event, 404);
        return { error: `Wallet ${alias} not found` };
      }

      const newBalance = (parseFloat(wallet.balance) - parseFloat(amount)).toFixed(2);
      store.upsertWallet({ ...wallet, balance: newBalance });

      const tx = {
        id: `TX-${randomUUID()}`,
        type: "DEFUNDING" as const,
        status: "SETTLED" as const,
        amount,
        currency: "EUR",
        creditedWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
        debitedWalletAlias: alias,
        createdAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
      };
      store.addTransaction(tx);

      return { wallet: store.getWallet(alias), transaction: tx };
    }),
  );

  return router;
}
