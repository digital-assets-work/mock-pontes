/**
 * Unit tests for the generic Workflow base and its concrete workflows
 * (transfer, funding, defunding, one-step payment) plus workflow persistence
 * (issue #14).
 */

import { describe, it, expect } from "@jest/globals";
import { MemoryStore } from "../src/state/memory-store.js";
import { CacheMemory } from "../src/cache/in-memory.js";
import { TransferWorkflow } from "../src/workflows/transfer.js";
import { FundingWorkflow, DefundingWorkflow } from "../src/workflows/funding.js";
import { PaymentWorkflow } from "../src/workflows/payment.js";
import { DirectRtgsWorkflow } from "../src/workflows/direct-rtgs.js";
import { PfodWorkflow } from "../src/workflows/pfod.js";
import { XvpWorkflow } from "../src/workflows/xvp.js";
import { isWorkflowRejection, WorkflowRejection } from "../src/workflows/workflow.js";

function seededStore(): MemoryStore {
  const store = new MemoryStore();
  store.ensureWallet("SRC", { ownerEntityID: "BANKAXXXXXX", managerNCB: "BDFEFR" });
  store.ensureWallet("DST", { ownerEntityID: "BANKBXXXXXX", managerNCB: "BDFEFR" });
  store.credit("SRC", "100.00");
  return store;
}

describe("TransferWorkflow (two-step)", () => {
  const CALLER = { entityBIC: "BANKAXXXXXX" };

  it("creates a PENDING_APPROVAL draft persisted in the store", () => {
    const store = seededStore();
    const wf = new TransferWorkflow(store);
    const draft = wf.create({
      id: "TR1",
      amount: "10.00",
      creditedWalletAlias: "DST",
      debitedWalletAlias: "SRC",
    });
    expect(draft.status).toBe("PENDING_APPROVAL");
    expect(draft.type).toBe("TRANSFER");
    expect(store.getDraft("TR1")?.status).toBe("PENDING_APPROVAL");
  });

  it("create does not check availability (may exceed the source balance)", () => {
    const store = seededStore();
    const wf = new TransferWorkflow(store);
    // 500 > 100 available, but create must still succeed (checked only at approve)
    const draft = wf.create({ id: "TR1", amount: "500.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC" });
    expect(draft.status).toBe("PENDING_APPROVAL");
    expect(store.getWallet("SRC")?.balance).toBe("100.00");
  });

  it("approve settles: debits source, credits target, records a TX-", () => {
    const store = seededStore();
    const wf = new TransferWorkflow(store);
    wf.create({ id: "TR1", amount: "40.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC", initiatorUserUUID: "user-1" });
    const settled = wf.approve("TR1", { caller: CALLER, approverUserUUID: "user-2" });
    expect(settled.status).toBe("SETTLED");
    expect(store.getWallet("SRC")?.balance).toBe("60.00");
    expect(store.getWallet("DST")?.balance).toBe("40.00");
    const txs = store.getTransactions();
    expect(txs).toHaveLength(1);
    expect(txs[0].id.startsWith("TX-")).toBe(true);
    expect(txs[0].type).toBe("TRANSFER");
  });

  it("approve rejects with 422 when the source is short at approval time", () => {
    const store = seededStore();
    const wf = new TransferWorkflow(store);
    wf.create({ id: "TR1", amount: "500.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC", initiatorUserUUID: "user-1" });
    try {
      wf.approve("TR1", { caller: CALLER, approverUserUUID: "user-2" });
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as WorkflowRejection).statusCode).toBe(422);
    }
    expect(store.getWallet("SRC")?.balance).toBe("100.00");
    expect(store.getDraft("TR1")?.status).toBe("PENDING_APPROVAL");
  });

  it("approve rejects with 403 when approver has no debit right on the source", () => {
    const store = seededStore();
    const wf = new TransferWorkflow(store);
    wf.create({ id: "TR1", amount: "10.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC", initiatorUserUUID: "user-1" });
    try {
      wf.approve("TR1", { caller: { entityBIC: "OTHERBANKXX" }, approverUserUUID: "user-2" });
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as WorkflowRejection).statusCode).toBe(403);
    }
  });

  it("approve rejects with 403 when the approver equals the initiator (four-eyes)", () => {
    const store = seededStore();
    const wf = new TransferWorkflow(store);
    wf.create({ id: "TR1", amount: "10.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC", initiatorUserUUID: "user-1" });
    try {
      wf.approve("TR1", { caller: CALLER, approverUserUUID: "user-1" });
      throw new Error("expected rejection");
    } catch (e) {
      const r = e as WorkflowRejection;
      expect(r.statusCode).toBe(403);
      expect(r.errorCode).toBe("HL-GER-003");
    }
  });

  it("cancel moves the draft to CANCELED without touching balances", () => {
    const store = seededStore();
    const wf = new TransferWorkflow(store);
    wf.create({ id: "TR1", amount: "40.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC" });
    const canceled = wf.cancel("TR1");
    expect(canceled.status).toBe("CANCELED");
    expect(store.getWallet("SRC")?.balance).toBe("100.00");
    expect(store.getTransactions()).toHaveLength(0);
  });

  it("rejects approve of an unknown draft with 404", () => {
    const store = seededStore();
    const wf = new TransferWorkflow(store);
    try {
      wf.approve("NOPE", { caller: CALLER });
      throw new Error("expected rejection");
    } catch (e) {
      expect(isWorkflowRejection(e)).toBe(true);
      const r = e as WorkflowRejection;
      expect(r.statusCode).toBe(404);
      expect(r.errorDescription).toBe("Draft NOPE not found");
    }
  });

  it("rejects approve of an already-settled draft with 409", () => {
    const store = seededStore();
    const wf = new TransferWorkflow(store);
    wf.create({ id: "TR1", amount: "10.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC", initiatorUserUUID: "user-1" });
    wf.approve("TR1", { caller: CALLER, approverUserUUID: "user-2" });
    try {
      wf.approve("TR1", { caller: CALLER, approverUserUUID: "user-2" });
      throw new Error("expected rejection");
    } catch (e) {
      const r = e as WorkflowRejection;
      expect(r.statusCode).toBe(409);
      expect(r.errorDescription).toBe("Draft TR1 is in status SETTLED, cannot approve");
    }
  });
});

