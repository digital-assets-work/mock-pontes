import {
  createRouter,
  defineEventHandler,
  getQuery,
  getRouterParam,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { createHash } from "node:crypto";
import type { MockStore, Transaction, Wallet } from "../state/mock-store.js";
import type { DcwCaller } from "../state/dcw.js";
import { totalOf } from "../state/dcw.js";
import type { AuthContext } from "../auth/jwt-middleware.js";
import { track } from "../http/route-registry.js";
import { getGrsEntity } from "../state/grs-entities.js";
import { networkId } from "./transfers.js";
import { ISSUANCE_WALLET_ALIAS, ISSUANCE_WALLET_BIC } from "../state/issuance-wallet.js";

/** The acting entity, derived from the verified JWT (issue #56 scoping). */
function callerOf(event: H3Event): DcwCaller {
  const entity = (event.context.auth as AuthContext | undefined)?.entityBIC;
  return entity ? { entityBIC: entity } : {};
}

const OPERATION_TYPE_BY_TX_TYPE: Record<Transaction["type"], "Issuance" | "Redemption" | "Transfer"> = {
  FUNDING: "Issuance",
  DEFUNDING: "Redemption",
  TRANSFER: "Transfer",
  DIRECT_RTGS: "Transfer",
  PFOD: "Transfer",
  XVP: "Transfer",
};

/** Resolves the owner/manager BIC of a move-leg wallet, with the ECB issuance-wallet fallback. */
function moveParty(alias: string, store: MockStore): { owner?: string; manager?: string } {
  const wallet = store.getWallet(alias);
  if (wallet) return { owner: wallet.ownerBIC, manager: wallet.managerNCB };
  if (alias === ISSUANCE_WALLET_ALIAS) return { owner: ISSUANCE_WALLET_BIC, manager: ISSUANCE_WALLET_BIC };
  return {};
}

/**
 * Maps an internal Transaction to the spec's `octopus.Settlement` shape, as seen
 * from the queried wallet (`moveDirection` = CDIT/DBIT relative to `walias`).
 * The endpoint's spec response is a bare `octopus.Settlement[]`, not the
 * internal Transaction shape — this was previously leaked verbatim.
 */
function toSettlement(tx: Transaction, walias: string, store: MockStore) {
  const credited = moveParty(tx.creditedWalletAlias, store);
  const debited = moveParty(tx.debitedWalletAlias, store);
  const settledAt = tx.settledAt ?? tx.createdAt;
  return {
    settlementID: tx.id,
    type: "CASH",
    requestType: "OPERATION",
    operationType: OPERATION_TYPE_BY_TX_TYPE[tx.type],
    // `moveType` ("SI"|"LT" per the spec's own example) has no equivalent
    // concept in this mock — fixed to the spec's example value, mirroring the
    // `settlementType` convention below (workbench issue #114).
    moveType: "LT",
    amount: tx.amount,
    currency: tx.currency,
    moveDirection: walias === tx.creditedWalletAlias ? "CDIT" : "DBIT",
    moveSource: tx.debitedWalletAlias,
    moveSourceOwner: debited.owner,
    moveSourceManager: debited.manager,
    moveDestination: tx.creditedWalletAlias,
    moveDestinationOwner: credited.owner,
    moveDestinationManager: credited.manager,
    // Single-network mock — same id `transferView()`/`imsTransactionView()`
    // echo on the RVS/IMS side (workbench issue #114).
    creditedNetwork: networkId(),
    debitedNetwork: networkId(),
    fundingRequestID: tx.fundingRequestID ?? "",
    instructingID: tx.instructingPartyID ?? "",
    operationContext: tx.operationContext ?? "",
    // Not modeled distinctly from the move-destination owner/manager above —
    // blank until a dedicated "receiving party" concept exists.
    receivingParty: "",
    receivingPartyManager: "",
    // No settlement-type modeling beyond a fixed constant, matching the
    // `transferView()` precedent in `transfers.ts`.
    settlementType: "CLRG",
    settlementDate: settledAt.slice(0, 10),
    settlementTime: settledAt,
    supplementaryData: tx.supplementaryData,
  };
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

/** `scope` vocabulary accepted by `GET .../ams/wallets`. */
const WALLET_SCOPES = ["ownedcustody", "owned", "used", "managed", "managedcustody", "poa"] as const;
type WalletScope = (typeof WALLET_SCOPES)[number];

/**
 * Resolves whether `wallet` is in-scope for `caller` under the given `scope`
 * value:
 *   - `ownedcustody`/`owned`/`used` — direct entity ownership.
 *   - `managed`/`managedcustody` — the caller's entity is the wallet's NCB manager.
 *   - `poa` — the caller's entity is a PoA grantee on the wallet.
 * This is the endpoint's own read-scoping (distinct from the generic
 * `canRead`/PoA-or-operator DCW guard, which has no "manager" concept).
 */
function inScope(scope: WalletScope, wallet: Wallet, caller: DcwCaller): boolean {
  if (!caller.entityBIC) return false;
  switch (scope) {
    case "ownedcustody":
    case "owned":
    case "used":
      return wallet.ownerEntityID === caller.entityBIC;
    case "managed":
    case "managedcustody":
      return wallet.managerNCB === caller.entityBIC;
    case "poa":
      return wallet.poaGrantees.includes(caller.entityBIC);
  }
}

function badRequest(event: H3Event, message: string): { businessErrors: unknown[] } {
  setResponseStatus(event, 400);
  return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: message }] };
}

