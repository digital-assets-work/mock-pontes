# src/version.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 77.78% (7/9) | `████████░░` |
| Branches | 54.55% (6/11) | `█████░░░░░` |
| Functions | 50.00% (1/2) | `█████░░░░░` |
| Lines | 75.00% (6/8) | `████████░░` |

**Uncovered lines:** 20-22

**Partial branches:** L16 (binary-expr)

**Never called:** `mockCommit` (L20)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
  13 | export function mockVersion(): string {
  14 |   const ref = process.env.PUBLIC_GIT_REF_NAME;
  15 |   if (ref && ref !== "no_ref_name") return ref.replace(/^v/, "");
! 16 |   return process.env.npm_package_version || (pkg as { version?: string }).version || "dev";
  17 | }
  18 | 
  19 | /** Short commit hash baked at build time, when available. */
- 20 | export function mockCommit(): string | undefined {
- 21 |   const c = process.env.PUBLIC_COMMIT_HASH;
- 22 |   return c && c !== "no_commit_hash" ? c.slice(0, 7) : undefined;
  23 | }
  24 | 
```
