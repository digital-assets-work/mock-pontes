import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  createError,
} from "h3";
import type { MockStore, Draft } from "../state/mock-store.js";

/**
 * Auto-create a wallet if it doesn't exist (mock-only convenience).
 */
function ensureWallet(store: MockStore, alias: string, body: any): void {
  if (!alias || store.getWallet(alias)) return;
  const owner = body.creditedCashWalletOwnerID || body.debitedCashWalletOwnerID || "UNKNOWN";
  store.ensureWallet(alias, {
    ownerBIC: owner,
    ownerEntityID: owner,
    managerNCB: body.creditedCashWalletManagerID || body.debitedCashWalletManagerID || "UNKNOWN",
    currency: body.currency || "EUR",
  });
  console.log(`[mock-pontes] Auto-created wallet ${alias}`);
}

export function createFundingRouter(store: MockStore) {
  const router = createRouter();

  // Funding source model (mock):
  // The token-issuance wallet `WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET` is the DCA
  // that sources the funds for a funding request. In this mock it is treated as
  // having an INFINITE balance available — funding approvals always credit the
  // target wallet and never debit or balance-check the issuance wallet. This is
  // why funding is the supported way to seed cash into the mock (there is no
  // separate admin "fund" shortcut). Defunding does the reverse: it debits the
  // target wallet and credits the (infinite) issuance wallet.

  // POST /dlt/:ncb/api/octopus/tms/funding-requests — Create funding draft
  router.post(
    "/dlt/:ncb/api/octopus/tms/funding-requests",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const now = new Date().toISOString();
      const seq = String(Math.floor(Math.random() * 999999)).padStart(6, "0");
      const id = `FRQ${now.slice(2, 10).replace(/-/g, "")}${seq}`;

      // Auto-create credited wallet if it doesn't exist (mock convenience)
      ensureWallet(store, body.creditedCashWalletAlias, body);

      const draft: Draft = {
        id,
        type: "FUNDING",
        status: "PENDING_APPROVAL",
        amount: body.amount || "0.00",
        currency: "EUR",
        creditedWalletAlias: body.creditedCashWalletAlias || "",
        debitedWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
        createdAt: now,
        updatedAt: now,
        initiatorUserUUID: body.initiatorUserUUID,
      };
      store.addDraft(draft);

      setResponseStatus(event, 201);
      return {
        fundingRequestID: draft.id,
        techFundRequestID: body.techFundRequestID,
        status: draft.status,
        type: "FUNDING",
        amount: draft.amount,
        currency: draft.currency,
        creditedCashWalletAlias: draft.creditedWalletAlias,
        creditedCashWalletManagerID: body.creditedCashWalletManagerID || "",
        creditedCashWalletOwnerID: body.creditedCashWalletOwnerID || "",
        debitedCashWalletAlias: draft.debitedWalletAlias,
        debitedCashWalletManagerID: body.debitedCashWalletManagerID || "ECBFDEFFXXX",
        debitedCashWalletOwnerID: body.debitedCashWalletOwnerID || "ECBFDEFFXXX",
        createdAt: draft.createdAt,
      };
    }),
  );

  // PUT /dlt/:ncb/api/octopus/tms/funding-requests-drafts/:id/approve — Approve funding draft
  router.put(
    "/dlt/:ncb/api/octopus/tms/funding-requests-drafts/:id/approve",
    defineEventHandler(async (event) => {
      const id = getRouterParam(event, "id")!;
      const draft = store.getDraft(id);
      if (!draft || draft.type !== "FUNDING") {
        throw createError({ statusCode: 404, data: { businessErrors: [{ errorDescription: `Funding draft ${id} not found` }] } });
      }
      if (draft.status !== "PENDING_APPROVAL") {
        throw createError({ statusCode: 409, data: { businessErrors: [{ errorDescription: `Draft ${id} is in status ${draft.status}, cannot approve` }] } });
      }
      // Credit the target wallet
      const creditedWallet = store.getWallet(draft.creditedWalletAlias);
      if (creditedWallet) {
        const newBalance = (parseFloat(creditedWallet.balance) + parseFloat(draft.amount)).toFixed(2);
        store.upsertWallet({ ...creditedWallet, balance: newBalance });
      }
      store.updateDraft(id, { status: "SETTLED" });
      store.addTransaction({
        id: `TX-${id}`,
        type: "FUNDING",
        status: "SETTLED",
        amount: draft.amount,
        currency: draft.currency,
        creditedWalletAlias: draft.creditedWalletAlias,
        debitedWalletAlias: draft.debitedWalletAlias,
        createdAt: draft.createdAt,
        settledAt: new Date().toISOString(),
      });
      return { fundingRequestID: id, status: "SETTLED" };
    }),
  );

  // POST /dlt/:ncb/api/octopus/tms/defunding-requests — Create defunding draft
  router.post(
    "/dlt/:ncb/api/octopus/tms/defunding-requests",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const now = new Date().toISOString();
      const seq = String(Math.floor(Math.random() * 999999)).padStart(6, "0");
      const id = `DRQ${now.slice(2, 10).replace(/-/g, "")}${seq}`;

      // Auto-create debited wallet if it doesn't exist (mock convenience)
      ensureWallet(store, body.debitedCashWalletAlias, body);

      const draft: Draft = {
        id,
        type: "DEFUNDING",
        status: "PENDING_APPROVAL",
        amount: body.amount || "0.00",
        currency: "EUR",
        creditedWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
        debitedWalletAlias: body.debitedCashWalletAlias || "",
        createdAt: now,
        updatedAt: now,
        initiatorUserUUID: body.initiatorUserUUID,
      };
      store.addDraft(draft);

      setResponseStatus(event, 201);
      return {
        defundingRequestID: draft.id,
        status: draft.status,
        type: "DEFUNDING",
        amount: draft.amount,
        currency: draft.currency,
        debitedCashWalletAlias: draft.debitedWalletAlias,
        createdAt: draft.createdAt,
      };
    }),
  );

  // PUT /dlt/:ncb/api/octopus/tms/defunding-requests-drafts/:id/approve — Approve defunding draft
  router.put(
    "/dlt/:ncb/api/octopus/tms/defunding-requests-drafts/:id/approve",
    defineEventHandler(async (event) => {
      const id = getRouterParam(event, "id")!;
      const draft = store.getDraft(id);
      if (!draft || draft.type !== "DEFUNDING") {
        throw createError({ statusCode: 404, data: { businessErrors: [{ errorDescription: `Defunding draft ${id} not found` }] } });
      }
      if (draft.status !== "PENDING_APPROVAL") {
        throw createError({ statusCode: 409, data: { businessErrors: [{ errorDescription: `Draft ${id} is in status ${draft.status}, cannot approve` }] } });
      }
      // Debit the source wallet
      const debitedWallet = store.getWallet(draft.debitedWalletAlias);
      if (debitedWallet) {
        const newBalance = (parseFloat(debitedWallet.balance) - parseFloat(draft.amount)).toFixed(2);
        store.upsertWallet({ ...debitedWallet, balance: newBalance });
      }
      store.updateDraft(id, { status: "SETTLED" });
      store.addTransaction({
        id: `TX-${id}`,
        type: "DEFUNDING",
        status: "SETTLED",
        amount: draft.amount,
        currency: draft.currency,
        creditedWalletAlias: draft.creditedWalletAlias,
        debitedWalletAlias: draft.debitedWalletAlias,
        createdAt: draft.createdAt,
        settledAt: new Date().toISOString(),
      });
      return { defundingRequestID: id, status: "SETTLED" };
    }),
  );

  // PUT /dlt/:ncb/api/octopus/tms/funding-requests-drafts/:id/cancel — Cancel funding draft
  // Initiator-only in the real API; the mock unwinds the draft without settling.
  router.put(
    "/dlt/:ncb/api/octopus/tms/funding-requests-drafts/:id/cancel",
    defineEventHandler(async (event) => {
      const id = getRouterParam(event, "id")!;
      const draft = store.getDraft(id);
      if (!draft || draft.type !== "FUNDING") {
        throw createError({ statusCode: 404, data: { businessErrors: [{ errorDescription: `Funding draft ${id} not found` }] } });
      }
      if (draft.status !== "PENDING_APPROVAL") {
        throw createError({ statusCode: 409, data: { businessErrors: [{ errorDescription: `Draft ${id} is in status ${draft.status}, cannot cancel` }] } });
      }
      store.updateDraft(id, { status: "CANCELED" });
      return { fundingRequestID: id, status: "CANCELED" };
    }),
  );

  return router;
}
