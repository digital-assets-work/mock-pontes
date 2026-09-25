# src/cache/common.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 33.33% (1/3) | `███░░░░░░░` |
| Branches | 100.00% (0/0) | `██████████` |
| Functions | 0.00% (0/1) | `░░░░░░░░░░` |
| Lines | 33.33% (1/3) | `███░░░░░░░` |

**Uncovered lines:** 24-25, 29

**Never called:** `fatalPersistError` (L24)

_Legend: `-` uncovered statement · `⋮` covered lines skipped · gutter: line number._

```diff
  21 |  * connection, rather than continuing to serve state that was never persisted.
  22 |  * Injected into the store/repositories so tests can substitute a spy.
  23 |  */
- 24 | export function fatalPersistError(err: unknown): void {
- 25 |   console.error(
  26 |     "[mock-pontes] FATAL: Redis persistence failed after reconnect/retry; stopping so the orchestrator can relaunch.",
  27 |     err,
  28 |   );
- 29 |   process.exit(1);
  30 | }
  31 | 
  32 | 
```
