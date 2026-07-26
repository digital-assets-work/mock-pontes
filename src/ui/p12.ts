/**
 * PKCS#12 (.p12) builder for the mock-pontes enrollment UI.
 *
 * Pure-JS implementation (pkijs + asn1js on Node's WebCrypto). No `openssl` /
 * shell dependency, so it works in the distroless Docker image. Bundles an
 * issued certificate + the user's (unencrypted PKCS#8) private key into a
 * password-protected PKCS#12 with AES-256-CBC privacy and an HMAC-SHA256
 * integrity MAC — importable into macOS Keychain / browsers.
 *
 * Dev-only convenience: the private key is used in-memory and never stored.
 */

import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import * as pvutils from "pvutils";
import { webcrypto } from "node:crypto";

// PKCS#12 / PKCS#9 bag & attribute OIDs.
const OID_CERT_BAG = "1.2.840.113549.1.12.10.1.3";
const OID_PKCS8_SHROUDED_KEY_BAG = "1.2.840.113549.1.12.10.1.2";
const OID_FRIENDLY_NAME = "1.2.840.113549.1.9.20";
const OID_LOCAL_KEY_ID = "1.2.840.113549.1.9.21";

let engineReady = false;
function ensureEngine(): void {
  if (engineReady) return;
  const crypto = webcrypto as unknown as Crypto;
  pkijs.setEngine("nodeEngine", new pkijs.CryptoEngine({ name: "nodeEngine", crypto }));
  engineReady = true;
}

/** Decode a PEM block to its DER ArrayBuffer. */
function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const buf = Buffer.from(b64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function bagAttributes(friendlyName: string, localKeyId: ArrayBuffer): pkijs.Attribute[] {
  return [
    new pkijs.Attribute({
      type: OID_FRIENDLY_NAME,
      values: [new asn1js.BmpString({ value: friendlyName })],
    }),
    new pkijs.Attribute({
      type: OID_LOCAL_KEY_ID,
      values: [new asn1js.OctetString({ valueHex: localKeyId })],
    }),
  ];
}

export async function buildP12(
  keyPem: string,
  certPem: string,
  password: string,
  friendlyName: string,
): Promise<Buffer> {
  ensureEngine();

  const name = friendlyName || "pontes-user";
  const passwordBuffer = pvutils.stringToArrayBuffer(password ?? "");

  const certificate = new pkijs.Certificate({ schema: asn1js.fromBER(pemToDer(certPem)).result });
  const privateKeyInfo = new pkijs.PrivateKeyInfo({ schema: asn1js.fromBER(pemToDer(keyPem)).result });

  const localKeyIdBytes = new Uint8Array(8);
  webcrypto.getRandomValues(localKeyIdBytes);
  const localKeyId = localKeyIdBytes.buffer.slice(0);

  const keyBag = new pkijs.SafeBag({
    bagId: OID_PKCS8_SHROUDED_KEY_BAG,
    bagValue: new pkijs.PKCS8ShroudedKeyBag({ parsedValue: privateKeyInfo }),
    bagAttributes: bagAttributes(name, localKeyId),
  });

  const certBag = new pkijs.SafeBag({
    bagId: OID_CERT_BAG,
    bagValue: new pkijs.CertBag({ parsedValue: certificate }),
    bagAttributes: bagAttributes(name, localKeyId),
  });

  // Encrypt the private key (shrouded key bag).
  // pkijs' ContentEncryptionAlgorithm type unions WebCrypto AES params that
  // demand an `iv`, but pkijs derives the iv/salt itself — so we type this `any`
  // to match the actual runtime contract ({ name, length }).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentEncryptionAlgorithm: any = { name: "AES-CBC", length: 256 };
  await (keyBag.bagValue as pkijs.PKCS8ShroudedKeyBag).makeInternalValues({
    password: passwordBuffer,
    contentEncryptionAlgorithm,
    hmacHashAlgorithm: "SHA-256",
    iterationCount: 2048,
  });

  const pfx = new pkijs.PFX({
    parsedValue: {
      integrityMode: 0, // password-based integrity
      authenticatedSafe: new pkijs.AuthenticatedSafe({
        parsedValue: {
          safeContents: [
            // Cert bag — wrapped in a password-encrypted SafeContents.
            { privacyMode: 1, value: new pkijs.SafeContents({ safeBags: [certBag] }) },
            // Key bag — already individually encrypted (shrouded), so no extra privacy.
            { privacyMode: 0, value: new pkijs.SafeContents({ safeBags: [keyBag] }) },
          ],
        },
      }),
    },
  });

  // Encrypt the cert SafeContents; leave the (already shrouded) key SafeContents as-is.
  await (pfx.parsedValue!.authenticatedSafe as pkijs.AuthenticatedSafe).makeInternalValues({
    safeContents: [
      {
        password: passwordBuffer,
        contentEncryptionAlgorithm,
        hmacHashAlgorithm: "SHA-256",
        iterationCount: 2048,
      },
      {},
    ],
  });

  // Apply the outer integrity MAC (HMAC-SHA256) over the whole PFX.
  await pfx.makeInternalValues({
    password: passwordBuffer,
    iterations: 2048,
    pbkdf2HashAlgorithm: "SHA-256",
    hmacHashAlgorithm: "SHA-256",
  });

  return Buffer.from(pfx.toSchema().toBER(false));
}
