# Endpoint coverage & controls

> **Generated:** 2026-07-26 — audit of the code in this repository against the
> vendored official spec. Regenerated after the admin-endpoint cleanup
> (mock-only `fund`/`defund`/`transfer`/wallet-list/transaction-list removed in
> favour of the official API).
> **Official spec:** ECB Pontes Pilot *EII API* **v1.0.0**
> (`src/ui/spec/pontes-official-v1.0.json`; YAML reference:
> `../mock-pontes-workbench/docs/pontes-reference/pontes-pilot-v1.0.yaml`).
> **Mock release baseline:** rows marked `v0.1.0` shipped in the **initial
> public release** (git tag `v0.1.0`, `package.json` version `1.0.0`, 2026-07-26).
> Rows marked `unreleased` have landed on `main` since and will carry the next
> release tag. The **Since** column records the first mock release that shipped
> the endpoint; update it whenever a new endpoint lands.

This document is an **audit only** — it reports what exists today and does not
change behaviour. Gaps are listed, not fixed.

## Legend

**Status**

- `IMPLEMENTED` — same method + path as the official spec, behaviour approximated.
- `PARTIAL` — implemented but with a different path shape or simplified semantics (see notes).
- `NOT IMPLEMENTED` — no mock route.

**Controls** (enforced by the middleware chain in `src/index.ts`, in order)

| Tag | Meaning | Source |
|-----|---------|--------|
| `JWT` | Bearer token validated (ES256), `event.context.auth` populated | `src/auth/jwt-middleware.ts` (applied to `/dlt` prefix) |
| `mTLS` | Authenticated call's client cert must match the cert associated with the user | `src/auth/middleware.ts` (`createMtlsConsistencyMiddleware`) |
| `mTLS-req` | A valid client certificate is required (independent of JWT) | handler / `src/routes/health.ts` (`/check/mtls`), `src/auth/enrollment-routes.ts` (token) |
| `PROFILE:X` | Route requires profile `X` in strict mode; bypassed by `PONTES_MOCK_LENIENT_PROFILE=true` | `src/auth/profile-authorization-middleware.ts` |
| `NRO` | Signer-cert consistency + ECDSA P-256/SHA-256 signature verification | `src/auth/nro-middleware.ts` + cert check, patterns in `src/index.ts` |
| `STATE` | Handler-level validation (required fields, wallet/draft existence, draft lifecycle state) | route handler |
| `none` | No auth (registered before the auth middlewares) | — |

> **Global note on `/dlt/**`:** every `/dlt/**` route sits behind `JWT` + `mTLS`
> consistency. `/check/**`, `/dlt/{ncb}/api/octopus/health`, the UI and the
> enrollment/token endpoints are registered **before** the JWT middleware and are
> therefore not JWT-protected.

---

## 1. Official EII API endpoints — coverage

### Connectivity & health

| Method | Official path | Status | Mock path | Controls | Since |
|--------|---------------|--------|-----------|----------|-------|
| GET | `/dlt/{ncb}/api/octopus/health` | IMPLEMENTED | same | `none` | v0.1.0 |

> Not in the EII spec but implemented as documented transport checks (ECB SDD §6.3):
> `GET /check/ip` (`none`) and `GET /check/mtls` (`mTLS-req`, 403 if no/untrusted cert) — see `src/routes/health.ts`.

### Bridge (1-step payments & business window)

