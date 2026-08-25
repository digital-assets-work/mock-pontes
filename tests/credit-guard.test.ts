/**
 * Conservation of value — crediting an unknown wallet must not destroy cash
 * (issue #77).
 *
 * Before the fix, `rawCredit()` was a no-op for an unknown wallet, so a transfer
 * / direct-RTGS / XvP that credited a non-existent alias debited the source and
 * credited nothing — total-under-management shrank. Now the credited wallet is
 * asserted to exist BEFORE any debit, so the operation is rejected atomically.
 */

import { describe, it, expect } from "@jest/globals";
import { MemoryStore } from "../src/state/memory-store.js";
import { TransferWorkflow } from "../src/workflows/transfer.js";
import { DirectRtgsWorkflow } from "../src/workflows/direct-rtgs.js";
import { XvpWorkflow } from "../src/workflows/xvp.js";
import { isWorkflowRejection } from "../src/workflows/workflow.js";

const OWNER = { entityBIC: "BANKAXXXXXX" };

function seed(balance = "1000.00"): MemoryStore {
  const s = new MemoryStore();
  s.ensureWallet("A-DCW1", { ownerEntityID: "BANKAXXXXXX", managerNCB: "BDF", availableBalance: balance });
  return s;
}

function total(s: MemoryStore): number {
  return s.getWallets().reduce((n, w) => n + parseFloat(w.balance) + parseFloat(w.lockedBalance), 0);
}

function reject(fn: () => unknown): { statusCode: number; errorCode: string } {
  try {
    fn();
  } catch (e) {
    expect(isWorkflowRejection(e)).toBe(true);
    return e as unknown as { statusCode: number; errorCode: string };
  }
  throw new Error("expected a WorkflowRejection");
}

describe("Conservation of value on credit (issue #77)", () => {
  it("rejects a transfer to an unknown credited wallet at create, without debiting", () => {
    const s = seed();
    const wf = new TransferWorkflow(s);
    const err = reject(() =>
      wf.create(
        { id: "TR1", amount: "100.00", currency: "EUR", creditedWalletAlias: "GHOST", debitedWalletAlias: "A-DCW1", initiatorUserUUID: "u1" },
        { caller: OWNER },
      ),
    );
    expect(err.statusCode).toBe(422);
    expect(err.errorCode).toBe("HL-WAL-003");
    expect(s.getWallet("A-DCW1")!.balance).toBe("1000.00"); // source untouched
    expect(s.getDraft("TR1")).toBeUndefined(); // no draft persisted
  });

  it("rejects a one-step direct-RTGS to an unknown credited wallet, without debiting", () => {
    const s = seed();
    const wf = new DirectRtgsWorkflow(s);
    const before = total(s);
    const err = reject(() =>
      wf.execute(
        { id: "DR1", amount: "200.00", currency: "EUR", creditedWalletAlias: "GHOST", debitedWalletAlias: "A-DCW1" },
        { caller: OWNER },
      ),
    );
    expect(err.errorCode).toBe("HL-WAL-003");
    expect(s.getWallet("A-DCW1")!.balance).toBe("1000.00");
    expect(total(s)).toBeCloseTo(before);
  });

  it("conserves value on a valid transfer", () => {
    const s = seed();
    s.ensureWallet("B-DCW1", { ownerEntityID: "BANKAXXXXXX", managerNCB: "BDF" });
    const wf = new TransferWorkflow(s);
    const before = total(s);
    wf.create(
      { id: "TR2", amount: "100.00", currency: "EUR", creditedWalletAlias: "B-DCW1", debitedWalletAlias: "A-DCW1", initiatorUserUUID: "u1" },
      { caller: OWNER },
    );
    wf.approve("TR2", { caller: OWNER, approverUserUUID: "u2" });
    expect(s.getWallet("A-DCW1")!.balance).toBe("900.00");
    expect(s.getWallet("B-DCW1")!.balance).toBe("100.00");
    expect(total(s)).toBeCloseTo(before);
  });

  it("rejects XvP payment crediting an unknown seller wallet, without debiting the buyer", () => {
    const s = seed(); // A-DCW1 = the buyer's wallet (1000, owned BANKAXXXXXX)
    const wf = new XvpWorkflow(s);
    const before = total(s);
    wf.init({
      xvpTransactionId: "XV1",
      transactionType: "DVP",
      amount: "100.00",
      currency: "EUR",
      sellerWalletAlias: "GHOST", // unknown seller (credit) wallet
      sellerBic: "BANKAXXXXXX",
      buyerBic: "BANKAXXXXXX",
    });
    const err = reject(() =>
      wf.pay("XV1", { buyerWalletAlias: "A-DCW1", buyerBic: "BANKAXXXXXX", sellerBic: "BANKAXXXXXX", amount: "100.00", currency: "EUR", caller: OWNER }),
    );
    expect(err.errorCode).toBe("HL-WAL-003");
    // The buyer is NOT debited — value conserved.
    expect(s.getWallet("A-DCW1")!.balance).toBe("1000.00");
    expect(total(s)).toBeCloseTo(before);
  });
});
