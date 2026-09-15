/**
 * Response-shape conformance tests for the FUNDING/DEFUNDING/DIRECT_RTGS
 * create and single-read endpoints (workbench issue #113): each of these was
 * returning a thin, hand-picked field subset instead of the official spec
 * schema's declared shape. These tests assert the *actual* declared fields are
 * present (via `assertConforms`, reused from `http-flow.test.ts`'s pattern)
 * for both the thin create/`-drafts` shapes and the richer single-GET shapes.
 *
 * Harness mirrors `tests/integration/http-flow.test.ts` (self-minted JWTs
 * verified by the mock's own test key, real ECDSA P-256 NRO signatures). Test
 * JWTs intentionally omit `preferred_username` (as in that file) so the
 * mTLS-consistency middleware is a no-op — `initiatorUserName`/
 * `approverUserName` are therefore blank in these responses; only their
 * *presence* as declared fields is asserted here, not their content.
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

process.env.PONTES_MOCK_BUSINESS_WINDOW_ALWAYS_OPEN = "true";

import { buildApp } from "../../src/app.js";
import { MemoryStore } from "../../src/state/memory-store.js";
import { getRuntimePkiBundle } from "../../src/auth/runtime-pki.js";
import { createInMemoryAuthUsersRepository } from "../../src/auth/users-repository.js";
import officialSpec from "../../src/ui/spec/pontes-official-v1.0.json";
import { buildSigningData } from "../../src/auth/nro-middleware.js";
import { ISSUANCE_WALLET_ALIAS, ISSUANCE_WALLET_BIC } from "../../src/state/issuance-wallet.js";

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

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
}

function request(
  port: number,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          ...opts.headers,
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        },
      },
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
          resolve({ status: res.statusCode || 0, json, text: data });
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
    { user_uuid: userUUID, user_profile: profile, entity_bic: "BSUIFRPPXXX", realm: "bdf", aud: "esydlt-backend-service" },
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

function officialProps(schemaName: string): Set<string> {
  const schema = (officialSpec as any).components.schemas[schemaName];
  return new Set(Object.keys(schema?.properties || {}));
}

/** Assert every field of `obj` is either an official property of `schemaName` or a known mock delta. */
function assertConforms(obj: Record<string, unknown>, schemaName: string, allowedDeltas: string[] = []): void {
  const allowed = officialProps(schemaName);
  const unexpected = Object.keys(obj).filter((k) => !allowed.has(k) && !allowedDeltas.includes(k));
  expect({ schemaName, unexpected }).toEqual({ schemaName, unexpected: [] });
}

const NCB = "bdf";
const BASE = `/dlt/${NCB}/api/octopus`;

async function buildTestApp(): Promise<App> {
  const store = new MemoryStore();
  const runtimePki = await getRuntimePkiBundle();
  const authUsersRepository = createInMemoryAuthUsersRepository();
  return buildApp({ store, runtimePki, authUsersRepository });
}

