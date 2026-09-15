# src/routes/direct-rtgs.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 71.43% (55/77) | `███████░░░` |
| Branches | 56.41% (44/78) | `██████░░░░` |
| Functions | 83.33% (10/12) | `████████░░` |
| Lines | 72.37% (55/76) | `███████░░░` |

**Uncovered lines:** 19-22, 24, 175, 218-219, 225, 238-239, 253-254, 263-268, 270, 274-276

**Partial branches:** L29 (cond-expr), L41 (if), L46 (binary-expr), L47 (binary-expr), L51 (binary-expr), L69 (binary-expr), L77 (binary-expr), L80 (binary-expr), L81 (binary-expr), L82 (binary-expr), L83 (binary-expr), L104 (binary-expr), L105 (binary-expr), L112 (binary-expr), L113 (binary-expr), L120 (binary-expr), L121 (binary-expr), L123 (binary-expr), L124 (binary-expr), L148 (binary-expr), L149 (binary-expr), L150 (binary-expr), L151 (binary-expr), L200 (binary-expr), L213 (binary-expr), L237 (if), L252 (if)

**Never called:** `sendRejection` (L19), `(anonymous_11)` (L263)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   16 | import { isWorkflowRejection } from "../workflows/workflow.js";
   17 | import { track } from "../http/route-registry.js";
   18 | 
