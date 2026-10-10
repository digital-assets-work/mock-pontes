import { createHash } from "node:crypto";
import { xvpCommitmentHash } from "../src/workflows/xvp-commitment.js";

describe("xvpCommitmentHash (issue #141: hash decoded secret bytes, not hex text)", () => {
  it("matches the golden vector for a 32-byte all-zero secret", () => {
    const zero32 = Buffer.alloc(32);
    expect(xvpCommitmentHash(zero32)).toBe(
      "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925"
    );
  });

  it("decoding the wire hex (64 zero characters) before hashing reproduces the golden vector", () => {
    const wireKey = "0".repeat(64);
    expect(xvpCommitmentHash(Buffer.from(wireKey, "hex"))).toBe(
      "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925"
    );
  });

  it("is NOT the SHA-256 of the hex text itself (regression: text-hashing vs byte-hashing)", () => {
    const wireKey = "0".repeat(64);
    const textHash = createHash("sha256").update(wireKey).digest("hex");
    expect(xvpCommitmentHash(Buffer.from(wireKey, "hex"))).not.toBe(textHash);
  });

  it("produces a 64-character lowercase hex digest for a random 32-byte secret", () => {
    const bytes = Buffer.from(
      "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9",
      "hex"
    );
    const hash = xvpCommitmentHash(bytes);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Same bytes → same commitment (deterministic, single SHA-256 operation).
    expect(xvpCommitmentHash(bytes)).toBe(hash);
  });
});