describe("Response enrichment — funding/defunding/direct-rtgs (workbench #113)", () => {
  let server: Server;
  let u1: string;
  let u2: string;
  let nro: { certPem: string; sign: (data: string) => string };

  beforeAll(async () => {
    delete process.env.REDIS_URL;
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
      techFundRequestID: "FUND-113-1",
      amount: "1000.00",
      currency: "EUR",
      creditedCashWalletAlias: "W113-FUND-01",
      creditedCashWalletManagerID: "MARKDEFFXXX",
      creditedCashWalletOwnerID: "BSUIFRPPXXX",
      debitedCashWalletAlias: ISSUANCE_WALLET_ALIAS,
      debitedCashWalletManagerID: ISSUANCE_WALLET_BIC,
      debitedCashWalletOwnerID: ISSUANCE_WALLET_BIC,
      instructingPartyID: "BSUIFRPPXXX",
      ...overrides,
    };
    // Real-Pontes-confirmed formula (issue #124), via the production
    // buildSigningData() rather than duplicating it here.
    const signature = nro.sign(buildSigningData(b)!);
    return { ...b, signature, signerPEM: nro.certPem };
  }

  // Signs a self-consistent FUNDING-shaped payload for draft-transition
  // (approve/cancel) endpoints — the transition handler ignores the body's
  // business fields once the NRO signature checks out, so this is reused for
  // both funding AND defunding draft transitions (issue #124).
  function nroFundingLikeTransition(overrides: Record<string, unknown> = {}) {
    const f = {
      type: "FUNDING",
      techFundRequestID: "FUND-113-APPROVE",
      amount: "1.00",
      creditedCashWalletOwnerID: "BSUIFRPPXXX",
      debitedCashWalletOwnerID: ISSUANCE_WALLET_BIC,
      ...overrides,
    };
    const signature = nro.sign(buildSigningData(f)!);
    return { ...f, signature, signerPEM: nro.certPem };
  }

  function rtgsBody(overrides: Record<string, unknown> = {}) {
    const b = {
      id: overrides.id || "DRTGS-113-01",
      amount: "50.00",
      currency: "EUR",
      correlationId: "CORR-113-01",
      payerBank: "MP01FRAAXXX",
      receiverBank: "MP01DEAAXXX",
      creditedCashWalletAlias: "W113-RTGS-DST",
      debitedCashWalletAlias: "W113-RTGS-SRC",
      instructingPartyID: "BSUIFRPPXXX",
      ...overrides,
    };
    const signature = nro.sign(String(b.id) + b.amount + b.payerBank + b.receiverBank);
    return { ...b, signature, signerPEM: nro.certPem };
  }

  // ---------------------------------------------------------------------
  // FUNDING / DEFUNDING
  // ---------------------------------------------------------------------

  it("enriches the DEFUNDING create response to conform to DefundingRequestResponse", async () => {
    // Fund the wallet first so it has balance to defund later.
    const funded = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: fundingBody({ creditedCashWalletAlias: "W113-DEFUND-SRC", techFundRequestID: "FUND-113-DF" }),
    });
    expect(funded.status).toBe(201);
    await request(server.port, "PUT", `${BASE}/tms/funding-requests-drafts/${funded.json.id}/approve`, {
      headers: { authorization: `Bearer ${u2}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: nroFundingLikeTransition(),
    });

    const body = {
      type: "DEFUNDING",
      techFundRequestID: "DEFUND-113-1",
      amount: "100.00",
      currency: "EUR",
      creditedCashWalletAlias: ISSUANCE_WALLET_ALIAS,
      creditedCashWalletManagerID: ISSUANCE_WALLET_BIC,
      creditedCashWalletOwnerID: ISSUANCE_WALLET_BIC,
      debitedCashWalletAlias: "W113-DEFUND-SRC",
      debitedCashWalletManagerID: "MARKDEFFXXX",
      debitedCashWalletOwnerID: "BSUIFRPPXXX",
      instructingPartyID: "BSUIFRPPXXX",
    };
    const signature = nro.sign(buildSigningData(body)!);
    const created = await request(server.port, "POST", `${BASE}/tms/defunding-requests`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: { ...body, signature, signerPEM: nro.certPem },
    });
    expect(created.status).toBe(201);
    expect(created.json.type).toBe("DEFUNDING");
    expect(created.json.defundingRequestType).toBe("D");
    expect(created.json.techFundRequestID).toBe("DEFUND-113-1");
    expect(created.json.signature).toBe(signature);
    expect(created.json.creditedCashWalletManagerID).toBe(ISSUANCE_WALLET_BIC);
    assertConforms(created.json, "triggermanagement.DefundingRequestResponse", [
      "fourEyesType",
      "status",
      "historicStatus",
      "timestamps",
      "lastUpdated",
      "initiatorUserName",
      "approverUserUUID",
      "approverUserName",
      "creationDate",
      "settledTime",
      "settledDate",
      "rootCause",
    ]);
  });

  it("splits the funding/defunding single-GET into thin (-drafts) and rich (non-drafts) shapes", async () => {
    const funded = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: fundingBody({ creditedCashWalletAlias: "W113-READ-01", techFundRequestID: "FUND-113-READ" }),
    });
    expect(funded.status).toBe(201);
    const id = funded.json.id;

    // Thin `-drafts` read, before settlement.
    const draftRead = await request(server.port, "GET", `${BASE}/tms/funding-defunding-requests-drafts/${id}`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    expect(draftRead.status).toBe(200);
    expect(draftRead.json.id).toBe(id);
    expect(draftRead.json.type).toBe("FUNDING");
    assertConforms(draftRead.json, "triggermanagement.FundingRequestResponse");

    await request(server.port, "PUT", `${BASE}/tms/funding-requests-drafts/${id}/approve`, {
      headers: { authorization: `Bearer ${u2}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: nroFundingLikeTransition(),
    });

    // Rich non-drafts read, after settlement — historicStatus/timestamps now populated.
    const richRead = await request(server.port, "GET", `${BASE}/tms/funding-defunding-requests/${id}`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    expect(richRead.status).toBe(200);
    expect(richRead.json.status).toBe("SETTLED");
    expect(Array.isArray(richRead.json.historicStatus)).toBe(true);
    expect(richRead.json.historicStatus).toEqual(expect.arrayContaining(["INITIALIZED", "PENDING_APPROVAL", "SETTLED"]));
    expect(richRead.json.timestamps).toBeTruthy();
    expect(richRead.json.settledDate).toBeTruthy();
    assertConforms(richRead.json, "triggermanagement.FundingRequest");
  });

  it("reads a settled DEFUNDING request via the rich shape (reusing FundingRequest, workbench #113)", async () => {
    const funded = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: fundingBody({ creditedCashWalletAlias: "W113-DF-READ-SRC", techFundRequestID: "FUND-113-DFREAD" }),
    });
    await request(server.port, "PUT", `${BASE}/tms/funding-requests-drafts/${funded.json.id}/approve`, {
      headers: { authorization: `Bearer ${u2}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: nroFundingLikeTransition(),
    });

    const body = {
      type: "DEFUNDING",
      techFundRequestID: "DEFUND-113-READ",
      amount: "10.00",
      currency: "EUR",
      creditedCashWalletAlias: ISSUANCE_WALLET_ALIAS,
      creditedCashWalletManagerID: ISSUANCE_WALLET_BIC,
      creditedCashWalletOwnerID: ISSUANCE_WALLET_BIC,
      debitedCashWalletAlias: "W113-DF-READ-SRC",
      debitedCashWalletManagerID: "MARKDEFFXXX",
      debitedCashWalletOwnerID: "BSUIFRPPXXX",
    };
    const signature = nro.sign(buildSigningData(body)!);
    const created = await request(server.port, "POST", `${BASE}/tms/defunding-requests`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: { ...body, signature, signerPEM: nro.certPem },
    });
    expect(created.status).toBe(201);

    await request(server.port, "PUT", `${BASE}/tms/defunding-requests-drafts/${created.json.id}/approve`, {
      headers: { authorization: `Bearer ${u2}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: nroFundingLikeTransition({ techFundRequestID: "DEFUND-113-READ-APPROVE" }),
    });

    const richRead = await request(server.port, "GET", `${BASE}/tms/funding-defunding-requests/${created.json.id}`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    expect(richRead.status).toBe(200);
    expect(richRead.json.status).toBe("SETTLED");
    expect(richRead.json.defundingRequestType).toBe("D");
    // `defundingRequestType` is not declared on the reused `FundingRequest`
    // schema — it's an intentional, documented delta for DEFUNDING reads.
    assertConforms(richRead.json, "triggermanagement.FundingRequest", ["defundingRequestType"]);
  });

  // ---------------------------------------------------------------------
  // DIRECT RTGS
  // ---------------------------------------------------------------------

  it("enriches the direct-RTGS create + thin -drafts read to conform to DirectRTGSPaymentInstructionResponse", async () => {
    // Both wallets must pre-exist (issue #93) — fund the source, one-step the destination.
    const funded = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: fundingBody({ creditedCashWalletAlias: "W113-RTGS-SRC", techFundRequestID: "FUND-113-RTGS" }),
    });
    await request(server.port, "PUT", `${BASE}/tms/funding-requests-drafts/${funded.json.id}/approve`, {
      headers: { authorization: `Bearer ${u2}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: nroFundingLikeTransition(),
    });
    const mkDst = await request(server.port, "POST", `${BASE}/ams/wallets/one-step`, {
      headers: { authorization: `Bearer ${u1}` },
      body: { walletAlias: "W113-RTGS-DST" },
    });
    expect(mkDst.status).toBe(201);

    const created = await request(server.port, "POST", `${BASE}/tms/direct-rtgs/payments`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: rtgsBody(),
    });
    expect(created.status).toBe(201);
    // The id is always server-minted (issue #32) -- a client-supplied value is
    // only checked for a duplicate, never echoed back verbatim.
    expect(typeof created.json.id).toBe("string");
    expect(created.json.type).toBe("Direct RTGS Payment");
    expect(created.json.correlationId).toBe("CORR-113-01");
    expect(created.json.payerBank).toBe("MP01FRAAXXX");
    expect(created.json.receiverBank).toBe("MP01DEAAXXX");
    expect(created.json.fourEyesType).toBe("DRAFT");
    assertConforms(created.json, "triggermanagement.DirectRTGSPaymentInstructionResponse");

    const draftRead = await request(server.port, "GET", `${BASE}/tms/direct-rtgs/payments-drafts/${created.json.id}`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    expect(draftRead.status).toBe(200);
    expect(draftRead.json.id).toBe(created.json.id);
    assertConforms(draftRead.json, "triggermanagement.DirectRTGSPaymentInstructionResponse");
  });

  it("enriches the direct-RTGS non-drafts read to the rich GetDirectRTGSPaymentInstruction shape", async () => {
    const funded = await request(server.port, "POST", `${BASE}/tms/funding-requests`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: fundingBody({ creditedCashWalletAlias: "W113-RTGS2-SRC", techFundRequestID: "FUND-113-RTGS2" }),
    });
    await request(server.port, "PUT", `${BASE}/tms/funding-requests-drafts/${funded.json.id}/approve`, {
      headers: { authorization: `Bearer ${u2}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: nroFundingLikeTransition(),
    });
    await request(server.port, "POST", `${BASE}/ams/wallets/one-step`, {
      headers: { authorization: `Bearer ${u1}` },
      body: { walletAlias: "W113-RTGS2-DST" },
    });

    const created = await request(server.port, "POST", `${BASE}/tms/direct-rtgs/payments`, {
      headers: { authorization: `Bearer ${u1}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: rtgsBody({
        id: "DRTGS-113-02",
        creditedCashWalletAlias: "W113-RTGS2-DST",
        debitedCashWalletAlias: "W113-RTGS2-SRC",
      }),
    });
    expect(created.status).toBe(201);

    const approve = await request(server.port, "PUT", `${BASE}/tms/direct-rtgs/payments-drafts/${created.json.id}/approve`, {
      headers: { authorization: `Bearer ${u2}`, "x-forwarded-client-cert": encodeURIComponent(nro.certPem) },
      body: rtgsBody({ id: created.json.id }),
    });
    expect(approve.status).toBe(200);

    const richRead = await request(server.port, "GET", `${BASE}/tms/direct-rtgs/payments/${created.json.id}`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    expect(richRead.status).toBe(200);
    expect(richRead.json.status).toBe("SETTLED");
    expect(richRead.json.historicStatus).toBeTruthy();
    expect(Object.keys(richRead.json.historicStatus)).toEqual(
      expect.arrayContaining(["INITIALIZED", "PENDING_APPROVAL", "SETTLED"]),
    );
    assertConforms(richRead.json, "triggermanagement.GetDirectRTGSPaymentInstruction");
  });
});
