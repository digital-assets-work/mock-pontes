import type {
  MockStore,
  Wallet,
  Transaction,
  Draft,
  BusinessWindow,
} from "./mock-store.js";

const DEFAULT_BUSINESS_WINDOW: BusinessWindow = {
  currentWindow: "OPEN_FOR_ALL",
  businessDate: new Date().toISOString().slice(0, 10),
  openTime: "08:00",
  closeTime: "18:00",
};

export class MemoryStore implements MockStore {
  private wallets: Map<string, Wallet> = new Map();
  private transactions: Transaction[] = [];
  private drafts: Map<string, Draft> = new Map();
  private businessWindow: BusinessWindow = { ...DEFAULT_BUSINESS_WINDOW };

  // --- Wallets ---

  getWallets(): Wallet[] {
    return [...this.wallets.values()];
  }

  getWallet(alias: string): Wallet | undefined {
    return this.wallets.get(alias);
  }

  upsertWallet(wallet: Wallet): void {
    this.wallets.set(wallet.alias, wallet);
  }

  // --- Transactions ---

  getTransactions(): Transaction[] {
    return [...this.transactions];
  }

  getWalletTransactions(alias: string): Transaction[] {
    // Settled transactions only — mirrors the real Pontes
    // `ams/wallets/{walias}/transactions` endpoint (settled list).
    // Pending/in-flight drafts are served separately via `ims/transactions`.
    return this.transactions.filter(
      (tx) =>
        tx.creditedWalletAlias === alias || tx.debitedWalletAlias === alias,
    );
  }

  addTransaction(tx: Transaction): void {
    this.transactions.push(tx);
  }

  // --- Drafts ---

  getDraft(id: string): Draft | undefined {
    return this.drafts.get(id);
  }

  getDrafts(): Draft[] {
    return [...this.drafts.values()];
  }

  addDraft(draft: Draft): void {
    this.drafts.set(draft.id, draft);
  }

  updateDraft(id: string, update: Partial<Draft>): void {
    const existing = this.drafts.get(id);
    if (existing) {
      this.drafts.set(id, { ...existing, ...update, updatedAt: new Date().toISOString() });
    }
  }

  // --- Business Window ---

  getBusinessWindow(): BusinessWindow {
    return { ...this.businessWindow };
  }

  setBusinessWindow(bw: Partial<BusinessWindow>): void {
    this.businessWindow = { ...this.businessWindow, ...bw };
  }

  // --- Reset ---

  reset(): void {
    this.wallets.clear();
    this.transactions = [];
    this.drafts.clear();
    this.businessWindow = { ...DEFAULT_BUSINESS_WINDOW };
  }
}
