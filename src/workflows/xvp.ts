import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DcwCaller } from "../state/dcw.js";
import { Workflow, WorkflowRejection } from "./workflow.js";

export type XvpTransactionType = "DVP" | "PVP";
export type XvpKeyType = "EXECUTION" | "CANCELLATION";

export interface XvpInitParams {
  xvpTransactionId: string;
  transactionType: XvpTransactionType;
  amount: string;
  currency: string;
  sellerWalletAlias: string; // where the seller is PAID (credited on execution)
  sellerBic?: string;
  buyerBic?: string;         // the entity expected to pay
  seller?: unknown;          // echoed back by GET (Participant)
  buyer?: unknown;           // echoed back by GET (SimpleParticipant)
  timeoutSec?: number;
}

export interface XvpPaymentParams {
  buyerWalletAlias: string; // the buyer's cash wallet, DEBITED on execution
  buyerBic?: string;
  sellerBic?: string;
  amount: string;
  currency: string;
  caller?: DcwCaller;       // buyer's entity, for debit rights
}

export interface XvpInitResult {
  xvpTransactionId: string;
  status: "INITIALIZED";
  executionHash: string;
  cancellationHash: string;
  /** Mock convenience: the preimages are returned so a client can execute/cancel. */
  executionKey: string;
  cancellationKey: string;
  timeout: string;
}

const DEFAULT_TIMEOUT_SEC = Number(process.env.PONTES_XVP_TIMEOUT_SEC || 3600);

function sha256Hex(preimage: string): string {
  return createHash("sha256").update(preimage).digest("hex");
}

/**
 * XvP (Hash-Linked cash leg).
 *
 * `init` (by the seller) registers the XvP — the seller's receive wallet, the
 * buyer's BIC, amount/currency — and issues an `executionHash`, a
 * `cancellationHash` and a `timeout`. No funds move at init.
 *
 * `pay` (by the buyer) settles the cash leg: it debits the buyer's wallet
 * and credits the seller's wallet, provided the buyer/seller BICs, amount and
 * currency match the initialisation, the buyer wallet is funded, and the caller
 * may debit it. The HLC secrets are returned so the buyer can drive the asset
 * leg.
 *
 * XvP records are persisted as `XVP` drafts (hash/key/BIC metadata in
 * `supplementaryData` as JSON).
 */
export class XvpWorkflow extends Workflow {
  readonly type = "XVP" as const;
  protected readonly notFoundLabel = "XvP transaction";

  // The base `apply()` is unused: XvP settles via execute() below.
  protected apply(): void {
    throw new WorkflowRejection(500, "HL-XVP-000", "XvP does not use the generic apply()");
  }

