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
| POST | `/dlt/{ncb}/api/bridge/payments` | PARTIAL | `/dlt/{ncb}/api/bridge/cash-token/payments` | `JWT` `mTLS` `PROFILE:EXTERNAL_USER` `STATE` | v0.1.0 |
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

- **IMPLEMENTED:** 11 official operations.
- **PARTIAL:** 4 (path-shape differences — see §3).
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

- **1-step payment.** Official `POST /dlt/{ncb}/api/bridge/payments`; the mock
  serves `POST /dlt/{ncb}/api/bridge/cash-token/payments`. Same intent (immediate
  cash-token settlement) but a client pointed at the official path will 404.
  Enforces `PROFILE:EXTERNAL_USER`.
- **Draft status updates.** The official spec uses a generic
  `.../{...-drafts}/{id}/{status}` path where `{status}` is the target state
  (e.g. `APPROVED`, `CANCELED`). The mock instead exposes literal
  `/approve` and `/cancel` sub-paths for RVS transactions and TMS funding, and
  only `/approve` for TMS defunding (no `cancel`). Behaviour: `404` if the draft
  is unknown, `409` if it is not in `PENDING_APPROVAL`.

### Behavioural simplifications on implemented endpoints

- **Auto-created wallets.** RVS/TMS/bridge handlers auto-create any referenced
  wallet instead of requiring the official AMS wallet-creation flow. There is no
  balance/overdraft check — debits can drive a balance negative.
- **Infinite funding source.** The token-issuance wallet
  `WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET` that sources funding is treated as
  having an infinite balance: funding approvals credit the target wallet without
  debiting/checking the issuance wallet. Funding is therefore the supported way
  to seed cash into the mock (there is no admin `fund` shortcut).
- **Business window is not enforced.** The mock serves current-business-window /
  businessdate values but does not reject transactions outside an open window.
- **IMS list returns drafts.** `GET .../ims/transactions` returns in-flight mock
  drafts rather than the full settled-transaction extract model of the real API.

### Gaps worth follow-up (not fixed here)

- **No NRO on cancel.** `NRO` is applied to funding/defunding **create** POSTs
  only; approve/cancel PUTs are not signature-checked.
