/**
 * Minimal mTLS + NRO example client for mock-pontes (TypeScript / Node built-ins only).
 *
 * Flow:
 *   1. GET  /check/mtls                          — prove the client cert is accepted
 *   2. GET  /dlt/{ncb}/api/octopus/health        — unauthenticated round trip
 *   3. POST /iam/realms/{ncb}/.../token          — acquire a JWT (mTLS + password)
 *   4. POST /dlt/{ncb}/api/octopus/tms/funding-requests
 *                                                — NRO-signed funding request (2-step)
 *   5. PUT  /dlt/{ncb}/.../funding-requests-drafts/{id}/approve
 *                                                — four-eyes approval by a SECOND user
 *   6. GET  /dlt/{ncb}/api/octopus/ams/wallets/{alias}
 *                                                — verify the wallet was credited
 *
 * Four-eyes control: the request is created by the initiator but must be approved
 * by a *different* enrolled user (a distinct certificate / user UUID); self-
 * approval is rejected with 403 HL-GER-003. Steps 5-6 run only when a second
 * (approver) certificate is configured via APPROVER_CERT / APPROVER_KEY.
 *
 * No third-party dependencies: uses node:https and node:crypto.
 */

import { existsSync, readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import https from "node:https";

const cfg = {
  baseUrl: process.env.BASE_URL ?? "https://localhost:3001",
  ncb: process.env.NCB ?? "bdf",
  certPath: process.env.CLIENT_CERT ?? "user.crt",
  keyPath: process.env.CLIENT_KEY ?? "user.key",
  caPath: process.env.CA_CERT, // optional; when unset the server cert is NOT verified (local dev)
  username: process.env.PONTES_USERNAME ?? "PFRBSUIFRPPXXX0001",
  password: process.env.PONTES_PASSWORD ?? "initiator-secret",
  // Approver (four-eyes) — a SECOND enrolled user with its own certificate.
  approverCertPath: process.env.APPROVER_CERT ?? "approver.crt",
  approverKeyPath: process.env.APPROVER_KEY ?? "approver.key",
  approverUsername: process.env.APPROVER_USERNAME ?? "PFRBSUIFRPPXXX0002",
  approverPassword: process.env.APPROVER_PASSWORD ?? "approver-secret",
  // Funding parameters
  amount: process.env.AMOUNT ?? "1000000.00",
  creditedAlias: process.env.CREDITED_ALIAS ?? "WFREURBSUIFRPPXXX-01",
  entityBic: process.env.ENTITY_BIC ?? "BSUIFRPPXXX",
  managerBic: process.env.MANAGER_BIC ?? "BDFEFRPPXXX",
};

const cert = readFileSync(cfg.certPath);
const key = readFileSync(cfg.keyPath);
const ca = cfg.caPath ? readFileSync(cfg.caPath) : undefined;

/** Build an mTLS agent for a given certificate + key pair. */
function makeAgent(clientCert: Buffer, clientKey: Buffer): https.Agent {
  return new https.Agent({
    cert: clientCert,
    key: clientKey,
    ca,
    // Only verify the server certificate when a CA bundle is supplied.
    rejectUnauthorized: Boolean(ca),
  });
}

const agent = makeAgent(cert, key);

interface Res {
  status: number;
  body: string;
}

function request(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string; agent?: https.Agent } = {},
): Promise<Res> {
  const url = new URL(path, cfg.baseUrl);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method, agent: opts.agent ?? agent, headers: opts.headers ?? {} },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Acquire a JWT for a user over its own mTLS agent. */
async function getToken(
  reqAgent: https.Agent,
  username: string,
  password: string,
): Promise<{ status: number; token?: string; body: string }> {
  const form = new URLSearchParams({
    grant_type: "password",
    username,
    password,
    client_id: "esydlt-web-app", // PILOT_READ_WRITE uses the web-app client
    scope: "openid",
  }).toString();
  const res = await request(
    "POST",
    `/iam/realms/${cfg.ncb}/protocol/openid-connect/token`,
    { headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, agent: reqAgent },
  );
  return { status: res.status, token: JSON.parse(res.body).access_token, body: res.body };
}

