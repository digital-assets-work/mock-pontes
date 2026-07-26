# Mock Pontes — TLS, mTLS, Enrollment & Certificates (code)

Application-side reference for the security/PKI features of `mock-pontes` and how
they work. This covers the runtime PKI, CSR enrollment, mTLS trust, PKCS#12 export,
profile enforcement, and the optional externally-provided (e.g. Let's Encrypt)
server-certificate loader.

---

## 1. HTTPS + mTLS server

The service always runs over HTTPS with a TLS server certificate **and** requests
a client certificate ([`src/index.ts`](../src/index.ts)):

```ts
https.createServer({
  cert: runtimePki.serverCertificatePem,          // server identity
  key:  runtimePki.serverPrivateKeyPem,
  ca:   runtimePki.clientSigningCaCertificatePem, // trust root to verify CLIENT certs
  requestCert: true,
  rejectUnauthorized: false,                       // accept no-cert conns; app validates
}, toNodeListener(app));
```

Key idea: **`cert`/`key` (server identity) are independent of `ca` (client-cert
trust)**. This is what lets us later swap in a Let's Encrypt server cert without
touching mTLS (§6).

`rejectUnauthorized: false` allows connections *without* a client cert (e.g. the
CSR/enrollment endpoint and the UI). Certificate validation is enforced per-route
by middleware, not at the TLS layer.

---

## 2. Runtime PKI ([`src/auth/runtime-pki.ts`](../src/auth/runtime-pki.ts))

At startup the service generates (and persists in Redis when available) a PKI
bundle with **two independent CAs**:

| CA | Field | Purpose |
|---|---|---|
| `MockPontes-ServerCA` | `serverCaCertificatePem` | Signs the **server** TLS leaf |
| `MockPontes-ClientCA` | `clientSigningCaCertificatePem` | Signs **enrolled client** certs (CSR) **and** verifies presented client certs (mTLS trust root) |

- Keys: EC `P-256`, signatures `ECDSA/SHA-256`; CAs valid 10 years.
- **Server leaf**: subject from `TLS_SUBJECT`, SANs from `TLS_SAN`, validity **825 days**.
- Persistence: `RedisCache` (`mock-pontes:pki`) so the cert survives restarts /
  multiple replicas; falls back to in-memory when no `REDIS_URL`.

### TLS_SAN / TLS_SUBJECT

`TLS_SAN` is a `;`-separated list of `dns:`/`ip:` entries, e.g.
`dns:localhost;ip:127.0.0.1;dns:mock-pontes-svc;dns:mock.integration.pontes.ca-dag.work`.
The Helm chart composes this automatically (loopback + Service DNS + `tls.extraSans`);
see the chart README. `getTlsCertConfig()` exposes the resolved subject/SAN for logs.

---

## 3. mTLS enforcement chain (middleware order in `src/index.ts`)

1. **Logging + mTLS context** ([`logger/middleware.ts`](../src/logger/middleware.ts)) —
   attaches presented client cert, fingerprint, validity to `event.context`.
2. **Health** (`/`, unauthenticated) and **Native UI** (unauthenticated) — mounted
   before auth so the control panel / docs / CSR page work without a cert or token.
3. **Enrollment router** (token + CSR endpoints, §4).
4. **JWT middleware** ([`auth/jwt-middleware.ts`](../src/auth/jwt-middleware.ts)) —
   validates bearer tokens for `/dlt`.
5. **mTLS/JWT consistency** ([`auth/middleware.ts`](../src/auth/middleware.ts)) —
   presented client cert must match the cert associated with the authenticated user.
6. **Profile authorization** (§5).
7. **NRO cert-check + NRO signature** middlewares — on funding/defunding write routes.

---

## 4. CSR enrollment & certificates

- **Token endpoint** `POST /iam/realms/:ncb/protocol/openid-connect/token`
  ([`auth/enrollment-routes.ts`](../src/auth/enrollment-routes.ts)) — **requires a
  valid client certificate** (mTLS); returns a JWT with the `user_profile` claim.
- **CSR signing** `POST /iam/realms/:ncb/protocol/openid-connect/csr` — body
  `{ username, password, profile, entityBIC, csr }`; signs the CSR with
  `MockPontes-ClientCA`.
- **Admin** `GET /admin/enrolled-users`, `GET /admin/enrolled-users/:username/certificate`.

### signCsr ([`auth/csr-handler.ts`](../src/auth/csr-handler.ts))

Preserves the CSR's requested extensions (notably the **privilege** custom
extension `1.2.3.4.5.6.7.8.1` carrying `{"attrs":{"privilege":"2E|4E","mspid":"<BIC>"}}`)
and issues with **24‑month** validity. A2A users must be **2E**, U2A humans **4E**;
the cert CN must equal the username (`P`/`A` + country + DLT BIC/LEI + freetext).

