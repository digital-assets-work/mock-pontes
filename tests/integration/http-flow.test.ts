/**
 * HTTP integration + official-schema conformance tests (issue #39).
 *
 * Boots the real h3 app in-process (via `buildApp`) behind a plain-HTTP listener
 * and drives the contract surface end to end — so the route handlers (previously
 * 0% covered) are exercised, including the negative paths that guard earlier
 * fixes:
 *   - self-approval → 403 (four-eyes, #28)
 *   - unknown {ncb} → 404 (#36)
 *   - missing NRO signature → 400, and the signer↔mTLS binding fail-closed (#30)
 *
 * mTLS is not used at the transport here; the four-eyes flow is driven with
 * self-minted JWTs (verified by the mock's own test key) that omit
 * `preferred_username` (so the mTLS-consistency middleware is a no-op) and carry
 * distinct `user_uuid` claims. NRO signatures are real ECDSA P-256 signatures.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";
import http from "node:http";
import { createSign, webcrypto } from "node:crypto";
import { toNodeListener, type App } from "h3";
import jwt from "jsonwebtoken";
import * as x509 from "@peculiar/x509";

// Drive the API irrespective of the wall-clock: the spec-driven business window
// (issue #81) would otherwise time-restrict some writes. Window behaviour is
// covered in tests/business-window.test.ts.
process.env.PONTES_MOCK_BUSINESS_WINDOW_ALWAYS_OPEN = "true";

import { buildApp } from "../../src/app.js";
import { MemoryStore } from "../../src/state/memory-store.js";
import { getRuntimePkiBundle } from "../../src/auth/runtime-pki.js";
import { createInMemoryAuthUsersRepository } from "../../src/auth/users-repository.js";
import officialSpec from "../../src/ui/spec/pontes-official-v1.0.json";

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

// ---------------------------------------------------------------------------
// HTTP harness
// ---------------------------------------------------------------------------

interface Server {
  port: number;
  close: () => Promise<void>;
}

async function listen(app: App): Promise<Server> {
  const server = http.createServer(toNodeListener(app));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

interface Res {
  status: number;
  json: any;
  text: string;
  headers: http.IncomingHttpHeaders;
}

function request(
  port: number,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload =
      opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers: { ...opts.headers, ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json: any;
          try {
            json = data ? JSON.parse(data) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode || 0, json, text: data, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test identities & NRO signing
// ---------------------------------------------------------------------------

async function mintJwt(userUUID: string, profile = "PILOT_READ_WRITE"): Promise<string> {
  // Sign with the persisted, shared JWT key from the runtime PKI bundle (#47) —
  // the same key the app now verifies with.
  const pki = await getRuntimePkiBundle();
  // No preferred_username → the mTLS-consistency middleware is a no-op.
  return jwt.sign(
    { user_uuid: userUUID, user_profile: profile, entity_bic: "BSUIFRPPXXX", realm: "bdf" },
    pki.jwtSigningPrivateKeyPem,
    { algorithm: "ES256", expiresIn: "5m" },
  );
}

async function makeNroSigner(): Promise<{
  certPem: string;
  sign: (data: string) => string;
}> {
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
  const pkcs8 = Buffer.from(
    await webcrypto.subtle.exportKey("pkcs8", keys.privateKey),
  ).toString("base64");
  const privPem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
  return {
    certPem: cert.toString("pem"),
    sign: (data: string) => createSign("SHA256").update(data).sign(privPem, "base64"),
  };
}

// ---------------------------------------------------------------------------
// Conformance helper
// ---------------------------------------------------------------------------

function officialProps(schemaName: string): Set<string> {
  const schema = (officialSpec as any).components.schemas[schemaName];
  return new Set(Object.keys(schema?.properties || {}));
}

/**
 * Assert every field of `obj` is either an official property of `schemaName` or
 * a known mock delta — turning payload divergences into a maintained list.
 */
function assertConforms(
  obj: Record<string, unknown>,
  schemaName: string,
  allowedDeltas: string[],
): void {
  const allowed = officialProps(schemaName);
  const unexpected = Object.keys(obj).filter(
    (k) => !allowed.has(k) && !allowedDeltas.includes(k),
  );
  expect({ schemaName, unexpected }).toEqual({ schemaName, unexpected: [] });
}

// ---------------------------------------------------------------------------

const NCB = "bdf";
const BASE = `/dlt/${NCB}/api/octopus`;

