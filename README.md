# mock-pontes

A stateful **mock of the ECB Pontes (TARGET) A2A API** for local development and
testing. It lets bank and PSP developers build and test their Pontes integration
locally — without needing access to the ECB test (UTEST) environment or waiting
for a Pontes business window.

> ⚠️ This is an **unofficial** community tool. It is not produced, endorsed, or
> supported by the European Central Bank. It reproduces the *shape* of the
> publicly documented Pontes A2A API for convenience only. Always validate
> against the official ECB environment and documentation before going live.

## Official ECB Pontes documentation

The ECB publishes the Pontes specifications and API documentation here:

📚 <https://www.ecb.europa.eu/paym/target/target-professional-use-documents-links/pontes-documents-links/html/index.en.html>

## Features

- **Pontes-compatible A2A routes** — wallets, transfers, funding/defunding, and
  the business-window endpoint.
- **Stateful draft lifecycle** — create → approve, with an in-memory (or Redis)
  ledger you can inspect and drive.
- **Admin API** — simulate funding, defunding, and transfers, and reset state.
- **HTTPS + mTLS** with a self-signed runtime PKI, plus CSR enrollment and a
  token endpoint, so you can exercise the full transport/auth flow locally.
- **Zero external services required** — runs standalone; Redis is optional.

## Quick start (Docker)

```bash
docker run --rm -p 3001:3001 ghcr.io/digital-assets-work/mock-pontes:latest
```

Then call a public endpoint (the mock uses a self-signed certificate, so pass
`-k`/`--insecure` for local testing):

```bash
curl -sk https://localhost:3001/dlt/bdf/api/octopus/health
# {"octopus":"UP","server":"UP","mock":true}

curl -sk https://localhost:3001/check/ip
# {"status":"OK","check":"ip","ip":"...","mock":true}
```

## Quick start (from source)

Requires Node.js 24+.

```bash
git clone https://github.com/digital-assets-work/mock-pontes.git
cd mock-pontes
npm ci
cp .env.example .env

npm run dev      # hot-reload dev server
# or
npm run build && npm run run   # production build + run
```

## API surface

The mock's OpenAPI description is served in **both JSON and YAML**, and the
vendored official ECB Pontes spec is exposed alongside it:

| Spec | JSON | YAML |
|------|------|------|
| Mock (this service) | `GET /openapi.json` | `GET /openapi.yaml` |
| Official ECB Pontes (vendored) | `GET /openapi/official.json` | `GET /openapi/official.yaml` |

Browse them interactively via the embedded Swagger UI at `/ui/docs`.

### Pontes-compatible routes

These mimic the real Pontes A2A API so a client can target the mock by pointing
its Pontes base URL at this service.

**[`docs/ENDPOINT-COVERAGE.md`](docs/ENDPOINT-COVERAGE.md) is the single source of
truth** for the full Pontes surface (every method + path, implemented/partial/not,
and the controls enforced). The served OpenAPI at `/openapi.json` (and the
Swagger UI at `/ui/docs`) is generated from the same routes and tags anything
unimplemented `NotImplemented`. To avoid drift, this README intentionally does
**not** duplicate that table.

Transport troubleshooting endpoints (served at the domain root, mirroring the
real Pontes gateway): `GET /check/ip`, `GET /check/mtls`.

