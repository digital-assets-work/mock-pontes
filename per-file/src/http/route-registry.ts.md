# src/http/route-registry.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 95.65% (22/23) | `██████████` |
| Branches | 100.00% (7/7) | `██████████` |
| Functions | 87.50% (7/8) | `█████████░` |
| Lines | 95.45% (21/22) | `██████████` |

**Uncovered lines:** 26-27

**Never called:** `getRegisteredRoutes` (L26)

_Legend: `-` uncovered statement · `⋮` covered lines skipped · gutter: line number._

```diff
  23 |   routes.push({ method: method.toUpperCase(), path });
  24 | }
  25 | 
- 26 | export function getRegisteredRoutes(): RouteEntry[] {
- 27 |   return [...routes];
  28 | }
  29 | 
  30 | /**
```