-  19 | function sendRejection(event: H3Event, e: unknown): { businessErrors: unknown } {
-  20 |   if (isWorkflowRejection(e)) {
-  21 |     setResponseStatus(event, e.statusCode);
-  22 |     return { businessErrors: e.businessErrors };
   23 |   }
-  24 |   throw e;
   25 | }
   26 | 
   27 | function callerOf(event: H3Event): DcwCaller | undefined {
   28 |   const entity = (event.context.auth as AuthContext | undefined)?.entityBIC;
!  29 |   return entity ? { entityBIC: entity } : undefined;
   30 | }
   31 | 
   32 | /**
  ⋮
   38 |  * own example.
   39 |  */
   40 | function historicStatusMap(d: Draft): Record<string, unknown> | undefined {
!  41 |   if (!d.historicStatus) return undefined;
   42 |   const out: Record<string, unknown> = {};
   43 |   for (const status of d.historicStatus) {
   44 |     const t = d.timestamps?.[status];
   45 |     out[status] = {
!  46 |       businessDate: t?.businessDate ?? null,
!  47 |       date: t?.businessDate ?? null,
   48 |       rootCause: null,
   49 |       status,
   50 |       systemStatus: null,
!  51 |       timestamp: t?.calendarDate ?? null,
   52 |     };
   53 |   }
   54 |   return out;
  ⋮
   66 |     id: d.id,
   67 |     amount: d.amount,
   68 |     currency: d.currency,
!  69 |     correlationId: d.correlationId ?? "",
   70 |     // Real backend uses `creationDate` for the business date of the payment
   71 |     // (not a draft-vs-settled distinction) — mirrors `transferView` (#109).
   72 |     creationDate: store.getBusinessDay().businessDate,
  ⋮
   74 |     // two-step draft (mirrors the funding/defunding create response).
   75 |     fourEyesType: "DRAFT",
   76 |     includeSubmit: false,
!  77 |     initiatorUserUUID: d.initiatorUserUUID ?? "",
   78 |     instructingPartyID: d.instructingPartyID ?? "",
   79 |     isCanceled: d.status === "CANCELED",
!  80 |     payerBank: d.payerBank ?? "",
!  81 |     receiverBank: d.receiverBank ?? "",
!  82 |     signature: d.signature ?? "",
!  83 |     signerPEM: d.signerPEM ?? "",
   84 |     source: "Payment",
   85 |     // Same UUID as `id` per the spec's own example.
   86 |     techPaymentId: d.id,
  ⋮
  101 |     amount: d.amount,
  102 |     approvalTimeOut: "",
  103 |     approverUserName: d.approverUserName ?? "",
! 104 |     approverUserUUID: d.approverUserUUID ?? "",
! 105 |     correlationId: d.correlationId ?? "",
  106 |     creationDate: store.getBusinessDay().businessDate,
  107 |     currency: d.currency,
  108 |     historicStatus: historicStatusMap(d),
  109 |     id: d.id,
  110 |     includeSubmit: false,
  111 |     initiatorUserName: d.initiatorUserName ?? "",
! 112 |     initiatorUserUUID: d.initiatorUserUUID ?? "",
! 113 |     instructingPartyID: d.instructingPartyID ?? "",
  114 |     isCanceled: d.status === "CANCELED",
  115 |     isManualDefunding: false,
  116 |     lastUpdatedBusinessDate: store.getBusinessDay().businessDate,
  117 |     lastUpdatedTime: d.updatedAt,
  118 |     marketDLTOperatorBuyer: "",
  119 |     marketDLTOperatorSeller: "",
! 120 |     payerBank: d.payerBank ?? "",
! 121 |     receiverBank: d.receiverBank ?? "",
  122 |     rootCause: "",
! 123 |     signature: d.signature ?? "",
! 124 |     signerPEM: d.signerPEM ?? "",
  125 |     source: "Payment",
  126 |     status: d.status,
  127 |     supplementaryData: d.supplementaryData ?? "",
  ⋮
  145 |     // it — the error points at POST .../ams/wallets/one-step.
  146 |     return {
  147 |       id,
! 148 |       amount: body.amount || "0.00",
! 149 |       currency: body.currency || "EUR",
! 150 |       creditedWalletAlias: body.creditedCashWalletAlias || "",
! 151 |       debitedWalletAlias: body.debitedCashWalletAlias || "",
  152 |       // Initiator is the authenticated caller (four-eyes), never the body (#28).
  153 |       initiatorUserUUID,
  154 |       initiatorUserName,
  ⋮
  172 |       try {
  173 |         id = resolveDraftId(store, "DRTGS", body.id);
  174 |       } catch (e) {
- 175 |         return sendRejection(event, e);
  176 |       }
  177 |       const auth = event.context.auth as AuthContext | undefined;
  178 |       const now = new Date().toISOString();
  ⋮
  197 |     "/dlt/:ncb/api/octopus/tms/direct-rtgs/payments-drafts/:id/:status",
  198 |     defineEventHandler((event) => {
  199 |       const id = getRouterParam(event, "id")!;
! 200 |       const status = (getRouterParam(event, "status") || "").toLowerCase();
  201 |       const auth = event.context.auth as AuthContext | undefined;
  202 |       try {
  203 |         if (status === "approve" || status === "approved") {
  ⋮
  210 |           setResponseHeader(event, "content-type", "application/json");
  211 |           return JSON.stringify("Direct RTGS Payment Draft Approved Successfully");
  212 |         }
! 213 |         if (status === "cancel" || status === "canceled" || status === "cancelled") {
  214 |           workflow.cancel(id);
  215 |           setResponseHeader(event, "content-type", "application/json");
  216 |           return JSON.stringify("Direct RTGS Payment Draft Cancelled Successfully");
  217 |         }
- 218 |         setResponseStatus(event, 400);
- 219 |         return {
  220 |           businessErrors: [
  221 |             { errorCode: "HL-VAL-003", errorDescription: `Unsupported status transition '${status}'` },
  222 |           ],
  223 |         };
  224 |       } catch (e) {
- 225 |         return sendRejection(event, e);
  226 |       }
  227 |     }),
  228 |   );
  ⋮
  234 |     defineEventHandler((event: H3Event) => {
  235 |       const id = getRouterParam(event, "id")!;
  236 |       const draft = store.getDraft(id, callerOf(event));
! 237 |       if (!draft || draft.type !== "DIRECT_RTGS") {
- 238 |         setResponseStatus(event, 404);
- 239 |         return { businessErrors: [{ errorCode: "HL-GER-001", errorDescription: `Direct RTGS payment ${id} not found` }] };
  240 |       }
  241 |       return rtgsResponseView(store, draft);
  242 |     }),
  ⋮
  249 |     defineEventHandler((event: H3Event) => {
  250 |       const id = getRouterParam(event, "id")!;
  251 |       const draft = store.getDraft(id, callerOf(event));
! 252 |       if (!draft || draft.type !== "DIRECT_RTGS") {
- 253 |         setResponseStatus(event, 404);
- 254 |         return { businessErrors: [{ errorCode: "HL-GER-001", errorDescription: `Direct RTGS payment ${id} not found` }] };
  255 |       }
  256 |       return rtgsGetView(store, draft);
  257 |     }),
  ⋮
  260 |   // POST /dlt/:ncb/api/bridge/direct-rtgs/payments — 1-step variant (immediate, NRO)
  261 |   router.post(
  262 |     "/dlt/:ncb/api/bridge/direct-rtgs/payments",
- 263 |     defineEventHandler(async (event) => {
- 264 |       const body = await readBody(event);
- 265 |       const id = body.id || body.paymentID || randomUUID();
- 266 |       const auth = event.context.auth as AuthContext | undefined;
- 267 |       try {
- 268 |         workflow.execute(buildInit(body, id, auth?.userUUID, auth?.username), { caller: callerOf(event) });
  269 |       } catch (e) {
- 270 |         return sendRejection(event, e);
  271 |       }
  272 |       // JSON string response (issue #82) so `response.json()` works; the ECB
  273 |       // spec's "Succesfully" spelling is intentional — do NOT "correct" it.
- 274 |       setResponseStatus(event, 200);
- 275 |       setResponseHeader(event, "content-type", "application/json");
- 276 |       return JSON.stringify("Direct RTGS Payment Settled Succesfully");
  277 |     }),
  278 |   );
  279 | 
```
