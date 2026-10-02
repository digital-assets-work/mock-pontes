# src/routes/bridge-payments.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 88.24% (30/34) | `█████████░` |
| Branches | 58.33% (7/12) | `██████░░░░` |
| Functions | 75.00% (3/4) | `████████░░` |
| Lines | 88.24% (30/34) | `█████████░` |

**Uncovered lines:** 68, 70-71, 112

**Partial branches:** L69 (if), L98 (binary-expr), L100 (binary-expr), L105 (cond-expr), L108 (if)

**Never called:** `(anonymous_3)` (L68)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   65 |         ["debitedCashWalletAlias", debitedCashWalletAlias],
   66 |       ]
   67 |         .filter(([, v]) => !v)
-  68 |         .map(([k]) => k);
!  69 |       if (missing.length > 0) {
-  70 |         setResponseStatus(event, 400);
-  71 |         return {
   72 |           businessErrors: [
   73 |             { errorCode: "HL-VAL-001", errorDescription: `Missing required fields: ${missing.join(", ")}` },
   74 |           ],
  ⋮
   95 |       try {
   96 |         workflow.execute(
   97 |           {
!  98 |             id: paymentID || randomUUID(),
   99 |             amount,
! 100 |             currency: currency || "EUR",
  101 |             creditedWalletAlias: creditedCashWalletAlias,
  102 |             debitedWalletAlias: debitedCashWalletAlias,
  103 |             supplementaryData,
  104 |           },
! 105 |           { caller: callerEntity ? { entityBIC: callerEntity } : undefined },
  106 |         );
  107 |       } catch (e) {
! 108 |         if (isWorkflowRejection(e)) {
  109 |           setResponseStatus(event, e.statusCode);
  110 |           return { businessErrors: e.businessErrors };
  111 |         }
- 112 |         throw e;
  113 |       }
  114 | 
  115 |       // The official 200 response is a JSON string (spec: application/json,
```
