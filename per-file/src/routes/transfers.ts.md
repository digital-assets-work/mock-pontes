# src/routes/transfers.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 90.67% (68/75) | `█████████░` |
| Branches | 76.47% (52/68) | `████████░░` |
| Functions | 100.00% (13/13) | `██████████` |
| Lines | 90.67% (68/75) | `█████████░` |

**Uncovered lines:** 34, 195, 201, 290-291, 318-319

**Partial branches:** L23 (cond-expr), L30 (if), L159 (cond-expr), L160 (binary-expr), L194 (if), L200 (if), L228 (binary-expr), L230 (binary-expr), L231 (binary-expr), L289 (if), L304 (binary-expr), L313 (binary-expr)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   20 | function authCaller(event: H3Event): { caller?: DcwCaller; approverUserUUID?: string } {
   21 |   const auth = event.context.auth as AuthContext | undefined;
   22 |   return {
!  23 |     caller: auth?.entityBIC ? { entityBIC: auth.entityBIC } : undefined,
   24 |     approverUserUUID: auth?.userUUID,
   25 |   };
   26 | }
   27 | 
   28 | /** Translate a workflow rejection into this router's error response shape. */
   29 | function sendRejection(event: H3Event, e: unknown): { businessErrors: unknown } {
!  30 |   if (isWorkflowRejection(e)) {
   31 |     setResponseStatus(event, e.statusCode);
   32 |     return { businessErrors: e.businessErrors };
   33 |   }
-  34 |   throw e;
   35 | }
   36 | 
   37 | function badRequest(event: H3Event, message: string): { businessErrors: unknown[] } {
  ⋮
  156 |     operationContext: d.operationContext,
  157 |     requestType: d.cbdcRequestType,
  158 |     senderID: d.debitedCashWalletManagerID,
! 159 |     settlementDate: settled ? businessDate : "",
! 160 |     settlementTime: settled ? d.updatedAt ?? "" : "",
  161 |     settlementType: "CLRG",
  162 |     supplementaryData: d.supplementaryData,
  163 |     timestamps: d.timestamps ?? {},
  ⋮
  191 |       // Field validation ahead of the workflow (a HAR-capture delta against the official spec): these
  192 |       // are request-shape checks, distinct from the wallet-manager business
  193 |       // rules enforced by TransferWorkflow.conditions().
! 194 |       if (!body.currency || body.currency !== "EUR") {
- 195 |         return badRequest(event, "currency is required and must be 'EUR'");
  196 |       }
  197 |       if (!caller?.entityBIC || body.instructingPartyID !== caller.entityBIC) {
  198 |         return badRequest(event, "instructingPartyID must match the authenticated caller");
  199 |       }
! 200 |       if (body.cbdcRequestType !== "PAYMENT" && body.cbdcRequestType !== "OPERATION") {
- 201 |         return badRequest(event, "cbdcRequestType must be 'PAYMENT' or 'OPERATION'");
  202 |       }
  203 |       const businessDate = store.getBusinessDay().businessDate;
  204 |       if (body.ISD && body.ISD !== businessDate) {
  ⋮
  225 |       try {
  226 |         draft = workflow.create({
  227 |           id,
! 228 |           amount: body.amountTransferred || "0.00",
  229 |           currency: "EUR",
! 230 |           creditedWalletAlias: body.creditedCashWalletAlias || "",
! 231 |           debitedWalletAlias: body.debitedCashWalletAlias || "",
  232 |           // Initiator is the authenticated caller (four-eyes), never the body (#28).
  233 |           initiatorUserUUID: (event.context.auth as AuthContext | undefined)?.userUUID,
  234 |           supplementaryData: body.supplementaryData,
  ⋮
  286 |       const id = getRouterParam(event, "id")!;
  287 |       const { caller } = authCaller(event);
  288 |       const draft = store.getDraft(id, caller);
! 289 |       if (!draft || draft.type !== "TRANSFER") {
- 290 |         setResponseStatus(event, 404);
- 291 |         return { businessErrors: [{ errorCode: "HL-GER-001", errorDescription: `Draft ${id} not found` }] };
  292 |       }
  293 |       return transferView(store, draft);
  294 |     }),
  ⋮
  301 |     "/dlt/:ncb/api/octopus/rvs/transactions-drafts/:id/:status",
  302 |     defineEventHandler((event) => {
  303 |       const id = getRouterParam(event, "id")!;
! 304 |       const status = (getRouterParam(event, "status") || "").toLowerCase();
  305 |       try {
  306 |         if (status === "approve" || status === "approved") {
  307 |           const { caller, approverUserUUID } = authCaller(event);
  ⋮
  310 |           setResponseHeader(event, "content-type", "application/json");
  311 |           return JSON.stringify("Cash Token Transaction Draft Approved Succesfully");
  312 |         }
! 313 |         if (status === "cancel" || status === "canceled" || status === "cancelled") {
  314 |           workflow.cancel(id);
  315 |           setResponseHeader(event, "content-type", "application/json");
  316 |           return JSON.stringify("Cash Token Transaction Draft Cancelled Succesfully");
  317 |         }
- 318 |         setResponseStatus(event, 400);
- 319 |         return {
  320 |           businessErrors: [
  321 |             { errorCode: "HL-VAL-003", errorDescription: `Unsupported status transition '${status}'` },
  322 |           ],
```
