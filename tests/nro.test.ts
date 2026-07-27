/**
 * NRO signing tests (issue #29).
 *
 * Pins the two aspects the official spec fixes but which the prose could be
 * misread on:
 *   1. The canonical field concatenation order (v1.0), and
 *   2. The digest convention: SHA-256 is applied EXACTLY ONCE over the plain
 *      concatenated string (SHA256withECDSA). A double-hash signature (signing a
 *      pre-computed SHA-256 digest) MUST be rejected, so that a client that gets
 *      it right against the mock also gets it right against the real platform.
 */

import { describe, it, expect } from "@jest/globals";
import {
  createSign,
  createHash,
  generateKeyPairSync,
} from "node:crypto";
import { buildSigningData, verifySignature } from "../src/auth/nro-middleware.js";

// Node's Verify.verify() accepts a public key OR an X.509 certificate; a raw
// SPKI public-key PEM is sufficient to pin the digest/round-trip behaviour
// without minting a certificate.
function ecKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    privPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    pubPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

/** Spec-correct producer: single SHA-256 over the concatenated string. */
function signSingleHash(data: string, privPem: string): string {
  return createSign("SHA256").update(data).sign(privPem, "base64");
}

/** Common mistake: sign a pre-computed SHA-256 digest (double hash). */
function signDoubleHash(data: string, privPem: string): string {
  const digest = createHash("sha256").update(data).digest();
  return createSign("SHA256").update(digest).sign(privPem, "base64");
}

describe("NRO canonical concatenation order (issue #29)", () => {
  it("funding / defunding: techFundRequestID + amount + creditedCashWalletOwnerID + debitedCashWalletOwnerID", () => {
    const data = buildSigningData({
      techFundRequestID: "FUND-2026-0001",
      amount: "1000000.00",
      creditedCashWalletOwnerID: "PARTYAAAXXX",
      debitedCashWalletOwnerID: "ECBBDEFFXXX",
    });
    expect(data).toBe("FUND-2026-00011000000.00PARTYAAAXXXECBBDEFFXXX");
  });

  it("direct RTGS: id + amount + payerBank + receiverBank", () => {
    const data = buildSigningData({
      id: "e3c8671d-44d7-4da1-b240-4a1b1e4e47e7",
      amount: "10000.50",
      payerBank: "BEILLULLXXX",
      receiverBank: "BSUIFRPPXXX",
    });
    expect(data).toBe(
      "e3c8671d-44d7-4da1-b240-4a1b1e4e47e710000.50BEILLULLXXXBSUIFRPPXXX",
    );
  });

  it("XvP: xvp<uuid-no-dashes> + amount + buyer.bic + seller.bic", () => {
    const data = buildSigningData({
      xvpTransactionId: "11111111-2222-3333-4444-555555555555",
      amount: "42.00",
      buyer: { bic: "BUYRDEFFXXX" },
      seller: { bic: "SELLFRPPXXX" },
    });
    expect(data).toBe(
      "xvp1111111122223333444455555555555542.00BUYRDEFFXXXSELLFRPPXXX",
    );
  });

  it("returns null when a required field is missing", () => {
    expect(
      buildSigningData({
        techFundRequestID: "FUND-1",
        amount: "1.00",
        creditedCashWalletOwnerID: "AAA",
        // debitedCashWalletOwnerID missing
      }),
    ).toBeNull();
  });
});

describe("NRO digest convention: SINGLE hash (issue #29)", () => {
  const data = "FUND-2026-00011000000.00PARTYAAAXXXECBBDEFFXXX";

  it("accepts a spec-correct single-hash SHA256withECDSA signature", () => {
    const { privPem, pubPem } = ecKeyPair();
    const sig = signSingleHash(data, privPem);
    expect(verifySignature(data, sig, pubPem)).toBe(true);
  });

  it("REJECTS a double-hash signature (signing a pre-computed digest)", () => {
    const { privPem, pubPem } = ecKeyPair();
    const sig = signDoubleHash(data, privPem);
    expect(verifySignature(data, sig, pubPem)).toBe(false);
  });

  it("REJECTS a signature made over different data", () => {
    const { privPem, pubPem } = ecKeyPair();
    const sig = signSingleHash(data + "tampered", privPem);
    expect(verifySignature(data, sig, pubPem)).toBe(false);
  });

  it("REJECTS a signature verified with the wrong public key", () => {
    const signer = ecKeyPair();
    const other = ecKeyPair();
    const sig = signSingleHash(data, signer.privPem);
    expect(verifySignature(data, sig, other.pubPem)).toBe(false);
  });
});