| Method | Official path | Status | Mock path | Controls | Since |
|--------|---------------|--------|-----------|----------|-------|
| GET | `/dlt/{ncb}/api/bridge/current-business-window` | IMPLEMENTED | same | `JWT` `mTLS` | v0.1.0 |
| POST | `/dlt/{ncb}/api/bridge/payments` | IMPLEMENTED | same | `JWT` `mTLS` `PROFILE:EXTERNAL_USER` `STATE` | v0.1.0 |
| POST | `/dlt/{ncb}/api/bridge/direct-rtgs/payments` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/bridge/whitelist/verify` | NOT IMPLEMENTED | — | — | — |
| POST | `/dlt/{ncb}/api/bridge/initpfoddeli` | NOT IMPLEMENTED | — | — | — |
| POST | `/dlt/{ncb}/api/bridge/initpfodrece` | NOT IMPLEMENTED | — | — | — |

### AMS — wallets & T2 accounts

| Method | Official path | Status | Mock path | Controls | Since |
|--------|---------------|--------|-----------|----------|-------|
| GET | `/dlt/{ncb}/api/octopus/ams/wallets/{walias}` | IMPLEMENTED | same | `JWT` `mTLS` `STATE` (404 if unknown) | v0.1.0 |
| GET | `/dlt/{ncb}/api/octopus/ams/wallets/{walias}/transactions` | IMPLEMENTED | same | `JWT` `mTLS` `STATE` (404 if unknown) | v0.1.0 |
| GET | `/dlt/{ncb}/api/octopus/ams/wallets` | IMPLEMENTED | same | `JWT` `mTLS` | unreleased |
| POST | `/dlt/{ncb}/api/octopus/ams/wallets` | NOT IMPLEMENTED | — (mock auto-creates wallets on first use) | — | — |
| GET | `/dlt/{ncb}/api/octopus/ams/wallets-drafts/{id}` | NOT IMPLEMENTED | — | — | — |
| PUT | `/dlt/{ncb}/api/octopus/ams/wallets-drafts/{id}/{status}` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/ams/totalundermanagement` | NOT IMPLEMENTED | — | — | — |
| POST | `/dlt/{ncb}/api/octopus/ams/t2accounts` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/ams/t2accounts` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/ams/t2accounts/{id}` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/ams/t2accounts-drafts/{id}` | NOT IMPLEMENTED | — | — | — |
| PUT | `/dlt/{ncb}/api/octopus/ams/t2accounts-drafts/{id}/{status}` | NOT IMPLEMENTED | — | — | — |
| POST | `/dlt/{ncb}/api/octopus/ams/poa-drafts` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/ams/poa/{id}` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/ams/poa-drafts/{id}` | NOT IMPLEMENTED | — | — | — |
| PUT | `/dlt/{ncb}/api/octopus/ams/poa-drafts/{id}/{status}` | NOT IMPLEMENTED | — | — | — |
| POST | `/dlt/{ncb}/api/octopus/ams/wallets/transactions/extract` | NOT IMPLEMENTED | — | — | — |

### RVS — cash-token transactions (2-step)

| Method | Official path | Status | Mock path | Controls | Since |
|--------|---------------|--------|-----------|----------|-------|
| POST | `/dlt/{ncb}/api/octopus/rvs/transactions-requests` | IMPLEMENTED | same | `JWT` `mTLS` `PROFILE:PILOT_READ_WRITE` `STATE` | v0.1.0 |
| PUT | `/dlt/{ncb}/api/octopus/rvs/transactions-drafts/{instructionID}/{status}` | PARTIAL | `.../transactions-drafts/{id}/approve` and `.../{id}/cancel` | `JWT` `mTLS` `PROFILE:PILOT_READ_WRITE` `STATE` (404/409) | v0.1.0 |
| GET | `/dlt/{ncb}/api/octopus/rvs/transactions-drafts/{instructionID}` | NOT IMPLEMENTED | — | — | — |

### TMS — funding / defunding (2-step, NRO-signed)

| Method | Official path | Status | Mock path | Controls | Since |
|--------|---------------|--------|-----------|----------|-------|
| POST | `/dlt/{ncb}/api/octopus/tms/funding-requests` | IMPLEMENTED | same | `JWT` `mTLS` `PROFILE:PILOT_READ_WRITE` `NRO` `STATE` | v0.1.0 |
| POST | `/dlt/{ncb}/api/octopus/tms/defunding-requests` | IMPLEMENTED | same | `JWT` `mTLS` `PROFILE:PILOT_READ_WRITE` `NRO` `STATE` | v0.1.0 |
| PUT | `/dlt/{ncb}/api/octopus/tms/funding-requests-drafts/{id}/{status}` | PARTIAL | `.../funding-requests-drafts/{id}/approve` and `.../{id}/cancel` | `JWT` `mTLS` `PROFILE:PILOT_READ_WRITE` `STATE` | v0.1.0 |
| PUT | `/dlt/{ncb}/api/octopus/tms/defunding-requests-drafts/{id}/{status}` | PARTIAL | `.../defunding-requests-drafts/{id}/approve` (no `cancel`) | `JWT` `mTLS` `PROFILE:PILOT_READ_WRITE` `STATE` | v0.1.0 |
| GET | `/dlt/{ncb}/api/octopus/tms/funding-defunding-requests-drafts/{id}` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/tms/funding-defunding-requests/{id}` | NOT IMPLEMENTED | — | — | — |
| POST | `/dlt/{ncb}/api/octopus/tms/funding-defunding-requests/extract` | NOT IMPLEMENTED | — | — | — |
| POST | `/dlt/{ncb}/api/octopus/tms/funding-defunding-requests/payment-instructions/extract` | NOT IMPLEMENTED | — | — | — |
| POST | `/dlt/{ncb}/api/octopus/tms/direct-rtgs/payments` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/tms/direct-rtgs/payments/{id}` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/tms/direct-rtgs/payments-drafts/{id}` | NOT IMPLEMENTED | — | — | — |
| PUT | `/dlt/{ncb}/api/octopus/tms/direct-rtgs/payments-drafts/{id}/{status}` | NOT IMPLEMENTED | — | — | — |
| POST | `/dlt/{ncb}/api/octopus/tms/direct-rtgs/payments/extract` | NOT IMPLEMENTED | — | — | — |
| POST | `/dlt/{ncb}/api/octopus/tms/instruct-on-behalf-drafts` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/tms/instruct-on-behalf/{id}` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/tms/instruct-on-behalf-drafts/{id}` | NOT IMPLEMENTED | — | — | — |
| PUT | `/dlt/{ncb}/api/octopus/tms/instruct-on-behalf-drafts/{id}/{status}` | NOT IMPLEMENTED | — | — | — |

