/**
 * Generic settlement workflow base.
 *
 * Every mock settlement operation (transfer, funding, defunding, one-step
 * payment, and — later — XvP) is modelled as a `Workflow` with a shared state
 * machine and persistence, plus two extension points that subclasses implement:
 *
 *   - `conditions(phase, record)` — validate/authorise a transition; throw a
 *     {@link WorkflowRejection} to reject it.
 *   - `apply(record)` — the DCW debit/credit effect performed at settlement.
 *
 * State machine:
 *
 *   INITIALIZED ──create──▶ PENDING_APPROVAL ──approve──▶ SETTLED
 *                                            └──cancel───▶ CANCELED
 *
 * One-step workflows settle in a single call via `execute()` (no approval step);
 * two-step workflows persist a `PENDING_APPROVAL` record via `create()` and are
 * later `approve()`d or `cancel()`ed.
 *
 * Fund-availability policy (see workbench issue #12):
 *   - One-step workflows debit immediately.
 *   - Two-step workflows do NOT reserve funds; availability is only ever checked
 *     at the second (approval) step by the concrete workflow.
 *   - Only XvP (issue #21) locks funds up-front via the DCW lock/release ops.
 */

import type { MockStore, Draft } from "../state/mock-store.js";
import type { DcwCaller } from "../state/dcw.js";

export type WorkflowType = Draft["type"];
export type WorkflowState = Draft["status"];
export type WorkflowPhase = "create" | "approve" | "cancel";

/**
 * A structured, transport-agnostic rejection. Routes translate this into the
 * exact HTTP error response shape they already use.
 */
export class WorkflowRejection extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: string,
    readonly errorDescription: string,
  ) {
    super(errorDescription);
    this.name = "WorkflowRejection";
  }

  get businessErrors(): { errorCode: string; errorDescription: string }[] {
    return [{ errorCode: this.errorCode, errorDescription: this.errorDescription }];
  }
}

export function isWorkflowRejection(e: unknown): e is WorkflowRejection {
  return e instanceof WorkflowRejection;
}

/** Fields required to open a workflow record. */
export interface WorkflowInit {
  id: string;
  amount: string;
  currency?: string;
  creditedWalletAlias: string;
  debitedWalletAlias: string;
  initiatorUserUUID?: string;
  supplementaryData?: string;
}

/** Per-request context threaded through a transition (identity for checks). */
export interface WorkflowActor {
  /** DCW debit-rights identity (entity BIC / whitelisted operator). */
  caller?: DcwCaller;
  /** UUID of the user performing an approval (four-eyes check). */
  approverUserUUID?: string;
}

const VERB: Record<WorkflowPhase, string> = {
  create: "create",
  approve: "approve",
  cancel: "cancel",
};

export abstract class Workflow {
  /** Draft/transaction type discriminator for this workflow. */
  abstract readonly type: WorkflowType;

  /** Label used in the "not found" rejection message ("Draft", "Funding draft", …). */
  protected readonly notFoundLabel: string = "Draft";
  protected readonly notFoundCode: string = "HL-GER-001";
  protected readonly stateCode: string = "HL-GER-002";

  /**
   * True when this workflow debits its `debitedWalletAlias`. Debit-side wallets
   * are **never** auto-created (issue #23) — they must already exist, otherwise a
   * condition error is raised.
   */
  protected readonly debitsSource: boolean = false;

  constructor(protected readonly store: MockStore) {}

  // --- extension points -----------------------------------------------------

  /** Validate/authorise a transition. Override to add checks; throw {@link WorkflowRejection}. */
  protected conditions(_phase: WorkflowPhase, _record: Draft, _caller?: DcwCaller): void {}

  /** Apply the DCW effect at settlement (credit/debit the wallets). */
  protected abstract apply(record: Draft, caller?: DcwCaller): void;

  /** Transaction id recorded on settlement. Override for a custom scheme. */
  protected transactionId(record: Draft): string {
    return `TX-${record.id}`;
  }

  // --- lifecycle ------------------------------------------------------------

  /** Persist a new two-step workflow in `PENDING_APPROVAL`. */
  create(init: WorkflowInit): Draft {
    const record = this.buildRecord(init, "PENDING_APPROVAL");
    this.conditions("create", record);
    this.assertDebitWalletExists(record);
    this.store.addDraft(record);
    return record;
  }

  /** `PENDING_APPROVAL` → `SETTLED`: run conditions, apply the effect, record a transaction. */
  approve(id: string, actor: WorkflowActor = {}): Draft {
    const record = this.loadPending(id, "approve");
    if (
      actor.approverUserUUID &&
      record.initiatorUserUUID &&
      actor.approverUserUUID === record.initiatorUserUUID
    ) {
      throw new WorkflowRejection(
        403,
        "HL-GER-003",
        "Approver must differ from the initiator (four-eyes control)",
      );
    }
    this.conditions("approve", record, actor.caller);
    this.assertDebitWalletExists(record);
    this.apply(record, actor.caller);
    this.store.updateDraft(id, { status: "SETTLED", approverUserUUID: actor.approverUserUUID });
    this.recordTransaction(record);
    return this.store.getDraft(id)!;
  }

  /** `PENDING_APPROVAL` → `CANCELED`. */
  cancel(id: string): Draft {
    const record = this.loadPending(id, "cancel");
    this.conditions("cancel", record);
    this.store.updateDraft(id, { status: "CANCELED" });
    return this.store.getDraft(id)!;
  }

