# src/routes/funding.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 91.86% (79/86) | `█████████░` |
| Branches | 60.16% (77/128) | `██████░░░░` |
| Functions | 100.00% (14/14) | `██████████` |
| Lines | 92.77% (77/83) | `█████████░` |

**Uncovered lines:** 28, 258, 370, 375, 388, 406

**Partial branches:** L20 (if), L54 (cond-expr), L64 (if), L91 (binary-expr), L92 (binary-expr), L94 (binary-expr), L95 (binary-expr), L96 (binary-expr), L98 (binary-expr), L99 (binary-expr), L103 (binary-expr), L111 (binary-expr), L112 (binary-expr), L114 (binary-expr), L117 (binary-expr), L118 (cond-expr), L147 (if), L152 (binary-expr), L153 (binary-expr), L162 (binary-expr), L164 (binary-expr), L175 (binary-expr), L176 (binary-expr), L205 (cond-expr), L216 (binary-expr), L217 (binary-expr), L219 (binary-expr), L220 (binary-expr), L225 (binary-expr), L226 (binary-expr), L247 (binary-expr), L254 (binary-expr), L282 (binary-expr), L285 (binary-expr), L316 (cond-expr), L321 (binary-expr), L330 (binary-expr), L331 (binary-expr), L333 (binary-expr), L334 (binary-expr), L354 (binary-expr), L359 (cond-expr), L366 (binary-expr), L387 (binary-expr), L405 (if)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   17 | 
   18 | /** Convert a workflow rejection into the h3 createError shape used by this router. */
   19 | function rejectAsError(e: unknown): never {
!  20 |   if (isWorkflowRejection(e)) {
   21 |     throw createError({
   22 |       statusCode: e.statusCode,
   23 |       // Preserve errorCode (not just the description) so it survives to the
  ⋮
   25 |       data: { businessErrors: e.businessErrors },
   26 |     });
   27 |   }
-  28 |   throw e;
   29 | }
   30 | 
   31 | /**
  ⋮
   51 | /** Acting entity from the verified JWT, for DCW authorisation (issue #56). */
   52 | function callerOf(event: H3Event): { entityBIC: string } | undefined {
   53 |   const entity = (event.context.auth as AuthContext | undefined)?.entityBIC;
!  54 |   return entity ? { entityBIC: entity } : undefined;
   55 | }
   56 | 
   57 | /**
  ⋮
   61 |  * auto-create: crediting an unknown wallet is rejected there.
   62 |  */
   63 | function ensureWallet(store: MockStore, alias: string, ownerEntity: string, managerNCB: string, currency: string): void {
!  64 |   if (!alias || store.getWallet(alias)) return;
   65 |   store.ensureWallet(alias, {
   66 |     ownerBIC: ownerEntity,
   67 |     ownerEntityID: ownerEntity,
  ⋮
   88 |     currency: d.currency,
   89 |     type: d.type,
   90 |     creditedCashWalletAlias: d.creditedWalletAlias,
!  91 |     creditedCashWalletManagerID: d.creditedCashWalletManagerID ?? "",
!  92 |     creditedCashWalletOwnerID: d.creditedCashWalletOwnerID ?? "",
   93 |     debitedCashWalletAlias: d.debitedWalletAlias,
!  94 |     debitedCashWalletManagerID: d.debitedCashWalletManagerID ?? "",
!  95 |     debitedCashWalletOwnerID: d.debitedCashWalletOwnerID ?? "",
!  96 |     initiatorUserUUID: d.initiatorUserUUID ?? "",
   97 |     instructingPartyID: d.instructingPartyID ?? "",
!  98 |     signature: d.signature ?? "",
!  99 |     signerPEM: d.signerPEM ?? "",
  100 |     // Derived from the (not-yet-modeled) T2 Account link of the credited
  101 |     // wallet — blank until T2 Accounts are implemented.
  102 |     t2AccountReference: "",
! 103 |     techFundRequestID: d.techFundRequestID ?? "",
  104 |   };
  105 |   if (isDefunding) base.defundingRequestType = "D";
  106 |   if (!opts.rich) return base;
  ⋮
  108 |     ...base,
  109 |     fourEyesType: "DRAFT",
  110 |     status: d.status,
! 111 |     historicStatus: d.historicStatus ?? null,
! 112 |     timestamps: d.timestamps ?? {},
  113 |     initiatorUserName: d.initiatorUserName ?? "",
! 114 |     approverUserUUID: d.approverUserUUID ?? "",
  115 |     approverUserName: d.approverUserName ?? "",
  116 |     creationDate: store.getBusinessDay().businessDate,
! 117 |     settledTime: d.status === "SETTLED" ? d.updatedAt ?? "" : "",
! 118 |     settledDate: d.status === "SETTLED" ? store.getBusinessDay().businessDate : "",
  119 |     rootCause: "",
  120 |   };
  121 | }
  ⋮
  144 | 
  145 |       // Auto-create the credited wallet if unknown — owned by the caller's own
  146 |       // entity (issue #77), with the NCB manager from the body or path.