describe("FundingWorkflow / DefundingWorkflow", () => {
  it("funding approve credits the target only", () => {
    const store = seededStore();
    const wf = new FundingWorkflow(store);
    wf.create(
      {
        id: "FRQ1",
        amount: "25.00",
        creditedWalletAlias: "DST",
        debitedWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
        initiatorUserUUID: "user-1",
      },
      { caller: { entityBIC: "BANKBXXXXXX" } },
    );
    wf.approve("FRQ1", { approverUserUUID: "user-2" });
    expect(store.getWallet("DST")?.balance).toBe("25.00");
  });

  it("funding uses a 'Funding draft' not-found label", () => {
    const store = seededStore();
    const wf = new FundingWorkflow(store);
    try {
      wf.approve("FRQX");
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as WorkflowRejection).errorDescription).toBe("Funding draft FRQX not found");
    }
  });

  it("funding approve enforces four-eyes (approver ≠ initiator)", () => {
    const store = seededStore();
    const wf = new FundingWorkflow(store);
    wf.create(
      {
        id: "FRQ1",
        amount: "10.00",
        creditedWalletAlias: "DST",
        debitedWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
        initiatorUserUUID: "user-1",
      },
      { caller: { entityBIC: "BANKBXXXXXX" } },
    );
    try {
      wf.approve("FRQ1", { approverUserUUID: "user-1" });
      throw new Error("expected rejection");
    } catch (e) {
      const r = e as WorkflowRejection;
      expect(r.statusCode).toBe(403);
      expect(r.errorCode).toBe("HL-GER-003");
    }
    expect(store.getDraft("FRQ1")?.status).toBe("PENDING_APPROVAL");
  });

  it("defunding approve debits the source only", () => {
    const store = seededStore();
    const wf = new DefundingWorkflow(store);
    wf.create({
      id: "DRQ1",
      amount: "30.00",
      creditedWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
      debitedWalletAlias: "SRC",
      initiatorUserUUID: "user-1",
    });
    wf.approve("DRQ1", { caller: { entityBIC: "BANKAXXXXXX" }, approverUserUUID: "user-2" });
    expect(store.getWallet("SRC")?.balance).toBe("70.00");
  });

  it("defunding approve rejects with 422 when the source is short", () => {
    const store = seededStore();
    const wf = new DefundingWorkflow(store);
    wf.create({
      id: "DRQ1",
      amount: "500.00",
      creditedWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
      debitedWalletAlias: "SRC",
      initiatorUserUUID: "user-1",
    });
    try {
      wf.approve("DRQ1", { caller: { entityBIC: "BANKAXXXXXX" }, approverUserUUID: "user-2" });
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as WorkflowRejection).statusCode).toBe(422);
    }
    expect(store.getWallet("SRC")?.balance).toBe("100.00");
    expect(store.getDraft("DRQ1")?.status).toBe("PENDING_APPROVAL");
  });

  it("defunding approve enforces four-eyes and can be canceled", () => {
    const store = seededStore();
    const wf = new DefundingWorkflow(store);
    wf.create({
      id: "DRQ1",
      amount: "10.00",
      creditedWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
      debitedWalletAlias: "SRC",
      initiatorUserUUID: "user-1",
    });
    try {
      wf.approve("DRQ1", { caller: { entityBIC: "BANKAXXXXXX" }, approverUserUUID: "user-1" });
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as WorkflowRejection).statusCode).toBe(403);
    }
    const canceled = wf.cancel("DRQ1");
    expect(canceled.status).toBe("CANCELED");
    expect(store.getWallet("SRC")?.balance).toBe("100.00");
  });

  it("does not confuse a funding draft with a defunding workflow (type guard)", () => {
    const store = seededStore();
    new FundingWorkflow(store).create(
      {
        id: "FRQ1",
        amount: "10.00",
        creditedWalletAlias: "DST",
        debitedWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
      },
      { caller: { entityBIC: "BANKBXXXXXX" } },
    );
    const defunding = new DefundingWorkflow(store);
    expect(() => defunding.approve("FRQ1")).toThrow();
  });
});

