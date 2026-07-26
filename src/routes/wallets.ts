import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
} from "h3";
import type { MockStore } from "../state/mock-store.js";

export function createWalletsRouter(store: MockStore) {
  const router = createRouter();

  // GET /dlt/:ncb/api/octopus/ams/wallets/:walias
  router.get(
    "/dlt/:ncb/api/octopus/ams/wallets/:walias",
    defineEventHandler((event) => {
      const walias = getRouterParam(event, "walias")!;
      const wallet = store.getWallet(walias);
      if (!wallet) {
        setResponseStatus(event, 404);
        return {
          businessErrors: [
            {
              errorCode: "HL-GER-001",
              errorDescription: `Wallet ${walias} not found`,
            },
          ],
        };
      }
      return {
        walletAlias: wallet.alias,
        ownerEntityID: wallet.ownerEntityID,
        ownerBIC: wallet.ownerBIC,
        managerNCB: wallet.managerNCB,
        balance: wallet.balance,
        currency: wallet.currency,
        isMainWallet: wallet.isMainWallet,
        createdAt: wallet.createdAt,
      };
    }),
  );

  // GET /dlt/:ncb/api/octopus/ams/wallets/:walias/transactions
  router.get(
    "/dlt/:ncb/api/octopus/ams/wallets/:walias/transactions",
    defineEventHandler((event) => {
      const walias = getRouterParam(event, "walias")!;
      const wallet = store.getWallet(walias);
      if (!wallet) {
        setResponseStatus(event, 404);
        return {
          businessErrors: [
            {
              errorCode: "HL-GER-001",
              errorDescription: `Wallet ${walias} not found`,
            },
          ],
        };
      }
      const transactions = store.getWalletTransactions(walias);
      return { transactions };
    }),
  );

  return router;
}
