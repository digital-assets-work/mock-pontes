/**
 * Client-side PKCS#12 (.p12) builder for the /ui/enroll page — the private
 * key never leaves the browser (mirrors the ECB reference "Certificate
 * Installation Tool", utest.pontes-pilot.target-ssp.eu/certapp/cert-install,
 * and this port of `src/ui/p12.ts`'s server-side logic; keep both in sync).
 *
 * Requires `forge` (vendor/forge.min.js) loaded before this script.
 */
(function () {
  var forge = window.forge;

  var OID_DATA = "1.2.840.113549.1.7.1";
  var OID_CERT_BAG = "1.2.840.113549.1.12.10.1.3";
  var OID_X509_CERTIFICATE = "1.2.840.113549.1.9.22.1";
  var OID_PKCS8_SHROUDED_KEY_BAG = "1.2.840.113549.1.12.10.1.2";
  var OID_FRIENDLY_NAME = "1.2.840.113549.1.9.20";
  var OID_LOCAL_KEY_ID = "1.2.840.113549.1.9.21";
  var OID_EC_PUBLIC_KEY = "1.2.840.10045.2.1";
  var OID_SHA1 = "1.3.14.3.2.26";

  var PBE_ITERATIONS = 2048;
  var SALT_SIZE = 8;
  var KEY_ENCRYPTION_ALGORITHM = "3des";

  /** Decode a PEM block to its DER bytes (forge "binary string": 1 char = 1 byte). */
  function pemToForgeBytes(pem) {
    var b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    return forge.util.createBuffer(forge.util.binary.base64.decode(b64)).getBytes();
  }

  /** UTF-16BE encoding required by BMPSTRING (forge has no built-in helper for this). */
  function toBmpBytes(value) {
    var out = "";
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      out += String.fromCharCode((code >> 8) & 0xff, code & 0xff);
    }
    return out;
  }

  var TagClass = forge.asn1.Class;
  var TagType = forge.asn1.Type;
  function seq(value) { return forge.asn1.create(TagClass.UNIVERSAL, TagType.SEQUENCE, true, value); }
  function set(value) { return forge.asn1.create(TagClass.UNIVERSAL, TagType.SET, true, value); }
  function oid(value) { return forge.asn1.create(TagClass.UNIVERSAL, TagType.OID, false, forge.asn1.oidToDer(value).getBytes()); }
  function octetString(value) { return forge.asn1.create(TagClass.UNIVERSAL, TagType.OCTETSTRING, false, value); }
  function bmpString(value) { return forge.asn1.create(TagClass.UNIVERSAL, TagType.BMPSTRING, false, toBmpBytes(value)); }
  function integer(value) { return forge.asn1.create(TagClass.UNIVERSAL, TagType.INTEGER, false, forge.asn1.integerToDer(value).getBytes()); }
  function contextSpecific(tagNumber, value) { return forge.asn1.create(TagClass.CONTEXT_SPECIFIC, tagNumber, true, value); }

  /** SET OF PKCS#9 bagAttributes (localKeyId + friendlyName) linking a cert bag to its key bag. */
  function bagAttributes(localKeyId, friendlyName) {
    return set([
      seq([oid(OID_LOCAL_KEY_ID), set([octetString(localKeyId)])]),
      seq([oid(OID_FRIENDLY_NAME), set([bmpString(friendlyName)])]),
    ]);
  }

  /** `SafeBag ::= SEQUENCE { bagId certBag, bagValue [0] CertBag, bagAttributes SET }`. */
  function buildCertBag(certDer, attributes) {
    var certBagValue = seq([oid(OID_X509_CERTIFICATE), contextSpecific(0, [octetString(certDer)])]);
    return seq([oid(OID_CERT_BAG), contextSpecific(0, [certBagValue]), attributes]);
  }

  /** `SafeBag ::= SEQUENCE { bagId pkcs8ShroudedKeyBag, bagValue [0] EncryptedPrivateKeyInfo, bagAttributes SET }`. */
  function buildEncryptedKeyBag(privateKeyInfoDer, password, attributes) {
    var plainKeyInfo = forge.asn1.fromDer(privateKeyInfoDer);
    var encryptedKeyInfo = forge.pki.encryptPrivateKeyInfo(plainKeyInfo, password, {
      algorithm: KEY_ENCRYPTION_ALGORITHM,
      count: PBE_ITERATIONS,
      saltSize: SALT_SIZE,
    });
    return seq([oid(OID_PKCS8_SHROUDED_KEY_BAG), contextSpecific(0, [encryptedKeyInfo]), attributes]);
  }

  /** `ContentInfo ::= SEQUENCE { contentType data, content [0] EXPLICIT OCTET STRING(DER(safeBags)) }`. */
  function dataContentInfo(safeBags) {
    var safeContents = seq(safeBags);
    return seq([oid(OID_DATA), contextSpecific(0, [octetString(forge.asn1.toDer(safeContents).getBytes())])]);
  }

  /** `MacData ::= SEQUENCE { mac DigestInfo, macSalt OCTET STRING, iterations INTEGER }` (HMAC-SHA1, PKCS#12 Appendix-B key derivation). */
  function buildMacData(authenticatedSafeDer, password) {
    var salt = forge.util.createBuffer(forge.random.getBytesSync(SALT_SIZE));
    var macKey = forge.pkcs12.generateKey(password, salt, 3 /* MAC key purpose, RFC 7292 Appendix B.3 */, PBE_ITERATIONS, 20);
    var hmac = forge.hmac.create();
    hmac.start(forge.md.sha1.create(), macKey);
    hmac.update(authenticatedSafeDer);
    var digestInfo = seq([
      seq([oid(OID_SHA1), forge.asn1.create(TagClass.UNIVERSAL, TagType.NULL, false, "")]),
      octetString(hmac.getMac().getBytes()),
    ]);
    return seq([digestInfo, octetString(salt.getBytes()), integer(PBE_ITERATIONS)]);
  }

  /**
   * Normalizes a private key PEM (PKCS#8 `PRIVATE KEY`, or legacy SEC1
   * `EC PRIVATE KEY`) into a plain (unencrypted) `PrivateKeyInfo` DER
   * (forge binary string), using only forge's own ASN.1 parser.
   */
  function normalizePrivateKeyToPkcs8Der(keyPem) {
    var trimmed = keyPem.trim();
    if (trimmed.indexOf("-----BEGIN PRIVATE KEY-----") !== -1) {
      return pemToForgeBytes(trimmed);
    }
    if (trimmed.indexOf("-----BEGIN EC PRIVATE KEY-----") !== -1) {
      var secDer = pemToForgeBytes(trimmed);
      var sec1 = forge.asn1.fromDer(secDer);
      var namedCurveOid = null;
      for (var i = 0; i < sec1.value.length; i++) {
        var child = sec1.value[i];
        if (child.tagClass === TagClass.CONTEXT_SPECIFIC && child.type === 0) {
          namedCurveOid = forge.asn1.derToOid(child.value[0].value);
        }
      }
      if (!namedCurveOid) throw new Error("SEC1 EC private key is missing its namedCurve parameters.");
      var privateKeyInfo = seq([integer(0), seq([oid(OID_EC_PUBLIC_KEY), oid(namedCurveOid)]), octetString(secDer)]);
      return forge.asn1.toDer(privateKeyInfo).getBytes();
    }
    throw new Error("Unsupported private key format. Expected PEM 'PRIVATE KEY' or 'EC PRIVATE KEY'.");
  }

  function forgeBytesToUint8Array(str) {
    var arr = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i) & 0xff;
    return arr;
  }

  /** Builds a password-protected .p12 entirely client-side. Returns a `Uint8Array`. */
  async function buildP12(keyPem, certPem, password, friendlyName) {
    var name = friendlyName || "pontes-user";
    var certDer = pemToForgeBytes(certPem);
    var privateKeyInfoDer = normalizePrivateKeyToPkcs8Der(keyPem);

    // Links the cert bag to its key bag (standard PKCS#12 convention).
    var certDerBytes = forgeBytesToUint8Array(certDer);
    var localKeyIdBuf = await window.crypto.subtle.digest("SHA-1", certDerBytes);
    var localKeyId = forge.util.createBuffer(new Uint8Array(localKeyIdBuf)).getBytes();
    var attributes = bagAttributes(localKeyId, name);

    var certBag = buildCertBag(certDer, attributes);
    var keyBag = buildEncryptedKeyBag(privateKeyInfoDer, password, attributes);

    // Both SafeContents are unencrypted at this layer: the certificate isn't
    // secret, and the private key is already individually encrypted inside its
    // own PKCS8ShroudedKeyBag above.
    var authenticatedSafe = seq([dataContentInfo([certBag]), dataContentInfo([keyBag])]);
    var authenticatedSafeDer = forge.asn1.toDer(authenticatedSafe).getBytes();

    var pfx = seq([
      integer(3),
      seq([oid(OID_DATA), contextSpecific(0, [octetString(authenticatedSafeDer)])]),
      buildMacData(authenticatedSafeDer, password),
    ]);

    return forgeBytesToUint8Array(forge.asn1.toDer(pfx).getBytes());
  }

  window.MockPontesP12 = { build: buildP12 };
})();
