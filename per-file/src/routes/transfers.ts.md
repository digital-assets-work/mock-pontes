# src/routes/transfers.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 91.25% (73/80) | `█████████░` |
| Branches | 77.14% (54/70) | `████████░░` |
| Functions | 100.00% (13/13) | `██████████` |
| Lines | 91.25% (73/80) | `█████████░` |

**Uncovered lines:** 35, 196, 202, 301-302, 329-330

**Partial branches:** L24 (cond-expr), L31 (if), L160 (cond-expr), L161 (binary-expr), L195 (if), L201 (if), L239 (binary-expr), L241 (binary-expr), L242 (binary-expr), L300 (if), L315 (binary-expr), L324 (binary-expr)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   21 | function authCaller(event: H3Event): { caller?: DcwCaller; approverUserUUID?: string } {
   22 |   const auth = event.context.auth as AuthContext | undefined;
   23 |   return {
!  24 |     caller: auth?.entityBIC ? { entityBIC: auth.entityBIC } : undefined,
   25 |     approverUserUUID: auth?.userUUID,
   26 |   };
   27 | }
   28 | 
   29 | /** Translate a workflow rejection into this router's error response shape. */
   30 | function sendRejection(event: H3Event, e: unknown): { businessErrors: unknown } {
!  31 |   if (isWorkflowRejection(e)) {
   32 |     setResponseStatus(event, e.statusCode);
   33 |     return { businessErrors: e.businessErrors };
   34 |   }
-  35 |   throw e;
   36 | }
   37 | 
   38 | function badRequest(event: H3Event, message: string): { businessErrors: unknown[] } {
  ⋮
  157 |     operationContext: d.operationContext,
  158 |     requestType: d.cbdcRequestType,
  159 |     senderID: d.debitedCashWalletManagerID,
! 160 |     settlementDate: settled ? businessDate : "",
! 161 |     settlementTime: settled ? d.updatedAt ?? "" : "",
  162 |     settlementType: "CLRG",
  163 |     supplementaryData: d.supplementaryData,
  164 |     timestamps: d.timestamps ?? {},
  ⋮
  192 |       // Field validation ahead of the workflow (a HAR-capture delta against the official spec): these
  193 |       // are request-shape checks, distinct from the wallet-manager business
  194 |       // rules enforced by TransferWorkflow.conditions().
! 195 |       if (!body.currency || body.currency !== "EUR") {
- 196 |         return badRequest(event, "currency is required and must be 'EUR'");
  197 |       }
  198 |       if (!caller?.entityBIC || body.instructingPartyID !== caller.entityBIC) {
  199 |         return badRequest(event, "instructingPartyID must match the authenticated caller");
  200 |       }
! 201 |       if (body.cbdcRequestType !== "PAYMENT" && body.cbdcRequestType !== "OPERATION") {
- 202 |         return badRequest(event, "cbdcRequestType must be 'PAYMENT' or 'OPERATION'");
  203 |       }
  204 |       const businessDate = store.getBusinessDay().businessDate;
  205 |       if (body.ISD && body.ISD !== businessDate) {
  ⋮
  236 |       try {
  237 |         draft = workflow.create({
  238 |           id,
! 239 |           amount: body.amountTransferred || "0.00",
  240 |           currency: "EUR",
! 241 |           creditedWalletAlias: body.creditedCashWalletAlias || "",
! 242 |           debitedWalletAlias: body.debitedCashWalletAlias || "",
  243 |           // Initiator is the authenticated caller (four-eyes), never the body (#28).
  244 |           initiatorUserUUID: (event.context.auth as AuthContext | undefined)?.userUUID,
  245 |           supplementaryData: body.supplementaryData,
  ⋮
  297 |       const id = getRouterParam(event, "id")!;
  298 |       const { caller } = authCaller(event);
  299 |       const draft = store.getDraft(id, caller);
! 300 |       if (!draft || draft.type !== "TRANSFER") {
- 301 |         setResponseStatus(event, 404);
- 302 |         return { businessErrors: [{ errorCode: "HL-GER-001", errorDescription: `Draft ${id} not found` }] };
  303 |       }
  304 |       return transferView(store, draft);
  305 |     }),
  ⋮
  312 |     "/dlt/:ncb/api/octopus/rvs/transactions-drafts/:id/:status",
  313 |     defineEventHandler((event) => {
  314 |       const id = getRouterParam(event, "id")!;
! 315 |       const status = (getRouterParam(event, "status") || "").toLowerCase();
  316 |       try {
  317 |         if (status === "approve" || status === "approved") {
  318 |           const { caller, approverUserUUID } = authCaller(event);
  ⋮
  321 |           setResponseHeader(event, "content-type", "application/json");
  322 |           return JSON.stringify("Cash Token Transaction Draft Approved Succesfully");
  323 |         }
! 324 |         if (status === "cancel" || status === "canceled" || status === "cancelled") {
  325 |           workflow.cancel(id);
  326 |           setResponseHeader(event, "content-type", "application/json");
  327 |           return JSON.stringify("Cash Token Transaction Draft Cancelled Succesfully");
  328 |         }
- 329 |         setResponseStatus(event, 400);
- 330 |         return {
  331 |           businessErrors: [
  332 |             { errorCode: "HL-VAL-003", errorDescription: `Unsupported status transition '${status}'` },
  333 |           ],
```
