# TypeScript mTLS + NRO example

Minimal client using **Node.js built-ins only** (`node:https`, `node:crypto`) —
no runtime dependencies. Runs via [`tsx`](https://github.com/privatenumber/tsx).

## Prerequisites

- Node.js 22+
- An enrolled user's **certificate + private key** (see
  [`../../docs/ENROLL-WITH-ECB-TOOLS.md`](../../docs/ENROLL-WITH-ECB-TOOLS.md)) —
  `user.crt` and `user.key` (PEM).
- A running mock (`npm run dev` in the repo root; default `https://localhost:3001`).

## Run

```bash
npm install
CLIENT_CERT=/path/to/user.crt \
CLIENT_KEY=/path/to/user.key \
npm start
```

## Environment variables

| Var | Default | Description |
|-----|---------|-------------|
| `BASE_URL` | `https://localhost:3001` | Mock base URL |
| `NCB` | `bdf` | NCB / realm |
| `CLIENT_CERT` | `user.crt` | Client certificate (PEM) |
| `CLIENT_KEY` | `user.key` | Client private key (PEM) |
| `CA_CERT` | *(unset)* | Server CA (PEM). Unset ⇒ verify against the system trust store (works against the hosted mock). For a local self-signed mock, fetch it: `curl -sk $BASE_URL/ca.pem -o mock-ca.pem` then set `CA_CERT=mock-ca.pem`. |
| `INSECURE_SKIP_VERIFY` | *(unset)* | Set to `true` to skip TLS server verification (dev only — explicit opt-out). |
| `APPROVER_CERT` / `APPROVER_KEY` | `approver.crt` / `approver.key` | Second (approver) user's cert + key for four-eyes approval (steps 5–6). When absent, the example stops after step 4. |
| `AMOUNT`, `CREDITED_ALIAS`, `ENTITY_BIC`, `MANAGER_BIC` | see `index.ts` | Funding parameters |

## Against real Pontes

Set `BASE_URL` to the Pontes EII gateway and use your Service-Desk-issued
certificate/key. Verification is on by default; set `CA_CERT` to the ECB CA
bundle only if the gateway cert is not publicly trusted. The code is unchanged.
