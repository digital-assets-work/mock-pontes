import type { Draft } from "../state/mock-store.js";
import { Workflow } from "./workflow.js";

/**
 * One-step bridge cash-token payment: debits the source and credits the target
 * in a single call, recording a settled transaction. No draft/approval cycle.
 */
export class PaymentWorkflow extends Workflow {
  readonly type = "TRANSFER" as const;

  protected apply(record: Draft): void {
    this.rawDebit(record.debitedWalletAlias, record.amount);
    this.rawCredit(record.creditedWalletAlias, record.amount);
  }
}