async function buildTestApp(): Promise<App> {
  const store = new MemoryStore();
  const runtimePki = await getRuntimePkiBundle();
  const authUsersRepository = createInMemoryAuthUsersRepository();
  return buildApp({ store, runtimePki, authUsersRepository });
}

describe("HTTP integration — money movement + guards (issue #39)", () => {
  let server: Server;
  let u1: string;
  let u2: string;
  let nro: { certPem: string; sign: (data: string) => string };

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    // The signer↔mTLS binding is always enforced; establish the client cert via
    // the trusted-proxy forwarded-cert path (the mock behind a TLS-terminating
    // proxy) using the same cert the request is NRO-signed with.
    process.env.TRUST_PROXY_CLIENT_CERT = "true";
    server = await listen(await buildTestApp());
    u1 = await mintJwt("user-1");
    u2 = await mintJwt("user-2");
    nro = await makeNroSigner();
  }, 30_000);

  afterAll(async () => {
    await server.close();
    delete process.env.TRUST_PROXY_CLIENT_CERT;
  });

  function fundingBody(overrides: Record<string, unknown> = {}) {
    const b = {
      type: "FUNDING",
      techFundRequestID: "FUND-INT-1",
      amount: "1000.00",
      currency: "EUR",
      creditedCashWalletAlias: "WDEEURTESTAAAA-01",
      creditedCashWalletManagerID: "MARKDEFFXXX",
      creditedCashWalletOwnerID: "BSUIFRPPXXX",
      debitedCashWalletAlias: "WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET",
      debitedCashWalletManagerID: "ECBFDEFFXXX",
      debitedCashWalletOwnerID: "ECBFDEFFXXX",
      ...overrides,
    };
    const signature = nro.sign(
      b.techFundRequestID + b.amount + b.creditedCashWalletOwnerID + b.debitedCashWalletOwnerID,
    );
    return { ...b, signature, signerPEM: nro.certPem };
  }

  it("rejects an unknown {ncb} with 404 (#36)", async () => {
    const res = await request(server.port, "GET", `/dlt/ZZZZ/api/octopus/ams/wallets`);
    expect(res.status).toBe(404);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-GER-001");
  });

  it("marks every response with the X-Mock-Pontes header (#41)", async () => {
    const res = await request(server.port, "GET", `${BASE}/ams/wallets`);
    expect(res.headers["x-mock-pontes"]).toBe("true");
    expect(res.headers["x-mock-pontes-version"]).toBeDefined();
  });

  it("401s a protected route without a token (normalised, #33)", async () => {
    const res = await request(server.port, "GET", `${BASE}/ams/wallets`);
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ status: 401, title: "Unauthorized" });
    expect(res.json.businessErrors[0].errorCode).toBeDefined();
  });

  it("400s a funding create with no NRO signature (#29/#30)", async () => {
    const res = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: { authorization: `Bearer ${u1}` },
      body: { techFundRequestID: "X", amount: "1.00" },
    });
    expect(res.status).toBe(400);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-NRO-001");
  });

  it("drives funding create → self-approve 403 → second-user approve 200 (#28)", async () => {
    // create (user-1)
    const created = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: {
        authorization: `Bearer ${u1}`,
        "x-forwarded-client-cert": encodeURIComponent(nro.certPem),
      },
      body: fundingBody(),
    });
    expect(created.status).toBe(201);
    expect(typeof created.json.id).toBe("string");
    // conformance: create response matches the official FundingRequestResponse
    // (known mock deltas: lifecycle status + createdAt timestamp).
    assertConforms(created.json, "triggermanagement.FundingRequestResponse", ["status", "createdAt"]);
    const id = created.json.id;

    // self-approval by the initiator → 403 (four-eyes, #28)
    const self = await request(server.port, "PUT", `${BASE}/tms/funding-requests-drafts/${id}/approve`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    expect(self.status).toBe(403);
    expect(self.json.businessErrors[0].errorCode).toBe("HL-GER-003");

    // approval by a distinct user → 200
    const ok = await request(server.port, "PUT", `${BASE}/tms/funding-requests-drafts/${id}/approve`, {
      headers: { authorization: `Bearer ${u2}` },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe("SETTLED");

    // the credited wallet now exists in the wallet list
    const wallets = await request(server.port, "GET", `${BASE}/ams/wallets`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    expect(wallets.status).toBe(200);
    const aliases = JSON.stringify(wallets.json);
    expect(aliases).toContain("WDEEURTESTAAAA-01");
  });

  it("rejects a funding create with an invalid amount (400 HL-VAL, #53)", async () => {
    const res = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: {
        authorization: `Bearer ${u1}`,
        "x-forwarded-client-cert": encodeURIComponent(nro.certPem),
      },
      body: fundingBody({ amount: "banana" }),
    });
    expect(res.status).toBe(400);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-VAL-001");
    expect(JSON.stringify(res.json)).toMatch(/amount/);
  });

  it("returns 501 for a declared-but-unimplemented official operation (#62)", async () => {
    const res = await request(server.port, "POST", `${BASE}/tms/funding-defunding-requests/extract`, {
      headers: { authorization: `Bearer ${u1}` },
      body: {},
    });
    expect(res.status).toBe(501);
    expect(res.json).toMatchObject({ status: 501, title: "Not Implemented" });
    expect(res.json.businessErrors[0].errorCode).toBe("HL-NIMP-001");
  });

  it("still 404s a truly unknown official-looking path (#62)", async () => {
    const res = await request(server.port, "GET", `${BASE}/tms/definitely-not-a-real-endpoint`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    expect(res.status).toBe(404);
  });

  it("rejects a non-EUR currency on funding create (400 HL-VAL-001, #80)", async () => {
    const res = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: {
        authorization: `Bearer ${u1}`,
        "x-forwarded-client-cert": encodeURIComponent(nro.certPem),
      },
      body: fundingBody({ currency: "USD" }),
    });
    expect(res.status).toBe(400);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-VAL-001");
    expect(JSON.stringify(res.json)).toMatch(/Unsupported currency 'USD'/);
  });

  it("rejects a CSR enrolment with a typo'd/unknown profile (400, #84)", async () => {
    const res = await request(server.port, "POST", `/iam/realms/${NCB}/protocol/openid-connect/csr`, {
      body: {
        username: "PTYPO0001",
        password: "secret",
        profile: "PILOT_READWRITE", // typo — missing underscore
        entityBIC: "BSUIFRPPXXX",
        csr: "dummy-csr-not-reached",
      },
    });
    expect(res.status).toBe(400);
    // The CSR error body is normalised (only the token endpoint keeps the OAuth shape).
    expect(res.text).toMatch(/Unknown profile/);
  });

  it("returns application/json (a JSON string) for a one-step bridge payment (#82)", async () => {
    // Fund a source wallet first.
    const funded = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: fundingBody({ creditedCashWalletAlias: "WPAY-SRC-82", techFundRequestID: "FUND-82" }),
    });
    expect(funded.status).toBe(201);
    await request(server.port, "PUT", `${BASE}/tms/funding-requests-drafts/${funded.json.id}/approve`, {
      headers: { authorization: `Bearer ${u2}` },
    });
    // Pre-create the destination wallet — it is no longer auto-created (#93).
    const mkDst = await request(server.port, "POST", `${BASE}/ams/wallets/one-step`, {
      headers: { authorization: `Bearer ${u1}` },
      body: { walletAlias: "WPAY-DST-82" },
    });
    expect(mkDst.status).toBe(201);
    // 1-step bridge payments require the EXTERNAL_USER profile.
    const ext = await mintJwt("user-ext", "EXTERNAL_USER");
    const pay = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/payments`, {
      headers: { authorization: `Bearer ${ext}` },
      body: {
        paymentID: "PAY-82",
        amount: "10.00",
        currency: "EUR",
        creditedCashWalletAlias: "WPAY-DST-82",
        creditedCashWalletManagerID: "BDFEFRPPXXX",
        debitedCashWalletAlias: "WPAY-SRC-82",
        debitedCashWalletManagerID: "ECBFDEFFXXX",
      },
    });
    expect(pay.status).toBe(200);
    expect(String(pay.headers["content-type"])).toMatch(/application\/json/);
    expect(pay.json).toBe("Cash Token Payment Settled Succesfully");
  });

  it("rejects a 1-step bridge payment to an unknown credited wallet (422 HL-WAL-003, #93)", async () => {
    // Fund a source so the debit side exists; the credited wallet does NOT exist.
    const funded = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: fundingBody({ creditedCashWalletAlias: "WPAY-SRC-93", techFundRequestID: "FUND-93" }),
    });
    expect(funded.status).toBe(201);
    await request(server.port, "PUT", `${BASE}/tms/funding-requests-drafts/${funded.json.id}/approve`, {
      headers: { authorization: `Bearer ${u2}` },
    });
    const ext = await mintJwt("user-ext-93", "EXTERNAL_USER");
    const pay = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/payments`, {
      headers: { authorization: `Bearer ${ext}` },
      body: {
        paymentID: "PAY-93",
        amount: "10.00",
        currency: "EUR",
        creditedCashWalletAlias: "WPAY-GHOST-93", // never created
        creditedCashWalletManagerID: "BDFEFRPPXXX",
        debitedCashWalletAlias: "WPAY-SRC-93",
        debitedCashWalletManagerID: "ECBFDEFFXXX",
      },
    });
    expect(pay.status).toBe(422);
    expect(pay.json.businessErrors[0].errorCode).toBe("HL-WAL-003");
    expect(JSON.stringify(pay.json)).toMatch(/ams\/wallets\/one-step/);
    // The debit side must be untouched — funds are not moved on rejection.
    const src = await request(server.port, "GET", `${BASE}/ams/wallets/WPAY-SRC-93`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    expect(src.json.availableBalance).toBe("1000.00");
  });

  it("creates a wallet for the caller's own entity via POST ams/wallets/one-step (#77)", async () => {
    const res = await request(server.port, "POST", `${BASE}/ams/wallets/one-step`, {
      headers: { authorization: `Bearer ${u1}` },
      body: { walletAlias: "WNEW-77-01", isMainWallet: false },
    });
    expect(res.status).toBe(201);
    expect(res.json.walletAlias).toBe("WNEW-77-01");
    expect(res.json.ownerEntityID).toBe("BSUIFRPPXXX");
    const read = await request(server.port, "GET", `${BASE}/ams/wallets/WNEW-77-01`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    expect(read.status).toBe(200);
  });

  it("rejects creating a wallet for another entity (#77)", async () => {
    const res = await request(server.port, "POST", `${BASE}/ams/wallets/one-step`, {
      headers: { authorization: `Bearer ${u1}` },
      body: { walletAlias: "WNEW-77-02", ownerEntityID: "SOMEOTHERBICXXX" },
    });
    expect(res.status).toBe(403);
  });

  it("409s a duplicate wallet creation (#77)", async () => {
    await request(server.port, "POST", `${BASE}/ams/wallets/one-step`, {
      headers: { authorization: `Bearer ${u1}` },
      body: { walletAlias: "WDUP-77" },
    });
    const res = await request(server.port, "POST", `${BASE}/ams/wallets/one-step`, {
      headers: { authorization: `Bearer ${u1}` },
      body: { walletAlias: "WDUP-77" },
    });
    expect(res.status).toBe(409);
  });

  it("funding auto-creates the credited wallet owned by the caller's entity, not the body (#77)", async () => {
    const created = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: {
        authorization: `Bearer ${u1}`,
        "x-forwarded-client-cert": encodeURIComponent(nro.certPem),
      },
      body: fundingBody({ creditedCashWalletAlias: "WAUTO-77", creditedCashWalletOwnerID: "IGNOREDBICXXX" }),
    });
    expect(created.status).toBe(201);
    await request(server.port, "PUT", `${BASE}/tms/funding-requests-drafts/${created.json.id}/approve`, {
      headers: { authorization: `Bearer ${u2}` },
    });
    const w = await request(server.port, "GET", `${BASE}/ams/wallets/WAUTO-77`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    expect(w.status).toBe(200);
    expect(w.json.ownerEntityID).toBe("BSUIFRPPXXX"); // caller entity, not the body's owner
  });
});

describe("HTTP integration — NRO signer↔mTLS fail-closed (#30)", () => {
  let server: Server;
  let token: string;
  let nro: { certPem: string; sign: (data: string) => string };

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    delete process.env.TRUST_PROXY_CLIENT_CERT;
    server = await listen(await buildTestApp());
    token = await mintJwt("user-1");
    nro = await makeNroSigner();
  }, 30_000);

  afterAll(async () => {
    await server.close();
  });

  it("rejects an NRO create when no client certificate is established (403 HL-NRO-005)", async () => {
    const b = {
      techFundRequestID: "FUND-BIND-1",
      amount: "5.00",
      creditedCashWalletAlias: "WDEEURTESTAAAA-02",
      creditedCashWalletOwnerID: "TESTAAAA",
      debitedCashWalletOwnerID: "ECBFDEFFXXX",
    };
    const signature = nro.sign(
      b.techFundRequestID + b.amount + b.creditedCashWalletOwnerID + b.debitedCashWalletOwnerID,
    );
    const res = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: { authorization: `Bearer ${token}` },
      body: { ...b, signature, signerPEM: nro.certPem },
    });
    expect(res.status).toBe(403);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-NRO-005");
  });
});
