# Python mTLS + NRO example

Uses [`requests`](https://requests.readthedocs.io/) for mTLS and
[`cryptography`](https://cryptography.io/) for the NRO ECDSA signature.

## Prerequisites

- Python 3.9+
- An enrolled user's **certificate + private key** (`user.crt`, `user.key`; see
  [`../../docs/ENROLL-WITH-ECB-TOOLS.md`](../../docs/ENROLL-WITH-ECB-TOOLS.md)).
- A running mock (default `https://localhost:3001`).

## Run

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

CLIENT_CERT=/path/to/user.crt \
CLIENT_KEY=/path/to/user.key \
PONTES_USERNAME=PFRBSUIFRPPXXX0001 \
PONTES_PASSWORD=initiator-secret \
python main.py
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
| `PONTES_USERNAME` / `PONTES_PASSWORD` | `PFRBSUIFRPPXXX0001` / `initiator-secret` | Credentials from enrollment |
| `APPROVER_CERT` / `APPROVER_KEY` | `approver.crt` / `approver.key` | Second (approver) user's cert + key for four-eyes approval (steps 5–6). When absent, the example stops after step 4. |
| `APPROVER_USERNAME` / `APPROVER_PASSWORD` | `PFRBSUIFRPPXXX0002` / `approver-secret` | Approver credentials from the second enrollment |
| `AMOUNT`, `CREDITED_ALIAS`, `ENTITY_BIC`, `MANAGER_BIC` | see `main.py` | Funding parameters |

## Against real Pontes

Set `BASE_URL` to the Pontes EII gateway and use your Service-Desk-issued
certificate/key. Verification is on by default; set `CA_CERT` to the ECB CA
bundle only if the gateway cert is not publicly trusted.
