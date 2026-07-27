import type { Draft } from "../state/mock-store.js";
import type { DcwCaller } from "../state/dcw.js";
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
 * Two-step defunding: debits (burns) the target DCW on approval and returns the
 * cash to the infinite issuance wallet. The debit is **checked** (issue #18):
 * availability + debit rights on the source are verified at approval time.
 */
export class DefundingWorkflow extends Workflow {
  readonly type = "DEFUNDING" as const;
  protected readonly notFoundLabel = "Defunding draft";
  protected readonly debitsSource = true;

  protected apply(record: Draft, caller?: DcwCaller): void {
    this.checkedDebit(record.debitedWalletAlias, record.amount, caller);
  }
}
