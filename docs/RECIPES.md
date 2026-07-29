# Recipes — one copy-pasteable flow at a time

The README documents the **funding** flow; this guide adds the rest (defunding,
transfer, 1-step bridge payment) as self-contained `curl` blocks, plus the
profile/client-id table and the field-name & signing gotchas that otherwise have
to be reverse-engineered from `HL-VAL` / `HL-NRO` errors.

> New to enrolment? Get your client certificate first with
> [`ENROLL-WITH-ECB-TOOLS.md`](ENROLL-WITH-ECB-TOOLS.md), then come back here.
> For the transport/PKI details see [`TLS-MTLS-AND-CERTS.md`](TLS-MTLS-AND-CERTS.md).

---

## 0. Common setup

Every recipe assumes these shell variables and an enrolled certificate
(`user.crt` / `user.key`, and for four-eyes flows a second `approver.crt` /
`approver.key`).

```bash
BASE=https://localhost:3001          # or https://mock.integration.pontes.ca-dag.work
NCB=bdf                              # the realm you enrolled in

# Local mock only: fetch its self-signed CA once, then verify against it.
# (Against the hosted instance the server cert is publicly trusted — drop --cacert.)
curl -sk "$BASE/ca.pem" -o mock-ca.pem
CACERT="--cacert mock-ca.pem"        # set CACERT="" for the hosted instance
```

Acquire a JWT (mTLS **and** the password grant — the client cert must be the one
bound to the user):

```bash
# PILOT_READ_WRITE (funding / defunding / transfer): client_id=esydlt-web-app, no secret
TOKEN=$(curl -s $CACERT --cert user.crt --key user.key \
  -X POST "$BASE/iam/realms/$NCB/protocol/openid-connect/token" \
  -d grant_type=password -d username=PFRBSUIFRPPXXX0001 -d password=initiator-secret \
  -d client_id=esydlt-web-app -d scope=openid | jq -r .access_token)
```

For an **EXTERNAL_USER** (1-step bridge) use the backend-service client **and its
matching secret** (see the table below):

```bash
EXT_TOKEN=$(curl -s $CACERT --cert ext.crt --key ext.key \
  -X POST "$BASE/iam/realms/$NCB/protocol/openid-connect/token" \
  -d grant_type=password -d username=PFRBSUIFRPPXXX0009 -d password=ext-secret \
  -d client_id=esydlt-backend-service -d client_secret=esydlt-backend-service \
  -d scope=openid | jq -r .access_token)
```

> **Wallets must already exist** for every settlement path except **funding**
> (the cash on-ramp, which auto-creates its *credited* wallet). An unknown
> credit/debit wallet is rejected `422 HL-WAL-003`/`HL-WAL-002` pointing at
> `POST /dlt/$NCB/api/octopus/ams/wallets/one-step` — create it there first.

---

## 1. Profile → client_id → client_secret → permitted operations

Mirrors real Pontes (SDD §6.3.3, Table U). Enforcement is strict — the wrong
`client_id`/secret for a profile is rejected `401 invalid_client`, and using a
profile on an operation it isn't allowed for is `403 HL-AUTH-001`.

| Profile | `client_id` | `client_secret` | Permitted write operations |
|---------|-------------|-----------------|-----------------------------|
| `PILOT_READ_WRITE` | `esydlt-web-app` | *(none)* | Funding, defunding, transfer (2-step draft → approve); the approve/cancel transitions |
| `EXTERNAL_USER` | `esydlt-backend-service` | `esydlt-backend-service` | 1-step bridge payments (`/api/bridge/…`) — no draft/approve |
| `PILOT_READ_ONLY` | `esydlt-web-app` | *(none)* | Reads only |
| `REFERENTIAL_READ_ONLY` | `esydlt-web-app` | *(none)* | Reads only |
| `REFERENTIAL_READ_WRITE` | `esydlt-web-app` | *(none)* | Referential writes |

The `client_secret` for `EXTERNAL_USER` really does equal the client id
(`esydlt-backend-service`) — that is the documented Table U value, not a
placeholder.

---

## 2. Field-name & signing gotchas

The single biggest time sink is that each flow uses a slightly different
vocabulary:

| Flow | Amount field | Business id | Extra required fields | NRO-signed? | Profile |
|------|--------------|-------------|-----------------------|-------------|---------|
| Funding | `amount` | `techFundRequestID` | credited/debited wallet alias·manager·owner, `type=FUNDING`, `currency` | **yes** | `PILOT_READ_WRITE` |
| Defunding | `amount` | **`techFundRequestID`** (not `techDefundRequestID`) | as funding, `type=DEFUNDING` | **yes** | `PILOT_READ_WRITE` |
| Transfer | **`amountTransferred`** | `instructionID` (optional) | `instructingPartyID`, `type=TRANSFER`, `cbdcRequestType=OPERATION`, credited/debited alias·manager, `currency` | no | `PILOT_READ_WRITE` |
| 1-step bridge payment | `amount` | `paymentID` | credited/debited alias, `creditedCashWalletManagerID`, `currency` | no | `EXTERNAL_USER` |

