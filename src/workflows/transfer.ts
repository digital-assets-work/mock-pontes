import { randomUUID } from "node:crypto";
import type { Draft } from "../state/mock-store.js";
import type { DcwCaller } from "../state/dcw.js";
import { Workflow } from "./workflow.js";

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

  protected apply(record: Draft, caller?: DcwCaller): void {
    this.checkedDebit(record.debitedWalletAlias, record.amount, caller);
    this.rawCredit(record.creditedWalletAlias, record.amount);
  }

  protected transactionId(): string {
    return `TX-${randomUUID()}`;
  }
}
