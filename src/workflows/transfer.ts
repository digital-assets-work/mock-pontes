import { randomUUID } from "node:crypto";
import type { Draft } from "../state/mock-store.js";
import { Workflow } from "./workflow.js";

/**
 * Two-step cash-token transfer between two DCWs.
 *
 * Approval settles immediately in the mock: debit the source, credit the target.
 * No funds are reserved at creation (availability is a mock no-op today; the
 * concrete availability check is introduced in workbench issue #16).
 */
export class TransferWorkflow extends Workflow {
  readonly type = "TRANSFER" as const;

  protected apply(record: Draft): void {
    this.rawDebit(record.debitedWalletAlias, record.amount);
    this.rawCredit(record.creditedWalletAlias, record.amount);
  }

  protected transactionId(): string {
    return `TX-${randomUUID()}`;
  }
}
