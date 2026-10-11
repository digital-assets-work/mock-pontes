# src/logger/middleware.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 62.96% (17/27) | `██████░░░░` |
| Branches | 27.27% (6/22) | `███░░░░░░░` |
| Functions | 75.00% (3/4) | `████████░░` |
| Lines | 64.00% (16/25) | `██████░░░░` |

**Uncovered lines:** 5-7, 17-21, 23-24

**Partial branches:** L16 (if), L40 (cond-expr), L41 (binary-expr)

**Never called:** `getCertFingerprint` (L5)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   2 | import type { TLSSocket } from "node:tls";
   3 | import { createHash } from "node:crypto";
   4 | 
-  5 | function getCertFingerprint(cert: { raw: Buffer } | undefined): string | null {
-  6 |   if (!cert || !cert.raw) return null;
-  7 |   return createHash("sha256").update(cert.raw).digest("hex");
   8 | }
   9 | 
  10 | export const createLoggingMiddleware = () => {
  ⋮
  13 | 
  14 |     // Only for mTLS mode
  15 |     const socket = event.node?.req?.socket as TLSSocket;
! 16 |     if (socket && typeof socket.getPeerCertificate === "function") {
- 17 |       const cert = socket.getPeerCertificate();
- 18 |       if (cert && cert.raw) {
- 19 |         const fingerprint = getCertFingerprint(cert);
- 20 |         event.context.mtlsCert = cert;
- 21 |         event.context.mtlsCertFingerprint = fingerprint;
  22 |       }
- 23 |       event.context.mtlsCertValid = socket.authorized;
- 24 |       event.context.mtlsCertError = socket.authorizationError || null;
  25 |     }
  26 | 
  27 |     // Log every HTTP call at end of response with user/cert info + duration
  ⋮
  37 |       // `certValid=INVALID (UNABLE_TO_GET_ISSUER_CERT)` (issue #98).
  38 |       const fingerprint = event.context.mtlsCertFingerprint;
  39 |       const certInfo = fingerprint
! 40 |         ? `cert=${fingerprint} certValid=${
! 41 |             event.context.mtlsCertValid ? "valid" : `INVALID (${event.context.mtlsCertError || "unknown"})`
  42 |           }`
  43 |         : "cert=<none>";
  44 |       console.log(
```
