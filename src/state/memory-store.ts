import type {
  MockStore,
  Wallet,
  Transaction,
  Draft,
  BusinessWindow,
} from "./mock-store.js";
import type { CacheInterface } from "../cache/index.js";
import { fatalPersistError } from "../cache/index.js";
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

/** Redis keys for persisted state (no expiry — mock state must not drop). */
const WALLETS_KEY = "wallets";
const DRAFTS_KEY = "drafts";
const TRANSACTIONS_KEY = "transactions";
const SEQUENCES_KEY = "sequences";
const PERSIST_TTL_SEC = 0; // 0 = no expiry

export class MemoryStore implements MockStore {
  private wallets: Map<string, Wallet> = new Map();
  private transactions: Transaction[] = [];
  private drafts: Map<string, Draft> = new Map();
  /** Per-(prefix, yyMMdd) monotonic counter backing nextId(). */
  private sequences: Map<string, number> = new Map();
  private businessWindow: BusinessWindow = { ...DEFAULT_BUSINESS_WINDOW };

  /**
   * Optional cache for persistence. When provided (Redis when REDIS_URL is set)
   * wallet state is written through on every mutation and reloaded via hydrate().
   *
   * `onPersistError` is invoked if a write-through fails after the cache layer's
   * reconnect-and-retry. It defaults to a fatal handler (stop the process so k8s
   * relaunches) per issue #46 — a lost write must not be silently ignored.
   * Tests inject a spy to observe the failure without exiting.
   */
  constructor(
    private readonly cache?: CacheInterface,
    private readonly onPersistError: (err: unknown) => void = fatalPersistError,
  ) {}

  /** Fire-and-forget write-through; a post-retry failure is treated as fatal. */
  private persist(run: () => Promise<unknown>): void {
    if (!this.cache) return;
    void run().catch((err) => this.onPersistError(err));
  }

  /** Load persisted state (call once at startup). */
  async hydrate(): Promise<void> {
    if (!this.cache) return;
    const wallets = await this.cache.get<Wallet[]>(WALLETS_KEY);
    if (Array.isArray(wallets)) {
      this.wallets = new Map(wallets.map((w) => [w.alias, w]));
    }
    const drafts = await this.cache.get<Draft[]>(DRAFTS_KEY);
    if (Array.isArray(drafts)) {
      this.drafts = new Map(drafts.map((d) => [d.id, d]));
    }
    const transactions = await this.cache.get<Transaction[]>(TRANSACTIONS_KEY);
    if (Array.isArray(transactions)) {
      this.transactions = transactions;
    }
    const sequences = await this.cache.get<[string, number][]>(SEQUENCES_KEY);
    if (Array.isArray(sequences)) {
      this.sequences = new Map(sequences);
    }
  }

  private persistWallets(): void {
    // The in-memory map is the sync source of truth; the cache is written through.
    this.persist(() =>
      this.cache!.put(WALLETS_KEY, [...this.wallets.values()], PERSIST_TTL_SEC),
    );
  }

  private persistDrafts(): void {
    this.persist(() =>
      this.cache!.put(DRAFTS_KEY, [...this.drafts.values()], PERSIST_TTL_SEC),
    );
  }

  private persistTransactions(): void {
    this.persist(() =>
      this.cache!.put(TRANSACTIONS_KEY, [...this.transactions], PERSIST_TTL_SEC),
    );
  }

  private persistSequences(): void {
    this.persist(() =>
      this.cache!.put(SEQUENCES_KEY, [...this.sequences.entries()], PERSIST_TTL_SEC),
    );
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
    this.persistTransactions();
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
    this.persistDrafts();
  }

  updateDraft(id: string, update: Partial<Draft>): void {
    const existing = this.drafts.get(id);
    if (existing) {
      this.drafts.set(id, { ...existing, ...update, updatedAt: new Date().toISOString() });
      this.persistDrafts();
    }
  }

  nextId(prefix: string): string {
    const day = new Date().toISOString().slice(2, 10).replace(/-/g, ""); // yyMMdd
    const key = `${prefix}:${day}`;
    const next = (this.sequences.get(key) ?? 0) + 1;
    this.sequences.set(key, next);
    this.persistSequences();
    return `${prefix}${day}${String(next).padStart(6, "0")}`;
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
    this.sequences.clear();
    this.businessWindow = { ...DEFAULT_BUSINESS_WINDOW };
    this.persistWallets();
    this.persistDrafts();
    this.persistTransactions();
    this.persistSequences();
  }
}
