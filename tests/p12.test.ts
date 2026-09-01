/**
 * PKCS#12 builder (src/ui/p12.ts) — regression test for the BER indefinite-
 * length chunking bug: pkijs auto-splits any encrypted payload over ~1KB into
 * a "constructed" OCTET STRING, which macOS Keychain's strict importer
 * rejects (OSStatus -26276) even with the correct password. Asserts the built
 * PFX is strict, definite-length DER (no constructed OCTET STRING / indefinite
 * length anywhere), and that it's still a valid, decryptable PKCS#12 per the
 * system `openssl`.
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { execSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import * as asn1js from "asn1js";
import { buildP12 } from "../src/ui/p12.js";
import { getRuntimePkiBundle } from "../src/auth/runtime-pki.js";
import { signCsr } from "../src/auth/csr-handler.js";

const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
const PASSWORD = "test-password-123";

async function makeKeyAndCsr(username: string): Promise<{ keyPem: string; csrPem: string }> {
  const x509 = await import("@peculiar/x509");
  x509.cryptoProvider.set(webcrypto as unknown as Crypto);
  const keys = await webcrypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const pkcs8 = await webcrypto.subtle.exportKey("pkcs8", keys.privateKey);
  const keyPem = x509.PemConverter.encode(pkcs8, "PRIVATE KEY");
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: `CN=${username}`,
    keys,
    signingAlgorithm: ALG,
  });
  return { keyPem, csrPem: csr.toString("pem") };
}

/** Recursively assert no node is a "constructed" (chunked) OCTET STRING, and nothing is indefinite-length. */
function assertNoIndefiniteLength(node: asn1js.BaseBlock | undefined): void {
  if (!node || !node.lenBlock) return;
  expect(node.lenBlock.isIndefiniteForm).toBe(false);
  if (node instanceof asn1js.OctetString) {
    expect(node.idBlock.isConstructed).toBe(false);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const children = (node.valueBlock as any)?.value as asn1js.BaseBlock[] | undefined;
  if (Array.isArray(children)) {
    children.forEach((child) => assertNoIndefiniteLength(child));
  }
}

describe("buildP12 (issue: macOS Keychain OSStatus -26276)", () => {
  let p12: Buffer;

  beforeAll(async () => {
    const pki = await getRuntimePkiBundle();
    const { keyPem, csrPem } = await makeKeyAndCsr("PFRTESTP12USER0001");
    const certPem = await signCsr(csrPem, pki.clientSigningCaPrivateKeyPem, pki.clientSigningCaCertificatePem, {
      username: "PFRTESTP12USER0001",
      entityBIC: "BSUIFRPPXXX",
    });
    p12 = await buildP12(keyPem, certPem, PASSWORD, "PFRTESTP12USER0001");
  });

  it("produces strict definite-length DER (no BER chunking) for a realistic issued cert", () => {
    const parsed = asn1js.fromBER(p12.buffer.slice(p12.byteOffset, p12.byteOffset + p12.byteLength));
    expect(parsed.offset).toBeGreaterThan(-1);
    assertNoIndefiniteLength(parsed.result);
  });

  it("is a valid, decryptable PKCS#12 per the system openssl", () => {
    const tmpP12 = join(tmpdir(), `test-p12-${Date.now()}.p12`);
    writeFileSync(tmpP12, p12);
    try {
      const out = execSync(`openssl pkcs12 -info -nokeys -nocerts -passin pass:${PASSWORD} -in "${tmpP12}" 2>&1`, {
        encoding: "utf-8",
      });
      expect(out).toMatch(/MAC/i);
      expect(out).not.toMatch(/invalid password/i);
      // Recurse into the AuthSafe content (a nested DER document embedded as an
      // OCTET STRING) and confirm it's strict, definite-length DER too — no
      // `l=inf` (BER indefinite length) or `EOC` (End-Of-Contents) markers.
      const dump = execSync(`openssl asn1parse -inform DER -in "${tmpP12}" -strparse 26 2>&1`, { encoding: "utf-8" });
      expect(dump).not.toMatch(/l=\s*inf/);
      expect(dump).not.toMatch(/EOC/);
    } finally {
      unlinkSync(tmpP12);
    }
  });
});
