import { randomUUID } from "node:crypto";
import type { Draft } from "../state/mock-store.js";
import type { DcwCaller } from "../state/dcw.js";
import { Workflow, WorkflowRejection, type WorkflowPhase } from "./workflow.js";

/**
 * Two-step cash-token transfer between two DCWs.
 *
 * Creation persists a PENDING_APPROVAL draft and reserves nothing. Approval
 * settles immediately: the source is debited via the **checked** DCW op
 * (availability + debit rights verified *now*, at approval — per issue #12),
 * then the target is credited. Availability is never checked at create time.
 */
export class TransferWorkflow extends Workflow {
  readonly type = "TRANSFER" as const;
  protected readonly debitsSource = true;

  /**
   * Manager-ID/`cbdcRequestType` business rules from the real captured HAR
   * delta against the official spec. These are validated at `create` only.
   * Each check no-ops when its wallet doesn't exist yet — the base class's
   * own existence assert runs right after `conditions()` and produces the
   * correct 422 in that case.
   */
  protected conditions(phase: WorkflowPhase, record: Draft): void {
    if (phase !== "create") return;
    const debited = this.store.getWallet(record.debitedWalletAlias);
    const credited = this.store.getWallet(record.creditedWalletAlias);
    if (debited && record.debitedCashWalletManagerID && record.debitedCashWalletManagerID !== debited.managerNCB) {
      throw new WorkflowRejection(
        400,
        "HL-WAL-004",
        `Debited cash wallet ${record.debitedWalletAlias} is not managed by ${record.debitedCashWalletManagerID}`,
      );
    }
    if (credited && record.creditedCashWalletManagerID && record.creditedCashWalletManagerID !== credited.managerNCB) {
      throw new WorkflowRejection(
        400,
        "HL-WAL-005",
        `Credited cash wallet ${record.creditedWalletAlias} is not managed by ${record.creditedCashWalletManagerID}`,
      );
    }
    if (debited && credited && record.cbdcRequestType) {
      const sameManager = debited.managerNCB === credited.managerNCB;
      if (record.cbdcRequestType === "OPERATION" && !sameManager) {
        throw new WorkflowRejection(
          400,
          "HL-WAL-006",
          "cbdcRequestType OPERATION requires the debited and credited wallets to share the same manager",
        );
      }
      if (record.cbdcRequestType === "PAYMENT" && sameManager) {
        throw new WorkflowRejection(
          400,
          "HL-WAL-006",
          "cbdcRequestType PAYMENT requires the debited and credited wallets to have different managers",
        );
      }
    }
  }

  protected apply(record: Draft, caller?: DcwCaller): void {
    this.checkedDebit(record.debitedWalletAlias, record.amount, caller);
    this.rawCredit(record.creditedWalletAlias, record.amount);
  }

  protected transactionId(): string {
    return `TX-${randomUUID()}`;
  }
}
