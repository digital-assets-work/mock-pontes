/**
 * XvP expiry persistence + per-transaction coordination boundary (workbench
 * issue #144).
 *
 * Exercises `XvpWorkflow`'s injectable clock and `InProcessXvpLock` directly
 * (unit level) — HTTP-level coverage of the user-facing status/key-disclosure
 * projection lives in `tests/integration/http-flow.test.ts`.
 */

import { describe, it, expect } from "@jest/globals";
import { MemoryStore } from "../src/state/memory-store.js";
import { XvpWorkflow } from "../src/workflows/xvp.js";
import { isWorkflowRejection } from "../src/workflows/workflow.js";

const SELLER = { entityBIC: "BANKAXXXXXX" };
const BUYER = { entityBIC: "BANKBXXXXXX" };

function seed(buyerBalance = "100.00"): MemoryStore {
  const s = new MemoryStore();
  s.ensureWallet("SELLER-W", { ownerEntityID: SELLER.entityBIC, managerNCB: "BDF" });
  s.ensureWallet("BUYER-W", { ownerEntityID: BUYER.entityBIC, managerNCB: "BDF", availableBalance: buyerBalance });
  return s;
}

/** A manually-resolvable promise, for controlled test barriers/deferred work. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * True iff `p` has NOT settled after every currently-queued microtask has run
 * (a promise `.then()` callback always fires before the next macrotask, so
 * racing against a `setImmediate` reliably distinguishes "already resolved/
 * rejected" from "genuinely still waiting").
 */
function stillPending(p: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    p.then(
      () => false,
      () => false,
    ),
    new Promise<boolean>((resolve) => setImmediate(() => resolve(true))),
  ]);
}

