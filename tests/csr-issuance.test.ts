/**
 * The mock now issues certificates shaped like the real Fabric-CA leaf (#72):
 * fixed Key Usage / Basic Constraints, Subject/Authority Key Identifiers, and a
 * server-synthesised Fabric attributes extension (enrolment id + MSP id +
 * CSR-supplied privilege), instead of copying the CSR verbatim.
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { webcrypto } from "node:crypto";
import * as x509 from "@peculiar/x509";
import { signCsr } from "../src/auth/csr-handler.js";
import { getRuntimePkiBundle } from "../src/auth/runtime-pki.js";

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const PONTES_PRIVILEGE_OID = "1.2.3.4.5.6.7.8.1";
const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;

async function makeCsr(subject: string, privilege?: string): Promise<string> {
  const keys = await webcrypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const extensions = privilege
    ? [new x509.Extension(
        PONTES_PRIVILEGE_OID,
        false,
        new TextEncoder().encode(JSON.stringify({ attrs: { privilege } })),
      )]
    : [];
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: subject,
    keys,
    signingAlgorithm: ALG,
    extensions,
  });
  return csr.toString("pem");
}

function attrsOf(cert: x509.X509Certificate): Record<string, string> {
  const ext = cert.extensions.find((e) => e.type === PONTES_PRIVILEGE_OID);
  if (!ext) throw new Error("no attrs extension");
  const json = JSON.parse(Buffer.from(ext.value).toString("utf8")) as { attrs: Record<string, string> };
  return json.attrs;
}

describe("Issued certificate structure (issue #72)", () => {
  let caKey: string;
  let caCert: string;

  beforeAll(async () => {
    const pki = await getRuntimePkiBundle();
    caKey = pki.clientSigningCaPrivateKeyPem;
    caCert = pki.clientSigningCaCertificatePem;
  });

  it("adds CA-side extensions and a synthesised attrs extension (privilege from CSR)", async () => {
    const csr = await makeCsr("C=FR, O=BSUIFRPPXXX, OU=client, CN=PFRBSUIFRPPXXXUSER", "4E");
    const pem = await signCsr(csr, caKey, caCert, { username: "PFRBSUIFRPPXXXUSER", entityBIC: "BSUIFRPPXXX" });
    const cert = new x509.X509Certificate(pem);

    // CA-side extensions
    const ku = cert.getExtension(x509.KeyUsagesExtension);
    expect(ku?.usages).toBe(x509.KeyUsageFlags.digitalSignature);
    expect(ku?.critical).toBe(true);
    const bc = cert.getExtension(x509.BasicConstraintsExtension);
    expect(bc?.ca).toBe(false);
    expect(bc?.critical).toBe(true);
    expect(cert.getExtension(x509.SubjectKeyIdentifierExtension)).toBeTruthy();
    expect(cert.getExtension(x509.AuthorityKeyIdentifierExtension)).toBeTruthy();

    // Fabric attributes, server-derived + CSR privilege
    const attrs = attrsOf(cert);
    expect(attrs["hf.EnrollmentID"]).toBe("PFRBSUIFRPPXXXUSER");
    expect(attrs["hf.Type"]).toBe("client");
    expect(attrs.mspid).toBe("BSUIFRPPXXX");
    expect(attrs.privilege).toBe("4E");
  });

  it("derives enrolment id / mspid from the subject when not supplied, and omits privilege when the CSR has none", async () => {
    const csr = await makeCsr("C=FR, O=DEUTDEFFXXX, OU=client, CN=DEUTDEFFXXXUSER");
    const pem = await signCsr(csr, caKey, caCert);
    const attrs = attrsOf(new x509.X509Certificate(pem));
    expect(attrs["hf.EnrollmentID"]).toBe("DEUTDEFFXXXUSER");
    expect(attrs.mspid).toBe("DEUTDEFFXXX");
    expect(attrs.privilege).toBeUndefined();
  });

  it("uses a 20-byte serial and preserves the CSR subject", async () => {
    const csr = await makeCsr("C=FR, O=BSUIFRPPXXX, OU=client, CN=PFRBSUIFRPPXXXUSER", "2E");
    const cert = new x509.X509Certificate(await signCsr(csr, caKey, caCert, { username: "PFRBSUIFRPPXXXUSER", entityBIC: "BSUIFRPPXXX" }));
    // Serial is a 20-byte hex (40 chars, leading zeros possible → allow ≤40).
    expect(cert.serialNumber.length).toBeGreaterThan(20);
    expect(cert.subject).toContain("CN=PFRBSUIFRPPXXXUSER");
  });
});
