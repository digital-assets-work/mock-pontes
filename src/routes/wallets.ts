import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  type H3Event,
} from "h3";
import type { MockStore, Wallet } from "../state/mock-store.js";
import type { DcwCaller } from "../state/dcw.js";
import { totalOf } from "../state/dcw.js";
import type { AuthContext } from "../auth/jwt-middleware.js";
import { track } from "../http/route-registry.js";

/** The acting entity, derived from the verified JWT (issue #56 scoping). */
function callerOf(event: H3Event): DcwCaller {
  const entity = (event.context.auth as AuthContext | undefined)?.entityBIC;
  return entity ? { entityBIC: entity } : {};
}

function walletNotFound(alias: string) {
  return {
    businessErrors: [
      {
        errorCode: "HL-GER-001",
        errorDescription: `Wallet ${alias} not found`,
      },
    ],
  };
}

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
  // Scoped to the caller's entity (issue #56): only own/PoA/operated wallets.
  router.get(
    "/dlt/:ncb/api/octopus/ams/wallets",
    defineEventHandler((event) => {
      return { wallets: store.getWallets(callerOf(event)).map(toWalletResponse) };
    }),
  );

  // GET /dlt/:ncb/api/octopus/ams/wallets/:walias
  router.get(
    "/dlt/:ncb/api/octopus/ams/wallets/:walias",
    defineEventHandler((event) => {
      const walias = getRouterParam(event, "walias")!;
      // A wallet the caller may not read is masked as "not found" (404).
      const wallet = store.getWallet(walias, callerOf(event));
      if (!wallet) {
        setResponseStatus(event, 404);
        return walletNotFound(walias);
      }
      return toWalletResponse(wallet);
    }),
  );

  // GET /dlt/:ncb/api/octopus/ams/wallets/:walias/transactions
  router.get(
    "/dlt/:ncb/api/octopus/ams/wallets/:walias/transactions",
    defineEventHandler((event) => {
      const walias = getRouterParam(event, "walias")!;
      const caller = callerOf(event);
      const wallet = store.getWallet(walias, caller);
      if (!wallet) {
        setResponseStatus(event, 404);
        return walletNotFound(walias);
      }
      const transactions = store.getWalletTransactions(walias, caller);
      return { transactions };
    }),
  );

  return router;
}
