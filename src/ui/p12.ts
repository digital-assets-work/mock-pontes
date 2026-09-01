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

/**
 * pkijs auto-splits any encrypted payload over ~1KB into a BER "constructed
 * string" — an indefinite-length OCTET STRING made of concatenated primitive
 * OCTET STRING chunks. That's legal BER, but macOS Keychain's strict PKCS#12
 * importer rejects it (OSStatus -26276, reported to the user as an invalid
 * password even though it isn't). pkijs exposes no option to disable this for
 * the password-encryption path we use (only its unrelated `EnvelopedData`
 * respects a `disableSplit` option).
 *
 * Patching pkijs's internal asn1js object graph before serialization turned
 * out to be unreliable: `EncryptedContentInfo.toSchema()` hard-codes ancestor
 * `isIndefiniteForm` flags from the *original* chunked OctetString at schema-
 * build time, and asn1js's `prepareIndefiniteForm()` (re-run on every
 * `toBER()` call) only ever OR-propagates that flag upward, so mutating the
 * schema tree in place doesn't reliably produce definite-length output.
 *
 * Instead, canonicalize the final serialized bytes directly: parse the BER
 * output and re-emit it as strict definite-length DER. This is well-defined
 * purely from the wire format, independent of pkijs's internal state.
 */
function readLength(buf: Uint8Array, pos: number): { length: number; headerLen: number; indefinite: boolean } {
  const first = buf[pos];
  if (first === 0x80) return { length: 0, headerLen: 1, indefinite: true };
  if ((first & 0x80) === 0) return { length: first, headerLen: 1, indefinite: false };
  const numBytes = first & 0x7f;
  let length = 0;
  for (let i = 0; i < numBytes; i++) length = length * 256 + buf[pos + 1 + i];
  return { length, headerLen: 1 + numBytes, indefinite: false };
}

function encodeLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  let n = length;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  return [0x80 | bytes.length, ...bytes];
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Re-wraps a constructed node's already-canonicalized children with a
 * recomputed definite length. If every child is a plain, primitive UNIVERSAL
 * OCTET STRING (tag byte 0x04) — BER's "constructed string" encoding, used
 * both for indefinite-length streaming chunking AND (rarer) upfront-sized
 * definite-length splitting — concatenate their raw value bytes into a
 * single flat, definite-length primitive OCTET STRING instead, using this
 * node's own tag (which may be a re-tagged `[0] IMPLICIT`) with the
 * constructed bit cleared. DER forbids constructed string encodings, so this
 * must apply regardless of whether the original was indefinite or definite.
 *
 * `skipMerge` opts a node out of this: a `[0] EXPLICIT` wrapper (e.g. CMS
 * `ContentInfo.content`) also happens to look identical at the byte level —
 * a constructed context tag with a single UNIVERSAL OCTET STRING child — but
 * must stay constructed, since EXPLICIT tagging wraps a *complete separate*
 * TLV rather than replacing one. The caller identifies that shape (the
 * `[0]`/etc. is the 2nd child of a 2-child SEQUENCE whose 1st child is an
 * OBJECT IDENTIFIER) before recursing, since it can't be told apart from
 * genuine chunking by looking at this node alone.
 */
function finalizeConstructed(
  tagBytes: Uint8Array,
  childTlvs: { tag: number; bytes: Uint8Array }[],
  consumed: number,
  skipMerge: boolean,
): { bytes: Uint8Array; consumed: number } {
  const isChunkedString = !skipMerge && childTlvs.length > 0 && childTlvs.every((c) => c.tag === 0x04);
  if (isChunkedString) {
    const innerValues = childTlvs.map((c) => {
      const { headerLen: childHeaderLen } = readLength(c.bytes, 1);
      return c.bytes.slice(1 + childHeaderLen);
    });
    const flatValue = concatBytes(innerValues);
    const flatTag = Uint8Array.from([tagBytes[0] & ~0x20]);
    const out = concatBytes([flatTag, Uint8Array.from(encodeLength(flatValue.length)), flatValue]);
    return { bytes: out, consumed };
  }
  const valueBytes = concatBytes(childTlvs.map((c) => c.bytes));
  const out = concatBytes([tagBytes, Uint8Array.from(encodeLength(valueBytes.length)), valueBytes]);
  return { bytes: out, consumed };
}