! 147 |       if (caller?.entityBIC) {
  148 |         ensureWallet(
  149 |           store,
  150 |           body.creditedCashWalletAlias,
  151 |           caller.entityBIC,
! 152 |           body.creditedCashWalletManagerID || "UNKNOWN",
! 153 |           body.currency || "EUR",
  154 |         );
  155 |       }
  156 | 
  ⋮
  159 |       const draft = funding.create(
  160 |         {
  161 |           id,
! 162 |           amount: body.amount || "0.00",
  163 |           currency: "EUR",
! 164 |           creditedWalletAlias: body.creditedCashWalletAlias || "",
  165 |           debitedWalletAlias: ISSUANCE_WALLET_ALIAS,
  166 |           // Initiator is the authenticated caller (four-eyes), never the body (#28).
  167 |           initiatorUserUUID: approverUUID(event),
  ⋮
  172 |           signerPEM: body.signerPEM,
  173 |           creditedCashWalletManagerID: body.creditedCashWalletManagerID,
  174 |           creditedCashWalletOwnerID: body.creditedCashWalletOwnerID,
! 175 |           debitedCashWalletManagerID: body.debitedCashWalletManagerID || ISSUANCE_WALLET_BIC,
! 176 |           debitedCashWalletOwnerID: body.debitedCashWalletOwnerID || ISSUANCE_WALLET_BIC,
  177 |           // Lifecycle trail (workbench #113), same seed as TransferWorkflow (#109)
  178 |           // — kept on the `Draft` for the richer single-GET view even though the
  179 |           // create response itself still reports `historicStatus: null` (below),
  ⋮
  202 |         // Echo the client's own draft timestamp (the real UI reuses its local
  203 |         // draft object, computed client-side, as the POST body) rather than
  204 |         // deriving a new one server-side.
! 205 |         lastUpdated: typeof body.lastUpdated === "number" ? body.lastUpdated : Date.now(),
  206 |         initiatorUserUUID: draft.initiatorUserUUID,
  207 |         initiatorUserName: "",
  208 |         approverUserUUID: "",
  ⋮
  213 |         currency: draft.currency,
  214 |         type: "FUNDING",
  215 |         creditedCashWalletAlias: draft.creditedWalletAlias,
! 216 |         creditedCashWalletManagerID: body.creditedCashWalletManagerID || "",
! 217 |         creditedCashWalletOwnerID: body.creditedCashWalletOwnerID || "",
  218 |         debitedCashWalletAlias: draft.debitedWalletAlias,
! 219 |         debitedCashWalletManagerID: body.debitedCashWalletManagerID || ISSUANCE_WALLET_BIC,
! 220 |         debitedCashWalletOwnerID: body.debitedCashWalletOwnerID || ISSUANCE_WALLET_BIC,
  221 |         // The real API uses `creationDate` (blank at draft stage) instead of
  222 |         // the mock's former `createdAt`.
  223 |         creationDate: "",
  224 |         // Echoed back verbatim, as sent by the client (NRO signature + signer cert).
! 225 |         signature: body.signature || "",
! 226 |         signerPEM: body.signerPEM || "",
  227 |         // Only meaningful for the analogous defunding-creation flow; blank here.
  228 |         defundingRequestType: "",
  229 |         settledTime: "",
  ⋮
  244 |     "/dlt/:ncb/api/octopus/tms/funding-requests-drafts/:id/:status",
  245 |     defineEventHandler((event) => {
  246 |       const id = getRouterParam(event, "id")!;
! 247 |       const status = (getRouterParam(event, "status") || "").toLowerCase();
  248 |       try {
  249 |         if (status === "approve" || status === "approved") {
  250 |           funding.approve(id, { approverUserUUID: approverUUID(event), approverUserName: actingUsername(event) });
  251 |           // Spec response is a plain JSON string, not an object.
  252 |           return stringResponse(event, "Funding Request Draft Approved Succesfully");
  253 |         }
! 254 |         if (status === "cancel" || status === "canceled" || status === "cancelled") {
  255 |           funding.cancel(id);
  256 |           return stringResponse(event, "Funding Request Draft Cancelled Succesfully");
  257 |         }
- 258 |         throw createError({
  259 |           statusCode: 400,
  260 |           data: { businessErrors: [{ errorDescription: `Unsupported status transition '${status}'` }] },
  261 |         });
  ⋮
  279 |       const businessDate = store.getBusinessDay().businessDate;
  280 |       const draft = defunding.create({
  281 |         id,
! 282 |         amount: body.amount || "0.00",
  283 |         currency: "EUR",
  284 |         creditedWalletAlias: ISSUANCE_WALLET_ALIAS,
! 285 |         debitedWalletAlias: body.debitedCashWalletAlias || "",
  286 |         // Initiator is the authenticated caller (four-eyes), never the body (#28).
  287 |         initiatorUserUUID: approverUUID(event),
  288 |         initiatorUserName: actingUsername(event),
  ⋮
  313 |         status: draft.status,
  314 |         historicStatus: null,
  315 |         timestamps: {},
! 316 |         lastUpdated: typeof body.lastUpdated === "number" ? body.lastUpdated : Date.now(),
  317 |         initiatorUserUUID: draft.initiatorUserUUID,
  318 |         initiatorUserName: "",
  319 |         approverUserUUID: "",
  320 |         approverUserName: "",
! 321 |         techFundRequestID: body.techFundRequestID || "",
  322 |         instructingPartyID: body.instructingPartyID || "",
  323 |         amount: draft.amount,
  324 |         currency: draft.currency,
  ⋮
  327 |         creditedCashWalletManagerID: ISSUANCE_WALLET_BIC,
  328 |         creditedCashWalletOwnerID: ISSUANCE_WALLET_BIC,
  329 |         debitedCashWalletAlias: draft.debitedWalletAlias,
! 330 |         debitedCashWalletManagerID: body.debitedCashWalletManagerID || "",
! 331 |         debitedCashWalletOwnerID: body.debitedCashWalletOwnerID || "",
  332 |         creationDate: "",
! 333 |         signature: body.signature || "",
! 334 |         signerPEM: body.signerPEM || "",
  335 |         // Only meaningful for this defunding-creation flow (the only value
  336 |         // the spec declares for this field).
  337 |         defundingRequestType: "D",
  ⋮
  351 |     "/dlt/:ncb/api/octopus/tms/defunding-requests-drafts/:id/:status",
  352 |     defineEventHandler((event) => {
  353 |       const id = getRouterParam(event, "id")!;
! 354 |       const status = (getRouterParam(event, "status") || "").toLowerCase();
  355 |       const auth = event.context.auth as AuthContext | undefined;
  356 |       try {
  357 |         if (status === "approve" || status === "approved") {
  358 |           defunding.approve(id, {
! 359 |             caller: auth?.entityBIC ? { entityBIC: auth.entityBIC } : undefined,
  360 |             approverUserUUID: auth?.userUUID,
  361 |             approverUserName: auth?.username,
  362 |           });
  363 |           // Spec response is a plain JSON string, not an object.
  364 |           return stringResponse(event, "Defunding Request Draft Approved Successfully");
  365 |         }
! 366 |         if (status === "cancel" || status === "canceled" || status === "cancelled") {
  367 |           defunding.cancel(id);
  368 |           return stringResponse(event, "Defunding Request Draft Cancelled Successfully");
  369 |         }
- 370 |         throw createError({
  371 |           statusCode: 400,
  372 |           data: { businessErrors: [{ errorDescription: `Unsupported status transition '${status}'` }] },
  373 |         });
  374 |       } catch (e) {
- 375 |         rejectAsError(e);
  376 |       }
  377 |     }),
  378 |   );
  ⋮
  384 |     defineEventHandler((event: H3Event) => {
  385 |       const id = getRouterParam(event, "id")!;
  386 |       const draft = store.getDraft(id, callerOf(event));
! 387 |       if (!draft || (draft.type !== "FUNDING" && draft.type !== "DEFUNDING")) {
- 388 |         throw createError({
  389 |           statusCode: 404,
  390 |           data: { businessErrors: [{ errorDescription: `Request ${id} not found` }] },
  391 |         });
  ⋮
  402 |     defineEventHandler((event: H3Event) => {
  403 |       const id = getRouterParam(event, "id")!;
  404 |       const draft = store.getDraft(id, callerOf(event));
! 405 |       if (!draft || (draft.type !== "FUNDING" && draft.type !== "DEFUNDING")) {
- 406 |         throw createError({
  407 |           statusCode: 404,
  408 |           data: { businessErrors: [{ errorDescription: `Request ${id} not found` }] },
  409 |         });
```
