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

  constructor(protected readonly store: MockStore) {}

  // --- extension points -----------------------------------------------------

  /** Validate/authorise a transition. Override to add checks; throw {@link WorkflowRejection}. */
  protected conditions(_phase: WorkflowPhase, _record: Draft): void {}

  /** Apply the DCW effect at settlement (credit/debit the wallets). */
  protected abstract apply(record: Draft): void;

  /** Transaction id recorded on settlement. Override for a custom scheme. */
  protected transactionId(record: Draft): string {
    return `TX-${record.id}`;
  }

  // --- lifecycle ------------------------------------------------------------

  /** Persist a new two-step workflow in `PENDING_APPROVAL`. */
  create(init: WorkflowInit): Draft {
    const record = this.buildRecord(init, "PENDING_APPROVAL");
    this.conditions("create", record);
    this.store.addDraft(record);
    return record;
  }

  /** `PENDING_APPROVAL` → `SETTLED`: run conditions, apply the effect, record a transaction. */
  approve(id: string, approverUserUUID?: string): Draft {
    const record = this.loadPending(id, "approve");
    this.conditions("approve", record);
    this.apply(record);
    this.store.updateDraft(id, { status: "SETTLED", approverUserUUID });
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
  execute(init: WorkflowInit): Draft {
    const record = this.buildRecord(init, "SETTLED");
    this.conditions("create", record);
    this.apply(record);
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
}
