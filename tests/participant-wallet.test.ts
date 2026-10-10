/**
 * Unit tests for `resolveParticipantWallet` (issue #139): BIC-based cash
 * wallet resolution shared by XvP seller init and buyer payment. Pure
 * function — no HTTP layer, mirroring `tests/dcw.test.ts`'s style.
 */

import { describe, it, expect } from "@jest/globals";
import { resolveParticipantWallet } from "../src/state/participant-wallet.js";
import { MemoryStore } from "../src/state/memory-store.js";
import { CacheMemory } from "../src/cache/in-memory.js";

const BIC_A = "BSUIFRPPXXX";
const BIC_B = "BEIILULUXXX";

describe("resolveParticipantWallet — explicit alias", () => {
  it("resolves an existing alias owned by the participant", () => {
    const s = new MemoryStore();
    s.ensureWallet("W-A-1", { ownerEntityID: BIC_A, ownerBIC: BIC_A });
    const r = resolveParticipantWallet(s, BIC_A, "W-A-1");
    expect(r.ok).toBe(true);
    expect(r.ok && r.wallet.alias).toBe("W-A-1");
  });

  it("fails (WALLET_NOT_FOUND) when the alias does not exist — never auto-creates", () => {
    const s = new MemoryStore();
    const r = resolveParticipantWallet(s, BIC_A, "NOPE");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("WALLET_NOT_FOUND");
    expect(s.getWallet("NOPE")).toBeUndefined();
  });

  it("masks an alias owned by a different participant identically to not-found", () => {
    const s = new MemoryStore();
    s.ensureWallet("W-B-1", { ownerEntityID: BIC_B, ownerBIC: BIC_B });
    const r = resolveParticipantWallet(s, BIC_A, "W-B-1");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("WALLET_NOT_FOUND");
  });
});

describe("resolveParticipantWallet — default resolution (no explicit alias)", () => {
  it("picks the participant's main wallet when present", () => {
    const s = new MemoryStore();
    s.ensureWallet("W-A-1", { ownerEntityID: BIC_A, ownerBIC: BIC_A, isMainWallet: false });
    s.ensureWallet("W-A-2", { ownerEntityID: BIC_A, ownerBIC: BIC_A, isMainWallet: true });
    const r = resolveParticipantWallet(s, BIC_A, undefined);
    expect(r.ok).toBe(true);
    expect(r.ok && r.wallet.alias).toBe("W-A-2");
  });

  it("falls back to the first owned wallet when none is flagged main", () => {
    const s = new MemoryStore();
    s.ensureWallet("W-A-1", { ownerEntityID: BIC_A, ownerBIC: BIC_A });
    s.ensureWallet("W-A-2", { ownerEntityID: BIC_A, ownerBIC: BIC_A });
    const r = resolveParticipantWallet(s, BIC_A, undefined);
    expect(r.ok).toBe(true);
    expect(r.ok && r.wallet.alias).toBe("W-A-1");
  });

  it("picks the first main wallet when more than one is (malformed) flagged main", () => {
    const s = new MemoryStore();
    s.ensureWallet("W-A-1", { ownerEntityID: BIC_A, ownerBIC: BIC_A, isMainWallet: true });
    s.ensureWallet("W-A-2", { ownerEntityID: BIC_A, ownerBIC: BIC_A, isMainWallet: true });
    const r = resolveParticipantWallet(s, BIC_A, undefined);
    expect(r.ok).toBe(true);
    expect(r.ok && r.wallet.alias).toBe("W-A-1");
  });

  it("ignores wallets owned by other participants", () => {
    const s = new MemoryStore();
    s.ensureWallet("W-B-1", { ownerEntityID: BIC_B, ownerBIC: BIC_B, isMainWallet: true });
    const r = resolveParticipantWallet(s, BIC_A, undefined);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("NO_PARTICIPANT_WALLET");
  });

  it("fails (NO_PARTICIPANT_WALLET) when the participant owns no wallet at all", () => {
    const s = new MemoryStore();
    const r = resolveParticipantWallet(s, BIC_A, undefined);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("NO_PARTICIPANT_WALLET");
  });

  it("fails when the BIC itself is unknown/undefined", () => {
    const s = new MemoryStore();
    s.ensureWallet("W-A-1", { ownerEntityID: BIC_A, ownerBIC: BIC_A });
    const r = resolveParticipantWallet(s, undefined, undefined);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("NO_PARTICIPANT_WALLET");
  });

  it("preserves insertion order across a hydrate() round-trip", async () => {
    const cache = new CacheMemory();
    const s1 = new MemoryStore(cache);
    s1.ensureWallet("W-A-1", { ownerEntityID: BIC_A, ownerBIC: BIC_A });
    s1.ensureWallet("W-A-2", { ownerEntityID: BIC_A, ownerBIC: BIC_A });

    const s2 = new MemoryStore(cache);
    await s2.hydrate();
    const r = resolveParticipantWallet(s2, BIC_A, undefined);
    expect(r.ok).toBe(true);
    expect(r.ok && r.wallet.alias).toBe("W-A-1");
    cache.close();
  });
});
