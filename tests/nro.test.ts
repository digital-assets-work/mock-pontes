/**
 * NRO signing tests (issue #29, re-scoped by issue #124).
 *
 * Pins:
 *   1. The canonical field concatenation order (v1.0) for all three
 *      NRO-signed operation families.
 *   2. FUNDING/DEFUNDING's confirmed-real-Pontes signing convention (issue
 *      #124): amount forced to 2dp, one BIC slot substituted with the fixed
 *      `ISSUER_TRIGGER_BIC` constant, and a genuine DOUBLE SHA-256 hash. This
 *      REVERSES the original issue #29 pinning for funding/defunding, which
 *      had assumed the documented spec prose (single hash, real BICs only)
 *      was correct — issue #124's live UTEST evidence shows it wasn't.
 *   3. Direct RTGS payment / XvP are UNCHANGED from the original issue #29
 *      pinning: SHA-256 applied EXACTLY ONCE over the plain concatenated
 *      string (SHA256withECDSA), real business fields only. A double-hash
 *      signature for these two families MUST still be rejected. Issue #124's
 *      live evidence does not cover them.
 */

import { describe, it, expect } from "@jest/globals";
import {
  createSign,
  createHash,
  generateKeyPairSync,
} from "node:crypto";
import { buildSigningData, verifySignature, decodeCertPem, ISSUER_TRIGGER_BIC } from "../src/auth/nro-middleware.js";
import * as x509 from "@peculiar/x509";
import { webcrypto } from "node:crypto";

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

/** Common mistake for direct RTGS/XvP: sign a pre-computed SHA-256 digest (double hash). */
function signDoubleHash(data: string, privPem: string): string {
  const digest = createHash("sha256").update(data).digest();
  return createSign("SHA256").update(digest).sign(privPem, "base64");
}

describe("NRO canonical concatenation order (issue #29 / #124)", () => {
  it("FUNDING: techFundRequestID + amount(2dp) + creditedCashWalletOwnerID + ISSUER_TRIGGER_BIC, then SHA-256 hex (issue #124)", () => {
    const data = buildSigningData({
      type: "FUNDING",
      techFundRequestID: "FUND-2026-0001",
      amount: "1000000", // body has no decimals — real captured example behavior
      creditedCashWalletOwnerID: "PARTYAAAXXX",
      // Real business field — present in the body, but NOT part of the
      // FUNDING signing string (ISSUER_TRIGGER_BIC replaces it there).
      debitedCashWalletOwnerID: "ECBBDEFFXXX",
    });
    const expectedConcat = `FUND-2026-00011000000.00PARTYAAAXXX${ISSUER_TRIGGER_BIC}`;
    expect(data).toBe(createHash("sha256").update(expectedConcat, "utf8").digest("hex"));
  });

  it("DEFUNDING: techFundRequestID + amount(2dp) + ISSUER_TRIGGER_BIC + debitedCashWalletOwnerID, then SHA-256 hex (issue #124)", () => {
    const data = buildSigningData({
      type: "DEFUNDING",
      techFundRequestID: "DEFUND-2026-0001",
      amount: "10.00",
      // Real business field — present in the body, but NOT part of the
      // DEFUNDING signing string (ISSUER_TRIGGER_BIC replaces it there).
      creditedCashWalletOwnerID: "ECBBDEFFXXX",
      debitedCashWalletOwnerID: "PARTYAAAXXX",
    });
    const expectedConcat = `DEFUND-2026-000110.00${ISSUER_TRIGGER_BIC}PARTYAAAXXX`;
    expect(data).toBe(createHash("sha256").update(expectedConcat, "utf8").digest("hex"));
  });

  it("amount is normalized to 2dp for signing regardless of the body's own formatting (issue #124)", () => {
    const base = {
      type: "FUNDING" as const,
      techFundRequestID: "FUND-X",
      creditedCashWalletOwnerID: "A",
      debitedCashWalletOwnerID: "B",
    };
    expect(buildSigningData({ ...base, amount: "1000" })).toBe(
      buildSigningData({ ...base, amount: "1000.00" }),
    );
  });

  it("returns null for a funding/defunding-shaped body missing 'type' (can't pick the BIC-substitution side)", () => {
    expect(
      buildSigningData({
        techFundRequestID: "FUND-1",
        amount: "1.00",
        creditedCashWalletOwnerID: "AAA",
        debitedCashWalletOwnerID: "BBB",
        // type missing
      }),
    ).toBeNull();
  });

  it("direct RTGS: id + amount + payerBank + receiverBank (unchanged — #124 does not cover this)", () => {
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

  it("XvP: xvp<uuid-no-dashes> + amount + buyer.bic + seller.bic (unchanged — #124 does not cover this)", () => {
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
        type: "FUNDING",
        amount: "1.00",
        creditedCashWalletOwnerID: "AAA",
        // debitedCashWalletOwnerID missing
      }),
    ).toBeNull();
  });
});