  /** One-step settlement: apply the effect and record a transaction, no draft persisted. */
  execute(init: WorkflowInit, actor: WorkflowActor = {}): Draft {
    const record = this.buildRecord(init, "SETTLED");
    this.conditions("create", record, actor.caller);
    this.assertDebitWalletExists(record);
    this.apply(record, actor.caller);
    this.recordTransaction(record);
    return record;
  }

  // --- helpers --------------------------------------------------------------

  private buildRecord(init: WorkflowInit, status: WorkflowState): Draft {
    const now = new Date().toISOString();
    return {
      id: init.id,
      type: this.type,
      status,
      amount: init.amount,
      currency: init.currency ?? "EUR",
      creditedWalletAlias: init.creditedWalletAlias,
      debitedWalletAlias: init.debitedWalletAlias,
      createdAt: now,
      updatedAt: now,
      initiatorUserUUID: init.initiatorUserUUID,
      supplementaryData: init.supplementaryData,
    };
  }

  protected loadPending(id: string, phase: WorkflowPhase): Draft {
    const record = this.store.getDraft(id);
    if (!record || record.type !== this.type) {
      throw new WorkflowRejection(404, this.notFoundCode, `${this.notFoundLabel} ${id} not found`);
    }
    if (record.status !== "PENDING_APPROVAL") {
      throw new WorkflowRejection(
        409,
        this.stateCode,
        `Draft ${id} is in status ${record.status}, cannot ${VERB[phase]}`,
      );
    }
    return record;
  }

  /**
   * Enforce that the debit-side wallet exists. Debit-side DCWs are never
   * auto-created (issue #23) — only credit-side wallets are. A missing debit
   * wallet is a condition failure.
   */
  protected assertDebitWalletExists(record: Draft): void {
    if (!this.debitsSource) return;
    const alias = record.debitedWalletAlias;
    if (alias && !this.store.getWallet(alias)) {
      throw new WorkflowRejection(422, "HL-WAL-002", `Debit wallet ${alias} does not exist`);
    }
  }

  protected recordTransaction(record: Draft): void {
    this.store.addTransaction({
      id: this.transactionId(record),
      type: this.type,
      status: "SETTLED",
      amount: record.amount,
      currency: record.currency,
      creditedWalletAlias: record.creditedWalletAlias,
      debitedWalletAlias: record.debitedWalletAlias,
      createdAt: record.createdAt,
      settledAt: new Date().toISOString(),
      supplementaryData: record.supplementaryData,
    });
  }

  /**
   * Unchecked credit that preserves current mock behaviour (no-op if the wallet
   * is missing). Concrete workflows use this from `apply()`.
   */
  protected rawCredit(alias: string, amount: string): void {
    const w = this.store.getWallet(alias);
    if (!w) return;
    this.store.upsertWallet({
      ...w,
      balance: (parseFloat(w.balance) + parseFloat(amount)).toFixed(2),
    });
  }

  /**
   * Unchecked debit that preserves current mock behaviour (may drive the balance
   * negative; no-op if the wallet is missing).
   */
  protected rawDebit(alias: string, amount: string): void {
    const w = this.store.getWallet(alias);
    if (!w) return;
    this.store.upsertWallet({
      ...w,
      balance: (parseFloat(w.balance) - parseFloat(amount)).toFixed(2),
    });
  }

  /**
   * Checked debit via the DCW ops: enforces debit rights (blocked/validity/owner
   * or PoA/operator) and sufficient available balance. Maps DCW errors to a
   * {@link WorkflowRejection}.
   */
  protected checkedDebit(alias: string, amount: string, caller?: DcwCaller): void {
    try {
      this.store.debit(alias, amount, caller);
    } catch (e) {
      throw this.mapDcwError(e, alias);
    }
  }

  /** Assert the source can be debited now (rights + availability) without mutating. */
  protected assertCanDebit(alias: string, amount: string, caller?: DcwCaller): void {
    const permitted = this.store.canDebit(alias, caller);
    if (!permitted.ok) {
      throw this.rejectionFor(permitted.reason ?? "NOT_AUTHORISED_TO_DEBIT", alias);
    }
    const w = this.store.getWallet(alias)!;
    if (parseFloat(w.balance) < parseFloat(amount)) {
      throw new WorkflowRejection(
        422,
        "HL-BAL-001",
        `Insufficient available balance on ${alias}`,
      );
    }
  }

  private mapDcwError(e: unknown, alias: string): WorkflowRejection {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("WALLET_NOT_FOUND")) {
      return new WorkflowRejection(404, "HL-WAL-001", `Wallet ${alias} not found`);
    }
    if (msg.startsWith("DCW_DEBIT_DENIED")) {
      return this.rejectionFor(msg.split(":")[1] || "NOT_AUTHORISED_TO_DEBIT", alias);
    }
    if (msg === "DCW_INSUFFICIENT_AVAILABLE") {
      return new WorkflowRejection(422, "HL-BAL-001", `Insufficient available balance on ${alias}`);
    }
    if (msg === "DCW_NEGATIVE_AMOUNT") {
      return new WorkflowRejection(400, "HL-VAL-002", "Amount must not be negative");
    }
    return new WorkflowRejection(422, "HL-GER-000", msg);
  }

  private rejectionFor(reason: string, alias: string): WorkflowRejection {
    if (reason === "WALLET_NOT_FOUND") {
      return new WorkflowRejection(404, "HL-WAL-001", `Wallet ${alias} not found`);
    }
    return new WorkflowRejection(403, "HL-AUT-001", `Debit of ${alias} not authorised (${reason})`);
  }
}