describe("PaymentWorkflow (one-step, checked debit — issue #15)", () => {
  const CALLER = { entityBIC: "BANKAXXXXXX" };

  it("execute settles immediately without persisting a draft", () => {
    const store = seededStore();
    const wf = new PaymentWorkflow(store);
    wf.execute(
      { id: "PAY1", amount: "15.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC" },
      { caller: CALLER },
    );
    expect(store.getWallet("SRC")?.balance).toBe("85.00");
    expect(store.getWallet("DST")?.balance).toBe("15.00");
    expect(store.getDrafts()).toHaveLength(0);
    expect(store.getTransactions()).toHaveLength(1);
    expect(store.getTransactions()[0].id).toBe("TX-PAY1");
  });

  it("rejects with 422 when the source lacks sufficient available balance", () => {
    const store = seededStore();
    const wf = new PaymentWorkflow(store);
    try {
      wf.execute(
        { id: "PAY2", amount: "500.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC" },
        { caller: CALLER },
      );
      throw new Error("expected rejection");
    } catch (e) {
      const r = e as WorkflowRejection;
      expect(r.statusCode).toBe(422);
      expect(r.errorCode).toBe("HL-BAL-001");
    }
    // no balances moved
    expect(store.getWallet("SRC")?.balance).toBe("100.00");
    expect(store.getWallet("DST")?.balance).toBe("0.00");
  });

  it("rejects with 403 when the caller has no debit right on the source", () => {
    const store = seededStore();
    const wf = new PaymentWorkflow(store);
    try {
      wf.execute(
        { id: "PAY3", amount: "10.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC" },
        { caller: { entityBIC: "OTHERBANKXX" } },
      );
      throw new Error("expected rejection");
    } catch (e) {
      const r = e as WorkflowRejection;
      expect(r.statusCode).toBe(403);
      expect(r.errorCode).toBe("HL-AUT-001");
    }
    expect(store.getWallet("SRC")?.balance).toBe("100.00");
  });
});