  /** Register the XvP and issue the hash-lock. No funds are moved. */
  init(params: XvpInitParams): XvpInitResult {
    if (params.transactionType !== "DVP" && params.transactionType !== "PVP") {
      throw new WorkflowRejection(400, "HL-XVP-001", `Invalid XvP transactionType '${params.transactionType}'`);
    }

    const executionKey = randomBytes(32).toString("hex");
    const cancellationKey = randomBytes(32).toString("hex");
    const paymentId = randomUUID();
    const executionHash = sha256Hex(executionKey);
    const cancellationHash = sha256Hex(cancellationKey);
    const now = new Date();
    const timeout = new Date(now.getTime() + (params.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000).toISOString();

    this.store.addDraft({
      id: params.xvpTransactionId,
      type: "XVP",
      status: "INITIALIZED",
      amount: params.amount,
      currency: params.currency,
      creditedWalletAlias: params.sellerWalletAlias, // the seller is paid here
      debitedWalletAlias: "",                          // the buyer wallet is named at execution
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: timeout,
      supplementaryData: JSON.stringify({
        transactionType: params.transactionType,
        executionHash,
        cancellationHash,
        executionKey,
        cancellationKey,
        paymentId,
        sellerBic: params.sellerBic,
        buyerBic: params.buyerBic,
        seller: params.seller,
        buyer: params.buyer,
      }),
    });

    return {
      xvpTransactionId: params.xvpTransactionId,
      status: "INITIALIZED",
      executionHash,
      cancellationHash,
      executionKey,
      cancellationKey,
      timeout,
    };
  }

  /** Read the persisted XvP record + its hash metadata. */
  get(xvpTransactionId: string): {
    id: string;
    status: string;
    amount: string;
    currency: string;
    sellerWalletAlias: string;
    buyerWalletAlias: string;
    timeout?: string;
    executionHash: string;
    cancellationHash: string;
    transactionType: string;
    executionKey?: string;
    cancellationKey?: string;
    paymentId?: string;
    sellerBic?: string;
    buyerBic?: string;
    seller?: unknown;
    buyer?: unknown;
  } | undefined {
    const d = this.store.getDraft(xvpTransactionId);
    if (!d || d.type !== "XVP") return undefined;
    const meta = d.supplementaryData ? JSON.parse(d.supplementaryData) : {};
    return {
      id: d.id,
      status: d.status,
      amount: d.amount,
      currency: d.currency,
      sellerWalletAlias: d.creditedWalletAlias,
      buyerWalletAlias: d.debitedWalletAlias,
      timeout: d.expiresAt,
      executionHash: meta.executionHash,
      cancellationHash: meta.cancellationHash,
      transactionType: meta.transactionType,
      executionKey: meta.executionKey,
      cancellationKey: meta.cancellationKey,
      paymentId: meta.paymentId,
      sellerBic: meta.sellerBic,
      buyerBic: meta.buyerBic,
      seller: meta.seller,
      buyer: meta.buyer,
    };
  }

  /**
   * Execute the cash leg (the buyer pays): validate the request matches the
   * initialisation (BICs, amount, currency), then debit the buyer's wallet and
   * credit the seller's wallet. Returns the HLC secrets for the asset leg.
   */
  pay(xvpTransactionId: string, params: XvpPaymentParams): {
    xvpTransactionId: string;
    status: "SETTLED";
    executionKey?: string;
    cancellationKey?: string;
    paymentId?: string;
  } {
    const rec = this.get(xvpTransactionId);
    if (!rec) {
      throw new WorkflowRejection(404, "HL-XVP-002", `XvP transaction ${xvpTransactionId} not found`);
    }
    if (rec.status !== "INITIALIZED") {
      throw new WorkflowRejection(409, "HL-XVP-003", `XvP ${xvpTransactionId} is already ${rec.status}`);
    }
    if (rec.timeout && Date.parse(rec.timeout) < Date.now()) {
      this.store.updateDraft(rec.id, { status: "EXPIRED" });
      throw new WorkflowRejection(409, "HL-XVP-004", `XvP ${xvpTransactionId} has timed out and can no longer be paid`);
    }
    // The payment must match the initialisation.
    if (rec.buyerBic && params.buyerBic && params.buyerBic !== rec.buyerBic) {
      throw new WorkflowRejection(400, "HL-XVP-006", `Buyer BIC '${params.buyerBic}' does not match the XvP buyer '${rec.buyerBic}'`);
    }
    if (rec.sellerBic && params.sellerBic && params.sellerBic !== rec.sellerBic) {
      throw new WorkflowRejection(400, "HL-XVP-006", `Seller BIC '${params.sellerBic}' does not match the XvP seller '${rec.sellerBic}'`);
    }
    if (params.amount !== rec.amount) {
      throw new WorkflowRejection(400, "HL-XVP-006", `Payment amount '${params.amount}' does not match the XvP amount '${rec.amount}'`);
    }
    if (params.currency !== rec.currency) {
      throw new WorkflowRejection(400, "HL-XVP-006", `Payment currency '${params.currency}' does not match the XvP currency '${rec.currency}'`);
    }
    // Conservation (issue #77): the seller's credit wallet must exist before we
    // debit the buyer, so a settlement never debits and then discards the credit.
    this.requireCreditWallet(rec.sellerWalletAlias);
    // Debit the buyer (rights + availability), then credit the seller.
    this.checkedDebit(params.buyerWalletAlias, rec.amount, params.caller);
    this.rawCredit(rec.sellerWalletAlias, rec.amount);
    this.store.updateDraft(rec.id, { status: "SETTLED", debitedWalletAlias: params.buyerWalletAlias });
    this.store.addTransaction({
      id: `TX-${rec.id}`,
      type: "XVP",
      status: "SETTLED",
      amount: rec.amount,
      currency: rec.currency,
      creditedWalletAlias: rec.sellerWalletAlias,
      debitedWalletAlias: params.buyerWalletAlias,
      createdAt: new Date().toISOString(),
      settledAt: new Date().toISOString(),
    });
    return {
      xvpTransactionId,
      status: "SETTLED",
      executionKey: rec.executionKey,
      cancellationKey: rec.cancellationKey,
      paymentId: rec.paymentId,
    };
  }
}
