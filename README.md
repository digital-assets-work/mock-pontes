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
curl -sk https://localhost:3001/dlt/de/api/octopus/health
# {"octopus":"UP","server":"UP","mock":true}

curl -sk https://localhost:3001/check/ip
# {"status":"OK","check":"ip","ip":"...","mock":true}
```

## Quick start (from source)

Requires Node.js 22+.

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

### Pontes-compatible routes

These mimic the real Pontes A2A API so a client can target the mock by pointing
its Pontes base URL at this service.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dlt/{ncb}/api/octopus/health` | Health check |
| GET | `/dlt/{ncb}/api/octopus/ams/wallets/{walias}` | Wallet details |
| GET | `/dlt/{ncb}/api/octopus/ams/wallets/{walias}/transactions` | Wallet transactions |
| POST | `/dlt/{ncb}/api/octopus/rvs/transactions-requests` | Create transfer draft |
| PUT | `/dlt/{ncb}/api/octopus/rvs/transactions-drafts/{id}/approve` | Approve draft |
| POST | `/dlt/{ncb}/api/octopus/rvs/funding-requests` | Create funding draft |
| POST | `/dlt/{ncb}/api/octopus/rvs/defunding-requests` | Create defunding draft |
| GET | `/dlt/{ncb}/api/bridge/current-business-window` | Business window |

Transport troubleshooting endpoints (served at the domain root, mirroring the
real Pontes gateway): `GET /check/ip`, `GET /check/mtls`.

### Admin routes

Simulation endpoints to drive the mock's state:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/wallets` | List all mock wallets & balances |
| GET | `/admin/wallets/:alias` | Wallet detail with transaction log |
| POST | `/admin/wallets/:alias/fund` | Simulate funding (credit wallet) |
| POST | `/admin/wallets/:alias/defund` | Simulate defunding (debit wallet) |
| POST | `/admin/transfers` | Simulate transfer between wallets |
| GET | `/admin/transactions` | List all mock transactions |
| POST | `/admin/reset` | Reset mock state |
| GET | `/admin/business-window` | Get business window config |
| PUT | `/admin/business-window` | Update business window config |

## Configuration

Configuration is via environment variables (see [`.env.example`](.env.example)):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Listening port |
| `HOST` | `localhost` (`0.0.0.0` in the Docker image) | Bind address |
| `REDIS_URL` | — | Optional Redis URL for multi-replica / persistent state |
| `TLS_SAN` | `dns:localhost;ip:127.0.0.1` | Subject Alternative Names for the runtime server cert |
| `TLS_SUBJECT` | `CN=localhost O=MockPontes C=DEV` | Subject for the runtime server cert |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | — | Serve an externally-provided (e.g. Let's Encrypt) server cert instead of the self-signed one |

State is kept in memory by default. Set `REDIS_URL` to persist runtime PKI and
enrolled users across restarts and to run multiple replicas.

## Documentation

- [`docs/ENDPOINT-COVERAGE.md`](docs/ENDPOINT-COVERAGE.md) — which official ECB
  Pontes endpoints the mock implements, the controls each enforces, and the mock
  release they were introduced in.
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
