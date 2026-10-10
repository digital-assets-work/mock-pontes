import { createHash } from "node:crypto";
import {
  generateXvpCommitments,
  resolveXvpHashMethod,
  xvpCommitmentHash,
} from "../src/workflows/xvp-commitment.js";

const ZERO_KEY_HEX = "0".repeat(64); // wire-encoding of a 32-byte all-zero secret

describe("resolveXvpHashMethod (issue #145)", () => {
  it("defaults to hex-string when unset", () => {
    expect(resolveXvpHashMethod(undefined)).toBe("hex-string");
  });

  it("defaults to hex-string on an empty string (must not accidentally select bytes)", () => {
    expect(resolveXvpHashMethod("")).toBe("hex-string");
  });

  it("accepts explicit hex-string", () => {
    expect(resolveXvpHashMethod("hex-string")).toBe("hex-string");
  });

  it("accepts explicit bytes", () => {
    expect(resolveXvpHashMethod("bytes")).toBe("bytes");
  });

  it("throws a clear configuration error for any other nonempty value", () => {
    expect(() => resolveXvpHashMethod("BYTES")).toThrow(/XVP_HASH_METHOD/);
    expect(() => resolveXvpHashMethod("hex")).toThrow(/XVP_HASH_METHOD/);
    expect(() => resolveXvpHashMethod("bytes ")).toThrow(/XVP_HASH_METHOD/);
  });
});

describe("xvpCommitmentHash (issue #145: hex-string vs bytes convention)", () => {
  it("bytes mode matches the pre-existing #141 golden vector for a 32-byte all-zero secret", () => {
    expect(xvpCommitmentHash(ZERO_KEY_HEX, "bytes")).toBe(
      "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925",
    );
  });

  it("hex-string mode hashes the 64 UTF-8 '0' characters instead", () => {
    const expected = createHash("sha256").update(Buffer.from(ZERO_KEY_HEX, "utf8")).digest("hex");
    expect(xvpCommitmentHash(ZERO_KEY_HEX, "hex-string")).toBe(expected);
    // Fixed vector, so a future accidental algorithm change is caught even if
    // the inline `createHash` computation above were also broken the same way.
    expect(xvpCommitmentHash(ZERO_KEY_HEX, "hex-string")).toBe(
      "60e05bd1b195af2f94112fa7197a5c88289058840ce7c6df9693756bc6250f55",
    );
  });

  it("the two modes produce different commitments for the same key", () => {
    expect(xvpCommitmentHash(ZERO_KEY_HEX, "bytes")).not.toBe(xvpCommitmentHash(ZERO_KEY_HEX, "hex-string"));
  });

  it("produces a 64-character lowercase hex digest for a random key, deterministically, in both modes", () => {
    const key = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9";
    for (const method of ["hex-string", "bytes"] as const) {
      const hash = xvpCommitmentHash(key, method);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(xvpCommitmentHash(key, method)).toBe(hash);
    }
  });
});

describe("generateXvpCommitments (issue #145)", () => {
  it.each(["hex-string", "bytes"] as const)(
    "produces execution and cancellation keys/hashes consistent with the %s method",
    (method) => {
      const commitments = generateXvpCommitments(method);
      expect(commitments.executionKey).toMatch(/^[0-9a-f]{64}$/);
      expect(commitments.cancellationKey).toMatch(/^[0-9a-f]{64}$/);
      // Both commitments are independently derived via the same method —
      // not just a standalone helper exercised once.
      expect(commitments.executionHash).toBe(xvpCommitmentHash(commitments.executionKey, method));
      expect(commitments.cancellationHash).toBe(xvpCommitmentHash(commitments.cancellationKey, method));
    },
  );

  it("generates distinct execution and cancellation secrets", () => {
    const { executionKey, cancellationKey, executionHash, cancellationHash } = generateXvpCommitments("hex-string");
    expect(executionKey).not.toBe(cancellationKey);
    expect(executionHash).not.toBe(cancellationHash);
  });
});
