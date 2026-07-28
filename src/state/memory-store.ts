import type {
  MockStore,
  Wallet,
  Transaction,
  Draft,
  BusinessWindow,
} from "./mock-store.js";
import type { CacheInterface } from "../cache/index.js";
import { fatalPersistError } from "../cache/index.js";
import { OFFICIAL_NCBS } from "../auth/ncb-middleware.js";
import {
  createDcw,
  canDebit as canDebitDcw,
  canRead as canReadDcw,
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
  /** Accepted NCB short names (seeded from the official enum; updatable later). */
  private validNcbs: string[] = [...OFFICIAL_NCBS];

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

  getWallets(caller?: DcwCaller): Wallet[] {
    const all = [...this.wallets.values()];
    // Unscoped for internal callers (no caller); scoped for API callers.
    return caller ? all.filter((w) => canReadDcw(w, caller).ok) : all;
  }

  getWallet(alias: string, caller?: DcwCaller): Wallet | undefined {
    const wallet = this.wallets.get(alias);
    if (!wallet) return undefined;
    // A caller that may not read the wallet sees it as "not found" (mask).
    if (caller && !canReadDcw(wallet, caller).ok) return undefined;
    return wallet;
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

  getWalletTransactions(alias: string, caller?: DcwCaller): Transaction[] {
    // Settled transactions only — mirrors the real Pontes
    // `ams/wallets/{walias}/transactions` endpoint (settled list).
    // Pending/in-flight drafts are served separately via `ims/transactions`.
    // If the caller may not read the wallet, mask as "no such wallet" (empty);
    // the route returns 404 when the wallet itself is not readable.
    const wallet = this.wallets.get(alias);
    if (caller && (!wallet || !canReadDcw(wallet, caller).ok)) return [];
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

  /**
   * A draft is readable by a caller if they may read (issue #56 `canRead`) at
   * least one of the DCWs it references (credited or debited). This reuses the
   * wallet ownership model instead of stamping an owning entity on the draft —
   * both legs' participants can therefore see a shared in-flight draft.
   */
  private canReadDraft(draft: Draft, caller: DcwCaller): boolean {
    for (const alias of [draft.creditedWalletAlias, draft.debitedWalletAlias]) {
      const wallet = alias ? this.wallets.get(alias) : undefined;
      if (wallet && canReadDcw(wallet, caller).ok) return true;
    }
    return false;
  }

  getDraft(id: string, caller?: DcwCaller): Draft | undefined {
    const draft = this.drafts.get(id);
    if (!draft) return undefined;
    // A caller that may not read any referenced wallet sees it as "not found".
    if (caller && !this.canReadDraft(draft, caller)) return undefined;
    return draft;
  }

  getDrafts(caller?: DcwCaller): Draft[] {
    const all = [...this.drafts.values()];
    // Unscoped for internal callers (no caller); scoped for API callers.
    return caller ? all.filter((d) => this.canReadDraft(d, caller)) : all;
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

  // --- Reference data ---

  getValidNcbs(): string[] {
    return [...this.validNcbs];
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
