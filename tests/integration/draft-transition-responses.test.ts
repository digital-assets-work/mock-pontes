/**
 * Draft-transition endpoints must return a plain JSON string confirmation, not
 * an object — the official spec declares `type: "string"` responses for these
 * approve/cancel endpoints and the PFoD leg-creation endpoints (follow-up from
 * the endpoint-response audit).
 *
 * Covers: funding-requests-drafts, defunding-requests-drafts,
 * rvs/transactions-drafts, direct-rtgs/payments-drafts (approve + cancel), and
 * both PFoD leg-creation endpoints (the two spec-documented success cases).
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import http from "node:http";
import { createSign, webcrypto } from "node:crypto";
import jwt from "jsonwebtoken";
import * as x509 from "@peculiar/x509";
import { toNodeListener, type App } from "h3";

process.env.PONTES_MOCK_BUSINESS_WINDOW_ALWAYS_OPEN = "true";

import { buildApp } from "../../src/app.js";
import { MemoryStore } from "../../src/state/memory-store.js";
import { getRuntimePkiBundle } from "../../src/auth/runtime-pki.js";
import { createInMemoryAuthUsersRepository } from "../../src/auth/users-repository.js";
import { buildSigningData } from "../../src/auth/nro-middleware.js";
import { ISSUANCE_WALLET_ALIAS, ISSUANCE_WALLET_BIC } from "../../src/state/issuance-wallet.js";

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const NCB = "bdf";
const ENTITY = "BSUIFRPPXXX";
const BASE = `/dlt/${NCB}/api/octopus`;

interface Server { port: number; close: () => Promise<void> }

async function listen(app: App): Promise<Server> {
  const server = http.createServer(toNodeListener(app));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

interface Res { status: number; json: any; text: string; headers: http.IncomingHttpHeaders }

function request(port: number, method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}): Promise<Res> {
  const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers: { ...opts.headers, ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json: any;
          try { json = data ? JSON.parse(data) : undefined; } catch { json = undefined; }
          resolve({ status: res.statusCode || 0, json, text: data, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function mintJwt(userUUID: string, profile = "PILOT_READ_WRITE"): Promise<string> {
  const pki = await getRuntimePkiBundle();
  return jwt.sign(
    // aud (issue #118): must intersect jwt-middleware's default audience
    // allow-list or the token is now rejected before reaching the handler.
    { user_uuid: userUUID, user_profile: profile, entity_bic: ENTITY, realm: NCB, aud: "esydlt-backend-service" },
    pki.jwtSigningPrivateKeyPem,
    { algorithm: "ES256", expiresIn: "5m" },
  );
}

async function makeNroSigner(): Promise<{ certPem: string; sign: (data: string) => string }> {
  const alg = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
  const keys = await webcrypto.subtle.generateKey(alg, true, ["sign", "verify"]);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: "CN=nro-test",
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 3600_000),
    signingAlgorithm: alg,
    keys,
  });
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", keys.privateKey)).toString("base64");
  const privPem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
  return {
    certPem: cert.toString("pem"),
    sign: (data: string) => createSign("SHA256").update(data).sign(privPem, "base64"),
  };
}

describe("Draft-transition endpoints return plain string confirmations (not objects)", () => {
  let server: Server;
  let store: MemoryStore;
  let u1: string;
  let u2: string;
  let ext: string;
  let nro: { certPem: string; sign: (data: string) => string };

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    process.env.TRUST_PROXY_CLIENT_CERT = "true";
    store = new MemoryStore();
    const runtimePki = await getRuntimePkiBundle();
    const app = buildApp({ store, runtimePki, authUsersRepository: createInMemoryAuthUsersRepository() });
    server = await listen(app);
    u1 = await mintJwt("user-1");
    u2 = await mintJwt("user-2");
    ext = await mintJwt("user-ext", "EXTERNAL_USER");
    nro = await makeNroSigner();
    // Seed a funded, caller-owned wallet for defunding / direct-RTGS (both use
    // a checked debit — availability + debit rights on the source).
    store.ensureWallet("SRC-DRAFT-RESP", { ownerEntityID: ENTITY, managerNCB: "BDF", availableBalance: "1000.00" });
    store.ensureWallet("DST-DRAFT-RESP", { ownerEntityID: ENTITY, managerNCB: "BDF", availableBalance: "0.00" });
  }, 30_000);

  afterAll(async () => {
    await server.close();
    delete process.env.TRUST_PROXY_CLIENT_CERT;
  });

  function nroHeaders() {
    return { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) };
  }

  // --- Funding -----------------------------------------------------------

  // Signs FUNDING/DEFUNDING using the real-Pontes-confirmed formula (issue
  // #124: 2dp amount + issuerTriggerBIC substitution + double hash) via the
  // production buildSigningData(), rather than duplicating the formula here.
  function fundingSignature(f: Record<string, unknown>) {
    return nro.sign(buildSigningData(f)!);
  }

  it("approves a funding draft with a plain string confirmation (not an object)", async () => {
    const f = {
      type: "FUNDING", techFundRequestID: "FUND-DRAFT-RESP-1", amount: "1.00", currency: "EUR",
      creditedCashWalletManagerID: "BDFEFRPPXXX", creditedCashWalletOwnerID: ENTITY,
      debitedCashWalletAlias: ISSUANCE_WALLET_ALIAS, debitedCashWalletManagerID: ISSUANCE_WALLET_BIC, debitedCashWalletOwnerID: ISSUANCE_WALLET_BIC,
    };
    const created = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: { ...f, creditedCashWalletAlias: "WFUND-DRAFT-RESP-1", signature: fundingSignature(f), signerPEM: nro.certPem },
    });
    expect(created.status).toBe(201);
    const approve = await request(server.port, "PUT", `${BASE}/tms/funding-requests-drafts/${created.json.id}/approve`, {
      headers: { authorization: `Bearer ${u2}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: { ...f, signature: fundingSignature(f), signerPEM: nro.certPem },
    });
    expect(approve.status).toBe(200);
    expect(String(approve.headers["content-type"])).toMatch(/application\/json/);
    expect(approve.json).toBe("Funding Request Draft Approved Succesfully");
  });

  it("cancels a funding draft with a plain string confirmation (not an object)", async () => {
    const f = {
      type: "FUNDING", techFundRequestID: "FUND-DRAFT-RESP-2", amount: "1.00", currency: "EUR",
      creditedCashWalletManagerID: "BDFEFRPPXXX", creditedCashWalletOwnerID: ENTITY,
      debitedCashWalletAlias: ISSUANCE_WALLET_ALIAS, debitedCashWalletManagerID: ISSUANCE_WALLET_BIC, debitedCashWalletOwnerID: ISSUANCE_WALLET_BIC,
    };
    const created = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: { ...f, creditedCashWalletAlias: "WFUND-DRAFT-RESP-2", signature: fundingSignature(f), signerPEM: nro.certPem },
    });
    expect(created.status).toBe(201);
    const cancel = await request(server.port, "PUT", `${BASE}/tms/funding-requests-drafts/${created.json.id}/cancel`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: { ...f, signature: fundingSignature(f), signerPEM: nro.certPem },
    });
    expect(cancel.status).toBe(200);
    expect(cancel.json).toBe("Funding Request Draft Cancelled Succesfully");
  });

  // --- Defunding -----------------------------------------------------------

  it("approves a defunding draft with a plain string confirmation (not an object)", async () => {
    const f = {
      type: "DEFUNDING", techFundRequestID: "DEFUND-DRAFT-RESP-1", amount: "1.00", currency: "EUR",
      creditedCashWalletAlias: ISSUANCE_WALLET_ALIAS, creditedCashWalletManagerID: ISSUANCE_WALLET_BIC, creditedCashWalletOwnerID: ISSUANCE_WALLET_BIC,
      debitedCashWalletManagerID: "BDFEFRPPXXX", debitedCashWalletOwnerID: ENTITY,
    };
    const created = await request(server.port, "POST", `${BASE}/tms/defunding-requests`, {
      headers: nroHeaders(),
      body: { ...f, debitedCashWalletAlias: "SRC-DRAFT-RESP", signature: fundingSignature(f), signerPEM: nro.certPem },
    });
    expect(created.status).toBe(201);
    const approve = await request(server.port, "PUT", `${BASE}/tms/defunding-requests-drafts/${created.json.id}/approve`, {
      headers: { authorization: `Bearer ${u2}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: { ...f, signature: fundingSignature(f), signerPEM: nro.certPem },
    });
    expect(approve.status).toBe(200);
    expect(approve.json).toBe("Defunding Request Draft Approved Successfully");
  });

  it("cancels a defunding draft with a plain string confirmation (not an object)", async () => {
    const f = {
      type: "DEFUNDING", techFundRequestID: "DEFUND-DRAFT-RESP-2", amount: "1.00", currency: "EUR",
      creditedCashWalletAlias: ISSUANCE_WALLET_ALIAS, creditedCashWalletManagerID: ISSUANCE_WALLET_BIC, creditedCashWalletOwnerID: ISSUANCE_WALLET_BIC,
      debitedCashWalletManagerID: "BDFEFRPPXXX", debitedCashWalletOwnerID: ENTITY,
    };
    const created = await request(server.port, "POST", `${BASE}/tms/defunding-requests`, {
      headers: nroHeaders(),
      body: { ...f, debitedCashWalletAlias: "SRC-DRAFT-RESP", signature: fundingSignature(f), signerPEM: nro.certPem },
    });
    expect(created.status).toBe(201);
    const cancel = await request(server.port, "PUT", `${BASE}/tms/defunding-requests-drafts/${created.json.id}/cancel`, {
      headers: nroHeaders(),
      body: { ...f, signature: fundingSignature(f), signerPEM: nro.certPem },
    });
    expect(cancel.status).toBe(200);
    expect(cancel.json).toBe("Defunding Request Draft Cancelled Successfully");
  });

  // --- Direct RTGS -----------------------------------------------------------

  function rtgsSignature(id: string, amount: string, payerBank: string, receiverBank: string) {
    return nro.sign(id + amount + payerBank + receiverBank);
  }

  it("approves a direct-RTGS draft with a plain string confirmation (not an object)", async () => {
    const id = "DRTGS-DRAFT-RESP-1";
    const body = {
      id, amount: "1.00", currency: "EUR", correlationId: id, payerBank: ENTITY, receiverBank: "ECBFDEFFXXX",
      creditedCashWalletAlias: "DST-DRAFT-RESP", debitedCashWalletAlias: "SRC-DRAFT-RESP",
    };
    const created = await request(server.port, "POST", `${BASE}/tms/direct-rtgs/payments`, {
      headers: nroHeaders(),
      body: { ...body, signature: rtgsSignature(id, body.amount, body.payerBank, body.receiverBank), signerPEM: nro.certPem },
    });
    expect(created.status).toBe(201);
    const approve = await request(server.port, "PUT", `${BASE}/tms/direct-rtgs/payments-drafts/${created.json.id}/approve`, {
      headers: { authorization: `Bearer ${u2}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: { ...body, signature: rtgsSignature(id, body.amount, body.payerBank, body.receiverBank), signerPEM: nro.certPem },
    });
    expect(approve.status).toBe(200);
    expect(approve.json).toBe("Direct RTGS Payment Draft Approved Successfully");
  });

  it("cancels a direct-RTGS draft with a plain string confirmation (not an object)", async () => {
    const id = "DRTGS-DRAFT-RESP-2";
    const body = {
      id, amount: "1.00", currency: "EUR", correlationId: id, payerBank: ENTITY, receiverBank: "ECBFDEFFXXX",
      creditedCashWalletAlias: "DST-DRAFT-RESP", debitedCashWalletAlias: "SRC-DRAFT-RESP",
    };
    const created = await request(server.port, "POST", `${BASE}/tms/direct-rtgs/payments`, {
      headers: nroHeaders(),
      body: { ...body, signature: rtgsSignature(id, body.amount, body.payerBank, body.receiverBank), signerPEM: nro.certPem },
    });
    expect(created.status).toBe(201);
    const cancel = await request(server.port, "PUT", `${BASE}/tms/direct-rtgs/payments-drafts/${created.json.id}/cancel`, {
      headers: nroHeaders(),
      body: { ...body, signature: rtgsSignature(id, body.amount, body.payerBank, body.receiverBank), signerPEM: nro.certPem },
    });
    expect(cancel.status).toBe(200);
    expect(cancel.json).toBe("Direct RTGS Payment Draft Cancelled Successfully");
  });

  // --- Transfers (rvs/transactions-drafts) — not NRO-signed -----------------

  it("approves a transfer draft with a plain string confirmation (not an object)", async () => {
    const created = await request(server.port, "POST", `${BASE}/rvs/transactions-requests`, {
      headers: { authorization: `Bearer ${u1}` },
      body: {
        instructionID: "TR-DRAFT-RESP-1", type: "TRANSFER", cbdcRequestType: "OPERATION",
        amountTransferred: "1.00", currency: "EUR", instructingPartyID: ENTITY,
        creditedCashWalletAlias: "DST-DRAFT-RESP", creditedCashWalletManagerID: "BDF",
        debitedCashWalletAlias: "SRC-DRAFT-RESP", debitedCashWalletManagerID: "BDF",
      },
    });
    expect(created.status).toBe(201);
    const approve = await request(server.port, "PUT", `${BASE}/rvs/transactions-drafts/${created.json.instructionID}/approve`, {
      headers: { authorization: `Bearer ${u2}` },
    });
    expect(approve.status).toBe(200);
    expect(approve.json).toBe("Cash Token Transaction Draft Approved Succesfully");
  });

  it("cancels a transfer draft with a plain string confirmation (not an object)", async () => {
    const created = await request(server.port, "POST", `${BASE}/rvs/transactions-requests`, {
      headers: { authorization: `Bearer ${u1}` },
      body: {
        instructionID: "TR-DRAFT-RESP-2", type: "TRANSFER", cbdcRequestType: "OPERATION",
        amountTransferred: "1.00", currency: "EUR", instructingPartyID: ENTITY,
        creditedCashWalletAlias: "DST-DRAFT-RESP", creditedCashWalletManagerID: "BDF",
        debitedCashWalletAlias: "SRC-DRAFT-RESP", debitedCashWalletManagerID: "BDF",
      },
    });
    expect(created.status).toBe(201);
    const cancel = await request(server.port, "PUT", `${BASE}/rvs/transactions-drafts/${created.json.instructionID}/cancel`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    expect(cancel.status).toBe(200);
    expect(cancel.json).toBe("Cash Token Transaction Draft Cancelled Succesfully");
  });

  // --- PFoD leg creation — not NRO-signed -----------------------------------

  it("a lone DELI leg (awaiting its RECE counterpart) returns the spec's plain string, 201", async () => {
    const deli = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/initpfoddeli`, {
      headers: { authorization: `Bearer ${ext}` },
      body: { tradeID: "PFOD-DRAFT-RESP-1", amount: "1.00", currency: "EUR", sellerCashTokenWalletRef: "SRC-DRAFT-RESP", sellerID: ENTITY },
    });
    expect(deli.status).toBe(201);
    expect(deli.json).toBe("PFoD DELI leg created successfully and awaiting corresponding RECE leg");
  });

  it("a RECE leg that completes the match (DELI already present) returns the spec's plain string, 200", async () => {
    const tradeID = "PFOD-DRAFT-RESP-2";
    const deli = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/initpfoddeli`, {
      headers: { authorization: `Bearer ${ext}` },
      body: { tradeID, amount: "1.00", currency: "EUR", sellerCashTokenWalletRef: "SRC-DRAFT-RESP", sellerID: ENTITY },
    });
    expect(deli.status).toBe(201);
    const rece = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/initpfodrece`, {
      headers: { authorization: `Bearer ${ext}` },
      body: { tradeID, amount: "1.00", currency: "EUR", buyerCashTokenWalletRef: "DST-DRAFT-RESP", buyerID: ENTITY, sellerCAMBIC: "ECBFDEFFXXX" },
    });
    // The audit found this path always returned 201 instead of the spec's 200
    // on the settle path — pin the corrected status code here too.
    expect(rece.status).toBe(200);
    expect(rece.json).toBe("PFoD RECE leg created an settled successfully");
  });
});