### IMS — transaction queries

| Method | Official path | Status | Mock path | Controls | Since |
|--------|---------------|--------|-----------|----------|-------|
| GET | `/dlt/{ncb}/api/octopus/ims/transactions` | IMPLEMENTED | same (returns in-flight drafts) | `JWT` `mTLS` | v0.1.0 |
| POST | `/dlt/{ncb}/api/octopus/ims/transactions` (extract) | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/ims/transactions/{id}` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/ims/stats` | NOT IMPLEMENTED | — | — | — |

### GRS — global registry / business calendar

| Method | Official path | Status | Mock path | Controls | Since |
|--------|---------------|--------|-----------|----------|-------|
| GET | `/dlt/{ncb}/api/octopus/grs/current-business-window` | IMPLEMENTED | same | `JWT` `mTLS` | v0.1.0 |
| GET | `/dlt/{ncb}/api/octopus/grs/businessdate` | IMPLEMENTED | same | `JWT` `mTLS` | v0.1.0 |
| GET | `/dlt/{ncb}/api/octopus/grs/business-windows` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/grs/ncbs` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/grs/ncbs/{entityid}` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/grs/closed-days/{year}` | NOT IMPLEMENTED | — | — | — |
| POST | `/dlt/{ncb}/api/octopus/grs/entities` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/grs/entities` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/grs/entities/{entityid}` | NOT IMPLEMENTED | — | — | — |
| PATCH | `/dlt/{ncb}/api/octopus/grs/entities/{entityid}` | NOT IMPLEMENTED | — | — | — |
| PUT | `/dlt/{ncb}/api/octopus/grs/entities-drafts/{id}/{status}` | NOT IMPLEMENTED | — | — | — |
| POST | `/dlt/{ncb}/api/octopus/grs/mdlt-operators` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/grs/mdlt-operators-drafts/{id}` | NOT IMPLEMENTED | — | — | — |
| PUT | `/dlt/{ncb}/api/octopus/grs/mdlt-operators-drafts/{id}/{status}` | NOT IMPLEMENTED | — | — | — |
| PATCH | `/dlt/{ncb}/api/octopus/grs/mdlt-operators/{mdltOperatorID}` | NOT IMPLEMENTED | — | — | — |
| POST | `/dlt/{ncb}/api/octopus/grs/mdlt-operators-whitelists-drafts` | NOT IMPLEMENTED | — | — | — |
| PUT | `/dlt/{ncb}/api/octopus/grs/mdlt-operators-whitelists-drafts/{id}/{status}` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/grs/mdlt-operators-whitelists` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/grs/mdlt-operators-whitelists/{id}/manager/{managerid}` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/grs/mdlt-platforms/{networkid}/mdlt-operators` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/grs/mdlt-platforms-details` | NOT IMPLEMENTED | — | — | — |
| GET | `/dlt/{ncb}/api/octopus/grs/mdlt-platforms-details/{networkid}` | NOT IMPLEMENTED | — | — | — |

