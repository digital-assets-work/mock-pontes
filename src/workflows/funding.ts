import type { Draft } from "../state/mock-store.js";
import { Workflow } from "./workflow.js";

/**
 * Two-step funding: credits the target wallet from the (infinite) token-issuance
 * wallet on approval. The issuance wallet is never balance-checked or debited —
 * funding is how cash is seeded into the mock.
 */
export class FundingWorkflow extends Workflow {
  readonly type = "FUNDING" as const;
  protected readonly notFoundLabel = "Funding draft";

  protected apply(record: Draft): void {
    this.rawCredit(record.creditedWalletAlias, record.amount);
  }
}

/**
 * Two-step defunding: debits the target wallet on approval and (conceptually)
 * returns the cash to the infinite issuance wallet.
 */
export class DefundingWorkflow extends Workflow {
  readonly type = "DEFUNDING" as const;
  protected readonly notFoundLabel = "Defunding draft";

  protected apply(record: Draft): void {
    this.rawDebit(record.debitedWalletAlias, record.amount);
  }
}
