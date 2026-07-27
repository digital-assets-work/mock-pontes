import type { Draft } from "../state/mock-store.js";
import type { DcwCaller } from "../state/dcw.js";
import { Workflow } from "./workflow.js";

/**
 * PFoD (Payment Free of Delivery) matched settlement — the wallet payment that
 * fires once the deliver + receive legs match on `tradeID`. Debits the seller's
 * cash wallet (checked: availability + rights) and credits the buyer's.
 *
 * The two legs are persisted and matched by the router; this workflow performs
 * the resulting one-step settlement via `execute()`.
 */
export class PfodWorkflow extends Workflow {
  readonly type = "PFOD" as const;
  protected readonly notFoundLabel = "PFoD trade";
  protected readonly debitsSource = true;

  protected apply(record: Draft, caller?: DcwCaller): void {
    this.checkedDebit(record.debitedWalletAlias, record.amount, caller);
    this.rawCredit(record.creditedWalletAlias, record.amount);
  }
}
