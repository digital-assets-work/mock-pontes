/**
 * Defence in depth against amount corruption (issue #54 / F-02).
 *
 * Even if a non-numeric amount slipped past request-body validation (#53), the
 * DCW ops must reject it so it can never be written into wallet state as `NaN`
 * and take down the whole AMS surface on later reads.
 */

import { describe, it, expect } from "@jest/globals";
import { MemoryStore } from "../src/state/memory-store.js";
import { parseAmount } from "../src/state/dcw.js";
import { FundingWorkflow } from "../src/workflows/funding.js";
import { isWorkflowRejection } from "../src/workflows/workflow.js";

describe("parseAmount (issue #54)", () => {
  it("accepts a valid amount", () => {
    expect(parseAmount("10.00")).toBe(10);
  });
  it("rejects non-finite and negative amounts", () => {
    expect(() => parseAmount("banana")).toThrow(/DCW_INVALID_AMOUNT/);
    expect(() => parseAmount("NaN")).toThrow(/DCW_INVALID_AMOUNT/);
    expect(() => parseAmount("Infinity")).toThrow(/DCW_INVALID_AMOUNT/);
    expect(() => parseAmount("-5.00")).toThrow(/DCW_NEGATIVE_AMOUNT/);
  });
});

describe("Bad amount cannot corrupt wallet state (issue #54)", () => {
  it("rejects a funding approve with a non-numeric amount and leaves state healthy", () => {
    const store = new MemoryStore();
    store.ensureWallet("A-DCW1", { ownerEntityID: "BANKAXXXXXX", managerNCB: "BDF" });
    const wf = new FundingWorkflow(store);
    wf.create(
      { id: "FRQ1", amount: "banana", creditedWalletAlias: "A-DCW1", debitedWalletAlias: "ISSUANCE", initiatorUserUUID: "u1" },
      { caller: { entityBIC: "BANKAXXXXXX" } },
    );

    let rejected: unknown;
    try {
      wf.approve("FRQ1", { approverUserUUID: "u2" });
    } catch (e) {
      rejected = e;
    }
    expect(isWorkflowRejection(rejected)).toBe(true);
    expect((rejected as { statusCode: number }).statusCode).toBe(400);

    // State stays healthy: the balance was never written as NaN, and reads work.
    expect(store.getWallet("A-DCW1")?.balance).toBe("0.00");
    expect(() => store.getWallets()).not.toThrow();
    expect(store.getWallets()).toHaveLength(1);
  });
});
