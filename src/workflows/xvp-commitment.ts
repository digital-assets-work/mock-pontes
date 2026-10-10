import { createHash } from "node:crypto";

/**
 * Commitment hash for an XvP hash-lock key (issue #141).
 *
 * Each key (`executionKey`/`cancellationKey`) is 32 random bytes, encoded on
 * the wire as 64 lowercase hex characters. The commitment
 * (`executionHash`/`cancellationHash`) must be `SHA-256` of those raw,
 * *decoded* bytes — never of the 64-character hex *text* that encodes them —
 * so that a market-DLT contract hashing the decoded secret computes the same
 * commitment this mock issues. Callers pass the already-decoded `Buffer` so
 * there is exactly one SHA-256 operation and no accidental text-hashing or
 * redundant decode step.
 */
export function xvpCommitmentHash(keyBytes: Buffer): string {
  return createHash("sha256").update(keyBytes).digest("hex");
}