/** Reads just the tag byte + full TLV length at `pos`, without recursing into content. Used to peek sibling shape ahead of the real canonicalization pass. */
function peekTlvSpan(buf: Uint8Array, pos: number): { tag: number; consumed: number } {
  const firstByte = buf[pos];
  let tagEnd = pos + 1;
  if ((firstByte & 0x1f) === 0x1f) {
    while (buf[tagEnd] & 0x80) tagEnd++;
    tagEnd++;
  }
  const { length, headerLen, indefinite } = readLength(buf, tagEnd);
  if (!indefinite) {
    return { tag: firstByte, consumed: tagEnd + headerLen + length - pos };
  }
  let childPos = tagEnd + headerLen;
  while (!(buf[childPos] === 0x00 && buf[childPos + 1] === 0x00)) {
    childPos += peekTlvSpan(buf, childPos).consumed;
  }
  return { tag: firstByte, consumed: childPos + 2 - pos };
}

/** Peeks the tag of every direct child within `[start, end)` (definite) or up to the EOC marker at `start` (indefinite, when `end` is omitted). */
function peekChildTags(buf: Uint8Array, start: number, end?: number): number[] {
  const tags: number[] = [];
  let pos = start;
  if (end !== undefined) {
    while (pos < end) {
      const span = peekTlvSpan(buf, pos);
      tags.push(span.tag);
      pos += span.consumed;
    }
  } else {
    while (!(buf[pos] === 0x00 && buf[pos + 1] === 0x00)) {
      const span = peekTlvSpan(buf, pos);
      tags.push(span.tag);
      pos += span.consumed;
    }
  }
  return tags;
}

/**
 * Canonicalizes exactly one BER TLV starting at `buf[pos]` into strict
 * definite-length DER. Returns the re-encoded bytes and how many input bytes
 * were consumed. Recurses into constructed values; a BER "constructed string"
 * (a node whose children are all plain primitive OCTET STRINGs) is flattened
 * into a single definite-length primitive OCTET STRING, matching what a
 * non-chunking encoder would have produced.
 */
function canonicalizeTlv(buf: Uint8Array, pos: number, skipMerge = false): { bytes: Uint8Array; consumed: number } {
  if (pos >= buf.length) throw new Error("canonicalizeTlv: out of bounds");
  const startPos = pos;
  const firstByte = buf[pos];
  const isConstructed = (firstByte & 0x20) !== 0;
  let tagEnd = pos + 1;
  if ((firstByte & 0x1f) === 0x1f) {
    while (buf[tagEnd] & 0x80) tagEnd++;
    tagEnd++;
  }
  const tagBytes = buf.slice(pos, tagEnd);
  const { length, headerLen, indefinite } = readLength(buf, tagEnd);
  const valueStart = tagEnd + headerLen;

  if (!indefinite) {
    const total = valueStart + length - startPos;
    if (total < 0 || valueStart + length > buf.length) throw new Error("canonicalizeTlv: length out of bounds");
    if (!isConstructed) {
      const rawValue = buf.slice(valueStart, valueStart + length);
      // CMS nests an entire separate DER document inside an OCTET STRING's
      // raw value (e.g. `ContentInfo`'s `[0] EXPLICIT` "data" content, or a
      // re-tagged `[0] IMPLICIT OCTET STRING`) — that's invisible as TLV
      // structure from here, so it never gets canonicalized just by walking
      // the outer tree. Detect it heuristically (looks like a nested
      // SEQUENCE and fully round-trips) and canonicalize it too.
      if (rawValue.length > 4 && rawValue[0] === 0x30) {
        try {
          const nested = canonicalizeTlv(rawValue, 0);
          if (nested.consumed === rawValue.length) {
            const out = concatBytes([tagBytes, Uint8Array.from(encodeLength(nested.bytes.length)), nested.bytes]);
            return { bytes: out, consumed: total };
          }
        } catch {
          // Not nested BER — fall through and keep the raw opaque bytes.
        }
      }
      return { bytes: buf.slice(startPos, startPos + total), consumed: total };
    }
    const valueEnd = valueStart + length;
    // CMS's `ContentInfo ::= SEQUENCE { contentType OID, content [0] EXPLICIT
    // ANY }` gives its `[0]` wrapper the exact same byte shape (constructed
    // context tag, one UNIVERSAL OCTET STRING child) as a degenerate
    // (single-piece) chunked/re-tagged OCTET STRING — so identify that
    // specific shape (2 siblings, 1st is an OBJECT IDENTIFIER) up front and
    // tell the 2nd child to never merge, since only it (not chunking) can be
    // reliably told apart this way.
    const siblingTags = peekChildTags(buf, valueStart, valueEnd);
    const isContentInfoShape = siblingTags.length === 2 && siblingTags[0] === 0x06;
    let childPos = valueStart;
    const childTlvs: { tag: number; bytes: Uint8Array }[] = [];
    let index = 0;
    while (childPos < valueEnd) {
      const childSkipMerge = isContentInfoShape && index === 1;
      const { bytes: childBytes, consumed } = canonicalizeTlv(buf, childPos, childSkipMerge);
      childTlvs.push({ tag: buf[childPos], bytes: childBytes });
      childPos += consumed;
      index++;
    }
    return finalizeConstructed(tagBytes, childTlvs, total, skipMerge);
  }

  // Indefinite length: gather children up to the End-Of-Contents marker (00 00).
  const siblingTags = peekChildTags(buf, valueStart);
  const isContentInfoShape = siblingTags.length === 2 && siblingTags[0] === 0x06;
  let childPos = valueStart;
  const childTlvs: { tag: number; bytes: Uint8Array }[] = [];
  let index = 0;
  while (!(buf[childPos] === 0x00 && buf[childPos + 1] === 0x00)) {
    if (childPos >= buf.length - 1) throw new Error("canonicalizeTlv: missing EOC marker");
    const childSkipMerge = isContentInfoShape && index === 1;
    const { bytes: childBytes, consumed } = canonicalizeTlv(buf, childPos, childSkipMerge);
    childTlvs.push({ tag: buf[childPos], bytes: childBytes });
    childPos += consumed;
    index++;
  }
  const consumed = childPos + 2 - startPos; // +2 for the EOC marker
  return finalizeConstructed(tagBytes, childTlvs, consumed, skipMerge);
}

