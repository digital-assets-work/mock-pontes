# Enroll in the mock using ECB-tool key & CSR

This guide shows how to take a **private key and Certificate Signing Request
(CSR)** generated with the **official ECB CertApp tool** and use the mock's local
CA to obtain a client certificate, package it as a **PKCS#12 (`.p12`)**, and
install it on your machine.

It lets you rehearse the real TARGET certificate flow **locally** — without the
TARGET Service Desk. On real Pontes, the CertApp only *builds* the CSR; the
certificate is then issued **manually by the TARGET Service Desk**. Here, the
mock plays the role of the Service-Desk CA and issues the certificate instantly.

> ⚠️ Local rehearsal only. Certificates issued by this mock are signed by its
> throwaway runtime CA and are **not** trusted by real Pontes.

> 🌐 **Want to try it without running anything?** A hosted mock is available at
> **<https://mock.integration.pontes.ca-dag.work>** (NCB/realm `bdf`). Its server
> certificate is publicly trusted, so you can drop the `-k` flag and omit
> `CA_CERT` in the examples. Just swap `https://localhost:3001` for that URL in
> the commands below.

---

## 1. Generate a private key + CSR with the ECB CertApp

The ECB **Certificate Signing Request Tool** runs entirely in your browser:

🔗 <https://utest.pontes-pilot.target-ssp.eu/certapp/csr>

It has three sections — **Private Key Generation**, **Certificate Request
Generation**, and **Certificate Verification**. The private key is generated
locally in the browser and **never transmitted**.

Steps (from the ECB "Pontes Pilot — Connectivity Training", §CSR generation):

1. Open the tool and click **"Generate a new private key"**. The key downloads
   automatically — store it safely (restrict file permissions; ideally an HSM or
   secure keystore; optionally encrypt it with a passphrase).
2. Expand **"Certificate Request Generation Tool"** and fill the mandatory fields:
   - **Country code**
   - **BIC / LEI** — your Actor/Participant organisation ID in ESY DLT (must match
     the Party BIC of the Market Participant, or the BIC/LEI defined as Market DLT
     Operator ID).
   - **Privilege** — `2E` or `4E`. **A2A service accounts must be `2E`** (`4E` is
     U2A/human only).
   - **Username** — becomes the certificate **Common Name (CN)**; must be unique
     across the whole system.
3. Click **"Generate a Certificate Signing Request"** and download the CSR (PEM).

Constraints (enforced by the mock too):

- Key type: **ECDSA P-256 only** (RSA is rejected).
- CSR format: **PKCS#10, PEM**.
- The CN equals the **Username**.
- The privilege is carried in a custom extension (OID `1.2.3.4.5.6.7.8.1`,
  JSON `{"attrs":{"privilege":"2E|4E","mspid":"<BIC>"}}`) — **not** the Subject `OU`.

### OpenSSL alternative (equivalent to the CertApp)

If you'd rather script it, this produces the same material:

```bash
# 1) EC P-256 private key
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out user.key

# 2) CSR with CN = username and the Pontes privilege extension
cat > csr.cnf <<'EOF'
[req]
distinguished_name = dn
req_extensions = exts
prompt = no
[dn]
CN = PFRBSUIFRPPXXX0001
[exts]
1.2.3.4.5.6.7.8.1 = ASN1:UTF8String:{"attrs":{"privilege":"2E","mspid":"BSUIFRPPXXX"}}
EOF
openssl req -new -key user.key -out user.csr -config csr.cnf
```

---

## 2. Map ECB CSR fields → mock enrollment inputs

When you enroll, the mock reads the CN from the CSR and needs a few extra fields
to **declare a new user**:

| ECB CertApp / CSR | Mock enrollment field | Required | Notes |
|-------------------|-----------------------|----------|-------|
| CSR Common Name (Username) | `username` | always | Must match the CSR CN |
| — | `password` | always | Set on first declaration; verified on re-enrollment |
| the CSR itself | `csr` | always | PKCS#10 PEM |
| Actor/Participant BIC/LEI | `entityBIC` | **new users** | MSPID / owning entity BIC |
| ESY DLT user profile | `profile` | **new users** | e.g. `PILOT_READ_WRITE`, `EXTERNAL_USER` |
| Privilege `2E`/`4E`, `mspid` | *(carried in the CSR extension)* | — | Preserved as-is in the issued cert |

`profile` and `entityBIC` are only required the first time a username is declared.
For an existing user, the mock validates the `password` and re-issues.

---

## 3. Enroll in the mock

Point your enrollment at a running mock (default `https://localhost:3001`; the
examples below use `bdf` as the NCB/realm). Against the hosted instance
<https://mock.integration.pontes.ca-dag.work> the server cert is publicly trusted,
so `curl` verifies normally with no extra flags. For a **local** mock (self-signed
cert), fetch its CA once and verify against it:

```bash
curl -sk https://localhost:3001/ca.pem -o mock-ca.pem   # one-time -k just to fetch the public CA
# thereafter add --cacert mock-ca.pem to your curl calls (shown below)
```

