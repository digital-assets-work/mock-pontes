import { randomBytes, randomUUID } from "node:crypto";
import type { DcwCaller } from "../state/dcw.js";
import type { Draft, MockStore } from "../state/mock-store.js";
import { Workflow, WorkflowRejection } from "./workflow.js";
import { xvpCommitmentHash } from "./xvp-commitment.js";
import { InProcessXvpLock, type XvpLock } from "./xvp-lock.js";

export type XvpTransactionType = "DVP" | "PVP";
export type XvpKeyType = "EXECUTION" | "CANCELLATION";

export interface XvpInitParams {
  xvpTransactionId: string;
  transactionType: XvpTransactionType;
  amount: string;
  currency: string;
  sellerWalletAlias: string; // where the seller is PAID (credited on execution)
  sellerBic?: string;
  buyerBic?: string;         // the entity expected to pay
  seller?: unknown;          // echoed back by GET (Participant)
  buyer?: unknown;           // echoed back by GET (SimpleParticipant)
  timeoutSec?: number;
}

export interface XvpPaymentParams {
  buyerWalletAlias: string; // the buyer's cash wallet, DEBITED on execution
  buyerBic?: string;
  sellerBic?: string;
  amount: string;
  currency: string;
  caller?: DcwCaller;       // buyer's entity, for debit rights
}

export interface XvpInitResult {
  xvpTransactionId: string;
  status: "INITIALIZED";
  executionHash: string;
  cancellationHash: string;
  /**
   * Returned by `init()` for the workflow's own internal persistence only
   * (issue #140: the route layer must NOT echo these in the init HTTP
   * response — they are disclosed later, conditionally, via the
   * payment-outcome query: `executionKey` once SETTLED, `cancellationKey`
   * once UNSETTLED/BURNED).
   */
  executionKey: string;
  cancellationKey: string;
  timeout: string;
}

const DEFAULT_TIMEOUT_SEC = Number(process.env.PONTES_XVP_TIMEOUT_SEC || 3600);

/** Shaped view of a persisted XvP `Draft` + its hash/key/BIC metadata. */
export interface XvpRecord {
  id: string;
  status: string;
  amount: string;
  currency: string;
  sellerWalletAlias: string;
  buyerWalletAlias: string;
  timeout?: string;
  executionHash: string;
  cancellationHash: string;
  transactionType: string;
  executionKey?: string;
  cancellationKey?: string;
  paymentId?: string;
  sellerBic?: string;
  buyerBic?: string;
  seller?: unknown;
  buyer?: unknown;
  paymentAttempted?: boolean;
}

export interface XvpWorkflowOptions {
  /**
   * Injectable clock (issue #144): epoch-ms "now", defaulting to the real
   * wall clock (`Date.now`). Override in tests for deterministic expiry and
   * concurrency scenarios (e.g. placing "now" exactly 1ms either side of a
   * deadline) instead of racing the real clock.
   */
  now?: () => number;
  /**
   * Per-XvP coordination boundary (issue #144, see `./xvp-lock.ts`). Defaults
   * to a fresh `InProcessXvpLock` scoped to this workflow instance — correct
   * for the single mock-pontes process this guarantee targets; see the
   * module docblock on `xvp-lock.ts` for the documented multi-replica
   * limitation.
   */
  lock?: XvpLock;
  /**
   * Test-only instrumentation (issue #144): awaited once a payment has been
   * admitted (status/expiry/BIC/amount/currency all validated) but before the
   * debit/credit settle, so deterministic tests can hold the coordination
   * boundary open with a controlled barrier and prove a concurrent GET
   * genuinely queues behind it. Defaults to a no-op; must never be set in
   * production.
   */
  onPaymentAdmitted?: () => Promise<void> | void;
}

