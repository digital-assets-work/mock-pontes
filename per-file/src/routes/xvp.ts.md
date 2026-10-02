# src/routes/xvp.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 84.29% (59/70) | `████████░░` |
| Branches | 62.69% (42/67) | `██████░░░░` |
| Functions | 100.00% (7/7) | `██████████` |
| Lines | 85.29% (58/68) | `█████████░` |

**Uncovered lines:** 40, 61-62, 108, 122-123, 153-154, 196-197

**Partial branches:** L36 (if), L46 (binary-expr), L47 (binary-expr), L52 (binary-expr), L53 (binary-expr), L54 (cond-expr), L58 (binary-expr), L60 (if), L121 (if), L147 (binary-expr), L148 (binary-expr), L151 (binary-expr), L152 (if), L167 (cond-expr), L195 (if), L199 (binary-expr), L206 (cond-expr), L208 (cond-expr), L213 (binary-expr), L214 (if)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   33 |   const workflow = new XvpWorkflow(store);
   34 | 
   35 |   function reject(event: H3Event, e: unknown): { businessErrors: unknown } {
!  36 |     if (isWorkflowRejection(e)) {
   37 |       setResponseStatus(event, e.statusCode);
   38 |       return { businessErrors: e.businessErrors };
   39 |     }
-  40 |     throw e;
   41 |   }
   42 | 
   43 |   const initHandler = defineEventHandler(async (event: H3Event) => {
   44 |     const body = await readBody(event);
   45 | 
!  46 |     const sellerBic = body.seller?.bic || body.sellerBIC;
!  47 |     const buyerBic = body.buyer?.bic || body.buyerBIC;
   48 |     // The seller names the wallet where they want to be PAID. The buyer is
   49 |     // identified by BIC only at init — their wallet is named at payment.
   50 |     const sellerWallet =
   51 |       body.seller?.cashWalletAlias ||
!  52 |       body.sellerCashWalletRef ||
!  53 |       body.seller?.cashWalletRef ||
!  54 |       (sellerBic ? `${sellerBic}-XVP-CASH` : undefined);
   55 |     // Spec: xvpTransactionId is a UUID (format:uuid); server-generated. A
   56 |     // client-supplied id is tolerated.
   57 |     const xvpTransactionId = body.xvpTransactionId || randomUUID();
!  58 |     const transactionType = (body.type || body.transactionType || "DVP") as XvpTransactionType;
   59 | 
!  60 |     if (!body.amount || !body.currency || !sellerWallet || !sellerBic || !buyerBic) {
-  61 |       setResponseStatus(event, 400);
-  62 |       return {
   63 |         businessErrors: [
   64 |           {
   65 |             errorCode: "HL-VAL-001",
  ⋮
  105 |         cancellationKey: result.cancellationKey,
  106 |       };
  107 |     } catch (e) {
- 108 |       return reject(event, e);
  109 |     }
  110 |   });
  111 | 
  ⋮
  118 |     defineEventHandler((event) => {
  119 |       const id = getRouterParam(event, "id")!;
  120 |       const rec = workflow.get(id);
! 121 |       if (!rec) {
- 122 |         setResponseStatus(event, 404);
- 123 |         return { businessErrors: [{ errorCode: "HL-XVP-002", errorDescription: `XvP transaction ${id} not found` }] };
  124 |       }
  125 |       return {
  126 |         xvpTransactionId: rec.id,
  ⋮
  144 |     defineEventHandler(async (event) => {
  145 |       const id = getRouterParam(event, "id")!;
  146 |       const body = await readBody(event);
! 147 |       const buyerBic = body.buyer?.bic || body.buyerBIC;
! 148 |       const sellerBic = body.seller?.bic || body.sellerBIC;
  149 |       // The buyer names the wallet to be DEBITED (spec PaymentRequest.buyer).
  150 |       const buyerWallet =
! 151 |         body.buyer?.cashWalletAlias || body.buyerCashWalletRef || body.buyer?.cashWalletRef;
! 152 |       if (!buyerWallet || !body.amount || !body.currency) {
- 153 |         setResponseStatus(event, 400);
- 154 |         return {
  155 |           businessErrors: [
  156 |             { errorCode: "HL-VAL-001", errorDescription: "Missing required fields: buyer.cashWalletAlias, amount, currency" },
  157 |           ],
  ⋮
  164 |           sellerBic,
  165 |           amount: body.amount,
  166 |           currency: body.currency,
! 167 |           caller: buyerBic ? { entityBIC: buyerBic } : undefined,
  168 |         });
  169 |         // Per PaymentResponse: executionKey is returned (to the buyer) on SETTLED.
  170 |         return {
  ⋮
  192 |     defineEventHandler((event) => {
  193 |       const id = getRouterParam(event, "id")!;
  194 |       const rec = workflow.get(id);
! 195 |       if (!rec) {
- 196 |         setResponseStatus(event, 404);
- 197 |         return { businessErrors: [{ errorCode: "HL-XVP-002", errorDescription: `XvP transaction ${id} not found` }] };
  198 |       }
! 199 |       const requested = String(getQuery(event).key || "").toUpperCase();
  200 |       const timedOut = !!rec.timeout && Date.parse(rec.timeout) < Date.now();
  201 |       // Terminal-but-unsettled state: a payment that was attempted → UNSETTLED;
  202 |       // a timeout with no payment ever attempted → BURNED (the spec burns the
  203 |       // payment on timeout to release the seller's cancellation key).
  204 |       const status =
  205 |         rec.status === "SETTLED"
! 206 |           ? "SETTLED"
  207 |           : rec.status === "INITIALIZED" && !timedOut
! 208 |             ? "PENDING"
  209 |             : rec.paymentAttempted
  210 |               ? "UNSETTLED"
  211 |               : "BURNED";
  212 |       const keys: { executionKey?: string; cancellationKey?: string } = {};
! 213 |       if (status === "SETTLED" && requested !== "CANCELLATION") keys.executionKey = rec.executionKey;
! 214 |       if ((status === "UNSETTLED" || status === "BURNED") && requested !== "EXECUTION")
  215 |         keys.cancellationKey = rec.cancellationKey;
  216 |       return {
  217 |         xvpTransactionId: rec.id,
```
