# src/routes/grs-entities.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 57.14% (8/14) | `██████░░░░` |
| Branches | 0.00% (0/2) | `░░░░░░░░░░` |
| Functions | 33.33% (1/3) | `███░░░░░░░` |
| Lines | 57.14% (8/14) | `██████░░░░` |

**Uncovered lines:** 18, 24-28, 33

**Never called:** `(anonymous_1)` (L18), `(anonymous_2)` (L24)

_Legend: `-` uncovered statement · `⋮` covered lines skipped · gutter: line number._

```diff
  15 |   // GET /dlt/:ncb/api/octopus/grs/entities — bare array (globalregistry.Entity[])
  16 |   router.get(
  17 |     "/dlt/:ncb/api/octopus/grs/entities",
- 18 |     defineEventHandler(() => listGrsEntities()),
  19 |   );
  20 | 
  21 |   // GET /dlt/:ncb/api/octopus/grs/entities/:entityid — by BIC (or draft id)
  22 |   router.get(
  23 |     "/dlt/:ncb/api/octopus/grs/entities/:entityid",
- 24 |     defineEventHandler((event) => {
- 25 |       const entityid = getRouterParam(event, "entityid")!;
- 26 |       const entity = getGrsEntity(entityid);
- 27 |       if (!entity) {
- 28 |         throw createError({
  29 |           statusCode: 404,
  30 |           data: { businessErrors: [{ errorDescription: `Entity ${entityid} not found` }] },
  31 |         });
  32 |       }
- 33 |       return entity;
  34 |     }),
  35 |   );
  36 | 
```
