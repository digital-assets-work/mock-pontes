/**
 * Mock Store Interface — defines the state contract for the Pontes mock.
 */

import type { CreateDcwOptions, DcwCaller, CanDebitResult } from "./dcw.js";

export interface Wallet {
  alias: string;
  ownerBIC: string;
  ownerEntityID: string;
  managerNCB: string;
  /** Available (spendable) balance, "0.00" format. */
  balance: string;
  /** Reserved balance held by in-flight locking workflows (e.g. XvP). */
  lockedBalance: string;
  currency: string;
  isMainWallet: boolean;
  isBlocked: boolean;
  validFrom: string;
  validTo?: string;
  /** Entity BICs granted power of attorney to debit this wallet. */
  poaGrantees: string[];
  /** Market DLT operator ids whitelisted to debit this wallet. */
  whitelistedOperators: string[];
  createdAt: string;
}

export interface Transaction {
  id: string;
  type: "FUNDING" | "DEFUNDING" | "TRANSFER" | "DIRECT_RTGS" | "PFOD" | "XVP";
  status: "SETTLED" | "PENDING" | "FAILED";
  amount: string;
  currency: string;
  creditedWalletAlias: string;
  debitedWalletAlias: string;
  createdAt: string;
  settledAt?: string;
  /** Non-standard free-text reason carried from the transfer request (mock only). */
  supplementaryData?: string;
}

export interface Draft {
  id: string;
  type: "FUNDING" | "DEFUNDING" | "TRANSFER" | "DIRECT_RTGS" | "PFOD" | "XVP";
  status:
    | "INITIALIZED"
    | "PENDING_APPROVAL"
    | "PENDING_MATCH"
    | "ACCEPTED"
    | "CANCELED"
    | "SETTLED"
    | "EXPIRED"
    | "FAILED";
  amount: string;
  currency: string;
  creditedWalletAlias: string;
  debitedWalletAlias: string;
  createdAt: string;
  updatedAt: string;
  initiatorUserUUID?: string;
  approverUserUUID?: string;
  /** Optional expiry (PFoD match window / XvP timeout). */
  expiresAt?: string;
  /** Non-standard free-text reason carried from the transfer request (mock only). */
  supplementaryData?: string;
}

/** Official Pontes business-window names, in daily sequence order. */
export type BusinessWindowName = "START_OF_DAY" | "OPEN_FOR_ALL" | "END_OF_DAY" | "CLOSED";

/**
 * The structure of a business day (issue #81). Instead of a single open/close
 * pair, the mock records the four boundary times that partition the Frankfurt
 * day into the official windows:
 *
 *   [sodStart, ofaStart) → Start of Day
 *   [ofaStart, ofaEnd)   → Open for All
 *   [ofaEnd,  eodEnd)    → End of Day
 *   outside the above     → Closed
 *
 * The current window is derived from the Frankfurt-local wall-clock time; there
 * is no stored "current window". Times must be non-decreasing
 * (`sodStart ≤ ofaStart ≤ ofaEnd ≤ eodEnd`).
 */
export interface BusinessDay {
  businessDate: string; // YYYY-MM-DD (balance value date)
  sodStart: string; // HH:mm — "Start of Day" begins
  ofaStart: string; // HH:mm — "Open for All" begins
  ofaEnd: string; // HH:mm — "Open for All" ends
  eodEnd: string; // HH:mm — "End of Day" ends
}

export interface MockStore {
  // Wallets
  getWallets(caller?: DcwCaller): Wallet[];
  getWallet(alias: string, caller?: DcwCaller): Wallet | undefined;
  upsertWallet(wallet: Wallet): void;

  // DCW lifecycle & operations
  /** Create the DCW with default settings if it doesn't exist yet; returns it. */
  ensureWallet(alias: string, opts?: CreateDcwOptions): Wallet;
  credit(alias: string, amount: string): Wallet;
  debit(alias: string, amount: string, caller?: DcwCaller): Wallet;
  lock(alias: string, amount: string): Wallet;
  release(alias: string, amount: string): Wallet;
  settleLocked(alias: string, amount: string): Wallet;
  canDebit(alias: string, caller?: DcwCaller): CanDebitResult;

  // Transactions
  getTransactions(): Transaction[];
  getWalletTransactions(alias: string, caller?: DcwCaller): Transaction[];
  addTransaction(tx: Transaction): void;

  // Drafts
  getDraft(id: string, caller?: DcwCaller): Draft | undefined;
  getDrafts(caller?: DcwCaller): Draft[];
  addDraft(draft: Draft): void;
  updateDraft(id: string, update: Partial<Draft>): void;

  /**
   * Mint a deterministic, monotonic id `${prefix}${yyMMdd}${seq:06}` using a
   * per-(prefix, day) counter (replaces Math.random minting). Collision-safe
   * and persisted with the rest of the state.
   */
  nextId(prefix: string): string;

  // Business Window
  getBusinessDay(): BusinessDay;
  setBusinessDay(day: Partial<BusinessDay>): void;

  // Reference data
  /** The NCB short names accepted on `/dlt/{ncb}` and `/igw/{ncb}` paths.
   *  Sourced from the store so it can later become an updatable concept. */
  getValidNcbs(): string[];

  // Reset
  reset(): void;
}