The `curl` snippets below use `--cacert mock-ca.pem` for the local mock; drop it
against the hosted instance.

### Path A — the built-in UI (recommended)

1. Open **`/ui/enroll`**.
2. Under **"1 · Certificate Signing Request"**, upload or paste your `user.csr`
   and click **"Inspect CSR"** to confirm the CN, key/curve, and privilege.
3. Under **"2 · User declaration"**, fill in:
   - **NCB / ORG (realm)** — e.g. `bdf`
   - **Username** — must equal the CSR CN
   - **Password**
   - **Entity BIC (MSPID)**
   - **Profile**
4. Click **"Enroll & issue certificate"**. The issued certificate appears in
   **"3 · Issued certificate"** — download it as `.pem`.

### Path B — the API (`curl`)

```bash
jq -n --arg csr "$(cat user.csr)" \
  '{username:"PFRBSUIFRPPXXX0001",
    password:"initiator-secret",
    profile:"PILOT_READ_WRITE",
    entityBIC:"BSUIFRPPXXX",
    csr:$csr}' \
| curl -s --cacert mock-ca.pem -X POST https://localhost:3001/iam/realms/bdf/protocol/openid-connect/csr \
    -H 'content-type: application/json' -d @- \
    | jq -r .certificate > user.crt
```

`user.crt` now holds the issued certificate (PEM). Response codes: `200` success,
`400` missing fields / invalid CSR, `401` wrong password for an existing user,
`409` the certificate fingerprint is already mapped to another user.

---

## 4. Produce a `.p12` and install it on your machine

A PKCS#12 bundle packages the issued **certificate + your private key** (and is
what browsers / Keychain import).

### Build the `.p12` in the UI

On **`/ui/enroll`**, section **"4 · Download as PKCS#12 (.p12)"**:

1. Upload or paste your **private key** (`user.key` from step 1).
2. Choose an **export password**.
3. Click **"Build & download .p12"**.

> The private key is used in-memory by the local mock only to assemble the bundle
> and is never stored. For real keys, prefer the command line below.

### Build the `.p12` with OpenSSL (offline)

```bash
openssl pkcs12 -export \
  -inkey user.key -in user.crt \
  -name "PFRBSUIFRPPXXX0001" \
  -out user.p12
# (you'll be prompted for an export password)
```

### Install the `.p12`

- **macOS (Keychain):** double-click `user.p12` (or
  `security import user.p12 -k ~/Library/Keychains/login.keychain-db`), enter the
  export password.
- **Windows:** double-click `user.p12` → **Certificate Import Wizard** → Current
  User store.
- **Firefox:** Settings → Privacy & Security → Certificates → **View
  Certificates** → *Your Certificates* → **Import…** → select `user.p12`.
- **curl (mTLS):** use the PEM pair directly:
  `curl --cert user.crt --key user.key https://…`

---

## 5. Verify the certificate & enrollment

Inspect the issued certificate (or use the **Inspect** button in `/ui/enroll`):

```bash
openssl x509 -in user.crt -noout -subject -issuer -dates
# subject=CN=PFRBSUIFRPPXXX0001
# issuer=CN=MockPontes-ClientCA, O=MockPontes, C=DEV
# notBefore/notAfter … 24-month validity

openssl x509 -in user.crt -noout -text | grep -A1 "1.2.3.4.5.6.7.8.1"
# 1.2.3.4.5.6.7.8.1:
#     {attrs:{privilege:2E,mspid:BSUIFRPPXXX}}
```

Confirm the user is enrolled and test mTLS:

```bash
# the user now appears in the enrolled-users list
curl -sk https://localhost:3001/admin/enrolled-users

# fetch the stored certificate for that user
curl -sk https://localhost:3001/admin/enrolled-users/PFRBSUIFRPPXXX0001/certificate

# present the cert on an mTLS request — returns the accepted fingerprint
curl -sk --cert user.crt --key user.key https://localhost:3001/check/mtls
# {"status":"OK","check":"mtls","fingerprint":"…","mock":true}
```

---

## 6. Trust chain & the real Service-Desk flow

- The issuing CA is the mock's **runtime local CA** `MockPontes-ClientCA`
  (`src/auth/runtime-pki.ts`), regenerated on startup (persisted in Redis when
  `REDIS_URL` is set). It signs enrolled client certs **and** is the mTLS trust
  root for client certs the mock accepts. Certificates are issued with a
  **24-month** validity, mirroring the real ECB CA (Deutsche Bundesbank).
- On **real Pontes**, the CertApp only builds the CSR; you additionally submit a
  registration form (username = CN, email for OTP, org BIC/LEI, privilege,
  profile, whitelisted IPs) to your NSD, and the **TARGET Service Desk** issues
  the certificate manually. This mock collapses that into an instant local
  issuance so you can exercise the transport/auth flow before you have real certs.

See [`TLS-MTLS-AND-CERTS.md`](TLS-MTLS-AND-CERTS.md) for the runtime PKI, mTLS
enforcement, and PKCS#12 internals.
