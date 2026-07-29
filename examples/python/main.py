"""
Minimal mTLS + NRO example client for mock-pontes (Python).

Flow:
  1. GET  /check/mtls                          - prove the client cert is accepted
  2. GET  /dlt/{ncb}/api/octopus/health        - unauthenticated round trip
  3. POST /iam/realms/{ncb}/.../token          - acquire a JWT (mTLS + password)
  4. POST /dlt/{ncb}/api/octopus/tms/funding-requests
                                               - NRO-signed funding request (2-step)
  5. PUT  /dlt/{ncb}/.../funding-requests-drafts/{id}/approve
                                               - four-eyes approval by a SECOND user
  6. GET  /dlt/{ncb}/api/octopus/ams/wallets/{alias}
                                               - verify the wallet was credited

Four-eyes control: the funding request is created by the initiator but must be
approved by a *different* enrolled user (a distinct certificate / user UUID);
self-approval is rejected with 403 HL-GER-003. Steps 5-6 run only when a second
(approver) certificate is configured via APPROVER_CERT / APPROVER_KEY.
"""

import base64
import os
import time

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

BASE_URL = os.environ.get("BASE_URL", "https://localhost:3001")
NCB = os.environ.get("NCB", "bdf")
CLIENT_CERT = os.environ.get("CLIENT_CERT", "user.crt")
CLIENT_KEY = os.environ.get("CLIENT_KEY", "user.key")
# TLS server verification (issue #89):
#   - CA_CERT set            -> verify against that CA (local self-signed: fetch it from GET /ca.pem)
#   - CA_CERT unset          -> verify against the system trust store (works out-of-the-box
#                               against the hosted Let's Encrypt cert)
#   - INSECURE_SKIP_VERIFY   -> explicit, loud opt-out (dev only); never skip silently
CA_CERT = os.environ.get("CA_CERT")
INSECURE = os.environ.get("INSECURE_SKIP_VERIFY", "").lower() in ("1", "true", "yes")
USERNAME = os.environ.get("PONTES_USERNAME", "PFRBSUIFRPPXXX0001")
PASSWORD = os.environ.get("PONTES_PASSWORD", "initiator-secret")

# Approver (four-eyes) — a SECOND enrolled user with its own certificate.
APPROVER_CERT = os.environ.get("APPROVER_CERT", "approver.crt")
APPROVER_KEY = os.environ.get("APPROVER_KEY", "approver.key")
APPROVER_USERNAME = os.environ.get("APPROVER_USERNAME", "PFRBSUIFRPPXXX0002")
APPROVER_PASSWORD = os.environ.get("APPROVER_PASSWORD", "approver-secret")

AMOUNT = os.environ.get("AMOUNT", "1000000.00")
CREDITED_ALIAS = os.environ.get("CREDITED_ALIAS", "WFREURBSUIFRPPXXX-01")
ENTITY_BIC = os.environ.get("ENTITY_BIC", "BSUIFRPPXXX")
MANAGER_BIC = os.environ.get("MANAGER_BIC", "BDFEFRPPXXX")


def new_session(cert, key):
    session = requests.Session()
    session.cert = (cert, key)
    # Verify by default; a custom CA takes precedence; skip only on explicit opt-in.
    session.verify = CA_CERT if CA_CERT else (not INSECURE)
    return session


def get_token(session, username, password):
    r = session.post(
        f"{BASE_URL}/iam/realms/{NCB}/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "username": username,
            "password": password,
            "client_id": "esydlt-web-app",  # PILOT_READ_WRITE uses the web-app client
            "scope": "openid",
        },
    )
    return r, r.json().get("access_token")


