import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  readBody,
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

  // POST /dlt/:ncb/api/octopus/ams/wallets — Submit a Dedicated Cash Wallet
  // Creation Request (official op). A caller may create a DCW **only for its own
  // entity** (issue #77): the owner is taken from the verified JWT, so the
  // credit side of a settlement has a wallet to land in when it wasn't
  // auto-created by funding.
  router.post(
    "/dlt/:ncb/api/octopus/ams/wallets",
    defineEventHandler(async (event) => {
      const caller = callerOf(event);
      if (!caller.entityBIC) {
        setResponseStatus(event, 403);
        return {
          businessErrors: [
            { errorCode: "HL-ATH-002", errorDescription: "An authenticated entity is required to create a wallet" },
          ],
        };
      }
      const body = (await readBody(event)) ?? {};
      const alias: unknown = body.walletAlias ?? body.alias;
      if (typeof alias !== "string" || !alias) {
        setResponseStatus(event, 400);
        return {
          businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "walletAlias is required" }],
        };
      }
      // A caller may only create wallets it will own — reject a foreign owner.
      if (body.ownerEntityID && body.ownerEntityID !== caller.entityBIC) {
        setResponseStatus(event, 403);
        return {
          businessErrors: [
            { errorCode: "HL-ATH-002", errorDescription: `You may only create wallets for your own entity (${caller.entityBIC})` },
          ],
        };
      }
      if (store.getWallet(alias)) {
        setResponseStatus(event, 409);
        return {
          businessErrors: [{ errorCode: "HL-GER-004", errorDescription: `Wallet ${alias} already exists` }],
        };
      }
      const ncb = getRouterParam(event, "ncb")!;
      const wallet = store.ensureWallet(alias, {
        ownerEntityID: caller.entityBIC,
        ownerBIC: caller.entityBIC,
        managerNCB: (typeof body.managerNCB === "string" && body.managerNCB) || ncb.toUpperCase(),
        currency: (typeof body.currency === "string" && body.currency) || "EUR",
        isMainWallet: Boolean(body.isMainWallet),
        validFrom: typeof body.validFrom === "string" ? body.validFrom : undefined,
        validTo: typeof body.validTo === "string" ? body.validTo : undefined,
      });
      setResponseStatus(event, 201);
      return toWalletResponse(wallet);
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
