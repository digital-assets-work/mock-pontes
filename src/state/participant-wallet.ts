/**
 * Participant-owned cash wallet resolution (issue #139).
 *
 * A single, deterministic policy shared by XvP seller initialization and
 * buyer payment (and reusable by any future caller needing the same "use the
 * participant's own DCW" semantics):
 *
 *   1. An explicit alias must name an existing wallet **owned by that
 *      participant's BIC** — an unknown alias, or one owned by someone else,
 *      is rejected. Never falls back to a default and never auto-creates.
 *   2. Otherwise, list the wallets owned by the participant's BIC (by
 *      `ownerEntityID`, never scoped to the authenticated caller's own
 *      read/PoA rights) in deterministic store-insertion order, and pick the
 *      first `isMainWallet=true` one.
 *   3. If none is a main wallet, pick the first wallet in that order.
 *   4. If the participant owns no wallet at all, resolution fails — this
 *      module never creates a wallet.
 *
 * Pure and side-effect-free (same spirit as `dcw.ts`), so it is independently
 * unit-testable; the route layer translates a failed resolution into the
 * transport-specific error response.
 */

import type { MockStore, Wallet } from "./mock-store.js";

export type ParticipantWalletFailureReason =
  | "WALLET_NOT_FOUND"
  | "NO_PARTICIPANT_WALLET";

export type ResolveParticipantWalletResult =
  | { ok: true; wallet: Wallet }
  | { ok: false; reason: ParticipantWalletFailureReason };

/**
 * Resolve the wallet a participant (identified by `bic`) should use.
 *
 * `explicitAlias` is the caller-supplied `cashWalletAlias` (if any). A
 * mismatched owner is reported identically to a non-existent alias
 * (`WALLET_NOT_FOUND`) — the caller does not learn that the alias belongs to
 * someone else.
 */
export function resolveParticipantWallet(
  store: MockStore,
  bic: string | undefined,
  explicitAlias: string | undefined,
): ResolveParticipantWalletResult {
  if (explicitAlias) {
    const wallet = store.getWallet(explicitAlias);
    if (!wallet || (bic && wallet.ownerEntityID !== bic)) {
      return { ok: false, reason: "WALLET_NOT_FOUND" };
    }
    return { ok: true, wallet };
  }
  // Unscoped (no caller) — ownership by BIC, not mere caller readability.
  const owned = bic ? store.getWallets().filter((w) => w.ownerEntityID === bic) : [];
  const chosen = owned.find((w) => w.isMainWallet) ?? owned[0];
  if (!chosen) return { ok: false, reason: "NO_PARTICIPANT_WALLET" };
  return { ok: true, wallet: chosen };
}
