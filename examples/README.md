# mock-pontes client examples

Minimal, self-contained clients that connect to the mock over **mTLS**, acquire a
**JWT**, and submit an **NRO-signed funding request** — in **TypeScript**,
**Python**, and **Java**.

| Language | Folder | TLS material | Runtime deps |
|----------|--------|--------------|--------------|
| TypeScript | [`typescript/`](typescript/) | PEM cert + key | none (Node built-ins) |
| Python | [`python/`](python/) | PEM cert + key | `requests`, `cryptography` |
| Java | [`java/`](java/) | PKCS#12 (`.p12`) | none (JDK built-ins) |

## The shared scenario

Each example performs the same four steps:

1. `GET /check/mtls` — proves the client certificate is accepted (prints the
   fingerprint the server saw).
2. `GET /dlt/{ncb}/api/octopus/health` — a basic round trip.
3. `POST /iam/realms/{ncb}/protocol/openid-connect/token` — acquires a JWT using
   the client certificate (mTLS) + username/password.
4. `POST /dlt/{ncb}/api/octopus/tms/funding-requests` — a **2-step funding
   request** carrying an **NRO signature**. This is the interesting bit: the
   payload fields `techFundRequestID + amount + creditedCashWalletOwnerID +
   debitedCashWalletOwnerID` are concatenated, signed with **ECDSA P-256 +
   SHA-256** using the client's private key, and sent as `signature` +
   `signerPEM`. The mock verifies the signature **and** that `signerPEM` matches
   the presented mTLS certificate.

## Prerequisites

1. **A running mock.** From the repo root: `npm run dev` (defaults to
   `https://localhost:3001`).
2. **An enrolled user** — a certificate + private key (and, for Java, a `.p12`).
   Follow [`../docs/ENROLL-WITH-ECB-TOOLS.md`](../docs/ENROLL-WITH-ECB-TOOLS.md).
   The quickest path:

   ```bash
   # generate an EC P-256 key + CSR
   openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out user.key
   printf '[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=PFRBSUIFRPPXXX0001\n' > csr.cnf
   openssl req -new -key user.key -out user.csr -config csr.cnf

   # enroll -> issued certificate
   jq -n --arg csr "$(cat user.csr)" \
     '{username:"PFRBSUIFRPPXXX0001",password:"initiator-secret",
       profile:"PILOT_READ_WRITE",entityBIC:"BSUIFRPPXXX",csr:$csr}' \
   | curl -sk -X POST https://localhost:3001/iam/realms/bdf/protocol/openid-connect/csr \
       -H 'content-type: application/json' -d @- | jq -r .certificate > user.crt

   # (Java only) bundle into a .p12
   openssl pkcs12 -export -inkey user.key -in user.crt -name PFRBSUIFRPPXXX0001 -out user.p12
   ```

## Server certificate trust (CA)

The mock serves a **self-signed** server certificate. There is currently no
endpoint to download its server CA, so the examples **skip server verification by
default** (fine for local dev). To enable verification, export the mock's server
CA to a PEM file and point `CA_CERT` at it.

## Run

See each folder's README:

- TypeScript: `cd typescript && npm install && CLIENT_CERT=… CLIENT_KEY=… npm start`
- Python: `cd python && pip install -r requirements.txt && CLIENT_CERT=… CLIENT_KEY=… python main.py`
- Java: `cd java && CLIENT_P12=… P12_PASSWORD=… mvn -q compile exec:java`
  (or the Docker one-liner in [`java/README.md`](java/README.md))

All cert/key/CA paths, `BASE_URL`, `NCB`, `PONTES_USERNAME`/`PONTES_PASSWORD`, and
the funding parameters are configurable via environment variables (sensible
defaults match the enrollment snippet above).

## Against real Pontes

The same code works against real Pontes: set `BASE_URL` to the EII gateway,
`CA_CERT` to the ECB CA bundle, and use your **TARGET Service-Desk-issued**
certificate/key (and matching NCB/realm + credentials).
