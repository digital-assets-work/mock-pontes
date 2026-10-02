# src/routes/wallets.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 83.16% (79/95) | `████████░░` |
| Branches | 72.53% (66/91) | `███████░░░` |
| Functions | 86.67% (13/15) | `█████████░` |
| Lines | 84.44% (76/90) | `████████░░` |

**Uncovered lines:** 39-40, 91-92, 126, 208, 249, 282-283, 292-293, 335-336, 350-351

**Partial branches:** L23 (cond-expr), L38 (if), L52 (binary-expr), L64 (cond-expr), L116 (if), L118 (switch), L125 (switch), L166 (binary-expr), L189 (binary-expr), L203 (binary-expr), L214 (binary-expr), L219 (binary-expr), L248 (if), L281 (if), L289 (binary-expr), L290 (binary-expr), L291 (if), L317 (binary-expr), L319 (cond-expr), L320 (cond-expr), L334 (if), L349 (if)

**Never called:** `walletNotFound` (L91), `(anonymous_7)` (L208)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   20 | /** The acting entity, derived from the verified JWT (issue #56 scoping). */
   21 | function callerOf(event: H3Event): DcwCaller {
   22 |   const entity = (event.context.auth as AuthContext | undefined)?.entityBIC;
!  23 |   return entity ? { entityBIC: entity } : {};
   24 | }
   25 | 
   26 | const OPERATION_TYPE_BY_TX_TYPE: Record<Transaction["type"], "Issuance" | "Redemption" | "Transfer"> = {
  ⋮
   35 | /** Resolves the owner/manager BIC of a move-leg wallet, with the ECB issuance-wallet fallback. */
   36 | function moveParty(alias: string, store: MockStore): { owner?: string; manager?: string } {
   37 |   const wallet = store.getWallet(alias);
!  38 |   if (wallet) return { owner: wallet.ownerBIC, manager: wallet.managerNCB };
-  39 |   if (alias === ISSUANCE_WALLET_ALIAS) return { owner: ISSUANCE_WALLET_BIC, manager: ISSUANCE_WALLET_BIC };
-  40 |   return {};
   41 | }
   42 | 
   43 | /**
  ⋮
   49 | function toSettlement(tx: Transaction, walias: string, store: MockStore) {
   50 |   const credited = moveParty(tx.creditedWalletAlias, store);
   51 |   const debited = moveParty(tx.debitedWalletAlias, store);
!  52 |   const settledAt = tx.settledAt ?? tx.createdAt;
   53 |   return {
   54 |     settlementID: tx.id,
   55 |     type: "CASH",
  ⋮
   61 |     moveType: "LT",
   62 |     amount: tx.amount,
   63 |     currency: tx.currency,
!  64 |     moveDirection: walias === tx.creditedWalletAlias ? "CDIT" : "DBIT",
   65 |     moveSource: tx.debitedWalletAlias,
   66 |     moveSourceOwner: debited.owner,
   67 |     moveSourceManager: debited.manager,
  ⋮
   88 |   };
   89 | }
   90 | 
-  91 | function walletNotFound(alias: string) {
-  92 |   return {
   93 |     businessErrors: [
   94 |       {
   95 |         errorCode: "HL-GER-001",
  ⋮
  113 |  * `canRead`/PoA-or-operator DCW guard, which has no "manager" concept).
  114 |  */
  115 | function inScope(scope: WalletScope, wallet: Wallet, caller: DcwCaller): boolean {
! 116 |   if (!caller.entityBIC) return false;
  117 |   switch (scope) {
! 118 |     case "ownedcustody":
  119 |     case "owned":
  120 |     case "used":
  121 |       return wallet.ownerEntityID === caller.entityBIC;
  122 |     case "managed":
  123 |     case "managedcustody":
  124 |       return wallet.managerNCB === caller.entityBIC;
! 125 |     case "poa":
- 126 |       return wallet.poaGrantees.includes(caller.entityBIC);
  127 |   }
  128 | }
  129 | 
  ⋮
  163 |     status: "ACCEPTED",
  164 |     historicStatus: ["PENDING_APPROVAL", "ACCEPTED"],
  165 |     timestamps: { ACCEPTED: acceptedAt, PENDING_APPROVAL: acceptedAt },
! 166 |     lastUpdated: Date.parse(wallet.createdAt) || 0,
  167 |     initiatorUserUUID: "",
  168 |     initiatorUserName: "",
  169 |     approverUserUUID: "",
  ⋮
  186 |     managerName: manager?.name ?? "",
  187 |     modality: "NORMAL",
  188 |     creationDate: "",
! 189 |     ownerName: owner?.name ?? "",
  190 |     type: "CASH",
  191 |     userEntityID: "",
  192 |     t2AccountWalletLinks: [
  ⋮
  200 |         status: "ACCEPTED",
  201 |       },
  202 |     ],
