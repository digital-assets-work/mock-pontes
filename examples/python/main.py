"""
Minimal mTLS + NRO example client for mock-pontes (Python).

Flow:
  1. GET  /check/mtls                          - prove the client cert is accepted
  2. GET  /dlt/{ncb}/api/octopus/health        - unauthenticated round trip
  3. POST /iam/realms/{ncb}/.../token          - acquire a JWT (mTLS + password)
  4. POST /dlt/{ncb}/api/octopus/tms/funding-requests
                                               - NRO-signed funding request (2-step)
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
CA_CERT = os.environ.get("CA_CERT")  # optional; when unset the server cert is not verified
USERNAME = os.environ.get("PONTES_USERNAME", "PFRBSUIFRPPXXX0001")
PASSWORD = os.environ.get("PONTES_PASSWORD", "initiator-secret")

AMOUNT = os.environ.get("AMOUNT", "1000000.00")
CREDITED_ALIAS = os.environ.get("CREDITED_ALIAS", "WFREURBSUIFRPPXXX-01")
ENTITY_BIC = os.environ.get("ENTITY_BIC", "BSUIFRPPXXX")
MANAGER_BIC = os.environ.get("MANAGER_BIC", "BDFEFRPPXXX")


def main() -> None:
    session = requests.Session()
    session.cert = (CLIENT_CERT, CLIENT_KEY)
    # Only verify the server certificate when a CA bundle is supplied.
    session.verify = CA_CERT if CA_CERT else False
    if not CA_CERT:
        import urllib3

        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    # 1. mTLS acceptance
    r = session.get(f"{BASE_URL}/check/mtls")
    print("1) GET /check/mtls        ->", r.status_code, r.text)

    # 2. Health (unauthenticated)
    r = session.get(f"{BASE_URL}/dlt/{NCB}/api/octopus/health")
    print("2) GET .../octopus/health ->", r.status_code, r.text)

    # 3. Token (mTLS + password grant)
    r = session.post(
        f"{BASE_URL}/iam/realms/{NCB}/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "username": USERNAME,
            "password": PASSWORD,
            "client_id": "esydlt-web-app",  # PILOT_READ_WRITE uses the web-app client
            "scope": "openid",
        },
    )
    token = r.json().get("access_token")
    print("3) POST .../token         ->", r.status_code, "(JWT acquired)" if token else r.text)
    if not token:
        raise SystemExit("No access_token - check USERNAME/PASSWORD and that the user is enrolled")

    # 4. NRO-signed funding request
    funding = {
        "techFundRequestID": os.environ.get("TECH_FUND_REQUEST_ID", f"FUND-{int(time.time() * 1000)}"),
        "amount": AMOUNT,
        "currency": "EUR",
        "creditedCashWalletAlias": CREDITED_ALIAS,
        "creditedCashWalletManagerID": MANAGER_BIC,
        "creditedCashWalletOwnerID": ENTITY_BIC,
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


if __name__ == "__main__":
    main()
