import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
} from "h3";
import { randomUUID } from "node:crypto";
import type { MockStore, Draft, Wallet } from "../state/mock-store.js";

function ensureWallet(store: MockStore, alias: string, ownerBIC: string, managerNCB: string): void {
  if (!alias || store.getWallet(alias)) return;
  const wallet: Wallet = {
    alias,
    ownerBIC,
    ownerEntityID: ownerBIC,
    managerNCB,
    balance: "0.00",
    currency: "EUR",
    isMainWallet: true,
    createdAt: new Date().toISOString(),
  };
  store.upsertWallet(wallet);
  console.log(`[mock-pontes] Auto-created wallet ${alias}`);
}

export function createTransfersRouter(store: MockStore) {
  const router = createRouter();

  // POST /dlt/:ncb/api/octopus/rvs/transactions-requests — Create transfer draft
  router.post(
    "/dlt/:ncb/api/octopus/rvs/transactions-requests",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const now = new Date().toISOString();
      const id = `TR${now.slice(2, 10).replace(/-/g, "")}${String(Math.floor(Math.random() * 999999)).padStart(6, "0")}`;

      // Auto-create wallets if they don't exist (mock convenience)
      ensureWallet(store, body.creditedCashWalletAlias, body.creditedCashWalletOwnerID || "UNKNOWN", body.creditedCashWalletManagerID || "UNKNOWN");
      ensureWallet(store, body.debitedCashWalletAlias, body.debitedCashWalletOwnerID || "UNKNOWN", body.debitedCashWalletManagerID || "UNKNOWN");

      const draft: Draft = {
        id,
        type: "TRANSFER",
        status: "PENDING_APPROVAL",
        amount: body.amountTransferred || "0.00",
        currency: "EUR",
        creditedWalletAlias: body.creditedCashWalletAlias || "",
        debitedWalletAlias: body.debitedCashWalletAlias || "",
        createdAt: now,
        updatedAt: now,
        initiatorUserUUID: body.initiatorUserUUID,
        supplementaryData: body.supplementaryData,
      };
      store.addDraft(draft);

      setResponseStatus(event, 201);
      return {
        instructionID: draft.id,
        status: draft.status,
        type: "TRANSFER",
        amountTransferred: draft.amount,
        currency: draft.currency,
        creditedCashWalletAlias: draft.creditedWalletAlias,
        debitedCashWalletAlias: draft.debitedWalletAlias,
        createdAt: draft.createdAt,
        supplementaryData: draft.supplementaryData,
      };
    }),
  );

  // GET /dlt/:ncb/api/octopus/ims/transactions — Retrieve Cash Token Transaction
  // List (any status, including PENDING_APPROVAL). Mirrors the real Pontes
  // `ims/transactions` query endpoint used to surface in-flight drafts.
  router.get(
    "/dlt/:ncb/api/octopus/ims/transactions",
    defineEventHandler(() => {
      return store.getDrafts().map((d) => ({
        instructionLTID: d.id,
        type: d.type,
        etatsUX: d.status,
        amountTransferred: d.amount,
        currency: d.currency,
        creditedCashWalletAlias: d.creditedWalletAlias,
        debitedCashWalletAlias: d.debitedWalletAlias,
        creationDate: d.createdAt,
        supplementaryData: d.supplementaryData,
      }));
    }),
  );

  // PUT /dlt/:ncb/api/octopus/rvs/transactions-drafts/:id/approve — Approve draft
  router.put(
    "/dlt/:ncb/api/octopus/rvs/transactions-drafts/:id/approve",
    defineEventHandler(async (event) => {
      const id = getRouterParam(event, "id")!;
      const draft = store.getDraft(id);
      if (!draft) {
        setResponseStatus(event, 404);
        return {
          businessErrors: [
            { errorCode: "HL-GER-001", errorDescription: `Draft ${id} not found` },
          ],
        };
      }
      if (draft.status !== "PENDING_APPROVAL") {
        setResponseStatus(event, 409);
        return {
          businessErrors: [
            {
              errorCode: "HL-GER-002",
              errorDescription: `Draft ${id} is in status ${draft.status}, cannot approve`,
            },
          ],
        };
      }

      // Settle the transfer immediately in the mock
      const creditedWallet = store.getWallet(draft.creditedWalletAlias);
      const debitedWallet = store.getWallet(draft.debitedWalletAlias);

      if (debitedWallet) {
        const newBalance = (
          parseFloat(debitedWallet.balance) - parseFloat(draft.amount)
        ).toFixed(2);
        store.upsertWallet({ ...debitedWallet, balance: newBalance });
      }
      if (creditedWallet) {
        const newBalance = (
          parseFloat(creditedWallet.balance) + parseFloat(draft.amount)
        ).toFixed(2);
        store.upsertWallet({ ...creditedWallet, balance: newBalance });
      }

      store.updateDraft(id, { status: "SETTLED" });
      store.addTransaction({
        id: `TX-${randomUUID()}`,
        type: "TRANSFER",
        status: "SETTLED",
        amount: draft.amount,
        currency: draft.currency,
        creditedWalletAlias: draft.creditedWalletAlias,
        debitedWalletAlias: draft.debitedWalletAlias,
        createdAt: draft.createdAt,
        settledAt: new Date().toISOString(),
        supplementaryData: draft.supplementaryData,
      });

      const updated = store.getDraft(id)!;
      return {
        instructionID: updated.id,
        status: updated.status,
        type: "TRANSFER",
        amountTransferred: updated.amount,
        currency: updated.currency,
        creditedCashWalletAlias: updated.creditedWalletAlias,
        debitedCashWalletAlias: updated.debitedWalletAlias,
        settledAt: new Date().toISOString(),
      };
    }),
  );

  // PUT /dlt/:ncb/api/octopus/rvs/transactions-drafts/:id/cancel — Cancel draft
  router.put(
    "/dlt/:ncb/api/octopus/rvs/transactions-drafts/:id/cancel",
    defineEventHandler(async (event) => {
      const id = getRouterParam(event, "id")!;
      const draft = store.getDraft(id);
      if (!draft) {
        setResponseStatus(event, 404);
        return {
          businessErrors: [
            { errorCode: "HL-GER-001", errorDescription: `Draft ${id} not found` },
          ],
        };
      }
      if (draft.status !== "PENDING_APPROVAL") {
        setResponseStatus(event, 409);
        return {
          businessErrors: [
            {
              errorCode: "HL-GER-002",
              errorDescription: `Draft ${id} is in status ${draft.status}, cannot cancel`,
            },
          ],
        };
      }

      store.updateDraft(id, { status: "CANCELED" });
      const updated = store.getDraft(id)!;
      return {
        instructionID: updated.id,
        status: updated.status,
        type: "TRANSFER",
        amountTransferred: updated.amount,
        currency: updated.currency,
        creditedCashWalletAlias: updated.creditedWalletAlias,
        debitedCashWalletAlias: updated.debitedWalletAlias,
      };
    }),
  );

  return router;
}
