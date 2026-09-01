/**
 * PKCS#12 (.p12) builder for the mock-pontes enrollment UI.
 *
 * Bundles an issued certificate + the user's private key into a password-
 * protected PKCS#12, importable into macOS Keychain / browsers. No `openssl`
 * / shell dependency, so it works in the distroless Docker image.
 *
 * Built with `node-forge`'s low-level ASN.1 primitives, deliberately NOT
 * pkijs's high-level PFX/SafeBag/EncryptedContentInfo builder: pkijs
 * auto-splits encrypted payloads over ~1KB into a BER "constructed string"
 * (indefinite-length OCTET STRING made of concatenated primitive pieces) —
 * legal BER, but macOS Keychain's strict PKCS#12 importer rejects it
 * (OSStatus -26276, reported as an invalid password even though it isn't).
 * forge's ASN.1 module has no "indefinite length" concept at all, so this
 * class of bug is structurally impossible here. This mirrors the ECB
 * reference "Certificate Installation Tool"
 * (utest.pontes-pilot.target-ssp.eu/certapp/cert-install), which uses the
 * exact same approach (forge for assembly, pkijs only to normalize the
 * private key format).
 *
 * Crypto choices (3DES-CBC key privacy, SHA-1 HMAC integrity, PKCS#12
 * Appendix-B password-based key derivation) also mirror that reference tool
 * — the most conservative/widely-compatible options, rather than the
 * AES-256/PBKDF2/SHA-256 this file used previously.
 *
 * Dev-only convenience: the private key is used in-memory and never stored.
 */

import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import forge from "node-forge";
import { webcrypto } from "node:crypto";

// PKCS#12 / PKCS#9 bag, attribute & algorithm OIDs.
const OID_DATA = "1.2.840.113549.1.7.1";
const OID_CERT_BAG = "1.2.840.113549.1.12.10.1.3";
const OID_X509_CERTIFICATE = "1.2.840.113549.1.9.22.1";
const OID_PKCS8_SHROUDED_KEY_BAG = "1.2.840.113549.1.12.10.1.2";
const OID_FRIENDLY_NAME = "1.2.840.113549.1.9.20";
const OID_LOCAL_KEY_ID = "1.2.840.113549.1.9.21";
const OID_EC_PUBLIC_KEY = "1.2.840.10045.2.1";
const OID_SHA1 = "1.3.14.3.2.26";

const PBE_ITERATIONS = 2048;
const SALT_SIZE = 8;
const KEY_ENCRYPTION_ALGORITHM = "3des";

/** Decode a PEM block to its DER ArrayBuffer. */
function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const buf = Buffer.from(b64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** forge represents byte strings as "binary strings" (1 char = 1 byte, latin1). */
function toForgeBytes(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("latin1");
}

/** UTF-16BE encoding required by BMPSTRING (forge has no built-in helper for this). */
function toBmpBytes(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    out += String.fromCharCode((code >> 8) & 0xff, code & 0xff);
  }
  return out;
}

const { Class: TagClass, Type: TagType } = forge.asn1;
const seq = (value: forge.asn1.Asn1[]): forge.asn1.Asn1 => forge.asn1.create(TagClass.UNIVERSAL, TagType.SEQUENCE, true, value);
const set = (value: forge.asn1.Asn1[]): forge.asn1.Asn1 => forge.asn1.create(TagClass.UNIVERSAL, TagType.SET, true, value);
const oid = (value: string): forge.asn1.Asn1 =>
  forge.asn1.create(TagClass.UNIVERSAL, TagType.OID, false, forge.asn1.oidToDer(value).getBytes());
const octetString = (value: string): forge.asn1.Asn1 => forge.asn1.create(TagClass.UNIVERSAL, TagType.OCTETSTRING, false, value);
const bmpString = (value: string): forge.asn1.Asn1 =>
  forge.asn1.create(TagClass.UNIVERSAL, TagType.BMPSTRING, false, toBmpBytes(value));
const integer = (value: number): forge.asn1.Asn1 =>
  forge.asn1.create(TagClass.UNIVERSAL, TagType.INTEGER, false, forge.asn1.integerToDer(value).getBytes());
const contextSpecific = (tagNumber: number, value: forge.asn1.Asn1[]): forge.asn1.Asn1 =>
  forge.asn1.create(TagClass.CONTEXT_SPECIFIC, tagNumber, true, value);

/** SET OF PKCS#9 bagAttributes (localKeyId + friendlyName) linking a cert bag to its key bag. */
function bagAttributes(localKeyId: string, friendlyName: string): forge.asn1.Asn1 {
  return set([
    seq([oid(OID_LOCAL_KEY_ID), set([octetString(localKeyId)])]),
    seq([oid(OID_FRIENDLY_NAME), set([bmpString(friendlyName)])]),
  ]);
}

/** `SafeBag ::= SEQUENCE { bagId certBag, bagValue [0] CertBag, bagAttributes SET }`. */
function buildCertBag(certDer: string, attributes: forge.asn1.Asn1): forge.asn1.Asn1 {
  const certBagValue = seq([oid(OID_X509_CERTIFICATE), contextSpecific(0, [octetString(certDer)])]);
  return seq([oid(OID_CERT_BAG), contextSpecific(0, [certBagValue]), attributes]);
}

