/**
 * Draft id resolution tests (issue #32).
 *
 * Covers:
 *  - deterministic daily-sequence minting (monotonic within a day, per prefix),
 *  - honouring a client-supplied instruction id (round-trips unchanged), and
 *  - duplicate client id → 409 HL-GER-004.
 */

import { describe, it, expect } from "@jest/globals";
import { MemoryStore } from "../src/state/memory-store.js";
import { resolveDraftId } from "../src/state/draft-id.js";
import { isWorkflowRejection } from "../src/workflows/workflow.js";
import type { Draft } from "../src/state/mock-store.js";

function draft(id: string): Draft {
  const now = new Date().toISOString();
  return {
    id,
    type: "TRANSFER",
    status: "PENDING_APPROVAL",
    amount: "1.00",
    currency: "EUR",
    creditedWalletAlias: "CRD",
    debitedWalletAlias: "DBT",
    createdAt: now,
    updatedAt: now,
  };
}

describe("MemoryStore.nextId — daily sequence (issue #32)", () => {
  it("mints monotonic, zero-padded ids per prefix within a day", () => {
    const store = new MemoryStore();
    const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    expect(store.nextId("TR")).toBe(`TR${day}000001`);
    expect(store.nextId("TR")).toBe(`TR${day}000002`);
    expect(store.nextId("TR")).toBe(`TR${day}000003`);
  });

  it("keeps independent counters per prefix", () => {
    const store = new MemoryStore();
    const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    expect(store.nextId("FRQ")).toBe(`FRQ${day}000001`);
    expect(store.nextId("DRQ")).toBe(`DRQ${day}000001`);
    expect(store.nextId("FRQ")).toBe(`FRQ${day}000002`);
  });

  it("resets the counter on reset()", () => {
    const store = new MemoryStore();
    const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    store.nextId("TR");
    store.reset();
    expect(store.nextId("TR")).toBe(`TR${day}000001`);
  });
});

describe("resolveDraftId — honour client id (issue #32)", () => {
  it("returns the client-supplied id unchanged when provided", () => {
    const store = new MemoryStore();
    expect(resolveDraftId(store, "TR", "TR260101000009-BDF")).toBe(
      "TR260101000009-BDF",
    );
  });

  it("mints a sequence id when the client id is absent/blank", () => {
    const store = new MemoryStore();
    const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    expect(resolveDraftId(store, "TR", undefined)).toBe(`TR${day}000001`);
    expect(resolveDraftId(store, "TR", "")).toBe(`TR${day}000002`);
    expect(resolveDraftId(store, "TR", "   ")).toBe(`TR${day}000003`);
  });

  it("rejects a duplicate client id with 409 HL-GER-004", () => {
    const store = new MemoryStore();
    store.addDraft(draft("TR260101000009-BDF"));
    try {
      resolveDraftId(store, "TR", "TR260101000009-BDF");
      throw new Error("expected rejection");
    } catch (e) {
      expect(isWorkflowRejection(e)).toBe(true);
      if (isWorkflowRejection(e)) {
        expect(e.statusCode).toBe(409);
        expect(e.errorCode).toBe("HL-GER-004");
      }
    }
  });
});
