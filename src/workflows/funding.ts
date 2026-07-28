import type { Draft } from "../state/mock-store.js";
import type { DcwCaller } from "../state/dcw.js";
import { Workflow, type WorkflowPhase } from "./workflow.js";

/**
 * Two-step funding: credits the target wallet from the (infinite) token-issuance
 * wallet on approval. The issuance wallet is never balance-checked or debited —
 * funding is how cash is seeded into the mock.
 */
export class FundingWorkflow extends Workflow {
  readonly type = "FUNDING" as const;
  protected readonly notFoundLabel = "Funding draft";

  /**
   * Fund only a wallet you are authorised to act on (issue #56). Funding has no
   * real debit (the source is the infinite issuance DCA), so as a proxy for the
   * T2 account's debit rights the *credited* wallet must belong to the caller's
   * entity (or a PoA / whitelisted operator). Enforced at draft creation.
   */
  protected conditions(phase: WorkflowPhase, record: Draft, caller?: DcwCaller): void {
    if (phase !== "create") return;
    const permitted = this.store.canDebit(record.creditedWalletAlias, caller);
    if (!permitted.ok) {
      throw this.rejectionFor(permitted.reason ?? "NOT_AUTHORISED_TO_DEBIT", record.creditedWalletAlias);
    }
  }

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