async function main(): Promise<void> {
  // 1. mTLS acceptance
  const mtls = await request("GET", "/check/mtls");
  console.log("1) GET /check/mtls        →", mtls.status, mtls.body);

  // 2. Health (unauthenticated)
  const health = await request("GET", `/dlt/${cfg.ncb}/api/octopus/health`);
  console.log("2) GET .../octopus/health →", health.status, health.body);

  // 3. Token (mTLS + password grant)
  const { status: tokenStatus, token, body: tokenBody } = await getToken(
    agent,
    cfg.username,
    cfg.password,
  );
  console.log("3) POST .../token         →", tokenStatus, token ? "(JWT acquired)" : tokenBody);
  if (!token) throw new Error("No access_token — check USERNAME/PASSWORD and that the user is enrolled");

  // 4. NRO-signed funding request
  const funding = {
    techFundRequestID: process.env.TECH_FUND_REQUEST_ID ?? `FUND-${Date.now()}`,
    type: "FUNDING",
    amount: cfg.amount,
    currency: "EUR",
    creditedCashWalletAlias: cfg.creditedAlias,
    creditedCashWalletManagerID: cfg.managerBic,
    creditedCashWalletOwnerID: cfg.entityBic,
    debitedCashWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
    debitedCashWalletManagerID: "ECBFDEFFXXX",
    debitedCashWalletOwnerID: "ECBFDEFFXXX",
  };

  // NRO canonical signing string (Pontes v1.0):
  //   techFundRequestID + amount + creditedCashWalletOwnerID + debitedCashWalletOwnerID
  const signingData =
    funding.techFundRequestID +
    funding.amount +
    funding.creditedCashWalletOwnerID +
    funding.debitedCashWalletOwnerID;

  const signer = createSign("SHA256");
  signer.update(signingData);
  signer.end();
  const signature = signer.sign(key, "base64"); // DER ECDSA-P256 signature, base64
  const signerPEM = cert.toString(); // must equal the mTLS client certificate

  const fundingRes = await request(
    "POST",
    `/dlt/${cfg.ncb}/api/octopus/tms/funding-requests`,
    {
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...funding, signature, signerPEM }),
    },
  );
  console.log("4) POST .../funding-requests →", fundingRes.status, fundingRes.body);
  const fundingId = JSON.parse(fundingRes.body).id as string | undefined; // server FRQ id

  // 5. Four-eyes approval by a SECOND user (self-approval is rejected 403).
  if (!fundingId || !existsSync(cfg.approverCertPath) || !existsSync(cfg.approverKeyPath)) {
    console.log(
      "5) approval skipped — set APPROVER_CERT / APPROVER_KEY (a second enrolled user)" +
        " to run the four-eyes approve + balance check.",
    );
    return;
  }
  const approverAgent = makeAgent(readFileSync(cfg.approverCertPath), readFileSync(cfg.approverKeyPath));
  const approverToken = await getToken(approverAgent, cfg.approverUsername, cfg.approverPassword);
  if (!approverToken.token) {
    throw new Error(`Approver token failed: ${approverToken.status} ${approverToken.body}`);
  }
  const approveRes = await request(
    "PUT",
    `/dlt/${cfg.ncb}/api/octopus/tms/funding-requests-drafts/${fundingId}/approve`,
    { headers: { authorization: `Bearer ${approverToken.token}` }, agent: approverAgent },
  );
  console.log("5) PUT .../{id}/approve   →", approveRes.status, approveRes.body);

  // 6. Verify the credited wallet now holds the funded amount.
  const walletRes = await request(
    "GET",
    `/dlt/${cfg.ncb}/api/octopus/ams/wallets/${cfg.creditedAlias}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const balance = walletRes.status < 300 ? JSON.parse(walletRes.body).availableBalance : undefined;
  console.log(
    "6) GET .../ams/wallets     →",
    walletRes.status,
    balance ? `availableBalance=${balance}` : walletRes.body,
  );
}

main().catch((err) => {
  console.error("Example failed:", err);
  process.exit(1);
});