function toWalletResponse(wallet: Wallet) {
  const owner = getGrsEntity(wallet.ownerEntityID);
  const manager = getGrsEntity(wallet.managerNCB);
  // The mock only ever creates settled (never draft) wallets synchronously —
  // there is no four-eyes wallet-creation flow — so the status/timestamps
  // fields below collapse to a single "already accepted at creation" shape.
  const acceptedAt = { calendarDate: wallet.createdAt, businessDate: wallet.createdAt.slice(0, 10) };
  return {
    walletAlias: wallet.alias,
    ownerEntityID: wallet.ownerEntityID,
    // `ownerBIC`/`managerNCB`/`balance`/`availableBalance`/`lockedBalance`/
    // `totalBalance`/`currency`/`createdAt` are mock-only fields kept for
    // backward compatibility with earlier mock consumers/tests — they are not
    // part of the real `accountmanagement.WalletBigResume` shape below.
    ownerBIC: wallet.ownerBIC,
    managerNCB: wallet.managerNCB,
    balance: wallet.balance,
    availableBalance: wallet.balance,
    lockedBalance: wallet.lockedBalance,
    totalBalance: totalOf(wallet).toFixed(2),
    currency: wallet.currency,
    createdAt: wallet.createdAt,

    // --- accountmanagement.WalletBigResume (real API shape) ---
    validFrom: wallet.validFrom,
    validTo: wallet.validTo ?? "",
    id: "",
    fourEyesType: "NORMAL",
    status: "ACCEPTED",
    historicStatus: ["PENDING_APPROVAL", "ACCEPTED"],
    timestamps: { ACCEPTED: acceptedAt, PENDING_APPROVAL: acceptedAt },
    lastUpdated: Date.parse(wallet.createdAt) || 0,
    initiatorUserUUID: "",
    initiatorUserName: "",
    approverUserUUID: "",
    approverUserName: "",
    // Opaque, stable per-alias technical id — not a secret, just needs to be
    // deterministic and mock-synthesized (no real fabflow system backs this).
    fabflowWalletID: createHash("sha256").update(wallet.alias).digest("base64"),
    holdingTable: [
      {
        holdingID: `${wallet.alias}-${wallet.currency}-AVAILABLE`,
        walletAlias: wallet.alias,
        amount: wallet.balance,
        quantity: wallet.balance,
        type: wallet.currency,
        modalityType: "NORMAL",
      },
    ],
    walletLinks: [],
    managerID: wallet.managerNCB,
    managerName: manager?.name ?? "",
    modality: "NORMAL",
    creationDate: "",
    ownerName: owner?.name ?? "",
    type: "CASH",
    userEntityID: "",
    t2AccountWalletLinks: [
      {
        validFrom: wallet.validFrom,
        validTo: wallet.validTo ?? "",
        t2AccountReference: `DCA_ACCOUNT_${wallet.ownerEntityID}`,
        t2AccountManagerID: wallet.managerNCB,
        walletAlias: wallet.alias,
        lastUpdated: 0,
        status: "ACCEPTED",
      },
    ],
    countryCode: owner?.countryCode ?? "",
    isBlocked: wallet.isBlocked,
    // No per-grantee maximumAmount/validity window is tracked today — only
    // the grantee identity (`poaGrantees`). Best-effort mapping onto the
    // `CreateInstructOnBehalf` shape, pending a real non-empty sample.
    POAs: wallet.poaGrantees.map((poaEntityID) => ({
      walletAlias: wallet.alias,
      walletOwnerID: wallet.ownerEntityID,
      walletManagerID: wallet.managerNCB,
      poaEntityID,
      validFrom: wallet.validFrom,
      validTo: wallet.validTo ?? "",
      maximumAmount: "",
    })),
    isMainWallet: wallet.isMainWallet,
    mainWalletHistoricStatus: [],
    instructingPartyID: owner?.instructingPartyID ?? "",
  };
}

