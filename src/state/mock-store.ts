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

export interface BusinessWindow {
  currentWindow: "CLOSED" | "START_OF_DAY" | "OPEN_FOR_ALL" | "END_OF_DAY";
  businessDate: string; // YYYY-MM-DD
  openTime: string; // HH:mm
  closeTime: string; // HH:mm
}

export interface MockStore {
  // Wallets
  getWallets(): Wallet[];
  getWallet(alias: string): Wallet | undefined;
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
  getWalletTransactions(alias: string): Transaction[];
  addTransaction(tx: Transaction): void;

  // Drafts
  getDraft(id: string): Draft | undefined;
  getDrafts(): Draft[];
  addDraft(draft: Draft): void;
  updateDraft(id: string, update: Partial<Draft>): void;

  // Business Window
  getBusinessWindow(): BusinessWindow;
  setBusinessWindow(bw: Partial<BusinessWindow>): void;

  // Reset
  reset(): void;
}