describe("FUNDING/DEFUNDING NRO signing end-to-end: 2dp amount + issuerTriggerBIC substitution + double hash (issue #124)", () => {
  it("verifySignature succeeds for a real-Pontes-shaped FUNDING request", () => {
    const { privPem, pubPem } = ecKeyPair();
    const body = {
      type: "FUNDING",
      techFundRequestID: "FUND-2026-0002",
      amount: "1000", // body has no decimals — real captured example behavior
      creditedCashWalletOwnerID: "PARTYAAAXXX",
      debitedCashWalletOwnerID: "ECBBDEFFXXX",
    };
    const preimage = buildSigningData(body)!;
    const sig = signSingleHash(preimage, privPem);
    expect(verifySignature(preimage, sig, pubPem)).toBe(true);
  });

  it("verifySignature succeeds for a real-Pontes-shaped DEFUNDING request", () => {
    const { privPem, pubPem } = ecKeyPair();
    const body = {
      type: "DEFUNDING",
      techFundRequestID: "DEFUND-2026-0002",
      amount: "10.00",
      creditedCashWalletOwnerID: "ECBBDEFFXXX",
      debitedCashWalletOwnerID: "PARTYAAAXXX",
    };
    const preimage = buildSigningData(body)!;
    const sig = signSingleHash(preimage, privPem);
    expect(verifySignature(preimage, sig, pubPem)).toBe(true);
  });

  it("REJECTS a FUNDING signature built with the OLD (single-hash, no substitution) formula", () => {
    const { privPem, pubPem } = ecKeyPair();
    const body = {
      type: "FUNDING",
      techFundRequestID: "FUND-2026-0003",
      amount: "500.00",
      creditedCashWalletOwnerID: "PARTYAAAXXX",
      debitedCashWalletOwnerID: "ECBBDEFFXXX",
    };
    const oldConcat =
      body.techFundRequestID + body.amount + body.creditedCashWalletOwnerID + body.debitedCashWalletOwnerID;
    const sig = signSingleHash(oldConcat, privPem);
    const preimage = buildSigningData(body)!;
    expect(verifySignature(preimage, sig, pubPem)).toBe(false);
  });
});

describe("verifySignature(): SINGLE hash primitive (issue #29)", () => {
  // Reused as the SECOND hash pass for FUNDING/DEFUNDING (issue #124), since
  // buildSigningData() pre-hashes those to a hex string before handing it to
  // this function. For direct RTGS/XvP, `data` here is still the plain
  // concatenated string, so the overall effect for those two remains a true
  // single hash.
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


describe("decodeCertPem: signerPEM format compatibility (issue #121)", () => {
  const data = "FUND-2026-00011000000.00PARTYAAAXXXECBBDEFFXXX";

  /**
   * Real Pontes UTEST rejects `signerPEM = base64(bare DER)` (the mock's
   * original assumption) and expects `signerPEM = base64(full armored PEM
   * text)` instead — confirmed live against UTEST. `decodeCertPem()` accepts
   * that real format plus a literal (non-base64) PEM string, and deliberately
   * does NOT accept `base64(bare DER)`, to keep the mock's behavior as close
   * as possible to the real platform.
   */
  async function makeCertPem(): Promise<string> {
    const alg = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
    const keys = await webcrypto.subtle.generateKey(alg, true, ["sign", "verify"]);
    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: "01",
      name: "CN=decode-cert-pem-test",
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 3600_000),
      signingAlgorithm: alg,
      keys,
    });
    return cert.toString("pem");
  }

  it("returns a literal (non-base64) PEM string as-is", async () => {
    const certPem = await makeCertPem();
    expect(decodeCertPem(certPem)).toBe(certPem);
  });

  it("decodes base64(full armored PEM text) — the real UTEST format", async () => {
    const certPem = await makeCertPem();
    const signerPEM = Buffer.from(certPem, "utf-8").toString("base64");
    expect(decodeCertPem(signerPEM)).toBe(certPem);
  });

  it("does NOT accept base64(bare DER) — matches real Pontes UTEST's rejection", async () => {
    const certPem = await makeCertPem();
    const bareDerBase64 = certPem
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s/g, "");
    // base64-decoding bare-DER base64 yields raw binary bytes reinterpreted as
    // UTF-8 text — never valid PEM armor, so it is left as unusable garbage
    // rather than being wrapped into a (spurious) valid-looking certificate.
    const decoded = decodeCertPem(bareDerBase64);
    expect(decoded).not.toContain("-----BEGIN CERTIFICATE-----");
  });

  it("end-to-end: verifySignature succeeds when signerPEM is base64(full armored PEM)", async () => {
    const alg = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
    const keys = await webcrypto.subtle.generateKey(alg, true, ["sign", "verify"]);
    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: "02",
      name: "CN=decode-cert-pem-e2e",
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 3600_000),
      signingAlgorithm: alg,
      keys,
    });
    const certPem = cert.toString("pem");
    const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", keys.privateKey)).toString("base64");
    const privPem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;

    const signerPEM = Buffer.from(certPem, "utf-8").toString("base64"); // real-UTEST shape
    const sig = createSign("SHA256").update(data).sign(privPem, "base64");

    expect(verifySignature(data, sig, decodeCertPem(signerPEM))).toBe(true);
  });

  it("end-to-end: verifySignature FAILS when signerPEM is base64(bare DER) — matches real Pontes UTEST rejection", async () => {
    const alg = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
    const keys = await webcrypto.subtle.generateKey(alg, true, ["sign", "verify"]);
    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: "03",
      name: "CN=decode-cert-pem-e2e-bare-der",
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 3600_000),
      signingAlgorithm: alg,
      keys,
    });
    const certPem = cert.toString("pem");
    const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", keys.privateKey)).toString("base64");
    const privPem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;

    const bareDerBase64 = certPem
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s/g, "");
    const sig = createSign("SHA256").update(data).sign(privPem, "base64");

    expect(verifySignature(data, sig, decodeCertPem(bareDerBase64))).toBe(false);
  });
});
