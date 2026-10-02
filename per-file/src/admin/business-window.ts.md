# src/admin/business-window.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 43.48% (10/23) | `████░░░░░░` |
| Branches | 0.00% (0/6) | `░░░░░░░░░░` |
| Functions | 25.00% (1/4) | `███░░░░░░░` |
| Lines | 45.45% (10/22) | `█████░░░░░` |

**Uncovered lines:** 16-19, 38, 45-51, 53-54

**Never called:** `businessWindowView` (L16), `(anonymous_2)` (L38), `(anonymous_3)` (L45)

_Legend: `-` uncovered statement · `⋮` covered lines skipped · gutter: line number._

```diff
  13 | } from "../state/business-window.js";
  14 | 
  15 | /** Build the GET view: the stored day fields + the live, computed window. */
- 16 | function businessWindowView(store: MockStore) {
- 17 |   const day = store.getBusinessDay();
- 18 |   const cw = currentWindow(day);
- 19 |   return {
  20 |     ...day,
  21 |     // Live, derived-from-Frankfurt-time view (issue #81) — the panel and the
  22 |     // official API therefore always agree.
  ⋮
  35 |   // GET /admin/business-window — Get business day + current window (unauthenticated, #35).
  36 |   router.get(
  37 |     "/admin/business-window",
- 38 |     defineEventHandler(() => businessWindowView(store)),
  39 |   );
  40 | 
  41 |   // POST/PUT /admin/business-window — Update the business day (admin-token gated, #35).
  42 |   // Accepts a sub-list of the day fields (businessDate, sodStart, ofaStart,
  43 |   // ofaEnd, eodEnd); rejects unknown fields and requires the times to stay in
  44 |   // increasing order (issue #81).
- 45 |   const update = defineEventHandler(async (event) => {
- 46 |     if (!enforceAdminToken(event)) return adminUnauthorizedBody();
- 47 |     const body = await readBody(event);
- 48 |     const { update, error } = validateBusinessDayUpdate(body, store.getBusinessDay());
- 49 |     if (error || !update) {
- 50 |       setResponseStatus(event, 400);
- 51 |       return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: error }] };
  52 |     }
- 53 |     store.setBusinessDay(update);
- 54 |     return businessWindowView(store);
  55 |   });
  56 |   router.post("/admin/business-window", update);
  57 |   router.put("/admin/business-window", update);
```
