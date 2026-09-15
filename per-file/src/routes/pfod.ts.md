# src/routes/pfod.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 70.73% (58/82) | `███████░░░` |
| Branches | 65.38% (34/52) | `███████░░░` |
| Functions | 90.00% (9/10) | `█████████░` |
| Lines | 71.79% (56/78) | `███████░░░` |

**Uncovered lines:** 48-52, 87-90, 93, 96-97, 114, 128-129, 134-135, 149, 160-161, 166-167, 182

**Partial branches:** L86 (if), L92 (if), L95 (if), L107 (cond-expr), L127 (if), L133 (if), L146 (if), L159 (if), L165 (if), L178 (if)

**Never called:** `reject` (L48)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   45 |     return JSON.stringify(message);
   46 |   }
   47 | 
-  48 |   function reject(event: H3Event, e: unknown): { businessErrors: unknown } {
-  49 |     if (isWorkflowRejection(e)) {
-  50 |       setResponseStatus(event, e.statusCode);
-  51 |       return { businessErrors: e.businessErrors };
-  52 |     }    throw e;
   53 |   }
   54 | 
   55 |   /** Persist a leg as a PENDING_MATCH draft. */
  ⋮
   83 |       return { tradeID, status: "PENDING_MATCH" };
   84 |     }
   85 |     const now = Date.now();
!  86 |     if (expired(deliver, now) || expired(receive, now)) {
-  87 |       if (expired(deliver, now)) store.updateDraft(deliver.id, { status: "EXPIRED" });
-  88 |       if (expired(receive, now)) store.updateDraft(receive.id, { status: "EXPIRED" });
-  89 |       setResponseStatus(event, 410);
-  90 |       return { tradeID, status: "EXPIRED" };
   91 |     }
!  92 |     if (deliver.status !== "PENDING_MATCH" || receive.status !== "PENDING_MATCH") {
-  93 |       return { tradeID, status: deliver.status === "SETTLED" ? "SETTLED" : deliver.status };
   94 |     }
!  95 |     if (deliver.amount !== receive.amount || deliver.currency !== receive.currency) {
-  96 |       setResponseStatus(event, 422);
-  97 |       return {
   98 |         businessErrors: [
   99 |           { errorCode: "HL-PFOD-001", errorDescription: `PFoD legs for trade ${tradeID} are inconsistent (amount/currency)` },
  100 |         ],
  ⋮
  104 |     const seller = deliver.debitedWalletAlias;
  105 |     const buyer = receive.creditedWalletAlias;
  106 |     const sellerWallet = store.getWallet(seller);
! 107 |     const caller = sellerWallet?.ownerEntityID ? { entityBIC: sellerWallet.ownerEntityID } : undefined;
  108 |     try {
  109 |       workflow.execute(
  110 |         { id: `PFOD-${tradeID}`, amount: deliver.amount, currency: deliver.currency, creditedWalletAlias: buyer, debitedWalletAlias: seller },
  111 |         { caller },
  112 |       );
  113 |     } catch (e) {
- 114 |       return reject(event, e);
  115 |     }
  116 |     store.updateDraft(deliver.id, { status: "SETTLED" });
  117 |     store.updateDraft(receive.id, { status: "SETTLED" });
  ⋮
  124 |     defineEventHandler(async (event) => {
  125 |       const body = await readBody(event);
  126 |       const { tradeID, amount, currency, sellerCashTokenWalletRef } = body;
! 127 |       if (!tradeID || !amount || !currency || !sellerCashTokenWalletRef) {
- 128 |         setResponseStatus(event, 400);
- 129 |         return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "Missing required fields: tradeID, amount, currency, sellerCashTokenWalletRef" }] };
  130 |       }
  131 |       // The seller cash wallet is the DEBIT side of the matched settlement and
  132 |       // must already exist (issue #93) — it is never auto-created.
! 133 |       if (!store.getWallet(sellerCashTokenWalletRef)) {
- 134 |         setResponseStatus(event, 422);
- 135 |         return { businessErrors: [{ errorCode: "HL-WAL-002", errorDescription: unknownWalletMessage("Debit", sellerCashTokenWalletRef) }] };
  136 |       }
  137 |       storeLeg(deliverId(tradeID), tradeID, amount, currency, sellerCashTokenWalletRef, "", (event.context.auth as AuthContext | undefined)?.userUUID);
  138 |       setResponseStatus(event, 201);
  ⋮
  143 |       // already arrived, expiry, amount/currency mismatch) are mock-only
  144 |       // extensions beyond the documented flow — preserve their existing
  145 |       // object shape for testability.
! 146 |       if (result.status === "PENDING_MATCH" && !("businessErrors" in result)) {
  147 |         return stringResponse(event, "PFoD DELI leg created successfully and awaiting corresponding RECE leg");
  148 |       }
- 149 |       return result;
  150 |     }),
  151 |   );
  152 | 
  ⋮
  156 |     defineEventHandler(async (event) => {
  157 |       const body = await readBody(event);
  158 |       const { tradeID, amount, currency, buyerCashTokenWalletRef } = body;
! 159 |       if (!tradeID || !amount || !currency || !buyerCashTokenWalletRef) {
- 160 |         setResponseStatus(event, 400);
- 161 |         return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "Missing required fields: tradeID, amount, currency, buyerCashTokenWalletRef" }] };
  162 |       }
  163 |       // The buyer cash wallet is the CREDIT side of the matched settlement and
  164 |       // must already exist (issue #93) — it is never auto-created.
! 165 |       if (!store.getWallet(buyerCashTokenWalletRef)) {
- 166 |         setResponseStatus(event, 422);
- 167 |         return { businessErrors: [{ errorCode: "HL-WAL-003", errorDescription: unknownWalletMessage("Credit", buyerCashTokenWalletRef) }] };
  168 |       }
  169 |       storeLeg(receiveId(tradeID), tradeID, amount, currency, "", buyerCashTokenWalletRef, (event.context.auth as AuthContext | undefined)?.userUUID);
  170 |       setResponseStatus(event, 201);
  ⋮
  175 |       // outcomes (still awaiting the DELI leg, expiry, mismatch) are
  176 |       // mock-only extensions beyond the documented flow — preserve their
  177 |       // existing object shape (and 201) for testability.
! 178 |       if (result.status === "SETTLED") {
  179 |         setResponseStatus(event, 200);
  180 |         return stringResponse(event, "PFoD RECE leg created an settled successfully");
  181 |       }
- 182 |       return result;
  183 |     }),
  184 |   );
  185 | 
```
