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
// See runtime-pki.ts: bridge Node's webcrypto key types to the DOM types that
// @peculiar/x509 expects.
const subtle = crypto.webcrypto.subtle as unknown as SubtleCrypto;
const SIGNING_ALG: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

/**
 * Hyperledger Fabric "attributes" extension OID. The real ECB Pontes IAM is
 * Fabric-CA based and embeds `{"attrs":{...}}` (enrolment id, MSP id, privilege)
 * under this OID; the runtime NRO/privilege checks read it (issue #72).
 */
const PONTES_PRIVILEGE_OID = "1.2.3.4.5.6.7.8.1";

export interface SignCsrOptions {
  validityMinutes?: number;
  /** Enrolment identity, used to synthesise the Fabric attributes (issue #72). */
  username?: string;
  entityBIC?: string;
}

/** Read the first value of an RDN (by short name) from an X.500 name string. */
function rdn(name: x509.Name, shortName: string): string | undefined {
  for (const entry of name.toJSON()) {
    const values = entry[shortName];
    if (values && values.length) return values[0];
  }
  return undefined;
}

/**
 * Extract the `privilege` from the CSR's Pontes attributes extension, if the
 * client requested one. Per the issue #72 decision the privilege is taken from
 * the CSR (not a separate enrolment field); everything else is derived here.
 */
function privilegeFromCsr(csr: x509.Pkcs10CertificateRequest): string | undefined {
  const ext = csr.extensions.find((e) => e.type === PONTES_PRIVILEGE_OID);
  if (!ext) return undefined;
  const raw = Buffer.from(ext.value).toString("utf8");
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    const json = JSON.parse(match[0]) as { attrs?: Record<string, string> } & Record<string, string>;
    return (json.attrs ?? json).privilege;
  } catch {
    return undefined;
  }
}

/**
 * Build the Fabric attributes extension value the way fabric-ca does: a raw
 * JSON string carried in the extension's OCTET STRING. Derived server-side from
 * the enrolment declaration (enrolment id, MSP id, type) plus the CSR-supplied
 * privilege (issue #72).
 */
function buildAttrsExtension(
  csr: x509.Pkcs10CertificateRequest,
  subjectName: x509.Name,
  options: SignCsrOptions,
): x509.Extension {
  const enrollmentId = options.username || rdn(subjectName, "CN") || "";
  const mspid = options.entityBIC || rdn(subjectName, "O") || "";
  const attrs: Record<string, string> = {
    "hf.Affiliation": "",
    "hf.EnrollmentID": enrollmentId,
    "hf.Type": "client",
    mspid,
  };
  const privilege = privilegeFromCsr(csr);
  if (privilege) attrs.privilege = privilege;
  const json = JSON.stringify({ attrs });
  return new x509.Extension(PONTES_PRIVILEGE_OID, false, new TextEncoder().encode(json));
}

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
  options: SignCsrOptions = {},
): Promise<string> {
  const csr = new x509.Pkcs10CertificateRequest(csrPem);
  const caCert = new x509.X509Certificate(caCertPem);
  const subjectName = new x509.Name(csr.subject);

  // Normalize any PEM format (SEC1 "EC PRIVATE KEY" or PKCS#8 "PRIVATE KEY") to PKCS#8 DER
  const pkcs8Der = crypto.createPrivateKey(caKeyPem).export({ type: "pkcs8", format: "der" });
  const caKey = await subtle.importKey("pkcs8", pkcs8Der, EC_ALG, false, ["sign"]);

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

  // Emit the CA-side extensions a real Fabric-CA leaf carries (issue #72),
  // rather than copying the CSR verbatim: fixed Key Usage / Basic Constraints,
  // Subject/Authority Key Identifiers, and the server-derived Fabric attributes
  // extension (enrolment id + MSP id + CSR-supplied privilege).
  const extensions: x509.Extension[] = [
    new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
    new x509.BasicConstraintsExtension(false, undefined, true),
    await x509.SubjectKeyIdentifierExtension.create(csr.publicKey),
    await x509.AuthorityKeyIdentifierExtension.create(caCert),
    buildAttrsExtension(csr, subjectName, options),
  ];

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: crypto.randomBytes(20).toString("hex"),
    subject: csr.subject,
    issuer: caCert.subject,
    notBefore,
    notAfter,
    signingAlgorithm: SIGNING_ALG,
    publicKey: csr.publicKey,
    signingKey: caKey,
    extensions,
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