/**
 * XvP (Hash-Linked cash leg).
 *
 * `init` (by the seller) registers the XvP — the seller's receive wallet, the
 * buyer's BIC, amount/currency — and issues an `executionHash`, a
 * `cancellationHash` and a `timeout`. No funds move at init.
 *
 * `pay` (by the buyer) settles the cash leg: it debits the buyer's wallet
 * and credits the seller's wallet, provided the buyer/seller BICs, amount and
 * currency match the initialisation, the buyer wallet is funded, and the caller
 * may debit it. The HLC secrets are returned so the buyer can drive the asset
 * leg.
 *
 * XvP records are persisted as `XVP` drafts (hash/key/BIC metadata in
 * `supplementaryData` as JSON).
 *
 * **Expiry + concurrency (issue #144).** `get()` and `pay()` both run under
 * one per-XvP coordination boundary (`this.lock`, see `./xvp-lock.ts`) and
 * both centralise the first-observation `EXPIRED` transition through
 * `maybeExpire()` — no route or caller re-derives a timed-out status from
 * `timeout`/`Date.now()` independently. See the module docblock on
 * `xvp-lock.ts` for exactly what this boundary does and does not guarantee.
 */
export class XvpWorkflow extends Workflow {
  readonly type = "XVP" as const;
  protected readonly notFoundLabel = "XvP transaction";

  private readonly now: () => number;
  private readonly lock: XvpLock;
  private readonly onPaymentAdmitted: () => Promise<void> | void;

  constructor(store: MockStore, options: XvpWorkflowOptions = {}) {
    super(store);
    this.now = options.now ?? Date.now;
    this.lock = options.lock ?? new InProcessXvpLock();
    this.onPaymentAdmitted = options.onPaymentAdmitted ?? (() => undefined);
  }

  // The base `apply()` is unused: XvP settles via execute() below.
  protected apply(): void {
    throw new WorkflowRejection(500, "HL-XVP-000", "XvP does not use the generic apply()");
  }

