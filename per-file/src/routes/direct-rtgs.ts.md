# src/routes/direct-rtgs.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 82.28% (65/79) | `████████░░` |
| Branches | 56.38% (53/94) | `██████░░░░` |
| Functions | 92.31% (12/13) | `█████████░` |
| Lines | 83.33% (65/78) | `████████░░` |

**Uncovered lines:** 19-22, 24, 218, 261-262, 268, 281-282, 296-297, 330

**Partial branches:** L29 (cond-expr), L41 (if), L46 (binary-expr), L47 (binary-expr), L51 (binary-expr), L69 (binary-expr), L77 (binary-expr), L80 (binary-expr), L81 (binary-expr), L82 (binary-expr), L83 (binary-expr), L106 (binary-expr), L107 (binary-expr), L114 (binary-expr), L115 (binary-expr), L122 (binary-expr), L123 (binary-expr), L125 (binary-expr), L126 (binary-expr), L153 (binary-expr), L156 (binary-expr), L160 (binary-expr), L161 (binary-expr), L166 (binary-expr), L167 (binary-expr), L169 (binary-expr), L170 (binary-expr), L191 (binary-expr), L192 (binary-expr), L193 (binary-expr), L194 (binary-expr), L243 (binary-expr), L256 (binary-expr), L280 (if), L295 (if), L308 (binary-expr)

**Never called:** `sendRejection` (L19)

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
  103 |     amount: d.amount,
  104 |     approvalTimeOut: "",
  105 |     approverUserName: d.approverUserName ?? "",
! 106 |     approverUserUUID: d.approverUserUUID ?? "",
! 107 |     correlationId: d.correlationId ?? "",
  108 |     creationDate: store.getBusinessDay().businessDate,
  109 |     currency: d.currency,
  110 |     historicStatus: historicStatusMap(d),
  111 |     id: d.id,
  112 |     includeSubmit: false,
  113 |     initiatorUserName: d.initiatorUserName ?? "",
! 114 |     initiatorUserUUID: d.initiatorUserUUID ?? "",
! 115 |     instructingPartyID: d.instructingPartyID ?? "",
  116 |     isCanceled: d.status === "CANCELED",
  117 |     isManualDefunding: false,
  118 |     lastUpdatedBusinessDate: store.getBusinessDay().businessDate,
  119 |     lastUpdatedTime: d.updatedAt,
  120 |     marketDLTOperatorBuyer: "",
  121 |     marketDLTOperatorSeller: "",
! 122 |     payerBank: d.payerBank ?? "",
! 123 |     receiverBank: d.receiverBank ?? "",
  124 |     rootCause: "",