def main() -> None:
    if not CA_CERT and INSECURE:
        import urllib3

        print("WARNING: TLS server verification is DISABLED (INSECURE_SKIP_VERIFY). Dev use only.")
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    session = new_session(CLIENT_CERT, CLIENT_KEY)

    # 1. mTLS acceptance
    r = session.get(f"{BASE_URL}/check/mtls")
    print("1) GET /check/mtls        ->", r.status_code, r.text)

    # 2. Health (unauthenticated)
    r = session.get(f"{BASE_URL}/dlt/{NCB}/api/octopus/health")
    print("2) GET .../octopus/health ->", r.status_code, r.text)

    # 3. Token (mTLS + password grant)
    r, token = get_token(session, USERNAME, PASSWORD)
    print("3) POST .../token         ->", r.status_code, "(JWT acquired)" if token else r.text)
    if not token:
        raise SystemExit("No access_token - check USERNAME/PASSWORD and that the user is enrolled")

    # 4. NRO-signed funding request
    funding = {
        "techFundRequestID": os.environ.get("TECH_FUND_REQUEST_ID", f"FUND-{int(time.time() * 1000)}"),
        "type": "FUNDING",
        "amount": AMOUNT,
        "currency": "EUR",
        "creditedCashWalletAlias": CREDITED_ALIAS,
        "creditedCashWalletManagerID": MANAGER_BIC,
        "creditedCashWalletOwnerID": ENTITY_BIC,
        "debitedCashWalletAlias": "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
        "debitedCashWalletManagerID": "ECBFDEFFXXX",
        "debitedCashWalletOwnerID": "ECBFDEFFXXX",
    }

    # NRO canonical signing string (Pontes v1.0):
    #   techFundRequestID + amount + creditedCashWalletOwnerID + debitedCashWalletOwnerID
    signing_data = (
        funding["techFundRequestID"]
        + funding["amount"]
        + funding["creditedCashWalletOwnerID"]
        + funding["debitedCashWalletOwnerID"]
    )

    with open(CLIENT_KEY, "rb") as fh:
        private_key = serialization.load_pem_private_key(fh.read(), password=None)
    signature_der = private_key.sign(signing_data.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    signature = base64.b64encode(signature_der).decode("ascii")

    with open(CLIENT_CERT, "r", encoding="utf-8") as fh:
        signer_pem = fh.read()  # must equal the mTLS client certificate

    r = session.post(
        f"{BASE_URL}/dlt/{NCB}/api/octopus/tms/funding-requests",
        json={**funding, "signature": signature, "signerPEM": signer_pem},
        headers={"authorization": f"Bearer {token}"},
    )
    print("4) POST .../funding-requests ->", r.status_code, r.text)
    funding_id = r.json().get("id")  # server-assigned FRQ id — the four-eyes target

    # 5. Four-eyes approval by a SECOND user (self-approval is rejected 403).
    if not (funding_id and os.path.exists(APPROVER_CERT) and os.path.exists(APPROVER_KEY)):
        print(
            "5) approval skipped - set APPROVER_CERT / APPROVER_KEY (a second enrolled"
            " user) to run the four-eyes approve + balance check."
        )
        return

    approver = new_session(APPROVER_CERT, APPROVER_KEY)
    ar, atoken = get_token(approver, APPROVER_USERNAME, APPROVER_PASSWORD)
    if not atoken:
        raise SystemExit(f"Approver token failed: {ar.status_code} {ar.text}")
    r = approver.put(
        f"{BASE_URL}/dlt/{NCB}/api/octopus/tms/funding-requests-drafts/{funding_id}/approve",
        headers={"authorization": f"Bearer {atoken}"},
    )
    print("5) PUT .../{id}/approve   ->", r.status_code, r.text)

    # 6. Verify the credited wallet now holds the funded amount.
    r = session.get(
        f"{BASE_URL}/dlt/{NCB}/api/octopus/ams/wallets/{CREDITED_ALIAS}",
        headers={"authorization": f"Bearer {token}"},
    )
    balance = r.json().get("availableBalance") if r.ok else None
    print("6) GET .../ams/wallets     ->", r.status_code, f"availableBalance={balance}" if balance else r.text)


if __name__ == "__main__":
    main()
