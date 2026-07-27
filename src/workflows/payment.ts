import type { Draft } from "../state/mock-store.js";
import type { DcwCaller } from "../state/dcw.js";
import { Workflow } from "./workflow.js";

/**
 * One-step bridge cash-token payment: debits the source and credits the target
 * in a single call, recording a settled transaction. No draft/approval cycle.
 *
 * The debit is checked (issue #15): the caller must have debit rights on the
 * source DCW and it must hold sufficient available balance right now.
 */
export class PaymentWorkflow extends Workflow {
  readonly type = "TRANSFER" as const;
  protected readonly debitsSource = true;

  protected apply(record: Draft, caller?: DcwCaller): void {
    this.checkedDebit(record.debitedWalletAlias, record.amount, caller);
    this.rawCredit(record.creditedWalletAlias, record.amount);
  }
}
