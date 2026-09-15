# src/auth/profile-authorization-middleware.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 75.00% (18/24) | `████████░░` |
| Branches | 71.43% (10/14) | `███████░░░` |
| Functions | 80.00% (4/5) | `████████░░` |
| Lines | 76.19% (16/21) | `████████░░` |

**Uncovered lines:** 43-44, 72-73, 80-81

**Partial branches:** L60 (binary-expr), L65 (if), L71 (if), L79 (if)

**Never called:** `createAuthorizationError` (L43)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
  40 |   return patterns.some((p) => p.test(path));
  41 | }
  42 | 
- 43 | function createAuthorizationError(profile: string, requiredProfiles: Set<string>) {
- 44 |   return {
  45 |     businessErrors: [
  46 |       {
  47 |         errorCode: "HL-AUTH-001",
  ⋮
  57 |  */
  58 | export function createProfileAuthorizationMiddleware() {
  59 |   return defineEventHandler((event: H3Event) => {
! 60 |     const path = event.path || "";
  61 |     // Only apply to /dlt/ routes (same scope as JWT middleware)
  62 |     if (!path.startsWith("/dlt")) return;
  63 | 
  64 |     const auth = event.context.auth as { profile?: string } | undefined;
! 65 |     if (!auth?.profile) return; // No auth context → JWT middleware already handled it
  66 | 
  67 |     const profile = auth.profile;
  68 | 
  69 |     // Check 1-step bridge routes (POST only for payments)
  70 |     if (matchesAny(path, BRIDGE_1STEP_PATTERNS)) {
! 71 |       if (!BRIDGE_1STEP_PROFILES.has(profile)) {
- 72 |         setResponseStatus(event, 403);
- 73 |         return createAuthorizationError(profile, BRIDGE_1STEP_PROFILES);
  74 |       }
  75 |     }
  76 | 
  77 |     // Check 2-step draft/approve/funding/defunding routes (POST/PUT write operations)
  78 |     if (matchesAny(path, DRAFT_APPROVE_PATTERNS)) {
! 79 |       if (!DRAFT_APPROVE_PROFILES.has(profile)) {
- 80 |         setResponseStatus(event, 403);
- 81 |         return createAuthorizationError(profile, DRAFT_APPROVE_PROFILES);
  82 |       }
  83 |     }
  84 |   });
```
