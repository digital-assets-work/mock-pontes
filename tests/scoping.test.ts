/**
 * Entity/BIC scoping (issue #56):
 * - wallet reads are filtered by the caller's entity (own / PoA / operator);
 * - a wallet/transaction the caller may not read is masked as "not found";
 * - funding is authorised on the credited wallet at draft creation (a proxy to
 *   the T2 account's debit rights).
 */

import { describe, it, expect } from "@jest/globals";
import { MemoryStore } from "../src/state/memory-store.js";
import { canRead } from "../src/state/dcw.js";
import { FundingWorkflow } from "../src/workflows/funding.js";
import { isWorkflowRejection } from "../src/workflows/workflow.js";

const OWNER = { entityBIC: "BANKAXXXXXX" };
const OTHER = { entityBIC: "BANKBXXXXXX" };

function storeWithWallets(): MemoryStore {
  const store = new MemoryStore();
  store.ensureWallet("A-DCW1", { ownerEntityID: "BANKAXXXXXX", managerNCB: "BDF" });
  store.ensureWallet("A-DCW2", { ownerEntityID: "BANKAXXXXXX", managerNCB: "BDF" });
  store.ensureWallet("B-DCW1", { ownerEntityID: "BANKBXXXXXX", managerNCB: "BDF" });
  return store;
}

describe("canRead (issue #56)", () => {
  const w = {
    ownerEntityID: "BANKAXXXXXX",
    poaGrantees: ["BANKCXXXXXX"],
    whitelistedOperators: ["OP1"],
  } as unknown as Parameters<typeof canRead>[0];

  it("allows the owning entity", () => {
    expect(canRead(w, { entityBIC: "BANKAXXXXXX" }).ok).toBe(true);
  });
  it("allows a PoA grantee and a whitelisted operator", () => {
    expect(canRead(w, { entityBIC: "BANKCXXXXXX" }).ok).toBe(true);
    expect(canRead(w, { marketDLTOperator: "OP1" }).ok).toBe(true);
  });
  it("denies an unrelated entity", () => {
    expect(canRead(w, { entityBIC: "BANKBXXXXXX" }).ok).toBe(false);
  });
});

describe("MemoryStore read scoping (issue #56)", () => {
  it("lists only the caller's own wallets", () => {
    const store = storeWithWallets();
    const own = store.getWallets(OWNER).map((w) => w.alias).sort();
    expect(own).toEqual(["A-DCW1", "A-DCW2"]);
    expect(store.getWallets(OTHER).map((w) => w.alias)).toEqual(["B-DCW1"]);
  });

  it("returns all wallets when no caller is supplied (internal use)", () => {
    const store = storeWithWallets();
    expect(store.getWallets()).toHaveLength(3);
  });

  it("masks another entity's wallet as not found", () => {
    const store = storeWithWallets();
    expect(store.getWallet("B-DCW1", OWNER)).toBeUndefined();
    expect(store.getWallet("A-DCW1", OWNER)?.alias).toBe("A-DCW1");
    // internal (no caller) still sees it
    expect(store.getWallet("B-DCW1")?.alias).toBe("B-DCW1");
  });

  it("masks transactions of an unreadable wallet", () => {
    const store = storeWithWallets();
    store.addTransaction({
      id: "TX1",
      creditedWalletAlias: "B-DCW1",
      debitedWalletAlias: "A-DCW1",
      amount: "1.00",
      currency: "EUR",
      createdAt: new Date().toISOString(),
    } as unknown as Parameters<MemoryStore["addTransaction"]>[0]);
    // OWNER may read A-DCW1's transactions...
    expect(store.getWalletTransactions("A-DCW1", OWNER).length).toBe(1);
    // ...but not B-DCW1's (masked as empty)
    expect(store.getWalletTransactions("B-DCW1", OWNER)).toEqual([]);
  });
});

describe("Funding authorisation on the credited wallet (issue #56)", () => {
  it("rejects funding a wallet the caller is not authorised on", () => {
    const store = new MemoryStore();
    store.ensureWallet("B-DCW1", { ownerEntityID: "BANKBXXXXXX", managerNCB: "BDF" });
    const wf = new FundingWorkflow(store);
    try {
      wf.create(
        { id: "FRQ1", amount: "10.00", creditedWalletAlias: "B-DCW1", debitedWalletAlias: "ISSUANCE", initiatorUserUUID: "u1" },
        { caller: OWNER },
      );
      throw new Error("expected rejection");
    } catch (e) {
      expect(isWorkflowRejection(e)).toBe(true);
      expect((e as { statusCode: number }).statusCode).toBe(403);
    }
    expect(store.getDraft("FRQ1")).toBeUndefined();
  });

  it("allows funding a wallet owned by the caller's entity", () => {
    const store = new MemoryStore();
    store.ensureWallet("A-DCW1", { ownerEntityID: "BANKAXXXXXX", managerNCB: "BDF" });
    const wf = new FundingWorkflow(store);
    const draft = wf.create(
      { id: "FRQ1", amount: "10.00", creditedWalletAlias: "A-DCW1", debitedWalletAlias: "ISSUANCE", initiatorUserUUID: "u1" },
      { caller: OWNER },
    );
    expect(draft.status).toBe("PENDING_APPROVAL");
  });
});