### IGW — inbound gateway XvP / direct-RTGS

| Method | Official path | Status | Mock path | Controls | Since |
|--------|---------------|--------|-----------|----------|-------|
| POST | `/igw/{ncb}/v1/xvps` | NOT IMPLEMENTED | — | — | — |
| GET | `/igw/{ncb}/v1/xvps/{xvpTransactionId}` | NOT IMPLEMENTED | — | — | — |
| POST | `/igw/{ncb}/v1/xvps/{xvpTransactionId}/payment` | NOT IMPLEMENTED | — | — | — |
| GET | `/igw/{ncb}/v1/xvps/{xvpTransactionId}/payment` | NOT IMPLEMENTED | — | — | — |
| POST | `/igw/{ncb}/v1/direct-rtgs/xvps` | NOT IMPLEMENTED | — | — | — |
| GET | `/igw/{ncb}/v1/direct-rtgs/xvps/{xvpTransactionId}` | NOT IMPLEMENTED | — | — | — |
| POST | `/igw/{ncb}/v1/direct-rtgs/xvps/{xvpTransactionId}/payment` | NOT IMPLEMENTED | — | — | — |
| GET | `/igw/{ncb}/v1/direct-rtgs/xvps/{xvpTransactionId}/payment` | NOT IMPLEMENTED | — | — | — |

### Coverage summary

- **IMPLEMENTED:** 12 official operations.
- **PARTIAL:** 3 (path-shape differences — see §3).
- **NOT IMPLEMENTED:** the remainder of the EII API (T2 accounts, GRS registry/entities/mDLT, PoA, instruct-on-behalf, direct-RTGS, XvP/IGW, extracts, stats).

---

## 2. Endpoints outside the EII OpenAPI

Two kinds live here: **standard IAM (Keycloak) endpoints** that also exist on real
Pontes (documented in the ECB Connectivity Training, not the EII OpenAPI), and
**mock-only helpers** with no real-Pontes equivalent.

### IAM (Keycloak-compatible) endpoints (`src/auth/*`) — standard platform

The mock exposes these so a client can complete the mTLS → token → API flow and
verify issued JWTs by their `kid`.

| Method | Path | Purpose | Controls | Since |
|--------|------|---------|----------|-------|
| POST | `/iam/realms/{ncb}/protocol/openid-connect/token` | Acquire a JWT (grant_type=password) | `mTLS-req` `STATE` | v0.1.0 |
| GET | `/iam/realms/{ncb}/protocol/openid-connect/certs` | JWKS — signing public key(s) for JWT verification (`kid=mock-pontes-key-1`, ES256) | `none` | unreleased |
| GET | `/iam/realms/{ncb}/.well-known/openid-configuration` | OIDC discovery (`issuer`, `token_endpoint`, `jwks_uri`) | `none` | unreleased |

### Enrollment (mock-only local CA, `src/auth/*`)

Mock-only: real Pontes issues certificates via the TARGET Service Desk, not an API.

| Method | Mock path | Purpose | Controls | Since |
|--------|-----------|---------|----------|-------|
| POST | `/iam/realms/{ncb}/protocol/openid-connect/csr` | Local CA: submit CSR, declare user, receive signed cert | `STATE` (username/password + CSR; new users need `profile`+`entityBIC`) | v0.1.0 |
| GET | `/admin/enrolled-users` | List enrolled users | `none` | v0.1.0 |
| GET | `/admin/enrolled-users/{username}/certificate` | Fetch an enrolled user's certificate (PEM) | `none` | v0.1.0 |