  /** Register the XvP and issue the hash-lock. No funds are moved. */
  init(params: XvpInitParams): XvpInitResult {
    if (params.transactionType !== "DVP" && params.transactionType !== "PVP") {
      throw new WorkflowRejection(400, "HL-XVP-001", `Invalid XvP transactionType '${params.transactionType}'`);
    }

    const executionKeyBytes = randomBytes(32);
    const cancellationKeyBytes = randomBytes(32);
    const executionKey = executionKeyBytes.toString("hex");
    const cancellationKey = cancellationKeyBytes.toString("hex");
    const paymentId = randomUUID();
    // Commitments are derived from the raw secret bytes (issue #141), not the
    // hex text above. Existing persisted records keep whatever hash they were
    // created with — only new `init()` calls use this convention, so no
    // upgrade/migration of stored commitments is needed.
    const executionHash = xvpCommitmentHash(executionKeyBytes);
    const cancellationHash = xvpCommitmentHash(cancellationKeyBytes);
    const now = new Date(this.now());
    const timeout = new Date(now.getTime() + (params.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000).toISOString();

    this.store.addDraft({
      id: params.xvpTransactionId,
      type: "XVP",
      status: "INITIALIZED",
      amount: params.amount,
      currency: params.currency,
      creditedWalletAlias: params.sellerWalletAlias, // the seller is paid here
      debitedWalletAlias: "",                          // the buyer wallet is named at execution
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: timeout,
      supplementaryData: JSON.stringify({
        transactionType: params.transactionType,
        executionHash,
        cancellationHash,
        executionKey,
        cancellationKey,
        paymentId,
        sellerBic: params.sellerBic,
        buyerBic: params.buyerBic,
        seller: params.seller,
        buyer: params.buyer,
      }),
    });

    return {
      xvpTransactionId: params.xvpTransactionId,
      status: "INITIALIZED",
      executionHash,
      cancellationHash,
      executionKey,
      cancellationKey,
      timeout,
    };
  }

  /**
   * Build the external record shape from a committed draft. Pure/read-only —
   * no clock read, no mutation. Callers decide whether `maybeExpire()` must
   * run first; both `get()` and `pay()` always run it under `this.lock`
   * before shaping, so every caller of this method already sees a
   * first-observation-settled status.
   */
  private shape(d: Draft): XvpRecord {
    const meta = d.supplementaryData ? JSON.parse(d.supplementaryData) : {};
    return {
      id: d.id,
      status: d.status,
      amount: d.amount,
      currency: d.currency,
      sellerWalletAlias: d.creditedWalletAlias,
      buyerWalletAlias: d.debitedWalletAlias,
      timeout: d.expiresAt,
      executionHash: meta.executionHash,
      cancellationHash: meta.cancellationHash,
      transactionType: meta.transactionType,
      executionKey: meta.executionKey,
      cancellationKey: meta.cancellationKey,
      paymentId: meta.paymentId,
      sellerBic: meta.sellerBic,
      buyerBic: meta.buyerBic,
      seller: meta.seller,
      buyer: meta.buyer,
      paymentAttempted: meta.paymentAttempted,
    };
  }

  /**
   * First-observation expiry transition (issue #144). `SETTLED`/`EXPIRED` are
   * terminal and are returned unchanged — once committed, no later clock
   * reading (including one that moves backwards, or a persisted-state
   * reload) ever recomputes them into something else. An `INITIALIZED`
   * record past its deadline (`timeout < now`; exact equality is NOT
   * expired) is atomically persisted as `EXPIRED` here, the first time *any*
   * caller observes it — payment admission, GET XvP, or GET payment alike.
   *
   * Must only ever be called while already holding this XvP's `lock`
   * boundary, and must stay fully synchronous (no `await`) so the
   * check-then-persist step itself can never be interleaved by another
   * queued caller.
   */
  private maybeExpire(d: Draft): Draft {
    if (d.status !== "INITIALIZED") return d;
    if (!d.expiresAt || Date.parse(d.expiresAt) >= this.now()) return d;
    this.store.updateDraft(d.id, { status: "EXPIRED" });
    return { ...d, status: "EXPIRED" };
  }

  /**
   * Read the persisted XvP record + its hash metadata. Issue #144: this is
   * one of the three places (alongside payment admission and GET payment)
   * that can observe and persist a first-time expiry transition, so it runs
   * under the same per-XvP coordination boundary as `pay()` — a concurrent
   * payment that already holds the boundary is waited out, and this call
   * then re-reads the committed outcome rather than deriving its own.
   */
  async get(xvpTransactionId: string): Promise<XvpRecord | undefined> {
    return this.lock.withLock(xvpTransactionId, () => {
      const d = this.store.getDraft(xvpTransactionId);
      if (!d || d.type !== "XVP") return undefined;
      return this.shape(this.maybeExpire(d));
    });
  }

  /**
   * Execute the cash leg (the buyer pays): validate the request matches the
   * initialisation (BICs, amount, currency), then debit the buyer's wallet and
   * credit the seller's wallet. Returns the HLC secrets for the asset leg.
   *
   * Issue #144: the whole admission-through-settlement sequence runs inside
   * one acquisition of this XvP's coordination boundary — a payment admitted
   * just before the deadline holds the boundary through settlement even if
   * that work crosses the deadline, so a competing expiry/cancellation-key
   * check (GET XvP / GET payment) queued behind it only ever observes the
   * fully-committed outcome, never a half-applied one. The boundary is always
   * released (success or rejection) so a failed payment never leaves the XvP
   * permanently stuck — a before-deadline retry can still be admitted.
   */
  async pay(xvpTransactionId: string, params: XvpPaymentParams): Promise<{
    xvpTransactionId: string;
    status: "SETTLED";
    executionKey?: string;
    cancellationKey?: string;
    paymentId?: string;
  }> {
    return this.lock.withLock(xvpTransactionId, async () => {
      const d = this.store.getDraft(xvpTransactionId);
      if (!d || d.type !== "XVP") {
        throw new WorkflowRejection(404, "HL-XVP-002", `XvP transaction ${xvpTransactionId} not found`);
      }
      const rec = this.shape(this.maybeExpire(d));
      // Issue #144: a late payment is reported identically regardless of
      // whether an earlier caller already observed/persisted the expiry —
      // `maybeExpire` above always runs first, so this generic "already
      // <status>" rejection uniformly covers both the first late attempt and
      // any subsequent one (previously the first got a dedicated HL-XVP-004
      // "timed out" rejection and only a later one got this HL-XVP-003
      // message; unified per the issue's acceptance criteria — same
      // committed terminal state, zero money movement, either way).
      if (rec.status !== "INITIALIZED") {
        throw new WorkflowRejection(409, "HL-XVP-003", `XvP ${xvpTransactionId} is already ${rec.status}`);
      }
      // The payment must match the initialisation.
      if (rec.buyerBic && params.buyerBic && params.buyerBic !== rec.buyerBic) {
        throw new WorkflowRejection(400, "HL-XVP-006", `Buyer BIC '${params.buyerBic}' does not match the XvP buyer '${rec.buyerBic}'`);
      }
      if (rec.sellerBic && params.sellerBic && params.sellerBic !== rec.sellerBic) {
        throw new WorkflowRejection(400, "HL-XVP-006", `Seller BIC '${params.sellerBic}' does not match the XvP seller '${rec.sellerBic}'`);
      }
      if (params.amount !== rec.amount) {
        throw new WorkflowRejection(400, "HL-XVP-006", `Payment amount '${params.amount}' does not match the XvP amount '${rec.amount}'`);
      }
      if (params.currency !== rec.currency) {
        throw new WorkflowRejection(400, "HL-XVP-006", `Payment currency '${params.currency}' does not match the XvP currency '${rec.currency}'`);
      }
      // Admitted: every precondition above held while we hold the boundary.
      // From here on we commit — see the `onPaymentAdmitted` docblock for why
      // this call exists (test-only instrumentation, no-op in production).
      await this.onPaymentAdmitted();
      // A well-formed payment has been initiated — record it so a later timeout is
      // reported as UNSETTLED (payment attempted) rather than BURNED (never
      // attempted).
      this.markPaymentAttempted(rec.id);
      // Conservation (issue #77): the seller's credit wallet must exist before we
      // debit the buyer, so a settlement never debits and then discards the credit.
      this.requireCreditWallet(rec.sellerWalletAlias);
      // Debit the buyer (rights + availability), then credit the seller.
      this.checkedDebit(params.buyerWalletAlias, rec.amount, params.caller);
      this.rawCredit(rec.sellerWalletAlias, rec.amount);
      this.store.updateDraft(rec.id, { status: "SETTLED", debitedWalletAlias: params.buyerWalletAlias });
      this.store.addTransaction({
        // Identify the settled cash movement by its payment id, and link it back
        // to the originating XvP via supplementaryData (as other payments do).
        id: rec.paymentId ?? `TX-${rec.id}`,
        type: "XVP",
        status: "SETTLED",
        amount: rec.amount,
        currency: rec.currency,
        creditedWalletAlias: rec.sellerWalletAlias,
        debitedWalletAlias: params.buyerWalletAlias,
        createdAt: new Date(this.now()).toISOString(),
        settledAt: new Date(this.now()).toISOString(),
        supplementaryData: xvpTransactionId,
      });
      return {
        xvpTransactionId,
        status: "SETTLED" as const,
        executionKey: rec.executionKey,
        cancellationKey: rec.cancellationKey,
        paymentId: rec.paymentId,
      };
    });
  }

  /**
   * Record that a well-formed payment was initiated, so a later timeout is
   * reported as UNSETTLED (a payment was attempted) rather than BURNED (the XvP
   * timed out with no payment ever initiated).
   */
  private markPaymentAttempted(id: string): void {
    const d = this.store.getDraft(id);
    if (!d) return;
    const meta = d.supplementaryData ? JSON.parse(d.supplementaryData) : {};
    if (meta.paymentAttempted) return;
    meta.paymentAttempted = true;
    this.store.updateDraft(id, { supplementaryData: JSON.stringify(meta) });
  }
}