/** `SafeBag ::= SEQUENCE { bagId pkcs8ShroudedKeyBag, bagValue [0] EncryptedPrivateKeyInfo, bagAttributes SET }`. */
function buildEncryptedKeyBag(privateKeyInfoDer: string, password: string, attributes: forge.asn1.Asn1): forge.asn1.Asn1 {
  const plainKeyInfo = forge.asn1.fromDer(privateKeyInfoDer);
  const encryptedKeyInfo = forge.pki.encryptPrivateKeyInfo(plainKeyInfo, password, {
    algorithm: KEY_ENCRYPTION_ALGORITHM,
    count: PBE_ITERATIONS,
    saltSize: SALT_SIZE,
  });
  return seq([oid(OID_PKCS8_SHROUDED_KEY_BAG), contextSpecific(0, [encryptedKeyInfo]), attributes]);
}

/** `ContentInfo ::= SEQUENCE { contentType data, content [0] EXPLICIT OCTET STRING(DER(safeBags)) }`. */
function dataContentInfo(safeBags: forge.asn1.Asn1[]): forge.asn1.Asn1 {
  const safeContents = seq(safeBags);
  return seq([oid(OID_DATA), contextSpecific(0, [octetString(forge.asn1.toDer(safeContents).getBytes())])]);
}

/** `MacData ::= SEQUENCE { mac DigestInfo, macSalt OCTET STRING, iterations INTEGER }` (HMAC-SHA1, PKCS#12 Appendix-B key derivation). */
function buildMacData(authenticatedSafeDer: string, password: string): forge.asn1.Asn1 {
  const salt = forge.util.createBuffer(forge.random.getBytesSync(SALT_SIZE));
  const macKey = forge.pkcs12.generateKey(password, salt, 3 /* MAC key purpose, RFC 7292 Appendix B.3 */, PBE_ITERATIONS, 20);
  const hmac = forge.hmac.create();
  hmac.start(forge.md.sha1.create(), macKey);
  hmac.update(authenticatedSafeDer);
  const digestInfo = seq([
    seq([oid(OID_SHA1), forge.asn1.create(TagClass.UNIVERSAL, TagType.NULL, false, "")]),
    octetString(hmac.getMac().getBytes()),
  ]);
  return seq([digestInfo, octetString(salt.getBytes()), integer(PBE_ITERATIONS)]);
}

/**
 * Normalizes a private key PEM (PKCS#8 `PRIVATE KEY`, or legacy SEC1
 * `EC PRIVATE KEY`) into a plain (unencrypted) `PrivateKeyInfo` DER buffer.
 * pkijs is used only for this ASN.1 schema handling — no crypto engine
 * needed, since nothing here is signed, verified, or encrypted via pkijs.
 */
function normalizePrivateKeyToPkcs8Der(keyPem: string): ArrayBuffer {
  const trimmed = keyPem.trim();
  if (trimmed.includes("-----BEGIN PRIVATE KEY-----")) {
    return pemToDer(trimmed);
  }
  if (trimmed.includes("-----BEGIN EC PRIVATE KEY-----")) {
    const ecPrivateKey = new pkijs.ECPrivateKey({ schema: asn1js.fromBER(pemToDer(trimmed)).result });
    const privateKeyInfo = new pkijs.PrivateKeyInfo({
      privateKeyAlgorithm: new pkijs.AlgorithmIdentifier({
        algorithmId: OID_EC_PUBLIC_KEY,
        algorithmParams: new asn1js.ObjectIdentifier({ value: ecPrivateKey.namedCurve }),
      }),
      privateKey: new asn1js.OctetString({ valueHex: ecPrivateKey.toSchema().toBER(false) }),
    });
    return privateKeyInfo.toSchema().toBER(false);
  }
  throw new Error("Unsupported private key format. Expected PEM 'PRIVATE KEY' or 'EC PRIVATE KEY'.");
}

export async function buildP12(
  keyPem: string,
  certPem: string,
  password: string,
  friendlyName: string,
): Promise<Buffer> {
  const name = friendlyName || "pontes-user";
  const certDer = toForgeBytes(pemToDer(certPem));
  const privateKeyInfoDer = toForgeBytes(normalizePrivateKeyToPkcs8Der(keyPem));

  // Links the cert bag to its key bag (standard PKCS#12 convention).
  const localKeyId = toForgeBytes(new Uint8Array(await webcrypto.subtle.digest("SHA-1", pemToDer(certPem))));
  const attributes = bagAttributes(localKeyId, name);

  const certBag = buildCertBag(certDer, attributes);
  const keyBag = buildEncryptedKeyBag(privateKeyInfoDer, password, attributes);

  // Both SafeContents are unencrypted at this layer: the certificate isn't
  // secret, and the private key is already individually encrypted inside its
  // own PKCS8ShroudedKeyBag above.
  const authenticatedSafe = seq([dataContentInfo([certBag]), dataContentInfo([keyBag])]);
  const authenticatedSafeDer = forge.asn1.toDer(authenticatedSafe).getBytes();

  const pfx = seq([
    integer(3),
    seq([oid(OID_DATA), contextSpecific(0, [octetString(authenticatedSafeDer)])]),
    buildMacData(authenticatedSafeDer, password),
  ]);

  return Buffer.from(forge.asn1.toDer(pfx).getBytes(), "latin1");
}
