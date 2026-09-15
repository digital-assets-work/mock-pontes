# src/routes/bridge-payments.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 86.21% (25/29) | `█████████░` |
| Branches | 50.00% (5/10) | `█████░░░░░` |
| Functions | 75.00% (3/4) | `████████░░` |
| Lines | 86.21% (25/29) | `█████████░` |

**Uncovered lines:** 59, 61-62, 94

**Partial branches:** L60 (if), L80 (binary-expr), L82 (binary-expr), L87 (cond-expr), L90 (if)

**Never called:** `(anonymous_3)` (L59)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   56 |         ["debitedCashWalletAlias", debitedCashWalletAlias],
   57 |       ]
   58 |         .filter(([, v]) => !v)
-  59 |         .map(([k]) => k);
!  60 |       if (missing.length > 0) {
-  61 |         setResponseStatus(event, 400);
-  62 |         return {
   63 |           businessErrors: [
   64 |             { errorCode: "HL-VAL-001", errorDescription: `Missing required fields: ${missing.join(", ")}` },
   65 |           ],
  ⋮
   77 |       try {
   78 |         workflow.execute(
   79 |           {
!  80 |             id: paymentID || randomUUID(),
   81 |             amount,
!  82 |             currency: currency || "EUR",
   83 |             creditedWalletAlias: creditedCashWalletAlias,
   84 |             debitedWalletAlias: debitedCashWalletAlias,
   85 |             supplementaryData,
   86 |           },
!  87 |           { caller: callerEntity ? { entityBIC: callerEntity } : undefined },
   88 |         );
   89 |       } catch (e) {
!  90 |         if (isWorkflowRejection(e)) {
   91 |           setResponseStatus(event, e.statusCode);
   92 |           return { businessErrors: e.businessErrors };
   93 |         }
-  94 |         throw e;
   95 |       }
   96 | 
   97 |       // The official 200 response is a JSON string (spec: application/json,
```