export function createWalletsRouter(store: MockStore) {
  const router = track(createRouter());

  // GET /dlt/:ncb/api/octopus/ams/wallets — Retrieve Dedicated Cash Wallet list
  // Official AMS query. Replaces the former mock-only `GET /admin/wallets`.
  // Bare array response filtered by the real UI's `wallettype`/
  // `type`/`scope` query parameters rather than the earlier hardcoded
  // canRead-only scoping — `scope` is now the sole read-rights determinant for
  // this endpoint (it already covers ownership/PoA, and adds the "managed by
  // this NCB" case that the generic `canRead` guard doesn't model).
  router.get(
    "/dlt/:ncb/api/octopus/ams/wallets",
    defineEventHandler((event) => {
      const query = getQuery(event);
      const rawWalletType = typeof query.wallettype === "string" ? query.wallettype : undefined;
      const rawType = typeof query.type === "string" ? query.type : undefined;
      const rawScope = typeof query.scope === "string" ? query.scope : undefined;

      // The mock only ever creates cash wallets — `wallettype` never filters
      // anything, it's accepted/validated only (case-insensitive).
      if (rawWalletType !== undefined && rawWalletType.toUpperCase() !== "CASH") {
        return badRequest(event, `Unknown wallettype '${rawWalletType}'. Expected: CASH`);
      }
      // Spec's own `type` param (four-eyes status), distinct from `wallettype`.
      const normalizedType = rawType?.toUpperCase();
      if (normalizedType !== undefined && normalizedType !== "NORMAL" && normalizedType !== "DRAFT") {
        return badRequest(event, `Unknown type '${rawType}'. Expected: NORMAL, DRAFT`);
      }
      if (rawScope === undefined) {
        return badRequest(event, "scope is required");
      }
      const scope = rawScope.toLowerCase();
      if (!(WALLET_SCOPES as readonly string[]).includes(scope)) {
        return badRequest(event, `Unknown scope '${rawScope}'. Expected: ${WALLET_SCOPES.join(", ")}`);
      }

      // This mock never creates draft-status wallets (no four-eyes wallet
      // creation flow) — a DRAFT-status query always yields an empty list.
      if (normalizedType === "DRAFT") return [];

      const caller = callerOf(event);
      return store
        .getWallets()
        .filter((w) => inScope(scope as WalletScope, w, caller))
        .map(toWalletResponse);
    }),
  );

  // POST /dlt/:ncb/api/octopus/ams/wallets/one-step — MOCK-ONLY convenience.
  // The official `POST .../ams/wallets` creates a wallet *draft* that a second
  // user must validate (four-eyes); this non-official one-step variant lets an
  // authenticated user create a DCW immediately **for its own entity** (issue
  // #77) — the owner is taken from the verified JWT, so the credit side of a
  // settlement has a wallet to land in when it wasn't auto-created by funding.
  router.post(
    "/dlt/:ncb/api/octopus/ams/wallets/one-step",
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
      // Spec response is a bare octopus.Settlement[], not { transactions }.
      return transactions.map((tx) => toSettlement(tx, walias, store));
    }),
  );

  return router;
}
