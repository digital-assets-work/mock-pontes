# src/admin/reset.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 60.00% (6/10) | `██████░░░░` |
| Branches | 0.00% (0/2) | `░░░░░░░░░░` |
| Functions | 50.00% (1/2) | `█████░░░░░` |
| Lines | 66.67% (6/9) | `███████░░░` |

**Uncovered lines:** 11-14

**Never called:** `(anonymous_1)` (L11)

_Legend: `-` uncovered statement · `⋮` covered lines skipped · gutter: line number._

```diff
   8 |   // POST /admin/reset — Reset mock state (admin-token gated, #35)
   9 |   router.post(
  10 |     "/admin/reset",
- 11 |     defineEventHandler((event) => {
- 12 |       if (!enforceAdminToken(event)) return adminUnauthorizedBody();
- 13 |       store.reset();
- 14 |       return { ok: true, message: "Mock state has been reset" };
  15 |     }),
  16 |   );
  17 | 
```
