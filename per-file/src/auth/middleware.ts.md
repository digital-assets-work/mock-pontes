# src/auth/middleware.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 31.58% (6/19) | `███░░░░░░░` |
| Branches | 7.14% (1/14) | `█░░░░░░░░░` |
| Functions | 100.00% (2/2) | `██████████` |
| Lines | 27.78% (5/18) | `███░░░░░░░` |

**Uncovered lines:** 11-12, 14-16, 22-23, 25-27, 33-35

**Partial branches:** L9 (if)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   6 | ) {
   7 |   return defineEventHandler((event) => {
   8 |     const username = event.context?.auth?.username;
!  9 |     if (!username) return;
  10 | 
- 11 |     const fingerprint = event.context.mtlsCertFingerprint;
- 12 |     const certValid = event.context.mtlsCertValid;
  13 | 
- 14 |     if (!fingerprint || !certValid) {
- 15 |       setResponseStatus(event, 401);
- 16 |       return {
  17 |         error: "invalid_client",
  18 |         error_description: "Valid client certificate required for authenticated calls",
  19 |       };
  20 |     }
  21 | 
- 22 |     const expectedFingerprint = authUsersRepository.getFingerprintByUsername(username);
- 23 |     const mappedUser = authUsersRepository.getUsernameByFingerprint(fingerprint);
  24 | 
- 25 |     if (!expectedFingerprint || !mappedUser) {
- 26 |       setResponseStatus(event, 401);
- 27 |       return {
  28 |         error: "invalid_client",
  29 |         error_description: "No certificate association found for user. Acquire a token with mTLS first.",
  30 |       };
  31 |     }
  32 | 
- 33 |     if (expectedFingerprint !== fingerprint || mappedUser !== username) {
- 34 |       setResponseStatus(event, 401);
- 35 |       return {
  36 |         error: "invalid_client",
  37 |         error_description: "Authenticated user certificate mismatch",
  38 |       };
```
