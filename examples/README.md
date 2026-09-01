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

Each example performs the same steps:

1. `GET /check/mtls` — proves the client certificate is accepted (prints the
   fingerprint the server saw).
2. `GET /dlt/{ncb}/api/octopus/health` — a basic round trip.
3. `POST /iam/realms/{ncb}/protocol/openid-connect/token` — acquires a JWT using
   just the client certificate (mTLS); no password is involved (issue #100 —
   confirmed against the real `utest` environment that A2A has no per-user
   password, identity comes solely from the enrolled certificate).
4. `POST /dlt/{ncb}/api/octopus/tms/funding-requests` — a **2-step funding
   request** carrying an **NRO signature**. This is the interesting bit: the
   payload fields `techFundRequestID + amount + creditedCashWalletOwnerID +
   debitedCashWalletOwnerID` are concatenated, signed with **ECDSA P-256 +
   SHA-256** using the client's private key, and sent as `signature` +
   `signerPEM`. The mock verifies the signature **and** that `signerPEM` matches
   the presented mTLS certificate.
5. `PUT /dlt/{ncb}/api/octopus/tms/funding-requests-drafts/{id}/approve` — the
   **four-eyes approval**, performed by a **second, different** enrolled user.
6. `GET /dlt/{ncb}/api/octopus/ams/wallets/{alias}` — confirms the credited
   wallet now holds the funded amount.

> **Four-eyes control.** A funding request is *created* by the initiator but must
> be *approved* by a **different** user (a distinct certificate / user UUID).
> Approving your own request returns `403 HL-GER-003 "Approver must differ from
> the initiator (four-eyes control)"`. That is why the scenario enrols **two**
> users. Steps 5–6 run only when a second (approver) certificate is configured
> (`APPROVER_CERT`/`APPROVER_KEY`, or `APPROVER_P12` for Java); otherwise the
> example stops after step 4 and prints how to enable them.

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
     '{username:"PFRBSUIFRPPXXX0001",
       profile:"PILOT_READ_WRITE",entityBIC:"BSUIFRPPXXX",csr:$csr}' \
   | curl -sk -X POST https://localhost:3001/iam/realms/bdf/protocol/openid-connect/csr \
       -H 'content-type: application/json' -d @- | jq -r .certificate > user.crt

   # (Java only) bundle into a .p12
   openssl pkcs12 -export -inkey user.key -in user.crt -name PFRBSUIFRPPXXX0001 -out user.p12
   ```

3. **A second enrolled user (the approver)** — four-eyes approval (steps 5–6)
   requires a *different* user. Repeat the enroll with a new username/key:

   ```bash
   # generate the approver's EC P-256 key + CSR
   openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out approver.key
   printf '[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=PFRBSUIFRPPXXX0002\n' > approver-csr.cnf
   openssl req -new -key approver.key -out approver.csr -config approver-csr.cnf

   # enroll the approver (same entityBIC so it can act on the same wallet)
   jq -n --arg csr "$(cat approver.csr)" \
     '{username:"PFRBSUIFRPPXXX0002",
       profile:"PILOT_READ_WRITE",entityBIC:"BSUIFRPPXXX",csr:$csr}' \
   | curl -sk -X POST https://localhost:3001/iam/realms/bdf/protocol/openid-connect/csr \
       -H 'content-type: application/json' -d @- | jq -r .certificate > approver.crt

   # (Java only) bundle the approver into a .p12
   openssl pkcs12 -export -inkey approver.key -in approver.crt -name PFRBSUIFRPPXXX0002 -out approver.p12
   ```

## Server certificate trust (CA)

The examples **verify the server certificate by default** — do the right thing
out of the box:

- **Against the hosted mock** (`https://mock.integration.pontes.ca-dag.work`):
  its certificate is publicly trusted (Let's Encrypt), so verification works with
  **no configuration** — no `CA_CERT`, no `-k`.
- **Against a local mock** (self-signed cert): fetch the mock's server CA once and
  point `CA_CERT` at it:

  ```bash
  # one-time -k just to fetch the CA (the file itself is public material)
  curl -sk https://localhost:3001/ca.pem -o mock-ca.pem
  export CA_CERT=mock-ca.pem
  # thereafter: curl --cacert mock-ca.pem https://localhost:3001/check/mtls
  ```

If you must skip verification (dev only), set `INSECURE_SKIP_VERIFY=true` — an
explicit, loud opt-out. The examples never disable verification silently.

## Run

See each folder's README:

- TypeScript: `cd typescript && npm install && CLIENT_CERT=… CLIENT_KEY=… npm start`
- Python: `cd python && pip install -r requirements.txt && CLIENT_CERT=… CLIENT_KEY=… python main.py`
- Java: `cd java && CLIENT_P12=… P12_PASSWORD=… mvn -q compile exec:java`
  (or the Docker one-liner in [`java/README.md`](java/README.md))

All cert/key/CA paths, `BASE_URL`, `NCB`, and the funding parameters are
configurable via environment variables (sensible defaults match the enrollment
snippet above).

## Against real Pontes

The same code works against real Pontes: set `BASE_URL` to the EII gateway,
`CA_CERT` to the ECB CA bundle, and use your **TARGET Service-Desk-issued**
certificate/key (and matching NCB/realm + credentials).
