# src/routes/business-window.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 62.50% (10/16) | `██████░░░░` |
| Branches | 100.00% (0/0) | `██████████` |
| Functions | 20.00% (1/5) | `██░░░░░░░░` |
| Lines | 62.50% (10/16) | `██████░░░░` |

**Uncovered lines:** 15-17, 29-31, 44-45, 56

**Never called:** `(anonymous_1)` (L15), `(anonymous_2)` (L29), `(anonymous_3)` (L44), `(anonymous_4)` (L56)

_Legend: `-` uncovered statement · `⋮` covered lines skipped · gutter: line number._

```diff
  12 |   // time (issues #59, #81).
  13 |   router.get(
  14 |     "/dlt/:ncb/api/bridge/current-business-window",
- 15 |     defineEventHandler(() => {
- 16 |       const cw = currentWindow(store.getBusinessDay());
- 17 |       return {
  18 |         windowName: cw.displayName,
  19 |         startTime: cw.startTime,
  20 |         endTime: cw.endTime,
  ⋮
  26 |   // Response schema: globalregistry.GetCurrentBusinessWindow { windowName, startTime, endTime, nextWindowName }
  27 |   router.get(
  28 |     "/dlt/:ncb/api/octopus/grs/current-business-window",
- 29 |     defineEventHandler(() => {
- 30 |       const cw = currentWindow(store.getBusinessDay());
- 31 |       return {
  32 |         windowName: cw.displayName,
  33 |         startTime: cw.startTime,
  34 |         endTime: cw.endTime,
  ⋮
  41 |   // Response schema: globalregistry.BusinessDate { businessDate, updateBDStatus }
  42 |   router.get(
  43 |     "/dlt/:ncb/api/octopus/grs/businessdate",
- 44 |     defineEventHandler(() => {
- 45 |       return {
  46 |         businessDate: store.getBusinessDay().businessDate,
  47 |         updateBDStatus: "UPDATE_NOT_ALLOWED",
  48 |       };
  ⋮
  53 |   // Response schema: globalregistry.BusinessWindow[] { windowID, nextWindowID, name, startTime, authorizedRoles }
  54 |   router.get(
  55 |     "/dlt/:ncb/api/octopus/grs/business-windows",
- 56 |     defineEventHandler(() => businessWindows(store.getBusinessDay())),
  57 |   );
  58 | 
  59 |   return router;
```
