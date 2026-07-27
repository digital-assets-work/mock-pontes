/**
 * Test ECDSA P-256 keypair and self-signed certificate for mock-pontes.
 * Used for JWT signing and NRO signature testing.
 *
 * In production, these would come from the ECB CA (Deutsche Bundesbank).
 * Here we generate them once at module load for zero-config dev use.
 */

import crypto from "node:crypto";
import { createSign } from "node:crypto";
import * as x509 from "@peculiar/x509";

export interface TestKeyMaterial {
  privateKeyPem: string;
  publicKeyPem: string;
  certificatePem: string;
  /** Base64-encoded DER certificate (for signerPEM field) */
  certificateBase64: string;
}

const EC_ALG: EcKeyGenParams = { name: "ECDSA", namedCurve: "P-256" };
// See runtime-pki.ts: bridge Node's webcrypto key types to the DOM types that
// @peculiar/x509 expects.
const subtle = crypto.webcrypto.subtle as unknown as SubtleCrypto;
const SIGNING_ALG: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

/**
 * Generate ECDSA P-256 test keypair + self-signed X.509 certificate.
 */
async function generateTestKeys(): Promise<TestKeyMaterial> {
  const keys = await subtle.generateKey(EC_ALG, true, ["sign", "verify"]);

  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: crypto.randomBytes(16).toString("hex"),
    name: "CN=mock-pontes, O=MockBank, C=DEV",
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000),
    signingAlgorithm: SIGNING_ALG,
    keys,
  });

  const pkcs8 = await subtle.exportKey("pkcs8", keys.privateKey);
  const spki = await subtle.exportKey("spki", keys.publicKey);

  const privateKeyPem = x509.PemConverter.encode(pkcs8, "PRIVATE KEY");
  const publicKeyPem = x509.PemConverter.encode(spki, "PUBLIC KEY");
  const certificatePem = cert.toString("pem");

  // Extract DER from PEM and base64 encode
  const pemBody = certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s/g, "");

  return {
    privateKeyPem,
    publicKeyPem,
    certificatePem,
    certificateBase64: pemBody,
  };
}

/**
 * Sign data with ECDSA P-256 + SHA-256 (same as Pontes NRO).
 */
export function signData(data: string, privateKeyPem: string): string {
  const sign = createSign("SHA256");
  sign.update(data);
  sign.end();
  return sign.sign(privateKeyPem, "base64");
}

/**
 * Mock technical users for the test IAM.
 */
export const MOCK_USERS: Record<
  string,
  { password: string; uuid: string; profile: string; entityBIC: string }
> = {
  "tech-user-initiator": {
    password: "initiator-secret",
    uuid: "11111111-1111-1111-1111-111111111111",
    profile: "PILOT_READ_WRITE",
    entityBIC: "CACIFFPPXXX",
  },
  "tech-user-approver": {
    password: "approver-secret",
    uuid: "22222222-2222-2222-2222-222222222222",
    profile: "PILOT_READ_WRITE",
    entityBIC: "CACIFFPPXXX",
  },
  "tech-user-external": {
    password: "external-secret",
    uuid: "33333333-3333-3333-3333-333333333333",
    profile: "EXTERNAL_USER",
    entityBIC: "CACIFFPPXXX",
  },
};

// Lazy async singleton — keys are generated once on first access
let keysPromise: Promise<TestKeyMaterial> | null = null;

export function getTestKeys(): Promise<TestKeyMaterial> {
  if (!keysPromise) {
    console.log("[mock-pontes] Generating test ECDSA P-256 keypair...");
    keysPromise = generateTestKeys().then((keys) => {
      console.log("[mock-pontes] Test keypair generated");
      return keys;
    });
  }
  return keysPromise;
}