### Admin state-simulation (`src/admin/*`)

Only mock-only controls with **no official-API equivalent** remain. The former
state-changing/querying admin endpoints (`fund`, `defund`, `transfers`, wallet
list/detail, transaction list) were **removed** — drive that state through the
official funding/defunding/transaction/wallet endpoints instead.

| Method | Mock path | Purpose | Controls | Since |
|--------|-----------|---------|----------|-------|
| POST | `/admin/reset` | Reset mock state | `none` | v0.1.0 |
| GET | `/admin/business-window` | Read business-window config | `none` | v0.1.0 |
| PUT | `/admin/business-window` | Update business-window config | `none` | v0.1.0 |

### UI & spec (`src/ui/*`)

| Method | Mock path | Purpose | Controls | Since |
|--------|-----------|---------|----------|-------|
| GET | `/`, `/ui`, `/ui/docs`, `/ui/enroll` | Native control-panel UI | `none` | v0.1.0 |
| GET | `/openapi.json` | Mock's own OpenAPI | `none` | v0.1.0 |
| GET | `/openapi/official.json` | Vendored official spec | `none` | v0.1.0 |
| GET | `/ui/config.json` | Runtime config | `none` | v0.1.0 |
| POST | `/ui/inspect` | Parse a submitted PEM (CSR/cert) | `none` | v0.1.0 |

---

## 3. Notes on PARTIAL endpoints and known gaps

### PARTIAL — path-shape differences

- **Draft status updates.** The official spec uses a generic
  `.../{...-drafts}/{id}/{status}` path where `{status}` is the target state.
  RVS transactions now serve the **generic `{status}`** transition
  (`approve`/`cancel`, case-insensitive, plus the `APPROVED`/`CANCELED` target
  states) alongside a `GET .../transactions-drafts/{id}` read-by-id. TMS funding
  also serves the **generic `{status}`** (approve|cancel) plus a
  `GET .../tms/funding-defunding-requests(-drafts)/{id}` read; TMS defunding
  likewise serves the generic `{status}` (approve **and cancel**, newly added).
  Behaviour: `404` if the draft is unknown, `409` if it is not
  in `PENDING_APPROVAL`. Two-step **approval** enforces **four-eyes** (approver
  `≠` initiator → `403`) and, for debiting workflows, checks the source **debit
  right** (`403`) and **available balance** (`422`) *at approval only*.

### Behavioural simplifications on implemented endpoints

- **DCW object model.** Dedicated Cash Wallets are modelled with an
  `availableBalance` + `lockedBalance` (invariant `available + locked = total`),
  per-currency holdings, an `isBlocked` flag/validity window, and **debit rights**
  (by default only a user of the owning entity may debit; PoA grantees and
  whitelisted market DLT operators are also allowed). The store exposes
  `credit`/`debit`/`lock`/`release`/`settleLocked` + `canDebit`, and wallet reads
  expose the available/locked/holdings model. State **persists to Redis** when
  `REDIS_URL` is set. *(Money-movement handlers are migrated onto these ops in the
  workflow issues; see the tracking epic.)*
- **Generic workflow engine.** Every settlement operation (2-step transfer,
  funding, defunding, 1-step bridge payment — and, later, XvP) runs on a shared
  `Workflow` base (`src/workflows/`) with one state machine
  (`INITIALIZED → PENDING_APPROVAL → SETTLED | CANCELED`) and two extension
  points: `conditions(phase)` (validate/authorise a transition) and `apply()`
  (the DCW debit/credit effect at settlement). Two-step workflows persist a
  `PENDING_APPROVAL` record and settle on approval; one-step workflows settle in
  a single call. Consistent with the availability policy, **two-step workflows do
  not reserve funds** — availability is only ever checked at the approval step,
  and only XvP locks funds up-front. Workflow records (drafts) and settled
  transactions **persist to Redis** when `REDIS_URL` is set.
