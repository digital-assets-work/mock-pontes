import { createHash, randomBytes } from "node:crypto";
import type { DcwCaller } from "../state/dcw.js";
import { Workflow, WorkflowRejection } from "./workflow.js";

export type XvpTransactionType = "DVP" | "PVP";
export type XvpKeyType = "EXECUTION" | "CANCELLATION";

export interface XvpInitParams {
  xvpTransactionId: string;
  transactionType: XvpTransactionType;
  amount: string;
  currency: string;
  sourceWalletAlias: string; // seller cash wallet (locked)
  targetWalletAlias: string; // buyer cash wallet (credited on execution)
  timeoutSec?: number;
  caller?: DcwCaller;
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
 * XvP (Hash-Link / hashed time-lock) — the only workflow that reserves funds.
 *
 * `init` locks the seller's cash and issues an `executionHash`, a
 * `cancellationHash` and a `timeout`. A later payment reveals a preimage that
 * hashes to one of them: the EXECUTION preimage settles the lock and credits the
 * buyer; the CANCELLATION preimage (or a timeout) releases the lock.
 *
 * XvP records are persisted as `XVP` drafts (hash/timeout metadata in
 * `supplementaryData` as JSON).
 */
export class XvpWorkflow extends Workflow {
  readonly type = "XVP" as const;
  protected readonly notFoundLabel = "XvP transaction";

  // The base `apply()` is unused: XvP settles via lock/settleLocked/release below.
  protected apply(): void {
    throw new WorkflowRejection(500, "HL-XVP-000", "XvP does not use the generic apply()");
  }

  /** Reserve the seller's funds and issue the hash-lock. Persists INITIALIZED. */
  init(params: XvpInitParams): XvpInitResult {
    if (params.transactionType !== "DVP" && params.transactionType !== "PVP") {
      throw new WorkflowRejection(400, "HL-XVP-001", `Invalid XvP transactionType '${params.transactionType}'`);
    }
    // Rights + availability, then lock.
    this.assertCanDebit(params.sourceWalletAlias, params.amount, params.caller);
    try {
      this.store.lock(params.sourceWalletAlias, params.amount);
    } catch (e) {
      throw new WorkflowRejection(422, "HL-BAL-001", `Cannot lock ${params.amount} on ${params.sourceWalletAlias}`);
    }

    const executionKey = randomBytes(32).toString("hex");
    const cancellationKey = randomBytes(32).toString("hex");
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
      creditedWalletAlias: params.targetWalletAlias,
      debitedWalletAlias: params.sourceWalletAlias,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: timeout,
      supplementaryData: JSON.stringify({
        transactionType: params.transactionType,
        executionHash,
        cancellationHash,
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
    source: string;
    target: string;
    timeout?: string;
    executionHash: string;
    cancellationHash: string;
    transactionType: string;
  } | undefined {
    const d = this.store.getDraft(xvpTransactionId);
    if (!d || d.type !== "XVP") return undefined;
    const meta = d.supplementaryData ? JSON.parse(d.supplementaryData) : {};
    return {
      id: d.id,
      status: d.status,
      amount: d.amount,
      currency: d.currency,
      source: d.debitedWalletAlias,
      target: d.creditedWalletAlias,
      timeout: d.expiresAt,
      executionHash: meta.executionHash,
      cancellationHash: meta.cancellationHash,
      transactionType: meta.transactionType,
    };
  }

  /**
   * Submit a preimage. If it hashes to the executionHash → settle the lock and
   * credit the buyer (SETTLED, reveals the key). If it hashes to the
   * cancellationHash → release the lock (CANCELLED). A timeout releases too.
   */
  payment(xvpTransactionId: string, preimage: string): {
    xvpTransactionId: string;
    status: "SETTLED" | "CANCELLED";
    keyType: XvpKeyType;
    executionKey?: string;
  } {
    const rec = this.get(xvpTransactionId);
    if (!rec) {
      throw new WorkflowRejection(404, "HL-XVP-002", `XvP transaction ${xvpTransactionId} not found`);
    }
    if (rec.status !== "INITIALIZED") {
      throw new WorkflowRejection(409, "HL-XVP-003", `XvP ${xvpTransactionId} is already ${rec.status}`);
    }
    if (rec.timeout && Date.parse(rec.timeout) < Date.now()) {
      this.releaseAndCancel(rec.id, rec.source, rec.amount, "EXPIRED");
      throw new WorkflowRejection(410, "HL-XVP-004", `XvP ${xvpTransactionId} has timed out`);
    }
    const providedHash = sha256Hex(preimage);
    if (providedHash === rec.executionHash) {
      this.store.settleLocked(rec.source, rec.amount);
      this.rawCredit(rec.target, rec.amount);
      this.store.updateDraft(rec.id, { status: "SETTLED" });
      this.store.addTransaction({
        id: `TX-${rec.id}`,
        type: "XVP",
        status: "SETTLED",
        amount: rec.amount,
        currency: rec.currency,
        creditedWalletAlias: rec.target,
        debitedWalletAlias: rec.source,
        createdAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
      });
      return { xvpTransactionId, status: "SETTLED", keyType: "EXECUTION", executionKey: preimage };
    }
    if (providedHash === rec.cancellationHash) {
      this.releaseAndCancel(rec.id, rec.source, rec.amount, "CANCELED");
      return { xvpTransactionId, status: "CANCELLED", keyType: "CANCELLATION" };
    }
    throw new WorkflowRejection(400, "HL-XVP-005", "Preimage does not match the execution or cancellation hash");
  }

  private releaseAndCancel(id: string, source: string, amount: string, finalStatus: "CANCELED" | "EXPIRED"): void {
    try {
      this.store.release(source, amount);
    } catch {
      // lock already gone — ignore in the mock
    }
    this.store.updateDraft(id, { status: finalStatus });
  }
}
