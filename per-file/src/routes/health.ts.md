# src/routes/health.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 34.78% (8/23) | `███░░░░░░░` |
| Branches | 0.00% (0/12) | `░░░░░░░░░░` |
| Functions | 40.00% (2/5) | `████░░░░░░` |
| Lines | 36.36% (8/22) | `████░░░░░░` |

**Uncovered lines:** 21-23, 52-54, 57, 70-72, 74-76, 86-88, 90

**Partial branches:** L55 (cond-expr), L56 (cond-expr), L80 (cond-expr), L81 (cond-expr)

**Never called:** `normalizeIp` (L21), `(anonymous_3)` (L52), `(anonymous_4)` (L70)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
  18 |  */
  19 | 
  20 | /** Strip the IPv4-mapped IPv6 prefix (::ffff:) for readability. */
- 21 | function normalizeIp(ip: string | undefined): string {
- 22 |   if (!ip) return "unknown";
- 23 |   return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
  24 | }
  25 | 
  26 | export function createHealthRouter(authUsersRepository: InMemoryAuthUsersRepository) {
  ⋮
  49 |   // Returns the caller's source IP address (honouring X-Forwarded-For when set).
  50 |   router.get(
  51 |     "/check/ip",
- 52 |     defineEventHandler((event) => {
- 53 |       const forwarded = getRequestHeader(event, "x-forwarded-for");
- 54 |       const ip = forwarded
! 55 |         ? forwarded.split(",")[0]!.trim()
! 56 |         : event.node?.req?.socket?.remoteAddress;
- 57 |       return { status: "OK", check: "ip", ip: normalizeIp(ip), mock: true };
  58 |     }),
  59 |   );
  60 | 
  ⋮
  67 |   // user who was since removed via `DELETE /admin/enrolled-users/{username}`).
  68 |   router.get(
  69 |     "/check/mtls",
- 70 |     defineEventHandler((event) => {
- 71 |       const fingerprint = event.context.mtlsCertFingerprint as string | undefined;
- 72 |       const valid = event.context.mtlsCertValid as boolean | undefined;
  73 | 
- 74 |       if (!fingerprint || !valid) {
- 75 |         setResponseStatus(event, 403);
- 76 |         return {
  77 |           status: "REJECTED",
  78 |           check: "mtls",
  79 |           error: fingerprint
! 80 |             ? "Client certificate is not trusted (not signed by the accepted CA)"
! 81 |             : "No client certificate presented",
  82 |           mock: true,
  83 |         };
  84 |       }
  85 | 
- 86 |       const cert = event.context.mtlsCert as PeerCertificate | undefined;
- 87 |       const user = cert?.subject?.CN;
- 88 |       const enrolled = authUsersRepository.getUsernameByFingerprint(fingerprint) !== undefined;
  89 | 
- 90 |       return { status: "OK", check: "mtls", fingerprint, user, enrolled, mock: true };
  91 |     }),
  92 |   );
  93 | 
```