- **One-step payment enforces funds + rights.** `POST .../bridge/payments`
  (EXTERNAL_USER) now debits via the checked DCW op: the caller must have a
  **debit right** on the source (owner / PoA / whitelisted operator, and the
  wallet not blocked/out-of-validity) and it must hold **sufficient available
  balance now**. Failures return `403` (rights) or `422` (insufficient balance);
  missing fields still return `400`; success returns `200` + the confirmation
  string. The source DCW is auto-created **owned by the caller's entity** so a
  party paying from its own wallet passes the rights check.
- **Direct RTGS payment (composite).** A direct-RTGS payment is modelled as a
  **defund(source) + fund(target)** composite workflow — net effect: checked
  debit of the payer + credit of the receiver. Both a **two-step** variant
  (`POST/PUT/GET .../octopus/tms/direct-rtgs/payments(-drafts)/{id}/{status}`,
  PILOT_READ_WRITE) and a **one-step** variant
  (`POST .../bridge/direct-rtgs/payments`, EXTERNAL_USER, returns `200` + a
  confirmation string) are served. Both are **NRO-signed on create** (signature
  over `id + amount + payerBank + receiverBank`, `signerPEM` = presented mTLS
  cert). Availability + debit rights are checked at approval (two-step) or
  immediately (one-step). *(Mock-defined paths; distinct from the `/igw/…`
  direct-RTGS/XvP surface, which is still not implemented.)*
- **PFoD (matched, 2-sided).** The deliver (`POST .../bridge/initpfoddeli`,
  seller) and receive (`POST .../bridge/initpfodrece`, buyer) legs (EXTERNAL_USER)
  are submitted independently and persisted as `PENDING_MATCH` PFOD drafts keyed
  by `tradeID`. When both legs are present with consistent `amount`/`currency`,
  the matched wallet payment fires (checked debit of the seller + credit of the
  buyer) → `SETTLED`; inconsistent legs → `422`; an unmatched leg past its window
  (`PONTES_PFOD_MATCH_WINDOW_SEC`, default 1h) is lazily marked `EXPIRED` (`410`).
- **Auto-created wallets.** RVS/TMS/bridge handlers auto-create any referenced
  wallet (via the DCW create primitive: zero balances, same-entity debit rights,
  no PoA/whitelist) instead of requiring the official AMS wallet-creation flow.
- **Infinite funding source.** The token-issuance wallet
  `WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET` that sources funding is treated as
  having an infinite balance: funding approvals credit the target wallet without
  debiting/checking the issuance wallet. Funding is therefore the supported way
  to seed cash into the mock (there is no admin `fund` shortcut).
- **Business window is not enforced.** The mock serves current-business-window /
  businessdate values but does not reject transactions outside an open window.
- **IMS list returns drafts.** `GET .../ims/transactions` returns in-flight mock
  drafts rather than the full settled-transaction extract model of the real API.
- **`supplementaryData` (non-official, "reason of payment").** The **2-step**
  transaction endpoint `POST .../rvs/transactions-requests` accepts an optional
  `supplementaryData` string and carries it through the draft, the settled
  transaction, and the `GET .../ims/transactions` query. This anticipates the ECB
  change (Jul 2026 clarification) that surfaces the Pontes **U2A** "reason for the
  payment" in `octopus.Settlement.supplementaryData` — it is *readable* in the
  official spec but not officially settable via A2A submission. Note: the
  **1-step** `POST .../bridge/payments` endpoint does **not** accept
  `supplementaryData`.

### Gaps worth follow-up (not fixed here)

- **NRO is create-only (by design).** `NRO` is verified on funding/defunding
  **create** POSTs only (signature over
  `techFundRequestID + amount + creditedCashWalletOwnerID + debitedCashWalletOwnerID`,
  with `signerPEM` matched to the presented mTLS cert). The `-drafts/{id}/{status}`
  approve/cancel PUTs are **not** signature-checked — the route patterns are now
  anchored to the create paths so approval is no longer erroneously rejected for a
  missing signature (fixed in the funding issue). Four-eyes (approver ≠ initiator)
  is enforced on funding/defunding approval instead.
