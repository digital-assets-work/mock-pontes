import type { Draft } from "../state/mock-store.js";
import type { DcwCaller } from "../state/dcw.js";
import { Workflow } from "./workflow.js";

/**
 * Direct RTGS payment — a composite of a **defunding on the source** (payer) and
 * a **funding on the target** (receiver), settling directly on RTGS.
 *
 * The net effect on the two DCWs is a checked debit of the payer plus a credit
 * of the receiver, performed atomically at settlement:
 *   - two-step: availability + debit rights are verified at approval (per #12);
 *   - one-step (bridge variant): verified immediately on execute.
 *
 * Reuses the same DCW effects as the defunding (#18) and funding (#17) workflows.
 */
export class DirectRtgsWorkflow extends Workflow {
  readonly type = "DIRECT_RTGS" as const;
  protected readonly notFoundLabel = "Direct RTGS payment";

  protected apply(record: Draft, caller?: DcwCaller): void {
    // defund(source/payer): checked debit — rights + availability
    this.checkedDebit(record.debitedWalletAlias, record.amount, caller);
    // fund(target/receiver): credit from RTGS
    this.rawCredit(record.creditedWalletAlias, record.amount);
  }
}
