import { createHash, randomBytes } from "node:crypto";

/**
 * XvP hash-lock commitment method (issue #145).
 *
 * - `hex-string` (default): hash the UTF-8 bytes of the 64-character
 *   lowercase hex wire key itself — the convention suggested by the OpenAPI
 *   examples. Real Pontes behavior has not been confirmed either way.
 * - `bytes` (opt-in, issue #141's original behavior): hash the key's raw
 *   decoded 32 bytes, matching a market-DLT contract that hex-decodes the
 *   key before hashing it.
 *
 * Both conventions keep the same wire format: keys remain lowercase
 * hex-encoded secret bytes, hashes remain 64 lowercase hex characters.
 * Neither mode is "more real" than the other until confirmed against actual
 * Pontes behavior — the mock supports both so callers can test either.
 */
export type XvpHashMethod = "hex-string" | "bytes";

const VALID_HASH_METHODS: ReadonlySet<string> = new Set<XvpHashMethod>(["hex-string", "bytes"]);

/**
 * Resolves `XVP_HASH_METHOD` (or any raw override) to a validated
 * `XvpHashMethod`, defaulting unset/empty to `hex-string`. Throws a clear
 * `Error` for any other unsupported value — never silently falls back.
 * Pass this the same raw string at every call site that needs the setting;
 * there is no cached/module-level value to go stale across tests.
 */
export function resolveXvpHashMethod(raw: string | undefined): XvpHashMethod {
  if (raw === undefined || raw === "") return "hex-string";
  if (VALID_HASH_METHODS.has(raw)) return raw as XvpHashMethod;
  throw new Error(
    `Invalid XVP_HASH_METHOD '${raw}': must be 'hex-string' or 'bytes' (unset defaults to 'hex-string').`,
  );
}

/**
 * SHA-256 commitment for one XvP hash-lock secret, applying `method`.
 * `keyHex` is the 64-character lowercase hex wire key. Exactly one SHA-256
 * operation either way — never double-hash, hash JSON, or add a prefix.
 */
export function xvpCommitmentHash(keyHex: string, method: XvpHashMethod): string {
  const input = method === "bytes" ? Buffer.from(keyHex, "hex") : Buffer.from(keyHex, "utf8");
  return createHash("sha256").update(input).digest("hex");
}

export interface XvpCommitmentPair {
  executionKey: string;
  executionHash: string;
  cancellationKey: string;
  cancellationHash: string;
}

/**
 * Generates the XvP's two hash-lock secrets (`executionKey`/
 * `cancellationKey`, 32 random bytes each, hex-encoded) and their commitments
 * (`executionHash`/`cancellationHash`), applying `method` uniformly to both.
 *
 * This is the single place "concerned" with the hex-string/bytes choice
 * (issue #145) — callers such as `XvpWorkflow.init()` just receive wire-ready
 * key/hash strings and never branch on `method` themselves.
 */
export function generateXvpCommitments(method: XvpHashMethod): XvpCommitmentPair {
  const executionKey = randomBytes(32).toString("hex");
  const cancellationKey = randomBytes(32).toString("hex");
  return {
    executionKey,
    executionHash: xvpCommitmentHash(executionKey, method),
    cancellationKey,
    cancellationHash: xvpCommitmentHash(cancellationKey, method),
  };
}