/**
 * Converts BER (possibly using indefinite-length "constructed string"
 * chunking, as pkijs produces for encrypted payloads over ~1KB) into strict
 * definite-length DER, required by macOS Keychain's strict PKCS#12 importer.
 */
function toDefiniteLengthDer(ber: ArrayBuffer): Buffer {
  const { bytes } = canonicalizeTlv(new Uint8Array(ber), 0);
  return Buffer.from(bytes);
}

/** A `Buffer`'s `.buffer` may be a larger, pooled (Shared)ArrayBuffer — copy out exactly this Buffer's own bytes. */
function arrayBufferOf(buf: Buffer): ArrayBuffer {
  const out = new ArrayBuffer(buf.byteLength);
  new Uint8Array(out).set(buf);
  return out;
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

  // Apply the outer integrity MAC (HMAC-SHA256). Done manually — mirroring
  // `PFX.makeInternalValues()`'s own integrityMode=0 logic — rather than via
  // pkijs directly, computing it over the *canonicalized* (definite-length
  // DER) AuthenticatedSafe bytes rather than pkijs's own possibly BER-chunked
  // serialization. Canonicalizing the whole PFX after pkijs computes its own
  // MAC would invalidate it, since the MAC covers these exact bytes.
  const authenticatedSafe = pfx.parsedValue!.authenticatedSafe as pkijs.AuthenticatedSafe;
  const canonicalAuthSafeBer = arrayBufferOf(toDefiniteLengthDer(authenticatedSafe.toSchema().toBER(false)));
  const crypto = pkijs.getCrypto(true);
  const saltBuffer = new ArrayBuffer(64);
  webcrypto.getRandomValues(new Uint8Array(saltBuffer));
  const iterations = 2048;
  const hmacHashAlgorithm = "SHA-256";
  const macDigest = await crypto.stampDataWithPassword({
    password: passwordBuffer,
    hashAlgorithm: hmacHashAlgorithm,
    salt: saltBuffer,
    iterationCount: iterations,
    contentToStamp: canonicalAuthSafeBer,
  });
  pfx.authSafe = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.DATA,
    content: new asn1js.OctetString({ valueHex: canonicalAuthSafeBer }),
  });
  pfx.macData = new pkijs.MacData({
    mac: new pkijs.DigestInfo({
      digestAlgorithm: new pkijs.AlgorithmIdentifier({
        algorithmId: crypto.getOIDByAlgorithm({ name: hmacHashAlgorithm }, true, "hmacHashAlgorithm"),
      }),
      digest: new asn1js.OctetString({ valueHex: macDigest }),
    }),
    macSalt: new asn1js.OctetString({ valueHex: saltBuffer }),
    iterations,
  });

  const schema = pfx.toSchema();
  return toDefiniteLengthDer(schema.toBER(false));
}