describe("DirectRtgsWorkflow (composite defund + fund — issue #19)", () => {
  const CALLER = { entityBIC: "BANKAXXXXXX" };

  it("two-step: create reserves nothing; approve debits payer and credits receiver", () => {
    const store = seededStore();
    const wf = new DirectRtgsWorkflow(store);
    wf.create({ id: "DRTGS1", amount: "40.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC", initiatorUserUUID: "user-1" });
    expect(store.getWallet("SRC")?.balance).toBe("100.00"); // nothing reserved at create
    const settled = wf.approve("DRTGS1", { caller: CALLER, approverUserUUID: "user-2" });
    expect(settled.status).toBe("SETTLED");
    expect(store.getWallet("SRC")?.balance).toBe("60.00");
    expect(store.getWallet("DST")?.balance).toBe("40.00");
    expect(store.getTransactions()[0].type).toBe("DIRECT_RTGS");
  });

  it("two-step: approve rejects with 422 when the payer is short at approval", () => {
    const store = seededStore();
    const wf = new DirectRtgsWorkflow(store);
    wf.create({ id: "DRTGS1", amount: "500.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC", initiatorUserUUID: "user-1" });
    try {
      wf.approve("DRTGS1", { caller: CALLER, approverUserUUID: "user-2" });
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as WorkflowRejection).statusCode).toBe(422);
    }
    expect(store.getWallet("SRC")?.balance).toBe("100.00");
  });

  it("one-step: execute settles immediately without a draft", () => {
    const store = seededStore();
    const wf = new DirectRtgsWorkflow(store);
    wf.execute(
      { id: "DRTGS-1S", amount: "25.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC" },
      { caller: CALLER },
    );
    expect(store.getWallet("SRC")?.balance).toBe("75.00");
    expect(store.getWallet("DST")?.balance).toBe("25.00");
    expect(store.getDrafts()).toHaveLength(0);
    expect(store.getTransactions()).toHaveLength(1);
  });
});

describe("PfodWorkflow (matched settlement — issue #20)", () => {
  const SELLER = { entityBIC: "BANKAXXXXXX" };

  it("matched settlement debits the seller and credits the buyer", () => {
    const store = seededStore();
    const wf = new PfodWorkflow(store);
    wf.execute(
      { id: "PFOD-T1", amount: "40.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC" },
      { caller: SELLER },
    );
    expect(store.getWallet("SRC")?.balance).toBe("60.00");
    expect(store.getWallet("DST")?.balance).toBe("40.00");
    expect(store.getTransactions()[0].type).toBe("PFOD");
  });

  it("matched settlement rejects with 422 when the seller is short", () => {
    const store = seededStore();
    const wf = new PfodWorkflow(store);
    try {
      wf.execute(
        { id: "PFOD-T2", amount: "500.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC" },
        { caller: SELLER },
      );
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as WorkflowRejection).statusCode).toBe(422);
    }
    expect(store.getWallet("SRC")?.balance).toBe("100.00");
  });
});

