/**
 * Mock Store Interface — defines the state contract for the Pontes mock.
 */

export interface Wallet {
  alias: string;
  ownerBIC: string;
  ownerEntityID: string;
  managerNCB: string;
  balance: string; // "0.00" format
  currency: string;
  isMainWallet: boolean;
  createdAt: string;
}

export interface Transaction {
  id: string;
  type: "FUNDING" | "DEFUNDING" | "TRANSFER";
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
  type: "FUNDING" | "DEFUNDING" | "TRANSFER";
  status:
    | "INITIALIZED"
    | "PENDING_APPROVAL"
    | "ACCEPTED"
    | "CANCELED"
    | "SETTLED"
    | "FAILED";
  amount: string;
  currency: string;
  creditedWalletAlias: string;
  debitedWalletAlias: string;
  createdAt: string;
  updatedAt: string;
  initiatorUserUUID?: string;
  approverUserUUID?: string;
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