Gotchas that produce opaque errors:

- **Defunding uses `techFundRequestID`** — *fund*, not *defund*. Guessing
  `techDefundRequestID` yields `HL-NRO-002 "Cannot determine signing fields"`,
  because the signing-field builder keys off `techFundRequestID`.
- **Transfer amount is `amountTransferred`**, not `amount`. It is enforced to
  2-decimal precision (`^\d{1,15}(\.\d{0,2})?$`); more than 2 decimals →
  `400 HL-VAL-001` (see the caveats below).
- **`cbdcRequestType`** is `PAYMENT` or `OPERATION` — use **`OPERATION`** for an
  ordinary transfer; **`type`** is `TRANSFER` / `ISSUANCE` / `REDEMPTION`.
- **The 1-step bridge payment 200 is `application/json` whose body is a JSON
  *string*** — `"Cash Token Payment Settled Succesfully"` (with quotes), per the
  official spec (`200` = `application/json`, `type: string`). It is **not**
  `text/plain` and **not** a JSON object; read it with `.json()`.
- The ECB spelling **"Succesfully"** in confirmation strings is intentional wire
  fidelity — match it, don't "fix" it.

### NRO signing string (funding / defunding)

```
signingString = techFundRequestID + amount + creditedCashWalletOwnerID + debitedCashWalletOwnerID
```

ECDSA **P-256 / SHA-256**, signature **base64(DER)**, and `signerPEM` **must equal
the mTLS client certificate you present**. With OpenSSL:

```bash
SIGNING_STRING="${TECH_ID}${AMOUNT}${CREDIT_OWNER}${DEBIT_OWNER}"
SIGNATURE=$(printf '%s' "$SIGNING_STRING" | openssl dgst -sha256 -sign user.key | base64 | tr -d '\n')
SIGNER_PEM=$(cat user.crt)
```

---

## 3. Funding (2-step, NRO-signed)

Credits a wallet from the issuance wallet. Funding is the one path that
auto-creates its *credited* wallet.

```bash
TECH_ID="FUND-$(date +%s)"; AMOUNT="1000.00"
CREDIT_OWNER=BSUIFRPPXXX; DEBIT_OWNER=ECBFDEFFXXX
SIGNATURE=$(printf '%s' "${TECH_ID}${AMOUNT}${CREDIT_OWNER}${DEBIT_OWNER}" \
  | openssl dgst -sha256 -sign user.key | base64 | tr -d '\n')

FRQ=$(curl -s $CACERT --cert user.crt --key user.key \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X POST "$BASE/dlt/$NCB/api/octopus/tms/funding-requests" -d @- <<JSON | jq -r .id
{
  "type": "FUNDING",
  "techFundRequestID": "$TECH_ID",
  "amount": "$AMOUNT",
  "currency": "EUR",
  "creditedCashWalletAlias": "WFREURBSUIFRPPXXX-01",
  "creditedCashWalletManagerID": "BDFEFRPPXXX",
  "creditedCashWalletOwnerID": "$CREDIT_OWNER",
  "debitedCashWalletAlias": "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
  "debitedCashWalletManagerID": "ECBFDEFFXXX",
  "debitedCashWalletOwnerID": "$DEBIT_OWNER",
  "signature": "$SIGNATURE",
  "signerPEM": "$(cat user.crt | sed ':a;N;$!ba;s/\n/\\n/g')"
}
JSON
)

# Four-eyes: a SECOND enrolled user approves (self-approval → 403 HL-GER-003).
APPROVER_TOKEN=$(curl -s $CACERT --cert approver.crt --key approver.key \
  -X POST "$BASE/iam/realms/$NCB/protocol/openid-connect/token" \
  -d grant_type=password -d username=PFRBSUIFRPPXXX0002 -d password=approver-secret \
  -d client_id=esydlt-web-app -d scope=openid | jq -r .access_token)

curl -s $CACERT --cert approver.crt --key approver.key \
  -H "authorization: Bearer $APPROVER_TOKEN" \
  -X PUT "$BASE/dlt/$NCB/api/octopus/tms/funding-requests-drafts/$FRQ/approve"

# Verify the credited wallet balance.
curl -s $CACERT --cert user.crt --key user.key -H "authorization: Bearer $TOKEN" \
  "$BASE/dlt/$NCB/api/octopus/ams/wallets/WFREURBSUIFRPPXXX-01" | jq .availableBalance
```

---

## 4. Defunding (2-step, NRO-signed)

Same shape as funding but `type=DEFUNDING` — and note the business id is still
`techFundRequestID`. Both wallets must already exist.