describe("XvpWorkflow (cash leg: buyer → seller — issue #21)", () => {
  const BUYER = { entityBIC: "BANKBXXXXXX" };

  function seed() {
    const s = new MemoryStore();
    s.ensureWallet("SELLER-W", { ownerEntityID: "BANKAXXXXXX", managerNCB: "BDF" });
    s.ensureWallet("BUYER-W", { ownerEntityID: "BANKBXXXXXX", managerNCB: "BDF", availableBalance: "100.00" });
    return s;
  }
  function init(store = seed(), amount = "40.00") {
    const wf = new XvpWorkflow(store);
    const r = wf.init({
      xvpTransactionId: "XVP1",
      transactionType: "DVP",
      amount,
      currency: "EUR",
      sellerWalletAlias: "SELLER-W",
      sellerBic: "BANKAXXXXXX",
      buyerBic: "BANKBXXXXXX",
    });
    return { store, wf, r };
  }

  it("init registers the XvP and issues hashes without moving funds", () => {
    const { store, r } = init();
    expect(r.status).toBe("INITIALIZED");
    expect(r.executionHash).toHaveLength(64);
    expect(r.cancellationHash).toHaveLength(64);
    expect(r.timeout).toBeDefined();
    expect(store.getWallet("BUYER-W")?.balance).toBe("100.00");
    expect(store.getWallet("SELLER-W")?.balance).toBe("0.00");
  });

  it("pay debits the buyer, credits the seller and records the transfer", () => {
    const { store, wf } = init();
    const p = wf.pay("XVP1", {
      buyerWalletAlias: "BUYER-W",
      buyerBic: "BANKBXXXXXX",
      sellerBic: "BANKAXXXXXX",
      amount: "40.00",
      currency: "EUR",
      caller: BUYER,
    });
    expect(p.status).toBe("SETTLED");
    expect(p.executionKey).toHaveLength(64);
    expect(store.getWallet("BUYER-W")?.balance).toBe("60.00");
    expect(store.getWallet("SELLER-W")?.balance).toBe("40.00");
    const tx = store.getTransactions()[0];
    expect(tx.type).toBe("XVP");
    expect(tx.debitedWalletAlias).toBe("BUYER-W");
    expect(tx.creditedWalletAlias).toBe("SELLER-W");
  });

  it("rejects pay when the buyer has insufficient funds (422)", () => {
    const { store, wf } = init(seed(), "500.00");
    try {
      wf.pay("XVP1", { buyerWalletAlias: "BUYER-W", buyerBic: "BANKBXXXXXX", sellerBic: "BANKAXXXXXX", amount: "500.00", currency: "EUR", caller: BUYER });
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as WorkflowRejection).statusCode).toBe(422);
    }
    expect(store.getWallet("BUYER-W")?.balance).toBe("100.00");
    expect(store.getWallet("SELLER-W")?.balance).toBe("0.00");
  });

  it("rejects pay on a buyer-BIC / seller-BIC / amount / currency mismatch (400)", () => {
    const bads = [
      { buyerBic: "WRONGBICXXX", sellerBic: "BANKAXXXXXX", amount: "40.00", currency: "EUR" },
      { buyerBic: "BANKBXXXXXX", sellerBic: "WRONGBICXXX", amount: "40.00", currency: "EUR" },
      { buyerBic: "BANKBXXXXXX", sellerBic: "BANKAXXXXXX", amount: "41.00", currency: "EUR" },
      { buyerBic: "BANKBXXXXXX", sellerBic: "BANKAXXXXXX", amount: "40.00", currency: "USD" },
    ];
    for (const bad of bads) {
      const { wf } = init();
      try {
        wf.pay("XVP1", { buyerWalletAlias: "BUYER-W", caller: BUYER, ...bad });
        throw new Error("expected rejection");
      } catch (e) {
        expect((e as WorkflowRejection).statusCode).toBe(400);
      }
    }
  });

  it("rejects pay on an unknown seller (credit) wallet without debiting the buyer (422)", () => {
    const store = seed();
    const wf = new XvpWorkflow(store);
    wf.init({ xvpTransactionId: "XVP9", transactionType: "DVP", amount: "40.00", currency: "EUR", sellerWalletAlias: "GHOST", sellerBic: "BANKAXXXXXX", buyerBic: "BANKBXXXXXX" });
    try {
      wf.pay("XVP9", { buyerWalletAlias: "BUYER-W", buyerBic: "BANKBXXXXXX", sellerBic: "BANKAXXXXXX", amount: "40.00", currency: "EUR", caller: BUYER });
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as WorkflowRejection).statusCode).toBe(422);
    }
    expect(store.getWallet("BUYER-W")?.balance).toBe("100.00");
  });
});

