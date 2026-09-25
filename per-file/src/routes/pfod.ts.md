# src/routes/pfod.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 73.63% (67/91) | `███████░░░` |
| Branches | 67.86% (38/56) | `███████░░░` |
| Functions | 90.00% (9/10) | `█████████░` |
| Lines | 74.71% (65/87) | `███████░░░` |

**Uncovered lines:** 58-62, 97-100, 103, 106-107, 124, 138-139, 149-150, 164, 175-176, 186-187, 202

**Partial branches:** L96 (if), L102 (if), L105 (if), L117 (cond-expr), L137 (if), L148 (if), L161 (if), L174 (if), L185 (if), L198 (if)

**Never called:** `reject` (L58)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   55 |     return JSON.stringify(message);
   56 |   }
   57 | 
-  58 |   function reject(event: H3Event, e: unknown): { businessErrors: unknown } {
-  59 |     if (isWorkflowRejection(e)) {
-  60 |       setResponseStatus(event, e.statusCode);
-  61 |       return { businessErrors: e.businessErrors };
-  62 |     }    throw e;
   63 |   }
   64 | 
   65 |   /** Persist a leg as a PENDING_MATCH draft. */
  ⋮
   93 |       return { tradeID, status: "PENDING_MATCH" };
   94 |     }
   95 |     const now = Date.now();
!  96 |     if (expired(deliver, now) || expired(receive, now)) {
-  97 |       if (expired(deliver, now)) store.updateDraft(deliver.id, { status: "EXPIRED" });
-  98 |       if (expired(receive, now)) store.updateDraft(receive.id, { status: "EXPIRED" });
-  99 |       setResponseStatus(event, 410);
- 100 |       return { tradeID, status: "EXPIRED" };
  101 |     }
! 102 |     if (deliver.status !== "PENDING_MATCH" || receive.status !== "PENDING_MATCH") {
- 103 |       return { tradeID, status: deliver.status === "SETTLED" ? "SETTLED" : deliver.status };
  104 |     }
! 105 |     if (deliver.amount !== receive.amount || deliver.currency !== receive.currency) {
- 106 |       setResponseStatus(event, 422);
- 107 |       return {
  108 |         businessErrors: [
  109 |           { errorCode: "HL-PFOD-001", errorDescription: `PFoD legs for trade ${tradeID} are inconsistent (amount/currency)` },
  110 |         ],
  ⋮
  114 |     const seller = deliver.debitedWalletAlias;
  115 |     const buyer = receive.creditedWalletAlias;
  116 |     const sellerWallet = store.getWallet(seller);
! 117 |     const caller = sellerWallet?.ownerEntityID ? { entityBIC: sellerWallet.ownerEntityID } : undefined;
  118 |     try {
  119 |       workflow.execute(
  120 |         { id: `PFOD-${tradeID}`, amount: deliver.amount, currency: deliver.currency, creditedWalletAlias: buyer, debitedWalletAlias: seller },
  121 |         { caller },
  122 |       );
  123 |     } catch (e) {
- 124 |       return reject(event, e);
  125 |     }
  126 |     store.updateDraft(deliver.id, { status: "SETTLED" });
  127 |     store.updateDraft(receive.id, { status: "SETTLED" });
  ⋮
  134 |     defineEventHandler(async (event) => {
  135 |       const body = await readBody(event);
  136 |       const { tradeID, amount, currency, sellerCashTokenWalletRef, supplementaryData } = body;
! 137 |       if (!tradeID || !amount || !currency || !sellerCashTokenWalletRef) {
- 138 |         setResponseStatus(event, 400);
- 139 |         return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "Missing required fields: tradeID, amount, currency, sellerCashTokenWalletRef" }] };
  140 |       }
  141 |       const suppErr = supplementaryDataError(supplementaryData);
  142 |       if (suppErr) {
  ⋮
  145 |       }
  146 |       // The seller cash wallet is the DEBIT side of the matched settlement and
  147 |       // must already exist (issue #93) — it is never auto-created.
! 148 |       if (!store.getWallet(sellerCashTokenWalletRef)) {
- 149 |         setResponseStatus(event, 422);
- 150 |         return { businessErrors: [{ errorCode: "HL-WAL-002", errorDescription: unknownWalletMessage("Debit", sellerCashTokenWalletRef) }] };
  151 |       }
  152 |       storeLeg(deliverId(tradeID), tradeID, amount, currency, sellerCashTokenWalletRef, "", (event.context.auth as AuthContext | undefined)?.userUUID);
  153 |       setResponseStatus(event, 201);
  ⋮
  158 |       // already arrived, expiry, amount/currency mismatch) are mock-only
  159 |       // extensions beyond the documented flow — preserve their existing
  160 |       // object shape for testability.
! 161 |       if (result.status === "PENDING_MATCH" && !("businessErrors" in result)) {
  162 |         return stringResponse(event, "PFoD DELI leg created successfully and awaiting corresponding RECE leg");
  163 |       }
- 164 |       return result;
  165 |     }),
  166 |   );
  167 | 
  ⋮
  171 |     defineEventHandler(async (event) => {
  172 |       const body = await readBody(event);
  173 |       const { tradeID, amount, currency, buyerCashTokenWalletRef, supplementaryData } = body;
! 174 |       if (!tradeID || !amount || !currency || !buyerCashTokenWalletRef) {
- 175 |         setResponseStatus(event, 400);
- 176 |         return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "Missing required fields: tradeID, amount, currency, buyerCashTokenWalletRef" }] };
  177 |       }
  178 |       const suppErr = supplementaryDataError(supplementaryData);
  179 |       if (suppErr) {
  ⋮
  182 |       }
  183 |       // The buyer cash wallet is the CREDIT side of the matched settlement and
  184 |       // must already exist (issue #93) — it is never auto-created.
! 185 |       if (!store.getWallet(buyerCashTokenWalletRef)) {
- 186 |         setResponseStatus(event, 422);
- 187 |         return { businessErrors: [{ errorCode: "HL-WAL-003", errorDescription: unknownWalletMessage("Credit", buyerCashTokenWalletRef) }] };
  188 |       }
  189 |       storeLeg(receiveId(tradeID), tradeID, amount, currency, "", buyerCashTokenWalletRef, (event.context.auth as AuthContext | undefined)?.userUUID);
  190 |       setResponseStatus(event, 201);
  ⋮
  195 |       // outcomes (still awaiting the DELI leg, expiry, mismatch) are
  196 |       // mock-only extensions beyond the documented flow — preserve their
  197 |       // existing object shape (and 201) for testability.
! 198 |       if (result.status === "SETTLED") {
  199 |         setResponseStatus(event, 200);
  200 |         return stringResponse(event, "PFoD RECE leg created an settled successfully");
  201 |       }
- 202 |       return result;
  203 |     }),
  204 |   );
  205 | 
```