---

## 5. Profile enforcement ([`src/auth/profile-enforcement.ts`](../src/auth/profile-enforcement.ts))

Recent change (Phase 7) — the mock strictly validates the Pontes profile model:

| Profile | client_id | Access |
|---|---|---|
| `PILOT_READ_WRITE` | `esydlt-web-app` | 2‑step drafts / approve / funding / defunding |
| `EXTERNAL_USER` | `esydlt-backend-service` (+ `client_secret`) | 1‑step bridge payments only |

- `validateClientIdForProfile()` rejects mismatched `client_id`/profile pairs.
- The **profile authorization** middleware maps endpoints → required profile.
- Opt out for lenient/legacy tests with `PONTES_MOCK_LENIENT_PROFILE=true`
  (`isStrictMode()`).

---

## 6. Native backend UI ([`src/ui/`](../src/ui))

Served directly from the backend (no build step), unauthenticated (dev tooling):

| Route | Purpose |
|---|---|
| `/`, `/ui` | Control panel + config |
| `/ui/docs` | Swagger UI — **two tabs**: *Mock (testable)* and *Official reference* (vendored ECB OpenAPI v1.0) + a token auth form |
| `/ui/enroll` | CSR enroll / download flow |
| `/openapi.json`, `/openapi/official.json` | Mock spec (tags `Pontes · X` vs `Mock · X`) and pristine official spec |
| `POST /ui/inspect` | Parse a CSR/cert (CN, key/curve, privilege, mspid) — [`inspect.ts`](../src/ui/inspect.ts) |
| `POST /ui/p12` | Build a **PKCS#12** bundle, pure-JS via `pkijs`/`asn1js`/WebCrypto (distroless-safe, no openssl) — [`p12.ts`](../src/ui/p12.ts) |

---

## 7. Use a valid server certificate (Let's Encrypt or other) (code side)

If you want to use a real server certificate instead of the self-signed one, mount the cert and key files into the container and set the environment variables
`TLS_CERT_FILE` and `TLS_KEY_FILE` to point to them. The code will read the files and use them for the HTTPS server instead of the self-signed cert. The mTLS trust root remains unchanged, so client certificates are still verified against the internal CA.

```ts
// in src/index.ts, before https.createServer
const certFile = process.env.TLS_CERT_FILE;
const keyFile  = process.env.TLS_KEY_FILE;
const useExternalCert = certFile && keyFile;

const server = https.createServer({
  cert: useExternalCert ? fs.readFileSync(certFile) : runtimePki.serverCertificatePem,
  key:  useExternalCert ? fs.readFileSync(keyFile)  : runtimePki.serverPrivateKeyPem,
  ca:   runtimePki.clientSigningCaCertificatePem,   // unchanged → mTLS intact
  requestCert: true,
  rejectUnauthorized: false,
}, toNodeListener(app));
```

---

## 8. Environment variables (security-related)

| Var | Effect |
|---|---|
| `TLS_SUBJECT` | Server cert subject DN |
| `TLS_SAN` | Server cert SANs (`dns:`/`ip:`, `;`-separated) — composed by the chart |
| `REDIS_URL` | Persist PKI + enrolled users across restarts/replicas |
| `PONTES_MOCK_LENIENT_PROFILE` | `true` disables strict profile/client_id enforcement |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | *(planned)* use an external (LE) server cert/key instead of self-signed |
