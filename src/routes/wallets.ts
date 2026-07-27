import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
} from "h3";
import type { MockStore, Wallet } from "../state/mock-store.js";
import { totalOf } from "../state/dcw.js";
import { track } from "../http/route-registry.js";

function toWalletResponse(wallet: Wallet) {
  return {
    walletAlias: wallet.alias,
    ownerEntityID: wallet.ownerEntityID,
    ownerBIC: wallet.ownerBIC,
    managerNCB: wallet.managerNCB,
    // `balance` kept for backward compatibility (= available balance).
    balance: wallet.balance,
    availableBalance: wallet.balance,
    lockedBalance: wallet.lockedBalance,
    totalBalance: totalOf(wallet).toFixed(2),
    currency: wallet.currency,
    isMainWallet: wallet.isMainWallet,
    isBlocked: wallet.isBlocked,
    holdingTable: [
      { holdingID: `${wallet.alias}-${wallet.currency}-AVAILABLE`, walletAlias: wallet.alias, type: "AVAILABLE", amount: wallet.balance },
      { holdingID: `${wallet.alias}-${wallet.currency}-LOCKED`, walletAlias: wallet.alias, type: "LOCKED", amount: wallet.lockedBalance },
    ],
    createdAt: wallet.createdAt,
  };
}

export function createWalletsRouter(store: MockStore) {
  const router = track(createRouter());

  // GET /dlt/:ncb/api/octopus/ams/wallets — Retrieve Dedicated Cash Wallet list
  // Official AMS query. Replaces the former mock-only `GET /admin/wallets`.
  router.get(
    "/dlt/:ncb/api/octopus/ams/wallets",
    defineEventHandler(() => {
      return { wallets: store.getWallets().map(toWalletResponse) };
    }),
  );

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
      return toWalletResponse(wallet);
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