describe("Debit-side wallet must pre-exist (issue #23)", () => {
  it("transfer create rejects with 422 when the debit wallet does not exist", () => {
    const store = new MemoryStore();
    store.ensureWallet("DST", { ownerEntityID: "BANKBXXXXXX", managerNCB: "BDFEFR" }); // credit side only
    const wf = new TransferWorkflow(store);
    try {
      wf.create({ id: "TR1", amount: "10.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC" });
      throw new Error("expected rejection");
    } catch (e) {
      const r = e as WorkflowRejection;
      expect(r.statusCode).toBe(422);
      expect(r.errorCode).toBe("HL-WAL-002");
    }
    expect(store.getDraft("TR1")).toBeUndefined();
  });

  it("one-step payment rejects with 422 when the debit wallet does not exist", () => {
    const store = new MemoryStore();
    store.ensureWallet("DST", { ownerEntityID: "BANKBXXXXXX", managerNCB: "BDFEFR" });
    const wf = new PaymentWorkflow(store);
    try {
      wf.execute(
        { id: "PAY1", amount: "10.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC" },
        { caller: { entityBIC: "BANKAXXXXXX" } },
      );
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as WorkflowRejection).statusCode).toBe(422);
    }
    expect(store.getTransactions()).toHaveLength(0);
  });

  it("funding (credit-only) still settles when the target is created on the credit side", () => {
    const store = new MemoryStore();
    store.ensureWallet("DST", { ownerEntityID: "BANKBXXXXXX", managerNCB: "BDFEFR" });
    const wf = new FundingWorkflow(store);
    wf.create(
      {
        id: "FRQ1",
        amount: "25.00",
        creditedWalletAlias: "DST",
        debitedWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET", // debit side never touched
        initiatorUserUUID: "user-1",
      },
      { caller: { entityBIC: "BANKBXXXXXX" } },
    );
    wf.approve("FRQ1", { approverUserUUID: "user-2" });
    expect(store.getWallet("DST")?.balance).toBe("25.00");
  });
});

describe("Four-eyes fails closed (issue #28)", () => {
  const CALLER = { entityBIC: "BANKAXXXXXX" };

  it("rejects approval when the approver identity is missing (no JWT)", () => {
    const store = seededStore();
    const wf = new TransferWorkflow(store);
    wf.create({ id: "TR1", amount: "10.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC", initiatorUserUUID: "user-1" });
    try {
      wf.approve("TR1", { caller: CALLER }); // no approverUserUUID
      throw new Error("expected rejection");
    } catch (e) {
      const r = e as WorkflowRejection;
      expect(r.statusCode).toBe(403);
      expect(r.errorCode).toBe("HL-GER-003");
    }
    expect(store.getDraft("TR1")?.status).toBe("PENDING_APPROVAL");
  });

  it("rejects approval when the recorded initiator is unknown", () => {
    const store = seededStore();
    const wf = new TransferWorkflow(store);
    wf.create({ id: "TR1", amount: "10.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC" }); // no initiator
    try {
      wf.approve("TR1", { caller: CALLER, approverUserUUID: "user-2" });
      throw new Error("expected rejection");
    } catch (e) {
      const r = e as WorkflowRejection;
      expect(r.statusCode).toBe(403);
      expect(r.errorCode).toBe("HL-GER-003");
    }
    expect(store.getDraft("TR1")?.status).toBe("PENDING_APPROVAL");
  });

  it("allows approval by a distinct authenticated user", () => {
    const store = seededStore();
    const wf = new TransferWorkflow(store);
    wf.create({ id: "TR1", amount: "10.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC", initiatorUserUUID: "user-1" });
    const settled = wf.approve("TR1", { caller: CALLER, approverUserUUID: "user-2" });
    expect(settled.status).toBe("SETTLED");
  });
});

describe("Workflow persistence (memory/Redis-style cache)", () => {
  it("persists drafts and transactions and rehydrates them", async () => {
    const cache = new CacheMemory();
    const store = new MemoryStore(cache);
    store.ensureWallet("SRC", { ownerEntityID: "BANKAXXXXXX", managerNCB: "BDFEFR" });
    store.ensureWallet("DST", { ownerEntityID: "BANKBXXXXXX", managerNCB: "BDFEFR" });
    store.credit("SRC", "100.00");
    const wf = new TransferWorkflow(store);
    wf.create({ id: "TR1", amount: "20.00", creditedWalletAlias: "DST", debitedWalletAlias: "SRC", initiatorUserUUID: "user-1" });
    wf.approve("TR1", { caller: { entityBIC: "BANKAXXXXXX" }, approverUserUUID: "user-2" });

    const reloaded = new MemoryStore(cache);
    await reloaded.hydrate();
    expect(reloaded.getDraft("TR1")?.status).toBe("SETTLED");
    expect(reloaded.getTransactions()).toHaveLength(1);
    expect(reloaded.getWallet("SRC")?.balance).toBe("80.00");
    expect(reloaded.getWallet("DST")?.balance).toBe("20.00");
  });
});
