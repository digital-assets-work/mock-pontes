/**
 * CSR (Certificate Signing Request) handler for client certificate onboarding.
 *
 * Implements Pontes spec section 6.3.5: clients submit CSR, server issues certificate.
 *
 * Usage:
 *   POST /iam/realms/{ncb}/protocol/openid-connect/csr
 *   Content-Type: application/json
 *
 *   {
 *     "username": "tech-user-initiator",
 *     "password": "initiator-secret",
 *     "csr": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----"
 *   }
 *
 * Response (on success):
 *   {
 *     "certificate": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
 *   }
 */

import crypto from "node:crypto";
import * as x509 from "@peculiar/x509";

export interface CSRRequest {
  username: string;
  password: string;
  csr: string;
}

export interface CSRResponse {
  certificate: string;
}

const EC_ALG: EcKeyGenParams = { name: "ECDSA", namedCurve: "P-256" };
const SIGNING_ALG: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

/**
 * Sign a PKCS#10 CSR with the test CA.
 * Returns the signed certificate in PEM format.
 *
 * @param csrPem PKCS#10 CSR in PEM format
 * @param caKeyPem CA private key in PEM format
 * @param caCertPem CA certificate in PEM format
 * @returns Signed certificate in PEM format
 */
export async function signCsr(
  csrPem: string,
  caKeyPem: string,
  caCertPem: string,
  options: { validityMinutes?: number } = {},
): Promise<string> {
  const csr = new x509.Pkcs10CertificateRequest(csrPem);
  const caCert = new x509.X509Certificate(caCertPem);

  // Normalize any PEM format (SEC1 "EC PRIVATE KEY" or PKCS#8 "PRIVATE KEY") to PKCS#8 DER
  const pkcs8Der = crypto.createPrivateKey(caKeyPem).export({ type: "pkcs8", format: "der" });
  const caKey = await crypto.webcrypto.subtle.importKey("pkcs8", pkcs8Der, EC_ALG, false, ["sign"]);

  // Real Pontes certificates are valid for 24 months from issuance (SDD v1.0 §6.3.5,
  // Connectivity Training §"Certificate Renewal"). Mirror that here — unless a
  // shorter validity is requested (admin-token mode issues 1-hour certs, #35).
  const notBefore = new Date();
  const notAfter = new Date(notBefore);
  if (options.validityMinutes != null) {
    notAfter.setMinutes(notAfter.getMinutes() + options.validityMinutes);
  } else {
    notAfter.setMonth(notAfter.getMonth() + 24);
  }

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: crypto.randomBytes(16).toString("hex"),
    subject: csr.subject,
    issuer: caCert.subject,
    notBefore,
    notAfter,
    signingAlgorithm: SIGNING_ALG,
    publicKey: csr.publicKey,
    signingKey: caKey,
    // Preserve the extensions the CSR requested (notably the Pontes custom
    // privilege attribute, OID 1.2.3.4.5.6.7.8.1, carrying {"privilege":"2E|4E",...})
    // so the issued cert mirrors what the real ECB CA embeds. The high-level
    // generator otherwise copies only subject + public key.
    extensions: csr.extensions,
  });

  return cert.toString("pem");
}

/**
 * Validate a PKCS#10 CSR PEM.
 * Returns true if valid, throws error if invalid.
 */
export function validateCsr(csrPem: string): boolean {
  try {
    new x509.Pkcs10CertificateRequest(csrPem);
    return true;
  } catch (err) {
    throw new Error(`Invalid CSR format: ${String(err).slice(0, 100)}`);
  }
}
