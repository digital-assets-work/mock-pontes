/**
 * Settlement flows — route-level integration with balance-before/after and a
 * conservation-of-value invariant (issue #83, following the review's key ask).
 *
 * These are exactly the assertions that would have caught the #77 money-burn:
 * after every settlement, each wallet moves by the expected amount AND the sum
 * of all balances (available + locked) is conserved.
 *
 * Seeds balances directly on the store (the funding path is covered elsewhere)
 * and drives the settlement over real HTTP so the route handlers are exercised.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import http from "node:http";
import jwt from "jsonwebtoken";
import { toNodeListener, type App } from "h3";

// Exercise the settlement routes irrespective of the wall-clock: transfer
// creation is Start-of-Day-only under the spec-driven business window (issue
// #81), so disable window enforcement here (the window itself is tested in
// tests/business-window.test.ts).
process.env.PONTES_MOCK_BUSINESS_WINDOW_ALWAYS_OPEN = "true";

import { buildApp } from "../../src/app.js";
import { MemoryStore } from "../../src/state/memory-store.js";
import { getRuntimePkiBundle } from "../../src/auth/runtime-pki.js";
import { createInMemoryAuthUsersRepository } from "../../src/auth/users-repository.js";

const NCB = "bdf";
const ENTITY = "BSUIFRPPXXX";

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
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

interface Res { status: number; json: any; text: string }

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
    { user_uuid: userUUID, user_profile: profile, entity_bic: ENTITY, realm: NCB, aud: "esydlt-backend-service" },
    pki.jwtSigningPrivateKeyPem,
    { algorithm: "ES256", expiresIn: "5m" },
  );
}

describe("Settlement flows — conservation of value (issue #83)", () => {
  let server: Server;
  let store: MemoryStore;
  let u1: string;
  let u2: string;
  let ext: string;

  const total = () => store.getWallets().reduce((n, w) => n + parseFloat(w.balance) + parseFloat(w.lockedBalance), 0);
  const avail = (alias: string) => parseFloat(store.getWallet(alias)!.balance);

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    store = new MemoryStore();
    const runtimePki = await getRuntimePkiBundle();
    const app = buildApp({ store, runtimePki, authUsersRepository: createInMemoryAuthUsersRepository() });
    server = await listen(app);
    u1 = await mintJwt("user-1");
    u2 = await mintJwt("user-2");
    ext = await mintJwt("user-ext", "EXTERNAL_USER");
    // Seed a funded source and an existing target, both owned by the caller's entity.
    // managerNCB matches the transfer bodies' *CashWalletManagerID (BDFEFRPPXXX) so the
    // new manager-consistency checks (HL-WAL-004/005/006) pass.
    store.ensureWallet("S-SRC", { ownerEntityID: ENTITY, managerNCB: "BDFEFRPPXXX", availableBalance: "1000.00" });
    store.ensureWallet("S-DST", { ownerEntityID: ENTITY, managerNCB: "BDFEFRPPXXX", availableBalance: "0.00" });
  }, 30_000);

  afterAll(async () => { await server.close(); });

  it("2-step transfer moves the exact amount and conserves value", async () => {
    const before = total();
    const create = await request(server.port, "POST", `/dlt/${NCB}/api/octopus/rvs/transactions-requests`, {
      headers: { authorization: `Bearer ${u1}` },
      body: {
        instructionID: "TR-83-1",
        type: "TRANSFER",
        cbdcRequestType: "OPERATION",
        amountTransferred: "250.00",
        currency: "EUR",
        creditedCashWalletAlias: "S-DST",
        creditedCashWalletManagerID: "BDFEFRPPXXX",
        creditedCashWalletOwnerID: ENTITY,
        debitedCashWalletAlias: "S-SRC",
        debitedCashWalletManagerID: "BDFEFRPPXXX",
        instructingPartyID: ENTITY,
      },
    });
    expect(create.status).toBe(201);
    // Nothing moves until approval (2-step).
    expect(avail("S-SRC")).toBe(1000);
    const approve = await request(server.port, "PUT", `/dlt/${NCB}/api/octopus/rvs/transactions-drafts/${create.json.instructionID}/approve`, {
      headers: { authorization: `Bearer ${u2}` },
    });
    expect(approve.status).toBe(200);
    expect(avail("S-SRC")).toBe(750);
    expect(avail("S-DST")).toBe(250);
    expect(total()).toBeCloseTo(before); // conserved
  });

  it("self-approval of a transfer is rejected without moving funds (four-eyes)", async () => {
    const before = total();
    const create = await request(server.port, "POST", `/dlt/${NCB}/api/octopus/rvs/transactions-requests`, {
      headers: { authorization: `Bearer ${u1}` },
      body: {
        instructionID: "TR-83-2", type: "TRANSFER", cbdcRequestType: "OPERATION",
        amountTransferred: "100.00", currency: "EUR",
        creditedCashWalletAlias: "S-DST", creditedCashWalletManagerID: "BDFEFRPPXXX", creditedCashWalletOwnerID: ENTITY,
        debitedCashWalletAlias: "S-SRC", debitedCashWalletManagerID: "BDFEFRPPXXX", instructingPartyID: ENTITY,
      },
    });
    expect(create.status).toBe(201);
    const self = await request(server.port, "PUT", `/dlt/${NCB}/api/octopus/rvs/transactions-drafts/${create.json.instructionID}/approve`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    expect(self.status).toBe(403);
    expect(self.json.businessErrors[0].errorCode).toBe("HL-GER-003");
    expect(total()).toBeCloseTo(before); // untouched
  });

  it("1-step bridge payment moves the exact amount and conserves value", async () => {
    const before = total();
    const srcBefore = avail("S-SRC");
    const dstBefore = avail("S-DST");
    const pay = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/payments`, {
      headers: { authorization: `Bearer ${ext}` },
      body: {
        paymentID: "PAY-83-1", amount: "50.00", currency: "EUR",
        creditedCashWalletAlias: "S-DST", creditedCashWalletManagerID: "BDFEFRPPXXX", creditedCashWalletOwnerID: ENTITY,
        debitedCashWalletAlias: "S-SRC", debitedCashWalletManagerID: "ECBFDEFFXXX",
      },
    });
    expect(pay.status).toBe(200);
    expect(avail("S-SRC")).toBeCloseTo(srcBefore - 50);
    expect(avail("S-DST")).toBeCloseTo(dstBefore + 50);
    expect(total()).toBeCloseTo(before); // conserved
  });

  it("a 1-step bridge payment carries supplementaryData through to the settled transaction", async () => {
    const pay = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/payments`, {
      headers: { authorization: `Bearer ${ext}` },
      body: {
        paymentID: "PAY-29-1", amount: "10.00", currency: "EUR",
        creditedCashWalletAlias: "S-DST", creditedCashWalletManagerID: "BDFEFRPPXXX", creditedCashWalletOwnerID: ENTITY,
        debitedCashWalletAlias: "S-SRC", debitedCashWalletManagerID: "ECBFDEFFXXX",
        supplementaryData: "invoice-2026-08-14-001",
      },
    });
    expect(pay.status).toBe(200);
    const list = await request(server.port, "GET", `/dlt/${NCB}/api/octopus/ams/wallets/S-DST/transactions`, {
      headers: { authorization: `Bearer ${u1}` },
    });
    const tx = list.json.find((t: any) => t.settlementID === "TX-PAY-29-1");
    expect(tx.supplementaryData).toBe("invoice-2026-08-14-001");
  });

  it("a 1-step bridge payment with a 30-char alnum/dash/underscore supplementaryData is accepted (#126 boundary)", async () => {
    const before = total();
    const pay = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/payments`, {
      headers: { authorization: `Bearer ${ext}` },
      body: {
        paymentID: "PAY-126-30", amount: "1.00", currency: "EUR",
        creditedCashWalletAlias: "S-DST", creditedCashWalletManagerID: "BDFEFRPPXXX", creditedCashWalletOwnerID: ENTITY,
        debitedCashWalletAlias: "S-SRC", debitedCashWalletManagerID: "ECBFDEFFXXX",
        supplementaryData: "A".repeat(30),
      },
    });
    expect(pay.status).toBe(200);
    expect(total()).toBeCloseTo(before); // conserved
  });

  it("a 1-step bridge payment with a 31-char supplementaryData is rejected (#126 length)", async () => {
    const before = total();
    const pay = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/payments`, {
      headers: { authorization: `Bearer ${ext}` },
      body: {
        paymentID: "PAY-126-31", amount: "1.00", currency: "EUR",
        creditedCashWalletAlias: "S-DST", creditedCashWalletManagerID: "BDFEFRPPXXX",
        debitedCashWalletAlias: "S-SRC", debitedCashWalletManagerID: "ECBFDEFFXXX",
        supplementaryData: "A".repeat(31),
      },
    });
    expect(pay.status).toBe(400);
    expect(pay.json.businessErrors[0].errorCode).toBe("HL-VAL-004");
    expect(pay.json.businessErrors[0].errorDescription).toMatch(
      /only letters, numbers, dashes, and underscores are allowed in SupplementaryData field/,
    );
    expect(total()).toBeCloseTo(before); // rejected — nothing moved
  });

  it("a 1-step bridge payment with a space in supplementaryData is rejected (#126 charset)", async () => {
    const pay = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/payments`, {
      headers: { authorization: `Bearer ${ext}` },
      body: {
        paymentID: "PAY-126-charset", amount: "1.00", currency: "EUR",
        creditedCashWalletAlias: "S-DST", creditedCashWalletManagerID: "BDFEFRPPXXX",
        debitedCashWalletAlias: "S-SRC", debitedCashWalletManagerID: "ECBFDEFFXXX",
        supplementaryData: "invoice 2026",
      },
    });
    expect(pay.status).toBe(400);
    expect(pay.json.businessErrors[0].errorCode).toBe("HL-VAL-004");
  });

  it("a 1-step bridge payment to an unknown credited wallet is rejected (422) and conserves value (#93)", async () => {
    const before = total();
    const srcBefore = avail("S-SRC");
    const pay = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/payments`, {
      headers: { authorization: `Bearer ${ext}` },
      body: {
        paymentID: "PAY-93-1", amount: "75.00", currency: "EUR",
        creditedCashWalletAlias: "S-GHOST", creditedCashWalletManagerID: "BDFEFRPPXXX", // never created
        debitedCashWalletAlias: "S-SRC", debitedCashWalletManagerID: "ECBFDEFFXXX",
      },
    });
    expect(pay.status).toBe(422);
    expect(pay.json.businessErrors[0].errorCode).toBe("HL-WAL-003");
    expect(JSON.stringify(pay.json)).toMatch(/ams\/wallets\/one-step/);
    // No wallet was created and no value moved (the reported symptom must not happen).
    expect(store.getWallet("S-GHOST")).toBeUndefined();
    expect(avail("S-SRC")).toBe(srcBefore);
    expect(total()).toBeCloseTo(before); // conserved — nothing burned
  });

  it("an overdrawing transfer is rejected (422) and conserves value", async () => {
    const before = total();
    const create = await request(server.port, "POST", `/dlt/${NCB}/api/octopus/rvs/transactions-requests`, {
      headers: { authorization: `Bearer ${u1}` },
      body: {
        instructionID: "TR-83-3", type: "TRANSFER", cbdcRequestType: "OPERATION",
        amountTransferred: "9999999.00", currency: "EUR",
        creditedCashWalletAlias: "S-DST", creditedCashWalletManagerID: "BDFEFRPPXXX", creditedCashWalletOwnerID: ENTITY,
        debitedCashWalletAlias: "S-SRC", debitedCashWalletManagerID: "BDFEFRPPXXX", instructingPartyID: ENTITY,
      },
    });
    expect(create.status).toBe(201);
    const approve = await request(server.port, "PUT", `/dlt/${NCB}/api/octopus/rvs/transactions-drafts/${create.json.instructionID}/approve`, {
      headers: { authorization: `Bearer ${u2}` },
    });
    expect(approve.status).toBe(422);
    expect(approve.json.businessErrors[0].errorCode).toBe("HL-BAL-001");
    expect(total()).toBeCloseTo(before); // untouched
  });

  it("a PFoD DELI leg with a 30-char alnum/dash/underscore supplementaryData is accepted (#134 boundary)", async () => {
    const deli = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/initpfoddeli`, {
      headers: { authorization: `Bearer ${ext}` },
      body: {
        tradeID: "PFOD-134-30", amount: "1.00", currency: "EUR",
        sellerCashTokenWalletRef: "S-SRC", sellerID: ENTITY, supplementaryData: "A".repeat(30),
      },
    });
    expect(deli.status).toBe(201);
  });

  it("a PFoD DELI leg with a 31-char supplementaryData is rejected (#134 length)", async () => {
    const deli = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/initpfoddeli`, {
      headers: { authorization: `Bearer ${ext}` },
      body: {
        tradeID: "PFOD-134-31", amount: "1.00", currency: "EUR",
        sellerCashTokenWalletRef: "S-SRC", sellerID: ENTITY, supplementaryData: "A".repeat(31),
      },
    });
    expect(deli.status).toBe(400);
    expect(deli.json.businessErrors[0].errorCode).toBe("HL-VAL-004");
    // Rejected before any leg is stored — no PENDING_MATCH draft left behind.
    expect(store.getDraft("PFOD-PFOD-134-31-DELI")).toBeUndefined();
  });

  it("a PFoD RECE leg with a space in supplementaryData is rejected (#134 charset)", async () => {
    const rece = await request(server.port, "POST", `/dlt/${NCB}/api/bridge/initpfodrece`, {
      headers: { authorization: `Bearer ${ext}` },
      body: {
        tradeID: "PFOD-134-charset", amount: "1.00", currency: "EUR",
        buyerCashTokenWalletRef: "S-DST", buyerID: ENTITY, sellerCAMBIC: "ECBFDEFFXXX",
        supplementaryData: "invoice 2026",
      },
    });
    expect(rece.status).toBe(400);
    expect(rece.json.businessErrors[0].errorCode).toBe("HL-VAL-004");
  });

  it("a 2-step transfer create with a 30-char alnum/dash/underscore supplementaryData is accepted (#134 boundary)", async () => {
    const create = await request(server.port, "POST", `/dlt/${NCB}/api/octopus/rvs/transactions-requests`, {
      headers: { authorization: `Bearer ${u1}` },
      body: {
        instructionID: "TR-134-30", type: "TRANSFER", cbdcRequestType: "OPERATION",
        amountTransferred: "1.00", currency: "EUR", instructingPartyID: ENTITY,
        creditedCashWalletAlias: "S-DST", creditedCashWalletManagerID: "BDFEFRPPXXX",
        debitedCashWalletAlias: "S-SRC", debitedCashWalletManagerID: "BDFEFRPPXXX",
        supplementaryData: "A".repeat(30),
      },
    });
    expect(create.status).toBe(201);
  });

  it("a 2-step transfer create with a 31-char supplementaryData is rejected (#134 length)", async () => {
    const create = await request(server.port, "POST", `/dlt/${NCB}/api/octopus/rvs/transactions-requests`, {
      headers: { authorization: `Bearer ${u1}` },
      body: {
        instructionID: "TR-134-31", type: "TRANSFER", cbdcRequestType: "OPERATION",
        amountTransferred: "1.00", currency: "EUR", instructingPartyID: ENTITY,
        creditedCashWalletAlias: "S-DST", creditedCashWalletManagerID: "BDFEFRPPXXX",
        debitedCashWalletAlias: "S-SRC", debitedCashWalletManagerID: "BDFEFRPPXXX",
        supplementaryData: "A".repeat(31),
      },
    });
    expect(create.status).toBe(400);
    expect(create.json.businessErrors[0].errorCode).toBe("HL-VAL-004");
  });

  it("a 2-step transfer create with a space in supplementaryData is rejected (#134 charset)", async () => {
    const create = await request(server.port, "POST", `/dlt/${NCB}/api/octopus/rvs/transactions-requests`, {
      headers: { authorization: `Bearer ${u1}` },
      body: {
        instructionID: "TR-134-charset", type: "TRANSFER", cbdcRequestType: "OPERATION",
        amountTransferred: "1.00", currency: "EUR", instructingPartyID: ENTITY,
        creditedCashWalletAlias: "S-DST", creditedCashWalletManagerID: "BDFEFRPPXXX",
        debitedCashWalletAlias: "S-SRC", debitedCashWalletManagerID: "BDFEFRPPXXX",
        supplementaryData: "invoice 2026",
      },
    });
    expect(create.status).toBe(400);
    expect(create.json.businessErrors[0].errorCode).toBe("HL-VAL-004");
  });
});