! 125 |     signature: d.signature ?? "",
! 126 |     signerPEM: d.signerPEM ?? "",
  127 |     source: "Payment",
  128 |     status: d.status,
  129 |     techPaymentId: d.id,
  ⋮
  150 |   return {
  151 |     amount: d.amount,
  152 |     approvalTimeOut: "",
! 153 |     correlationId: d.correlationId ?? "",
  154 |     creationDate: store.getBusinessDay().businessDate,
  155 |     currency: d.currency,
! 156 |     historicStatus: d.historicStatus ?? [],
  157 |     id: d.id,
  158 |     includeSubmit: false,
  159 |     initiatorUserName: d.initiatorUserName ?? "",
! 160 |     initiatorUserUUID: d.initiatorUserUUID ?? "",
! 161 |     instructingPartyID: d.instructingPartyID ?? "",
  162 |     isCanceled: false,
  163 |     isManualDefunding: false,
  164 |     lastUpdatedBusinessDate: store.getBusinessDay().businessDate,
  165 |     lastUpdatedTime: d.updatedAt,
! 166 |     payerBank: d.payerBank ?? "",
! 167 |     receiverBank: d.receiverBank ?? "",
  168 |     rootCause: "",
! 169 |     signature: d.signature ?? "",
! 170 |     signerPEM: d.signerPEM ?? "",
  171 |     status: "COMPLETED",
  172 |     type: "Direct RTGS Payment",
  173 |   };
  ⋮
  188 |     // it — the error points at POST .../ams/wallets/one-step.
  189 |     return {
  190 |       id,
! 191 |       amount: body.amount || "0.00",
! 192 |       currency: body.currency || "EUR",
! 193 |       creditedWalletAlias: body.creditedCashWalletAlias || "",
! 194 |       debitedWalletAlias: body.debitedCashWalletAlias || "",
  195 |       // Initiator is the authenticated caller (four-eyes), never the body (#28).
  196 |       initiatorUserUUID,
  197 |       initiatorUserName,
  ⋮
  215 |       try {
  216 |         id = resolveDraftId(store, "DRTGS", body.id);
  217 |       } catch (e) {
- 218 |         return sendRejection(event, e);
  219 |       }
  220 |       const auth = event.context.auth as AuthContext | undefined;
  221 |       const now = new Date().toISOString();
  ⋮
  240 |     "/dlt/:ncb/api/octopus/tms/direct-rtgs/payments-drafts/:id/:status",
  241 |     defineEventHandler((event) => {
  242 |       const id = getRouterParam(event, "id")!;
! 243 |       const status = (getRouterParam(event, "status") || "").toLowerCase();
  244 |       const auth = event.context.auth as AuthContext | undefined;
  245 |       try {
  246 |         if (status === "approve" || status === "approved") {
  ⋮
  253 |           setResponseHeader(event, "content-type", "application/json");
  254 |           return JSON.stringify("Direct RTGS Payment Draft Approved Successfully");
  255 |         }
! 256 |         if (status === "cancel" || status === "canceled" || status === "cancelled") {
  257 |           workflow.cancel(id);
  258 |           setResponseHeader(event, "content-type", "application/json");
  259 |           return JSON.stringify("Direct RTGS Payment Draft Cancelled Successfully");
  260 |         }
- 261 |         setResponseStatus(event, 400);
- 262 |         return {
  263 |           businessErrors: [
  264 |             { errorCode: "HL-VAL-003", errorDescription: `Unsupported status transition '${status}'` },
  265 |           ],
  266 |         };
  267 |       } catch (e) {
- 268 |         return sendRejection(event, e);
  269 |       }
  270 |     }),
  271 |   );
  ⋮
  277 |     defineEventHandler((event: H3Event) => {
  278 |       const id = getRouterParam(event, "id")!;
  279 |       const draft = store.getDraft(id, callerOf(event));
! 280 |       if (!draft || draft.type !== "DIRECT_RTGS") {
- 281 |         setResponseStatus(event, 404);
- 282 |         return { businessErrors: [{ errorCode: "HL-GER-001", errorDescription: `Direct RTGS payment ${id} not found` }] };
  283 |       }
  284 |       return rtgsResponseView(store, draft);
  285 |     }),
  ⋮
  292 |     defineEventHandler((event: H3Event) => {
  293 |       const id = getRouterParam(event, "id")!;
  294 |       const draft = store.getDraft(id, callerOf(event));
! 295 |       if (!draft || draft.type !== "DIRECT_RTGS") {
- 296 |         setResponseStatus(event, 404);
- 297 |         return { businessErrors: [{ errorCode: "HL-GER-001", errorDescription: `Direct RTGS payment ${id} not found` }] };
  298 |       }
  299 |       return rtgsGetView(store, draft);
  300 |     }),
  ⋮
  305 |     "/dlt/:ncb/api/bridge/direct-rtgs/payments",
  306 |     defineEventHandler(async (event) => {
  307 |       const body = await readBody(event);
! 308 |       const id = body.id || body.paymentID || randomUUID();
  309 |       const auth = event.context.auth as AuthContext | undefined;
  310 |       const now = new Date().toISOString();
  311 |       const businessDate = store.getBusinessDay().businessDate;
  ⋮
  327 |           { caller: callerOf(event) },
  328 |         );
  329 |       } catch (e) {
- 330 |         return sendRejection(event, e);
  331 |       }
  332 |       // Structured `BridgeDirectRTGS` response (ECB spec v1.1, workbench #133)
  333 |       // — replaces the bare confirmation string used under v1.0 (issue #82).
```
