import type {
  MockStore,
  Wallet,
  Transaction,
  Draft,
  BusinessWindow,
} from "./mock-store.js";
import type { CacheInterface } from "../cache/index.js";
import {
  createDcw,
  canDebit as canDebitDcw,
  withCredit,
  withDebit,
  withLock,
  withRelease,
  withSettleLocked,
  type CreateDcwOptions,
  type DcwCaller,
  type CanDebitResult,
} from "./dcw.js";

const DEFAULT_BUSINESS_WINDOW: BusinessWindow = {
  currentWindow: "OPEN_FOR_ALL",
  businessDate: new Date().toISOString().slice(0, 10),
  openTime: "08:00",
  closeTime: "18:00",
};

/** Redis key for the persisted wallet set (no expiry — wallets must not drop). */
const WALLETS_KEY = "wallets";
const PERSIST_TTL_SEC = 0; // 0 = no expiry

export class MemoryStore implements MockStore {
  private wallets: Map<string, Wallet> = new Map();
  private transactions: Transaction[] = [];
  private drafts: Map<string, Draft> = new Map();
  private businessWindow: BusinessWindow = { ...DEFAULT_BUSINESS_WINDOW };

  /**
   * Optional cache for persistence. When provided (Redis when REDIS_URL is set)
   * wallet state is written through on every mutation and reloaded via hydrate().
   */
  constructor(private readonly cache?: CacheInterface) {}

  /** Load persisted wallet state (call once at startup). */
  async hydrate(): Promise<void> {
    if (!this.cache) return;
    const stored = await this.cache.get<Wallet[]>(WALLETS_KEY);
    if (Array.isArray(stored)) {
      this.wallets = new Map(stored.map((w) => [w.alias, w]));
    }
  }

  private persistWallets(): void {
    if (!this.cache) return;
    // Fire-and-forget write-through; the in-memory map is the sync source of truth.
    void this.cache.put(WALLETS_KEY, [...this.wallets.values()], PERSIST_TTL_SEC);
  }

  // --- Wallets ---

  getWallets(): Wallet[] {
    return [...this.wallets.values()];
  }

  getWallet(alias: string): Wallet | undefined {
    return this.wallets.get(alias);
  }

  upsertWallet(wallet: Wallet): void {
    this.wallets.set(wallet.alias, wallet);
    this.persistWallets();
  }

  // --- DCW lifecycle & operations ---

  ensureWallet(alias: string, opts: CreateDcwOptions = {}): Wallet {
    const existing = this.wallets.get(alias);
    if (existing) return existing;
    const wallet = createDcw(alias, opts);
    this.upsertWallet(wallet);
    return wallet;
  }

  private requireWallet(alias: string): Wallet {
    const w = this.wallets.get(alias);
    if (!w) throw new Error(`WALLET_NOT_FOUND:${alias}`);
    return w;
  }

  credit(alias: string, amount: string): Wallet {
    const next = withCredit(this.requireWallet(alias), amount);
    this.upsertWallet(next);
    return next;
  }

  debit(alias: string, amount: string, caller: DcwCaller = {}): Wallet {
    const wallet = this.requireWallet(alias);
    const permitted = canDebitDcw(wallet, caller);
    if (!permitted.ok) throw new Error(`DCW_DEBIT_DENIED:${permitted.reason}`);
    const next = withDebit(wallet, amount);
    this.upsertWallet(next);
    return next;
  }

  lock(alias: string, amount: string): Wallet {
    const next = withLock(this.requireWallet(alias), amount);
    this.upsertWallet(next);
    return next;
  }

  release(alias: string, amount: string): Wallet {
    const next = withRelease(this.requireWallet(alias), amount);
    this.upsertWallet(next);
    return next;
  }

  settleLocked(alias: string, amount: string): Wallet {
    const next = withSettleLocked(this.requireWallet(alias), amount);
    this.upsertWallet(next);
    return next;
  }

  canDebit(alias: string, caller: DcwCaller = {}): CanDebitResult {
    const wallet = this.wallets.get(alias);
    if (!wallet) return { ok: false, reason: "WALLET_NOT_FOUND" };
    return canDebitDcw(wallet, caller);
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
    this.persistWallets();
  }
}