> **Seeding cash into the mock.** Use the official **funding** endpoint
> (`POST .../tms/funding-requests` then approve). The token-issuance wallet that
> sources the funds is treated as having an **infinite** balance, so funding
> always succeeds — there is no separate admin "fund" shortcut. Move balances
> between wallets with the official transfer (`rvs/transactions-requests` +
> approve) or 1-step bridge payment, and remove cash with **defunding**.
>
> **Wallets.** Funding **auto-creates** its credited wallet for **your own
> entity** if it doesn't exist; you can also pre-create one with
> `POST .../ams/wallets` (owner taken from your JWT — you may only create wallets
> for your own entity). Every other settlement path **rejects an unknown credited
> wallet** with `422 HL-WAL-003` (conservation of value, issue #77) rather than
> silently discarding the credit.

### Admin routes

Mock-only endpoints with **no official-API equivalent** (everything else is now
driven through the official Pontes endpoints above — see
[`docs/ENDPOINT-COVERAGE.md`](docs/ENDPOINT-COVERAGE.md)):

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/reset` | Reset mock state |
| GET | `/admin/business-window` | Get business window config |
| PUT | `/admin/business-window` | Update business window config |

> **Security — the admin surface is unauthenticated by default.** `ADMIN_TOKEN`
> is **not set** by default, and while it is unset the state-changing admin
> endpoints (`POST /admin/reset`, `PUT /admin/business-window`) and
> `GET /admin/enrolled-users` are **open** — convenient for local development.
> **Any published / public instance MUST set `ADMIN_TOKEN`** so those endpoints
> require it (via the `X-Admin-Token` header, or `Authorization: Bearer <token>`);
> otherwise any visitor could reset everyone's state. When the token is set, CSR
> enrolment still works but issues short-lived (1 hour) certificates. See
> [`docs/TLS-MTLS-AND-CERTS.md`](docs/TLS-MTLS-AND-CERTS.md) §9.

### Enrollment routes (mock-only)

The mock ships a **local certificate authority** so you can obtain client
certificates without the real ECB process. These endpoints have **no equivalent
on real Pontes** — there, certificates are issued manually by the **TARGET
Service Desk**, not through an API.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/iam/realms/{ncb}/protocol/openid-connect/csr` | Submit a PKCS#10 CSR; declares the user (when new) and returns a signed certificate (PEM) |
| GET | `/admin/enrolled-users` | List users that have a certificate enrolled in this instance |
| GET | `/admin/enrolled-users/{username}/certificate` | Fetch an enrolled user's certificate (PEM) |

**CSR request body** (`application/json`):

| Field | Required | Notes |
|-------|----------|-------|
| `username` | always | Must match the CSR Common Name |
| `password` | always | Verified for an existing user; set on first declaration |
| `csr` | always | PKCS#10 CSR in PEM format |
| `profile` | new users only | e.g. `PILOT_READ_WRITE`, `EXTERNAL_USER` |
| `entityBIC` | new users only | Owning entity BIC (MSPID) |

Responses: `200` `{ "certificate": "<PEM>" }` · `400` missing fields / invalid
CSR · `401` invalid credentials for an existing user · `409` certificate
fingerprint already associated with another user. `GET
/admin/enrolled-users/{username}/certificate` returns `404` when the user has no
enrolled certificate.

The easiest way to drive these is the built-in UI: the **[`/ui/enroll`](/ui/enroll)**
page uploads/pastes a CSR, declares the user, and downloads the signed
certificate (and a PKCS#12 bundle), while **[`/ui/docs`](/ui/docs)** exposes the
same endpoints via Swagger UI ("try it out"). See
[`docs/TLS-MTLS-AND-CERTS.md`](docs/TLS-MTLS-AND-CERTS.md) for the runtime PKI,
CSR enrollment, and PKCS#12 export details.

## Configuration

Configuration is via environment variables (see [`.env.example`](.env.example)):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Listening port |
| `HOST` | `localhost` (`0.0.0.0` in the Docker image) | Bind address |
| `REDIS_URL` | — | Optional Redis URL for multi-replica / persistent state |
| `ADMIN_TOKEN` | — (unset → admin surface open) | Gate the admin surface. **Unset by default; set it on any published/public instance** so `/admin/*` writes and `/admin/enrolled-users` require it (`X-Admin-Token` header or `Authorization: Bearer`). |
| `TLS_SAN` | `dns:localhost;ip:127.0.0.1` | Subject Alternative Names for the runtime server cert |
| `TLS_SUBJECT` | `CN=localhost O=MockPontes C=DEV` | Subject for the runtime server cert |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | — | Serve an externally-provided (e.g. Let's Encrypt) server cert instead of the self-signed one |
| `PONTES_MOCK_ENFORCE_BUSINESS_WINDOW` | `false` | When `true`, mutating official API calls (`POST`/`PUT`/… on `/dlt/*`, `/igw/*`) are rejected with `403 HL-BW-001` outside the business window. `openTime`/`closeTime` are read in **Frankfurt** (`Europe/Berlin`) time. Off by default so local seeding isn't blocked. |

> The `TLS_SUBJECT` default above is for **local** use (`C=DEV`). A **deployed**
> instance sets `TLS_SUBJECT` to the real identity, e.g.
> `CN=<server FQDN>, O=MockPontes, C=FR`.

State is kept in memory by default. Set `REDIS_URL` to persist runtime PKI and
enrolled users across restarts and to run multiple replicas.

## Documentation

- [`examples/`](examples/) — runnable **mTLS + NRO** client examples in
  TypeScript, Python, and Java (check-mtls → health → token → NRO-signed funding).
- [`docs/DOMAIN-MODEL.md`](docs/DOMAIN-MODEL.md) — the Pontes functional object
  model: concepts, cardinalities, fields, and lifecycles, coloured by what the
  mock implements.
- [`docs/ENDPOINT-COVERAGE.md`](docs/ENDPOINT-COVERAGE.md) — which official ECB
  Pontes endpoints the mock implements, the controls each enforces, and the mock
  release they were introduced in.
- [`docs/ENROLL-WITH-ECB-TOOLS.md`](docs/ENROLL-WITH-ECB-TOOLS.md) — take a key
  & CSR generated with the official ECB CertApp tool, enroll in the mock, and
  produce/install a client certificate and `.p12`.
- [`docs/TLS-MTLS-AND-CERTS.md`](docs/TLS-MTLS-AND-CERTS.md) — HTTPS/mTLS, runtime
  PKI, CSR enrollment, PKCS#12 export, and profile enforcement.

## Tech stack

- **H3 + listhen** (API-only), **TypeScript**
- `tsx` for development, `esbuild` for the production bundle
- Optional **Redis** for state persistence

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE).
