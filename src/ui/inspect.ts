/**
 * PEM inspection helper for the mock-pontes UI.
 *
 * Parses a submitted PEM (PKCS#10 CSR or X.509 certificate) and extracts the
 * fields the ECB Connectivity training / CSR verification tool surfaces:
 * subject (CN/C/O/OU), issuer + validity (certs), public-key algorithm/curve,
 * and the Pontes custom **privilege** attribute (OID 1.2.3.4.5.6.7.8.1).
 */

import crypto from "node:crypto";
import * as x509 from "@peculiar/x509";

/** Pontes custom CSR/cert extension carrying `{"attrs":{"privilege":"2E|4E","mspid":"<BIC>"}}`. */
export const PONTES_PRIVILEGE_OID = "1.2.3.4.5.6.7.8.1";

export interface PemInspection {
  type: "CSR" | "CERTIFICATE" | "UNKNOWN";
  valid: boolean;
  subject?: string;
  commonName?: string;
  country?: string;
  organization?: string;
  organizationalUnit?: string;
  issuer?: string;
  notBefore?: string;
  notAfter?: string;
  serialNumber?: string;
  publicKeyType?: string;
  curve?: string;
  privilege?: string;
  mspid?: string;
  extensions?: Array<{ oid: string; critical: boolean }>;
  error?: string;
}

/** Split an RDN string ("CN=x, O=y, C=z") into a lookup map. */
function parseDn(dn: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of dn.split(/,\s*(?=[A-Za-z0-9.]+=)/)) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim();
  }
  return out;
}

/** Derive key type + named curve from an SPKI DER public key. */
function keyDetails(spkiDer: ArrayBuffer): { publicKeyType?: string; curve?: string } {
  try {
    const ko = crypto.createPublicKey({
      key: Buffer.from(spkiDer),
      format: "der",
      type: "spki",
    });
    const details = ko.asymmetricKeyDetails as { namedCurve?: string } | undefined;
    return { publicKeyType: ko.asymmetricKeyType, curve: details?.namedCurve };
  } catch {
    return {};
  }
}

/** Decode the Pontes privilege extension value (a UTF8 JSON string) if present. */
function decodePrivilege(
  extensions: readonly x509.Extension[],
): { privilege?: string; mspid?: string } {
  const ext = extensions.find((e) => e.type === PONTES_PRIVILEGE_OID);
  if (!ext) return {};
  const raw = Buffer.from(ext.value).toString("utf8");
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const json = JSON.parse(match[0]) as { attrs?: Record<string, string> } & Record<string, string>;
    const attrs = json.attrs ?? json;
    return { privilege: attrs.privilege, mspid: attrs.mspid };
  } catch {
    return {};
  }
}

/** Inspect a PEM string (CSR or certificate) and return structured details. */
export function inspectPem(pem: string): PemInspection {
  const text = (pem || "").trim();

  if (/-----BEGIN CERTIFICATE REQUEST-----/.test(text)) {
    try {
      const csr = new x509.Pkcs10CertificateRequest(text);
      const dn = parseDn(csr.subject);
      const { publicKeyType, curve } = keyDetails(csr.publicKey.rawData);
      const { privilege, mspid } = decodePrivilege(csr.extensions);
      return {
        type: "CSR",
        valid: true,
        subject: csr.subject,
        commonName: dn.CN,
        country: dn.C,
        organization: dn.O,
        organizationalUnit: dn.OU,
        publicKeyType,
        curve,
        privilege,
        mspid,
        extensions: csr.extensions.map((e) => ({ oid: e.type, critical: e.critical })),
      };
    } catch (e) {
      return { type: "CSR", valid: false, error: String(e).slice(0, 200) };
    }
  }

  if (/-----BEGIN CERTIFICATE-----/.test(text)) {
    try {
      const cert = new x509.X509Certificate(text);
      const dn = parseDn(cert.subject);
      const { publicKeyType, curve } = keyDetails(cert.publicKey.rawData);
      const { privilege, mspid } = decodePrivilege(cert.extensions);
      return {
        type: "CERTIFICATE",
        valid: true,
        subject: cert.subject,
        commonName: dn.CN,
        country: dn.C,
        organization: dn.O,
        organizationalUnit: dn.OU,
        issuer: cert.issuer,
        notBefore: cert.notBefore.toISOString(),
        notAfter: cert.notAfter.toISOString(),
        serialNumber: cert.serialNumber,
        publicKeyType,
        curve,
        privilege,
        mspid,
        extensions: cert.extensions.map((e) => ({ oid: e.type, critical: e.critical })),
      };
    } catch (e) {
      return { type: "CERTIFICATE", valid: false, error: String(e).slice(0, 200) };
    }
  }

  return { type: "UNKNOWN", valid: false, error: "Not a PEM CSR or certificate" };
}