! 203 |     countryCode: owner?.countryCode ?? "",
  204 |     isBlocked: wallet.isBlocked,
  205 |     // No per-grantee maximumAmount/validity window is tracked today — only
  206 |     // the grantee identity (`poaGrantees`). Best-effort mapping onto the
  207 |     // `CreateInstructOnBehalf` shape, pending a real non-empty sample.
- 208 |     POAs: wallet.poaGrantees.map((poaEntityID) => ({
  209 |       walletAlias: wallet.alias,
  210 |       walletOwnerID: wallet.ownerEntityID,
  211 |       walletManagerID: wallet.managerNCB,
  212 |       poaEntityID,
  213 |       validFrom: wallet.validFrom,
! 214 |       validTo: wallet.validTo ?? "",
  215 |       maximumAmount: "",
  216 |     })),
  217 |     isMainWallet: wallet.isMainWallet,
  218 |     mainWalletHistoricStatus: [],
! 219 |     instructingPartyID: owner?.instructingPartyID ?? "",
  220 |   };
  221 | }
  222 | 
  ⋮
  245 |       }
  246 |       // Spec's own `type` param (four-eyes status), distinct from `wallettype`.
  247 |       const normalizedType = rawType?.toUpperCase();
! 248 |       if (normalizedType !== undefined && normalizedType !== "NORMAL" && normalizedType !== "DRAFT") {
- 249 |         return badRequest(event, `Unknown type '${rawType}'. Expected: NORMAL, DRAFT`);
  250 |       }
  251 |       if (rawScope === undefined) {
  252 |         return badRequest(event, "scope is required");
  ⋮
  278 |     "/dlt/:ncb/api/octopus/ams/wallets/one-step",
  279 |     defineEventHandler(async (event) => {
  280 |       const caller = callerOf(event);
! 281 |       if (!caller.entityBIC) {
- 282 |         setResponseStatus(event, 403);
- 283 |         return {
  284 |           businessErrors: [
  285 |             { errorCode: "HL-ATH-002", errorDescription: "An authenticated entity is required to create a wallet" },
  286 |           ],
  287 |         };
  288 |       }
! 289 |       const body = (await readBody(event)) ?? {};
! 290 |       const alias: unknown = body.walletAlias ?? body.alias;
! 291 |       if (typeof alias !== "string" || !alias) {
- 292 |         setResponseStatus(event, 400);
- 293 |         return {
  294 |           businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "walletAlias is required" }],
  295 |         };
  296 |       }
  ⋮
  314 |         ownerEntityID: caller.entityBIC,
  315 |         ownerBIC: caller.entityBIC,
  316 |         managerNCB: (typeof body.managerNCB === "string" && body.managerNCB) || ncb.toUpperCase(),
! 317 |         currency: (typeof body.currency === "string" && body.currency) || "EUR",
  318 |         isMainWallet: Boolean(body.isMainWallet),
! 319 |         validFrom: typeof body.validFrom === "string" ? body.validFrom : undefined,
! 320 |         validTo: typeof body.validTo === "string" ? body.validTo : undefined,
  321 |       });
  322 |       setResponseStatus(event, 201);
  323 |       return toWalletResponse(wallet);
  ⋮
  331 |       const walias = getRouterParam(event, "walias")!;
  332 |       // A wallet the caller may not read is masked as "not found" (404).
  333 |       const wallet = store.getWallet(walias, callerOf(event));
! 334 |       if (!wallet) {
- 335 |         setResponseStatus(event, 404);
- 336 |         return walletNotFound(walias);
  337 |       }
  338 |       return toWalletResponse(wallet);
  339 |     }),
  ⋮
  346 |       const walias = getRouterParam(event, "walias")!;
  347 |       const caller = callerOf(event);
  348 |       const wallet = store.getWallet(walias, caller);
! 349 |       if (!wallet) {
- 350 |         setResponseStatus(event, 404);
- 351 |         return walletNotFound(walias);
  352 |       }
  353 |       const transactions = store.getWalletTransactions(walias, caller);
  354 |       // Spec response is a bare octopus.Settlement[], not { transactions }.
```