describe("XvP expiry persistence + coordination boundary (issue #144)", () => {
  it("persists EXPIRED on first observation via get(), and a later read never reverts it", async () => {
    const store = seed();
    let now = 1_000_000;
    const wf = new XvpWorkflow(store, { now: () => now });
    wf.init({
      xvpTransactionId: "XVP-EXP",
      transactionType: "DVP",
      amount: "40.00",
      currency: "EUR",
      sellerWalletAlias: "SELLER-W",
      sellerBic: SELLER.entityBIC,
      buyerBic: BUYER.entityBIC,
      timeoutSec: 1, // deadline = 1_001_000
    });
    expect(store.getDraft("XVP-EXP")!.status).toBe("INITIALIZED");
    // Exactly at the deadline: NOT expired (strict `<`, not `<=`).
    now = 1_001_000;
    expect((await wf.get("XVP-EXP"))!.status).toBe("INITIALIZED");
    expect(store.getDraft("XVP-EXP")!.status).toBe("INITIALIZED");
    // 1ms past the deadline: first observation persists EXPIRED.
    now = 1_001_001;
    expect((await wf.get("XVP-EXP"))!.status).toBe("EXPIRED");
    expect(store.getDraft("XVP-EXP")!.status).toBe("EXPIRED");
    // Backwards clock adjustment / persisted-state reload: once committed,
    // EXPIRED never reverts, even if "now" moves back before the deadline, and
    // even via a fresh XvpWorkflow instance over the same (reloaded) store.
    now = 1_000_500;
    expect((await wf.get("XVP-EXP"))!.status).toBe("EXPIRED");
    const reloaded = new XvpWorkflow(store, { now: () => 1_000_500 });
    expect((await reloaded.get("XVP-EXP"))!.status).toBe("EXPIRED");
  });

  it("unifies the late-payment rejection: first and subsequent late attempts both get HL-XVP-003 with zero money movement", async () => {
    const store = seed();
    let now = 0;
    const wf = new XvpWorkflow(store, { now: () => now });
    wf.init({
      xvpTransactionId: "XVP-LATE",
      transactionType: "DVP",
      amount: "40.00",
      currency: "EUR",
      sellerWalletAlias: "SELLER-W",
      sellerBic: SELLER.entityBIC,
      buyerBic: BUYER.entityBIC,
      timeoutSec: 1,
    });
    now = 2000; // past the deadline
    const payParams = { buyerWalletAlias: "BUYER-W", buyerBic: BUYER.entityBIC, sellerBic: SELLER.entityBIC, amount: "40.00", currency: "EUR", caller: BUYER };
    const first = await wf.pay("XVP-LATE", payParams).catch((e) => e);
    expect(isWorkflowRejection(first)).toBe(true);
    expect(first.statusCode).toBe(409);
    expect(first.errorCode).toBe("HL-XVP-003");
    expect(first.errorDescription).toBe("XvP XVP-LATE is already EXPIRED");
    const second = await wf.pay("XVP-LATE", payParams).catch((e) => e);
    expect(isWorkflowRejection(second)).toBe(true);
    expect(second.statusCode).toBe(409);
    expect(second.errorCode).toBe("HL-XVP-003");
    expect(second.errorDescription).toBe(first.errorDescription);
    expect(store.getWallet("BUYER-W")!.balance).toBe("100.00");
    expect(store.getWallet("SELLER-W")!.balance).toBe("0.00");
  });

  it("payment wins: admitted 1ms before the deadline, holds the boundary through settlement; a cancellation-key GET queued behind it waits and then sees SETTLED", async () => {
    const store = seed();
    let now = 0;
    const admitted = deferred();
    const wf = new XvpWorkflow(store, { now: () => now, onPaymentAdmitted: () => admitted.promise });
    wf.init({
      xvpTransactionId: "XVP-PWIN",
      transactionType: "DVP",
      amount: "40.00",
      currency: "EUR",
      sellerWalletAlias: "SELLER-W",
      sellerBic: SELLER.entityBIC,
      buyerBic: BUYER.entityBIC,
      timeoutSec: 1, // deadline = 1000
    });
    now = 999; // 1ms before the deadline: admitted.
    const payPromise = wf.pay("XVP-PWIN", {
      buyerWalletAlias: "BUYER-W",
      buyerBic: BUYER.entityBIC,
      sellerBic: SELLER.entityBIC,
      amount: "40.00",
      currency: "EUR",
      caller: BUYER,
    });
    // Let the payment's admission checks (which read "now") actually run and
    // suspend on the barrier before the clock moves — otherwise this test
    // would race its own `now` mutation against the deferred admission check.
    await Promise.resolve();
    now = 1001; // the competing GET observes the clock 1ms after the deadline.
    const getPromise = wf.get("XVP-PWIN");
    // The GET must genuinely queue behind the in-flight (barrier-held) payment.
    expect(await stillPending(getPromise)).toBe(true);
    expect(await stillPending(payPromise)).toBe(true);
    // Release the payment's admitted barrier: settlement can now complete.
    admitted.resolve();
    const pay = await payPromise;
    expect(pay.status).toBe("SETTLED");
    // The GET, having waited, now observes the committed outcome — never a
    // half-applied state, and the record is SETTLED (no expiry, no
    // cancellation key ever disclosed for a settled XvP).
    const rec = await getPromise;
    expect(rec!.status).toBe("SETTLED");
    expect(store.getWallet("BUYER-W")!.balance).toBe("60.00");
    expect(store.getWallet("SELLER-W")!.balance).toBe("40.00");
  });

  it("expiry wins: a queued payment observes EXPIRED and fails with no debit, credit or execution-key disclosure", async () => {
    const store = seed();
    let now = 0;
    const wf = new XvpWorkflow(store, { now: () => now });
    wf.init({
      xvpTransactionId: "XVP-EWIN",
      transactionType: "DVP",
      amount: "40.00",
      currency: "EUR",
      sellerWalletAlias: "SELLER-W",
      sellerBic: SELLER.entityBIC,
      buyerBic: BUYER.entityBIC,
      timeoutSec: 1, // deadline = 1000
    });
    now = 1001; // past the deadline before either operation is admitted.
    // Call order (no `await` in between) establishes FIFO admission order:
    // the expiry-observing GET is admitted first.
    const getPromise = wf.get("XVP-EWIN");
    const payPromise = wf.pay("XVP-EWIN", {
      buyerWalletAlias: "BUYER-W",
      buyerBic: BUYER.entityBIC,
      sellerBic: SELLER.entityBIC,
      amount: "40.00",
      currency: "EUR",
      caller: BUYER,
    });
    const rec = await getPromise;
    expect(rec!.status).toBe("EXPIRED");
    const payErr = await payPromise.catch((e) => e);
    expect(isWorkflowRejection(payErr)).toBe(true);
    expect(payErr.errorCode).toBe("HL-XVP-003");
    expect(payErr.errorDescription).toContain("EXPIRED");
    expect(store.getWallet("BUYER-W")!.balance).toBe("100.00");
    expect(store.getWallet("SELLER-W")!.balance).toBe("0.00");
  });

  it("two concurrent payments for the same XvP cannot both debit; the second observes SETTLED and fails", async () => {
    const store = seed();
    const wf = new XvpWorkflow(store, { now: () => 0 });
    wf.init({
      xvpTransactionId: "XVP-DBL",
      transactionType: "DVP",
      amount: "40.00",
      currency: "EUR",
      sellerWalletAlias: "SELLER-W",
      sellerBic: SELLER.entityBIC,
      buyerBic: BUYER.entityBIC,
    });
    const params = {
      buyerWalletAlias: "BUYER-W",
      buyerBic: BUYER.entityBIC,
      sellerBic: SELLER.entityBIC,
      amount: "40.00",
      currency: "EUR",
      caller: BUYER,
    };
    // Fired back-to-back, no `await` in between: both queue on the same lock.
    const first = wf.pay("XVP-DBL", params);
    const second = wf.pay("XVP-DBL", params);
    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.errorCode).toBe("HL-XVP-003");
    // Exactly one debit/credit applied — never double.
    expect(store.getWallet("BUYER-W")!.balance).toBe("60.00");
    expect(store.getWallet("SELLER-W")!.balance).toBe("40.00");
    expect(store.getTransactions()).toHaveLength(1);
  });

  it("unrelated XvP ids never block each other", async () => {
    const store = seed();
    const admitted = deferred();
    const wf = new XvpWorkflow(store, { now: () => 0, onPaymentAdmitted: () => admitted.promise });
    for (const id of ["XVP-A", "XVP-B"]) {
      wf.init({
        xvpTransactionId: id,
        transactionType: "DVP",
        amount: "10.00",
        currency: "EUR",
        sellerWalletAlias: "SELLER-W",
        sellerBic: SELLER.entityBIC,
        buyerBic: BUYER.entityBIC,
      });
    }
    // XVP-A's payment is held open on the barrier; XVP-B's GET must still
    // resolve promptly since the two ids have independent boundaries.
    const payA = wf.pay("XVP-A", {
      buyerWalletAlias: "BUYER-W",
      buyerBic: BUYER.entityBIC,
      sellerBic: SELLER.entityBIC,
      amount: "10.00",
      currency: "EUR",
      caller: BUYER,
    });
    const getB = wf.get("XVP-B");
    expect(await stillPending(getB)).toBe(false);
    expect((await getB)!.status).toBe("INITIALIZED");
    expect(await stillPending(payA)).toBe(true);
    admitted.resolve();
    expect((await payA).status).toBe("SETTLED");
  });

  it("a failed payment releases the boundary; a before-deadline retry can still be admitted", async () => {
    const store = seed("10.00"); // insufficient funds for a 40.00 payment
    const wf = new XvpWorkflow(store, { now: () => 0 });
    wf.init({
      xvpTransactionId: "XVP-RETRY",
      transactionType: "DVP",
      amount: "40.00",
      currency: "EUR",
      sellerWalletAlias: "SELLER-W",
      sellerBic: SELLER.entityBIC,
      buyerBic: BUYER.entityBIC,
    });
    const params = {
      buyerWalletAlias: "BUYER-W",
      buyerBic: BUYER.entityBIC,
      sellerBic: SELLER.entityBIC,
      amount: "40.00",
      currency: "EUR",
      caller: BUYER,
    };
    const failed = await wf.pay("XVP-RETRY", params).catch((e) => e);
    expect(isWorkflowRejection(failed)).toBe(true);
    expect(failed.statusCode).toBe(422);
    // Top up the buyer, then retry — the lock was released, not stuck.
    store.credit("BUYER-W", "30.00");
    const retried = await wf.pay("XVP-RETRY", params);
    expect(retried.status).toBe("SETTLED");
    expect(store.getWallet("SELLER-W")!.balance).toBe("40.00");
  });
});