```bash
TECH_ID="DEFUND-$(date +%s)"; AMOUNT="250.00"
CREDIT_OWNER=ECBFDEFFXXX; DEBIT_OWNER=BSUIFRPPXXX
SIGNATURE=$(printf '%s' "${TECH_ID}${AMOUNT}${CREDIT_OWNER}${DEBIT_OWNER}" \
  | openssl dgst -sha256 -sign user.key | base64 | tr -d '\n')

curl -s $CACERT --cert user.crt --key user.key \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X POST "$BASE/dlt/$NCB/api/octopus/tms/defunding-requests" -d @- <<JSON | jq
{
  "type": "DEFUNDING",
  "techFundRequestID": "$TECH_ID",
  "amount": "$AMOUNT",
  "currency": "EUR",
  "creditedCashWalletAlias": "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
  "creditedCashWalletManagerID": "ECBFDEFFXXX",
  "creditedCashWalletOwnerID": "$CREDIT_OWNER",
  "debitedCashWalletAlias": "WFREURBSUIFRPPXXX-01",
  "debitedCashWalletManagerID": "BDFEFRPPXXX",
  "debitedCashWalletOwnerID": "$DEBIT_OWNER",
  "signature": "$SIGNATURE",
  "signerPEM": "$(cat user.crt | sed ':a;N;$!ba;s/\n/\\n/g')"
}
JSON
# → PENDING_APPROVAL; approve exactly as in §3 via .../defunding-requests-drafts/{id}/approve
```

---

## 5. Transfer (2-step, **not** NRO-signed)

Moves value between two existing wallets. No signature — but a different
vocabulary: `amountTransferred`, `instructingPartyID`, `cbdcRequestType`.

```bash
curl -s $CACERT --cert user.crt --key user.key \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X POST "$BASE/dlt/$NCB/api/octopus/rvs/transactions-requests" -d @- <<JSON | jq
{
  "type": "TRANSFER",
  "cbdcRequestType": "OPERATION",
  "instructingPartyID": "BSUIFRPPXXX",
  "amountTransferred": "10.00",
  "currency": "EUR",
  "creditedCashWalletAlias": "WFREURCOUNTERPARTY-01",
  "creditedCashWalletManagerID": "BDFEFRPPXXX",
  "debitedCashWalletAlias": "WFREURBSUIFRPPXXX-01",
  "debitedCashWalletManagerID": "BDFEFRPPXXX"
}
JSON
# → PENDING_APPROVAL; approve via .../rvs/transactions-drafts/{id}/approve (four-eyes)
```

`amountTransferred` must have at most 2 decimals — `"10.123"` is now rejected
`400 HL-VAL-001` (issue #97).

---

## 6. 1-step bridge payment (`EXTERNAL_USER`, no draft)

A single call settles immediately — no draft/approve cycle. Requires the
`EXTERNAL_USER` profile and its backend-service token (`$EXT_TOKEN` from §0).

```bash
curl -s $CACERT --cert ext.crt --key ext.key \
  -H "authorization: Bearer $EXT_TOKEN" -H 'content-type: application/json' \
  -X POST "$BASE/dlt/$NCB/api/bridge/payments" -d @- <<JSON
{
  "paymentID": "PAY-$(date +%s)",
  "amount": "5.00",
  "currency": "EUR",
  "creditedCashWalletAlias": "WFREURCOUNTERPARTY-01",
  "creditedCashWalletManagerID": "BDFEFRPPXXX",
  "debitedCashWalletAlias": "WFREURBSUIFRPPXXX-01",
  "debitedCashWalletManagerID": "BDFEFRPPXXX"
}
JSON
# → 200, Content-Type: application/json, body is a JSON *string* (with quotes):
#     "Cash Token Payment Settled Succesfully"
#   Parse it with .json() — it is not a JSON object, and not text/plain. The ECB
#   "Succesfully" spelling is intentional (wire fidelity).
```

---

## 7. Do not conclude from a green mock run

A flow passing here does **not** guarantee it passes against real Pontes (UTEST).
Re-verify these against the real environment — they are exactly where a mock can
mislead:

- **Amount precision.** The mock now enforces 2-decimal money on all settlement
  amounts (issue #97), matching the spec pattern — but confirm your client sends
  amounts real Pontes accepts (no thousands separators, `.`-decimal, ≤ 2 dp).
- **NCB isolation.** The mock keeps a **single global ledger** and now rejects a
  token used against a different `{ncb}` than its realm (`403 HL-ATH-003`, issue
  #97). Real Pontes partitions per NCB — verify your realm/NCB pairing and that
  you never rely on cross-NCB visibility.
- **Idempotency / duplicate business ids.** The mock **does not** reject a
  repeated `techFundRequestID` / `paymentID` — a retry creates a *second* draft
  (e.g. `FRQ…0002`). This is not specified by Pontes, so **do not** rely on the
  mock's behaviour either way; make your client idempotent and confirm the real
  system's duplicate handling before going live.

Related: the settlement wallet rules (issue #93) and business-window semantics
(issues #81, #94) are modelled but simplified — treat UTEST as the source of
truth for edge cases.
