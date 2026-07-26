/**
 * Minimal mTLS + NRO example client for mock-pontes (TypeScript / Node built-ins only).
 *
 * Flow:
 *   1. GET  /check/mtls                          — prove the client cert is accepted
 *   2. GET  /dlt/{ncb}/api/octopus/health        — unauthenticated round trip
 *   3. POST /iam/realms/{ncb}/.../token          — acquire a JWT (mTLS + password)
 *   4. POST /dlt/{ncb}/api/octopus/tms/funding-requests
 *                                                — NRO-signed funding request (2-step)
 *
 * No third-party dependencies: uses node:https and node:crypto.
 */

import { readFileSync } from "node:fs";
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
  // Funding parameters
  amount: process.env.AMOUNT ?? "1000000.00",
  creditedAlias: process.env.CREDITED_ALIAS ?? "WFREURBSUIFRPPXXX-01",
  entityBic: process.env.ENTITY_BIC ?? "BSUIFRPPXXX",
  managerBic: process.env.MANAGER_BIC ?? "BDFEFRPPXXX",
};

const cert = readFileSync(cfg.certPath);
const key = readFileSync(cfg.keyPath);
const ca = cfg.caPath ? readFileSync(cfg.caPath) : undefined;

const agent = new https.Agent({
  cert,
  key,
  ca,
  // Only verify the server certificate when a CA bundle is supplied.
  rejectUnauthorized: Boolean(ca),
});

interface Res {
  status: number;
  body: string;
}

function request(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<Res> {
  const url = new URL(path, cfg.baseUrl);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method, agent, headers: opts.headers ?? {} },
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

async function main(): Promise<void> {
  // 1. mTLS acceptance
  const mtls = await request("GET", "/check/mtls");
  console.log("1) GET /check/mtls        →", mtls.status, mtls.body);

  // 2. Health (unauthenticated)
  const health = await request("GET", `/dlt/${cfg.ncb}/api/octopus/health`);
  console.log("2) GET .../octopus/health →", health.status, health.body);

  // 3. Token (mTLS + password grant)
  const form = new URLSearchParams({
    grant_type: "password",
    username: cfg.username,
    password: cfg.password,
    client_id: "esydlt-web-app", // PILOT_READ_WRITE uses the web-app client
    scope: "openid",
  }).toString();
  const tokenRes = await request(
    "POST",
    `/iam/realms/${cfg.ncb}/protocol/openid-connect/token`,
    { headers: { "content-type": "application/x-www-form-urlencoded" }, body: form },
  );
  const token = JSON.parse(tokenRes.body).access_token as string | undefined;
  console.log("3) POST .../token         →", tokenRes.status, token ? "(JWT acquired)" : tokenRes.body);
  if (!token) throw new Error("No access_token — check USERNAME/PASSWORD and that the user is enrolled");

  // 4. NRO-signed funding request
  const funding = {
    techFundRequestID: process.env.TECH_FUND_REQUEST_ID ?? `FUND-${Date.now()}`,
    amount: cfg.amount,
    currency: "EUR",
    creditedCashWalletAlias: cfg.creditedAlias,
    creditedCashWalletManagerID: cfg.managerBic,
    creditedCashWalletOwnerID: cfg.entityBic,
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
}

main().catch((err) => {
  console.error("Example failed:", err);
  process.exit(1);
});
