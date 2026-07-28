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
PONTES_USERNAME=PFRBSUIFRPPXXX0001 \
PONTES_PASSWORD=initiator-secret \
npm start
```

## Environment variables

| Var | Default | Description |
|-----|---------|-------------|
| `BASE_URL` | `https://localhost:3001` | Mock base URL |
| `NCB` | `bdf` | NCB / realm |
| `CLIENT_CERT` | `user.crt` | Client certificate (PEM) |
| `CLIENT_KEY` | `user.key` | Client private key (PEM) |
| `CA_CERT` | *(unset)* | Server CA (PEM). When unset, the server cert is **not** verified (local dev). |
| `PONTES_USERNAME` / `PONTES_PASSWORD` | `PFRBSUIFRPPXXX0001` / `initiator-secret` | Credentials from enrollment |
| `APPROVER_CERT` / `APPROVER_KEY` | `approver.crt` / `approver.key` | Second (approver) user's cert + key for four-eyes approval (steps 5–6). When absent, the example stops after step 4. |
| `APPROVER_USERNAME` / `APPROVER_PASSWORD` | `PFRBSUIFRPPXXX0002` / `approver-secret` | Approver credentials from the second enrollment |
| `AMOUNT`, `CREDITED_ALIAS`, `ENTITY_BIC`, `MANAGER_BIC` | see `index.ts` | Funding parameters |

## Against real Pontes

Set `BASE_URL` to the Pontes EII gateway, `CA_CERT` to the ECB CA bundle, and use
your Service-Desk-issued certificate/key. The code is unchanged.
