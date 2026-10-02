# src/auth/jwt-middleware.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 93.33% (42/45) | `█████████░` |
| Branches | 80.65% (25/31) | `████████░░` |
| Functions | 100.00% (7/7) | `██████████` |
| Lines | 95.00% (38/40) | `██████████` |

**Uncovered lines:** 136-137

**Partial branches:** L45 (cond-expr), L49 (if), L63 (binary-expr), L108 (binary-expr), L141 (cond-expr), L142 (cond-expr)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   42 |     .split(",")
   43 |     .map((v) => v.trim())
   44 |     .filter(Boolean);
!  45 |   return parsed.length > 0 ? parsed : DEFAULT_JWT_AUDIENCE_ALLOWLIST;
   46 | }
   47 | 
   48 | function shouldApplyAuth(path: string, protectedPrefixes: readonly string[]): boolean {
!  49 |   if (protectedPrefixes.length === 0) return true;
   50 |   return protectedPrefixes.some((prefix) => path.startsWith(prefix));
   51 | }
   52 | 
  ⋮
   60 |   jwtPublicKeyPem: string,
   61 | ) {
   62 |   return defineEventHandler(async (event: H3Event) => {
!  63 |     const path = event.path || "";
   64 | 
   65 |     if (!shouldApplyAuth(path, protectedPrefixes)) return;
   66 | 
  ⋮
  105 | 
  106 |       // Attach auth context for downstream handlers
  107 |       event.context.auth = {
! 108 |         userUUID: decoded.user_uuid || decoded.sub,
  109 |         username: decoded.preferred_username,
  110 |         profile: decoded.user_profile,
  111 |         entityBIC: decoded.entity_bic,
  ⋮
  133 |         };
  134 |       }
  135 |     } catch (err: any) {
- 136 |       setResponseStatus(event, 401);
- 137 |       return {
  138 |         error: "invalid_token",
  139 |         error_description:
  140 |           err.name === "TokenExpiredError"
! 141 |             ? "Token has expired"
! 142 |             : `Invalid token: ${err.message}`,
  143 |       };
  144 |     }
  145 |   });
```
