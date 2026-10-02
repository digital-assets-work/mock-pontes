# src/routes/pfod.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 74.74% (71/95) | `███████░░░` |
| Branches | 70.49% (43/61) | `███████░░░` |
| Functions | 90.00% (9/10) | `█████████░` |
| Lines | 75.82% (69/91) | `████████░░` |

**Uncovered lines:** 68-72, 107-110, 113, 116-117, 136, 150-151, 161-162, 176, 191-192, 202-203, 235

**Partial branches:** L106 (if), L112 (if), L115 (if), L129 (cond-expr), L149 (if), L160 (if), L173 (if), L190 (if), L201 (if), L231 (if)

**Never called:** `reject` (L68)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   65 |     return JSON.stringify(message);
   66 |   }
   67 | 
-  68 |   function reject(event: H3Event, e: unknown): { businessErrors: unknown } {
-  69 |     if (isWorkflowRejection(e)) {
-  70 |       setResponseStatus(event, e.statusCode);
-  71 |       return { businessErrors: e.businessErrors };
-  72 |     }    throw e;
   73 |   }
   74 | 
   75 |   /** Persist a leg as a PENDING_MATCH draft. */
  ⋮
  103 |       return { tradeID, status: "PENDING_MATCH" };
  104 |     }
  105 |     const now = Date.now();
! 106 |     if (expired(deliver, now) || expired(receive, now)) {
- 107 |       if (expired(deliver, now)) store.updateDraft(deliver.id, { status: "EXPIRED" });
- 108 |       if (expired(receive, now)) store.updateDraft(receive.id, { status: "EXPIRED" });
- 109 |       setResponseStatus(event, 410);
- 110 |       return { tradeID, status: "EXPIRED" };
  111 |     }
! 112 |     if (deliver.status !== "PENDING_MATCH" || receive.status !== "PENDING_MATCH") {
- 113 |       return { tradeID, status: deliver.status === "SETTLED" ? "SETTLED" : deliver.status };
  114 |     }
! 115 |     if (deliver.amount !== receive.amount || deliver.currency !== receive.currency) {
- 116 |       setResponseStatus(event, 422);
- 117 |       return {
  118 |         businessErrors: [
  119 |           { errorCode: "HL-PFOD-001", errorDescription: `PFoD legs for trade ${tradeID} are inconsistent (amount/currency)` },
  120 |         ],
  ⋮
  126 |     const deliverWallet = deliver.debitedWalletAlias;
  127 |     const receiveWallet = receive.creditedWalletAlias;
  128 |     const debitedWallet = store.getWallet(receiveWallet);
! 129 |     const caller = debitedWallet?.ownerEntityID ? { entityBIC: debitedWallet.ownerEntityID } : undefined;
  130 |     try {
  131 |       workflow.execute(
  132 |         { id: `PFOD-${tradeID}`, amount: deliver.amount, currency: deliver.currency, creditedWalletAlias: deliverWallet, debitedWalletAlias: receiveWallet },
  133 |         { caller },
  134 |       );
  135 |     } catch (e) {
- 136 |       return reject(event, e);
  137 |     }
  138 |     store.updateDraft(deliver.id, { status: "SETTLED" });
  139 |     store.updateDraft(receive.id, { status: "SETTLED" });
  ⋮
  146 |     defineEventHandler(async (event) => {
  147 |       const body = await readBody(event);
  148 |       const { tradeID, amount, currency, sellerCashTokenWalletRef, supplementaryData } = body;
! 149 |       if (!tradeID || !amount || !currency || !sellerCashTokenWalletRef) {
- 150 |         setResponseStatus(event, 400);
- 151 |         return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "Missing required fields: tradeID, amount, currency, sellerCashTokenWalletRef" }] };
  152 |       }
  153 |       const suppErr = supplementaryDataError(supplementaryData);
  154 |       if (suppErr) {
  ⋮
  157 |       }
  158 |       // The seller cash wallet is the DEBIT side of the matched settlement and
  159 |       // must already exist (issue #93) — it is never auto-created.
! 160 |       if (!store.getWallet(sellerCashTokenWalletRef)) {
- 161 |         setResponseStatus(event, 422);
- 162 |         return { businessErrors: [{ errorCode: "HL-WAL-002", errorDescription: unknownWalletMessage("Debit", sellerCashTokenWalletRef) }] };
  163 |       }
  164 |       storeLeg(deliverId(tradeID), tradeID, amount, currency, sellerCashTokenWalletRef, "", (event.context.auth as AuthContext | undefined)?.userUUID);
  165 |       setResponseStatus(event, 201);
  ⋮
  170 |       // already arrived, expiry, amount/currency mismatch) are mock-only
  171 |       // extensions beyond the documented flow — preserve their existing
  172 |       // object shape for testability.
! 173 |       if (result.status === "PENDING_MATCH" && !("businessErrors" in result)) {
  174 |         return stringResponse(event, "PFoD DELI leg created successfully and awaiting corresponding RECE leg");
  175 |       }
- 176 |       return result;
  177 |     }),
  178 |   );
  179 | 
  ⋮
  187 |       // — already enforced end-to-end by the global ajv request-validation
  188 |       // middleware (`bridge.PFoDReceRequest.required`), but duplicated here
  189 |       // for defense-in-depth, consistent with the other required fields below.
! 190 |       if (!tradeID || !amount || !currency || !buyerCashTokenWalletRef || !sellerCAMBIC) {
- 191 |         setResponseStatus(event, 400);
- 192 |         return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "Missing required fields: tradeID, amount, currency, buyerCashTokenWalletRef, sellerCAMBIC" }] };
  193 |       }
  194 |       const suppErr = supplementaryDataError(supplementaryData);
  195 |       if (suppErr) {
  ⋮
  198 |       }
  199 |       // The buyer cash wallet is the CREDIT side of the matched settlement and
  200 |       // must already exist (issue #93) — it is never auto-created.
! 201 |       if (!store.getWallet(buyerCashTokenWalletRef)) {
- 202 |         setResponseStatus(event, 422);
- 203 |         return { businessErrors: [{ errorCode: "HL-WAL-003", errorDescription: unknownWalletMessage("Credit", buyerCashTokenWalletRef) }] };
  204 |       }
  205 |       // Confirmed real-Pontes behavior (issue #137): submitting RECE before a
  206 |       // matching DELI leg exists is a hard backend failure (a generic 500
  ⋮
  228 |       // outcomes (still awaiting the DELI leg, expiry, mismatch) are
  229 |       // mock-only extensions beyond the documented flow — preserve their
  230 |       // existing object shape (and 201) for testability.
! 231 |       if (result.status === "SETTLED") {
  232 |         setResponseStatus(event, 200);
  233 |         return stringResponse(event, "PFoD RECE leg created an settled successfully");
  234 |       }
- 235 |       return result;
  236 |     }),
  237 |   );
  238 | 
```
