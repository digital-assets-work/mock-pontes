/**
 * Unit tests for the DCW (Dedicated Cash Wallet) model, operations and
 * persistence (issue #13).
 */

import { describe, it, expect } from "@jest/globals";
import {
  createDcw,
  canDebit,
  withCredit,
  withDebit,
  withLock,
  withRelease,
  withSettleLocked,
  totalOf,
} from "../src/state/dcw.js";
import { MemoryStore } from "../src/state/memory-store.js";
import { CacheMemory } from "../src/cache/in-memory.js";

describe("DCW defaults (createDcw)", () => {
  it("creates a wallet with zero balances, no PoA/whitelist, entity-only debit", () => {
    const w = createDcw("W1", { ownerEntityID: "BANKAXXXXXX", managerNCB: "BDFEFR" });
    expect(w.balance).toBe("0.00");
    expect(w.lockedBalance).toBe("0.00");
    expect(w.poaGrantees).toEqual([]);
    expect(w.whitelistedOperators).toEqual([]);
    expect(w.isBlocked).toBe(false);
    expect(w.ownerEntityID).toBe("BANKAXXXXXX");
  });
});

describe("canDebit (debit rights)", () => {
  const base = createDcw("W1", { ownerEntityID: "BANKAXXXXXX" });
  it("allows a user of the owning entity", () => {
    expect(canDebit(base, { entityBIC: "BANKAXXXXXX" }).ok).toBe(true);
  });
  it("denies a different entity by default", () => {
    const r = canDebit(base, { entityBIC: "BANKBXXXXXX" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NOT_AUTHORISED_TO_DEBIT");
  });
  it("allows a PoA grantee", () => {
    const w = { ...base, poaGrantees: ["BANKBXXXXXX"] };
    expect(canDebit(w, { entityBIC: "BANKBXXXXXX" }).ok).toBe(true);
  });
  it("allows a whitelisted market DLT operator", () => {
    const w = { ...base, whitelistedOperators: ["OP1"] };
    expect(canDebit(w, { marketDLTOperator: "OP1" }).ok).toBe(true);
  });
  it("denies debit on a blocked wallet", () => {
    const w = { ...base, isBlocked: true };
    expect(canDebit(w, { entityBIC: "BANKAXXXXXX" }).reason).toBe("WALLET_BLOCKED");
  });
});

describe("balance operations", () => {
  const w0 = createDcw("W1", { ownerEntityID: "E" });

  it("credits and debits the available balance", () => {
    const w1 = withCredit(w0, "100.00");
    expect(w1.balance).toBe("100.00");
    const w2 = withDebit(w1, "40.50");
    expect(w2.balance).toBe("59.50");
  });

  it("rejects an over-debit", () => {
    expect(() => withDebit(w0, "1.00")).toThrow("DCW_INSUFFICIENT_AVAILABLE");
  });

  it("lock moves available → locked, preserving the total", () => {
    const funded = withCredit(w0, "100.00");
    const locked = withLock(funded, "30.00");
    expect(locked.balance).toBe("70.00");
    expect(locked.lockedBalance).toBe("30.00");
    expect(totalOf(locked)).toBeCloseTo(100);
  });

  it("release returns locked → available", () => {
    const locked = withLock(withCredit(w0, "100.00"), "30.00");
    const released = withRelease(locked, "30.00");
    expect(released.balance).toBe("100.00");
    expect(released.lockedBalance).toBe("0.00");
  });

  it("settleLocked removes from locked (total decreases)", () => {
    const locked = withLock(withCredit(w0, "100.00"), "30.00");
    const settled = withSettleLocked(locked, "30.00");
    expect(settled.lockedBalance).toBe("0.00");
    expect(totalOf(settled)).toBeCloseTo(70);
  });

  it("rejects over-lock / over-release / over-settle", () => {
    expect(() => withLock(w0, "1.00")).toThrow("DCW_INSUFFICIENT_AVAILABLE");
    expect(() => withRelease(w0, "1.00")).toThrow("DCW_INSUFFICIENT_LOCKED");
    expect(() => withSettleLocked(w0, "1.00")).toThrow("DCW_INSUFFICIENT_LOCKED");
  });
});

describe("MemoryStore DCW operations", () => {
  it("ensureWallet is idempotent and applies defaults", () => {
    const s = new MemoryStore();
    const a = s.ensureWallet("W1", { ownerEntityID: "E" });
    const b = s.ensureWallet("W1");
    expect(a).toBe(b);
    expect(s.getWallet("W1")!.balance).toBe("0.00");
  });

  it("debit enforces rights via canDebit", () => {
    const s = new MemoryStore();
    s.ensureWallet("W1", { ownerEntityID: "E" });
    s.credit("W1", "50.00");
    expect(() => s.debit("W1", "10.00", { entityBIC: "OTHER" })).toThrow(
      "DCW_DEBIT_DENIED:NOT_AUTHORISED_TO_DEBIT",
    );
    const w = s.debit("W1", "10.00", { entityBIC: "E" });
    expect(w.balance).toBe("40.00");
  });

  it("throws for operations on an unknown wallet", () => {
    const s = new MemoryStore();
    expect(() => s.credit("NOPE", "1.00")).toThrow("WALLET_NOT_FOUND:NOPE");
  });
});

describe("MemoryStore persistence (write-through + hydrate)", () => {
  it("persists wallet state to the cache and reloads it", async () => {
    const cache = new CacheMemory();
    const s1 = new MemoryStore(cache);
    s1.ensureWallet("W1", { ownerEntityID: "E" });
    s1.credit("W1", "123.45");
    s1.lock("W1", "23.45");

    const s2 = new MemoryStore(cache);
    await s2.hydrate();
    const w = s2.getWallet("W1")!;
    expect(w.balance).toBe("100.00");
    expect(w.lockedBalance).toBe("23.45");

    cache.close();
  });
});
