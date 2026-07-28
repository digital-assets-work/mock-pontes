/**
 * Dedicated Cash Wallet (DCW) — model + pure operations.
 *
 * The DCW is the object every money-movement workflow mutates. This module holds
 * the *pure* (side-effect-free) model helpers so they can be unit-tested in
 * isolation; the store (see memory-store.ts) wires them to persistence.
 *
 * Balances are decimal strings ("0.00"). Invariant: available + locked = total.
 */

import type { Wallet } from "./mock-store.js";

/** Identity of the party attempting an operation (for debit-rights checks). */
export interface DcwCaller {
  /** BIC of the entity the acting user belongs to. */
  entityBIC?: string;
  /** Market DLT operator id, when acting as a whitelisted operator. */
  marketDLTOperator?: string;
}

export interface CreateDcwOptions {
  ownerEntityID?: string;
  ownerBIC?: string;
  managerNCB?: string;
  currency?: string;
  isMainWallet?: boolean;
  availableBalance?: string;
  lockedBalance?: string;
  validFrom?: string;
  validTo?: string;
}

export interface CanDebitResult {
  ok: boolean;
  reason?: string;
}

const ZERO = "0.00";

function toNumber(s: string): number {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) throw new Error(`DCW_INVALID_AMOUNT:${s}`);
  return n;
}

function money(n: number): string {
  return n.toFixed(2);
}

function positiveAmount(amount: string): number {
  const a = toNumber(amount);
  if (a < 0) throw new Error("DCW_NEGATIVE_AMOUNT");
  return a;
}

/**
 * Validate + parse an amount string (issue #54, defence in depth). A non-finite
 * (`NaN`/`Infinity`) or negative amount throws here — so even if an unvalidated
 * value slips past the request-body validation (#53) it can never be written
 * into wallet state as `NaN` and take down the whole AMS surface on later reads.
 */
export function parseAmount(amount: string): number {
  return positiveAmount(amount);
}

export function availableOf(w: Wallet): number {
  return toNumber(w.balance);
}
export function lockedOf(w: Wallet): number {
  return toNumber(w.lockedBalance);
}
export function totalOf(w: Wallet): number {
  return availableOf(w) + lockedOf(w);
}

/**
 * Create a new DCW with the official defaults (issue #13):
 * zero available, zero locked, only same-entity users may debit, no PoA and no
 * whitelisted market DLT operator.
 */
export function createDcw(alias: string, opts: CreateDcwOptions = {}): Wallet {
  const owner = opts.ownerEntityID || opts.ownerBIC || "UNKNOWN";
  const now = new Date().toISOString();
  return {
    alias,
    ownerBIC: opts.ownerBIC || owner,
    ownerEntityID: owner,
    managerNCB: opts.managerNCB || "UNKNOWN",
    balance: opts.availableBalance || ZERO, // available balance (back-compat name)
    lockedBalance: opts.lockedBalance || ZERO,
    currency: opts.currency || "EUR",
    isMainWallet: opts.isMainWallet ?? false,
    isBlocked: false,
    validFrom: opts.validFrom || now,
    validTo: opts.validTo,
    poaGrantees: [],
    whitelistedOperators: [],
    createdAt: now,
  };
}

/**
 * Debit-rights guard. By default only a user of the OWNING entity may debit a
 * DCW; PoA grantees and whitelisted market DLT operators are also allowed.
 * A blocked or out-of-validity wallet cannot be debited.
 */
export function canDebit(w: Wallet, caller: DcwCaller = {}, now: Date = new Date()): CanDebitResult {
  if (w.isBlocked) return { ok: false, reason: "WALLET_BLOCKED" };
  if (w.validFrom && new Date(w.validFrom) > now) return { ok: false, reason: "WALLET_NOT_YET_VALID" };
  if (w.validTo && new Date(w.validTo) < now) return { ok: false, reason: "WALLET_EXPIRED" };
  const byEntity = !!caller.entityBIC && caller.entityBIC === w.ownerEntityID;
  const byPoa = !!caller.entityBIC && w.poaGrantees.includes(caller.entityBIC);
  const byOperator =
    !!caller.marketDLTOperator && w.whitelistedOperators.includes(caller.marketDLTOperator);
  if (byEntity || byPoa || byOperator) return { ok: true };
  return { ok: false, reason: "NOT_AUTHORISED_TO_DEBIT" };
}

/**
 * Read-rights guard (issue #56). A user may read a DCW only if they belong to
 * the owning entity, are a PoA grantee, or a whitelisted market DLT operator —
 * the same allow-set as {@link canDebit}, kept as a separate function so read
 * rules can evolve independently. Unlike debit, reads ignore blocked/validity
 * state. Callers mask a denied read as "not found" (404) to hide existence.
 */
export function canRead(w: Wallet, caller: DcwCaller = {}): CanDebitResult {
  const byEntity = !!caller.entityBIC && caller.entityBIC === w.ownerEntityID;
  const byPoa = !!caller.entityBIC && w.poaGrantees.includes(caller.entityBIC);
  const byOperator =
    !!caller.marketDLTOperator && w.whitelistedOperators.includes(caller.marketDLTOperator);
  if (byEntity || byPoa || byOperator) return { ok: true };
  return { ok: false, reason: "NOT_AUTHORISED_TO_READ" };
}

/** Credit the available balance. */
export function withCredit(w: Wallet, amount: string): Wallet {
  const a = positiveAmount(amount);
  return { ...w, balance: money(availableOf(w) + a) };
}

/** Debit the available balance (requires sufficient available funds). */
export function withDebit(w: Wallet, amount: string): Wallet {
  const a = positiveAmount(amount);
  const available = availableOf(w);
  if (a > available) throw new Error("DCW_INSUFFICIENT_AVAILABLE");
  return { ...w, balance: money(available - a) };
}

/** Reserve funds: available → locked (requires sufficient available). */
export function withLock(w: Wallet, amount: string): Wallet {
  const a = positiveAmount(amount);
  const available = availableOf(w);
  if (a > available) throw new Error("DCW_INSUFFICIENT_AVAILABLE");
  return { ...w, balance: money(available - a), lockedBalance: money(lockedOf(w) + a) };
}

/** Release a reservation: locked → available (requires sufficient locked). */
export function withRelease(w: Wallet, amount: string): Wallet {
  const a = positiveAmount(amount);
  const locked = lockedOf(w);
  if (a > locked) throw new Error("DCW_INSUFFICIENT_LOCKED");
  return { ...w, lockedBalance: money(locked - a), balance: money(availableOf(w) + a) };
}

/** Settle a reservation: locked → debited (removed from the wallet). */
export function withSettleLocked(w: Wallet, amount: string): Wallet {
  const a = positiveAmount(amount);
  const locked = lockedOf(w);
  if (a > locked) throw new Error("DCW_INSUFFICIENT_LOCKED");
  return { ...w, lockedBalance: money(locked - a) };
}
