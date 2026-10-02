# src/ui/inspect.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 8.33% (4/48) | `█░░░░░░░░░` |
| Branches | 0.00% (0/14) | `░░░░░░░░░░` |
| Functions | 0.00% (0/7) | `░░░░░░░░░░` |
| Lines | 9.09% (4/44) | `█░░░░░░░░░` |

**Uncovered lines:** 37-41, 43, 47-49, 54-55, 57, 62, 65-73, 75, 80-81, 83-89, 101, 104, 108-114, 130, 133, 137

**Never called:** `parseDn` (L37), `keyDetails` (L47), `decodePrivilege` (L62), `(anonymous_13)` (L65), `inspectPem` (L80), `(anonymous_15)` (L101), `(anonymous_16)` (L130)

_Legend: `-` uncovered statement · `⋮` covered lines skipped · gutter: line number._

```diff
   34 | }
   35 | 
   36 | /** Split an RDN string ("CN=x, O=y, C=z") into a lookup map. */
-  37 | function parseDn(dn: string): Record<string, string> {
-  38 |   const out: Record<string, string> = {};
-  39 |   for (const part of dn.split(/,\s*(?=[A-Za-z0-9.]+=)/)) {
-  40 |     const eq = part.indexOf("=");
-  41 |     if (eq > 0) out[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim();
   42 |   }
-  43 |   return out;
   44 | }
   45 | 
   46 | /** Derive key type + named curve from an SPKI DER public key. */
-  47 | function keyDetails(spkiDer: ArrayBuffer): { publicKeyType?: string; curve?: string } {
-  48 |   try {
-  49 |     const ko = crypto.createPublicKey({
   50 |       key: Buffer.from(spkiDer),
   51 |       format: "der",
   52 |       type: "spki",
   53 |     });
-  54 |     const details = ko.asymmetricKeyDetails as { namedCurve?: string } | undefined;
-  55 |     return { publicKeyType: ko.asymmetricKeyType, curve: details?.namedCurve };
   56 |   } catch {
-  57 |     return {};
   58 |   }
   59 | }
   60 | 
   61 | /** Decode the Pontes privilege extension value (a UTF8 JSON string) if present. */
-  62 | function decodePrivilege(
   63 |   extensions: readonly x509.Extension[],
   64 | ): { privilege?: string; mspid?: string } {
-  65 |   const ext = extensions.find((e) => e.type === PONTES_PRIVILEGE_OID);
-  66 |   if (!ext) return {};
-  67 |   const raw = Buffer.from(ext.value).toString("utf8");
-  68 |   const match = raw.match(/\{[\s\S]*\}/);
-  69 |   if (!match) return {};
-  70 |   try {
-  71 |     const json = JSON.parse(match[0]) as { attrs?: Record<string, string> } & Record<string, string>;
-  72 |     const attrs = json.attrs ?? json;
-  73 |     return { privilege: attrs.privilege, mspid: attrs.mspid };
   74 |   } catch {
-  75 |     return {};
   76 |   }
   77 | }
   78 | 
   79 | /** Inspect a PEM string (CSR or certificate) and return structured details. */
-  80 | export function inspectPem(pem: string): PemInspection {
-  81 |   const text = (pem || "").trim();
   82 | 
-  83 |   if (/-----BEGIN CERTIFICATE REQUEST-----/.test(text)) {
-  84 |     try {
-  85 |       const csr = new x509.Pkcs10CertificateRequest(text);
-  86 |       const dn = parseDn(csr.subject);
-  87 |       const { publicKeyType, curve } = keyDetails(csr.publicKey.rawData);
-  88 |       const { privilege, mspid } = decodePrivilege(csr.extensions);
-  89 |       return {
   90 |         type: "CSR",
   91 |         valid: true,
   92 |         subject: csr.subject,
  ⋮
   98 |         curve,
   99 |         privilege,
  100 |         mspid,
- 101 |         extensions: csr.extensions.map((e) => ({ oid: e.type, critical: e.critical })),
  102 |       };
  103 |     } catch (e) {
- 104 |       return { type: "CSR", valid: false, error: String(e).slice(0, 200) };
  105 |     }
  106 |   }
  107 | 
- 108 |   if (/-----BEGIN CERTIFICATE-----/.test(text)) {
- 109 |     try {
- 110 |       const cert = new x509.X509Certificate(text);
- 111 |       const dn = parseDn(cert.subject);
- 112 |       const { publicKeyType, curve } = keyDetails(cert.publicKey.rawData);
- 113 |       const { privilege, mspid } = decodePrivilege(cert.extensions);
- 114 |       return {
  115 |         type: "CERTIFICATE",
  116 |         valid: true,
  117 |         subject: cert.subject,
  ⋮
  127 |         curve,
  128 |         privilege,
  129 |         mspid,
- 130 |         extensions: cert.extensions.map((e) => ({ oid: e.type, critical: e.critical })),
  131 |       };
  132 |     } catch (e) {
- 133 |       return { type: "CERTIFICATE", valid: false, error: String(e).slice(0, 200) };
  134 |     }
  135 |   }
  136 | 
- 137 |   return { type: "UNKNOWN", valid: false, error: "Not a PEM CSR or certificate" };
  138 | }
  139 | 
```
