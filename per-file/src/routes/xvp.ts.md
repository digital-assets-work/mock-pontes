# src/routes/xvp.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 85.42% (82/96) | `█████████░` |
| Branches | 75.00% (66/88) | `████████░░` |
| Functions | 100.00% (10/10) | `██████████` |
| Lines | 86.81% (79/91) | `█████████░` |

**Uncovered lines:** 97, 147, 164-165, 193-194, 219-220, 255-256, 336-337

**Partial branches:** L20 (if), L49 (binary-expr), L58 (binary-expr), L93 (if), L112 (binary-expr), L161 (binary-expr), L162 (binary-expr), L163 (if), L189 (binary-expr), L190 (binary-expr), L191 (cond-expr), L192 (if), L218 (if), L252 (binary-expr), L253 (binary-expr), L254 (if), L283 (cond-expr), L335 (if), L347 (cond-expr), L354 (binary-expr)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   17 | 
   18 | /** Legacy direct-RTGS XvP init only (see note on the handler registration below). */
   19 | function ensureWallet(store: MockStore, alias: string, ownerEntityID?: string): void {
!  20 |   if (!alias || store.getWallet(alias)) return;
   21 |   store.ensureWallet(alias, { ownerEntityID, ownerBIC: ownerEntityID });
   22 |   console.log(`[mock-pontes] Auto-created wallet ${alias}`);
   23 | }
  ⋮
   46 |         {
   47 |           errorCode: "HL-WAL-007",
   48 |           errorDescription:
!  49 |             `No cash wallet found for participant ${bic ?? "(unknown BIC)"}. Supply an explicit ` +
   50 |             `cashWalletAlias or create one first via POST /dlt/{ncb}/api/octopus/ams/wallets/one-step.`,
   51 |         },
   52 |       ],
  ⋮
   55 |   // Unknown alias, or one owned by a different participant (masked identically —
   56 |   // the caller does not learn that the alias belongs to someone else).
   57 |   return {
!  58 |     businessErrors: [{ errorCode: side === "Debit" ? "HL-WAL-002" : "HL-WAL-003", errorDescription: unknownWalletMessage(side, alias ?? "") }],
   59 |   };
   60 | }
   61 | 
  ⋮
   90 |   const workflow = new XvpWorkflow(store);
   91 | 
   92 |   function reject(event: H3Event, e: unknown): { businessErrors: unknown } {
!  93 |     if (isWorkflowRejection(e)) {
   94 |       setResponseStatus(event, e.statusCode);
   95 |       return { businessErrors: e.businessErrors };
   96 |     }
-  97 |     throw e;
   98 |   }
   99 | 
  100 |   /**
  ⋮
  109 |     body: Record<string, unknown>,
  110 |   ) {
  111 |     const xvpTransactionId = (body.xvpTransactionId as string) || randomUUID();
! 112 |     const transactionType = ((body.type as string) || (body.transactionType as string) || "DVP") as XvpTransactionType;
  113 |     try {
  114 |       const result = workflow.init({
  115 |         xvpTransactionId,
  ⋮
  144 |         status: result.status,
  145 |       };
  146 |     } catch (e) {
- 147 |       return reject(event, e);
  148 |     }
  149 |   }
  150 | 
  ⋮
  158 |     "/igw/:ncb/v1/xvps",
  159 |     defineEventHandler(async (event: H3Event) => {
  160 |       const body = await readBody(event);
! 161 |       const sellerBic = body.seller?.bic || body.sellerBIC;
! 162 |       const buyerBic = body.buyer?.bic || body.buyerBIC;
! 163 |       if (!body.amount || !body.currency || !sellerBic || !buyerBic) {
- 164 |         setResponseStatus(event, 400);
- 165 |         return {
  166 |           businessErrors: [
  167 |             { errorCode: "HL-VAL-001", errorDescription: "Missing required fields: amount, currency, seller.bic, buyer.bic" },
  168 |           ],
  ⋮
  186 |     "/igw/:ncb/v1/direct-rtgs/xvps",
  187 |     defineEventHandler(async (event: H3Event) => {
  188 |       const body = await readBody(event);
! 189 |       const sellerBic = body.seller?.bic || body.sellerBIC;
! 190 |       const buyerBic = body.buyer?.bic || body.buyerBIC;
! 191 |       const sellerWallet = body.seller?.cashWalletAlias || (sellerBic ? `${sellerBic}-XVP-CASH` : undefined);
! 192 |       if (!body.amount || !body.currency || !sellerWallet || !sellerBic || !buyerBic) {
- 193 |         setResponseStatus(event, 400);
- 194 |         return {
  195 |           businessErrors: [
  196 |             {
  197 |               errorCode: "HL-VAL-001",
  ⋮
  215 |     defineEventHandler(async (event) => {
  216 |       const id = getRouterParam(event, "id")!;
  217 |       const rec = await workflow.get(id);
! 218 |       if (!rec) {
- 219 |         setResponseStatus(event, 404);
- 220 |         return { businessErrors: [{ errorCode: "HL-XVP-002", errorDescription: `XvP transaction ${id} not found` }] };
  221 |       }
  222 |       return {
  223 |         xvpTransactionId: rec.id,
  ⋮
  249 |     defineEventHandler(async (event) => {
  250 |       const id = getRouterParam(event, "id")!;
  251 |       const body = await readBody(event);
! 252 |       const buyerBic = body.buyer?.bic || body.buyerBIC;
! 253 |       const sellerBic = body.seller?.bic || body.sellerBIC;
! 254 |       if (!buyerBic || !body.amount || !body.currency) {
- 255 |         setResponseStatus(event, 400);
- 256 |         return {
  257 |           businessErrors: [
  258 |             { errorCode: "HL-VAL-001", errorDescription: "Missing required fields: buyer.bic, amount, currency" },
  259 |           ],
  ⋮
  280 |           sellerBic,
  281 |           amount: body.amount,
  282 |           currency: body.currency,
! 283 |           caller: auth?.entityBIC ? { entityBIC: auth.entityBIC } : undefined,
  284 |         });
  285 |         // Per PaymentResponse: executionKey is returned (to the buyer) on SETTLED.
  286 |         return {
  ⋮
  332 |       }
  333 |       const requested = rawKey;
  334 |       const rec = await workflow.get(id);
! 335 |       if (!rec) {
- 336 |         setResponseStatus(event, 404);
- 337 |         return { businessErrors: [{ errorCode: "HL-XVP-002", errorDescription: `XvP transaction ${id} not found` }] };
  338 |       }
  339 |       // `rec.status` already reflects a first-observation EXPIRED transition
  340 |       // (see `workflow.get()`/`maybeExpire()`) — no separate timeout check
  ⋮
  344 |       // payment on timeout to release the seller's cancellation key).
  345 |       const status =
  346 |         rec.status === "SETTLED"
! 347 |           ? "SETTLED"
  348 |           : rec.status === "INITIALIZED"
  349 |             ? "PENDING"
  350 |             : rec.paymentAttempted
  351 |               ? "UNSETTLED"
  352 |               : "BURNED";
  353 |       const keys: { executionKey?: string; cancellationKey?: string } = {};
! 354 |       if (status === "SETTLED" && requested !== "CANCELLATION") keys.executionKey = rec.executionKey;
  355 |       if ((status === "UNSETTLED" || status === "BURNED") && requested !== "EXECUTION")
  356 |         keys.cancellationKey = rec.cancellationKey;
  357 |       return {
```
