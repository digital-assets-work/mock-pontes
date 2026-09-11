/**
 * Transfers `requestvalidation.OperationRequest` schema alignment
 * (a HAR-capture delta against the official spec).
 *
 * Covers the request-field validation and wallet-manager business rules that
 * sit in front of `TransferWorkflow`, and the enriched response shape
 * (`instructionID`/`etatsUX`/`creationDate`/manager ids/network ids/lifecycle
 * trail) on create, read, and approve.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import http from "node:http";
import jwt from "jsonwebtoken";
import { toNodeListener, type App } from "h3";

// Transfer creation is Open-for-All-only under the spec-driven business
// window (issue #81); disable enforcement here (covered separately in
// tests/business-window.test.ts).
process.env.PONTES_MOCK_BUSINESS_WINDOW_ALWAYS_OPEN = "true";

import { buildApp } from "../../src/app.js";
import { MemoryStore } from "../../src/state/memory-store.js";
import { getRuntimePkiBundle } from "../../src/auth/runtime-pki.js";
import { createInMemoryAuthUsersRepository } from "../../src/auth/users-repository.js";
import officialSpec from "../../src/ui/spec/pontes-official-v1.0.json";

const NCB = "bdf";
const ENTITY = "BSUIFRPPXXX";
const BASE = `/dlt/${NCB}/api/octopus`;

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
    { user_uuid: userUUID, user_profile: profile, entity_bic: ENTITY, realm: NCB },
    pki.jwtSigningPrivateKeyPem,
    { algorithm: "ES256", expiresIn: "5m" },
  );
}

function officialProps(schemaName: string): Set<string> {
  const schema = (officialSpec as any).components.schemas[schemaName];
  return new Set(Object.keys(schema?.properties || {}));
}

/** Every field of `obj` must be an official property or a known mock delta. */
function assertConforms(obj: Record<string, unknown>, schemaName: string, allowedDeltas: string[]): void {
  const allowed = officialProps(schemaName);
  const unexpected = Object.keys(obj).filter((k) => !allowed.has(k) && !allowedDeltas.includes(k));
  expect({ schemaName, unexpected }).toEqual({ schemaName, unexpected: [] });
}

describe("Transfers — requestvalidation.OperationRequest alignment", () => {
  let server: Server;
  let store: MemoryStore;
  let auth: string;
  let approverAuth: string;

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    store = new MemoryStore();
    const runtimePki = await getRuntimePkiBundle();
    const app = buildApp({ store, runtimePki, authUsersRepository: createInMemoryAuthUsersRepository() });
    server = await listen(app);
    auth = await mintJwt("user-1");
    approverAuth = await mintJwt("user-2"); // distinct from the initiator (four-eyes, #28)

    // T-SRC and T-DST-SAME share a manager (BDFEFRPPXXX); T-DST-DIFF has a
    // different one (ECBFDEFFXXX) — lets the same two wallets exercise both
    // the OPERATION (same-manager) and PAYMENT (different-manager) rules.
    store.ensureWallet("T-SRC", { ownerEntityID: ENTITY, managerNCB: "BDFEFRPPXXX", availableBalance: "500.00" });
    store.ensureWallet("T-DST-SAME", { ownerEntityID: ENTITY, managerNCB: "BDFEFRPPXXX", availableBalance: "0.00" });
    store.ensureWallet("T-DST-DIFF", { ownerEntityID: ENTITY, managerNCB: "ECBFDEFFXXX", availableBalance: "0.00" });
  }, 30_000);

  afterAll(async () => { await server.close(); });

  function body(overrides: Record<string, unknown> = {}) {
    return {
      type: "TRANSFER",
      cbdcRequestType: "OPERATION",
      amountTransferred: "10.00",
      currency: "EUR",
      creditedCashWalletAlias: "T-DST-SAME",
      creditedCashWalletManagerID: "BDFEFRPPXXX",
      debitedCashWalletAlias: "T-SRC",
      debitedCashWalletManagerID: "BDFEFRPPXXX",
      instructingPartyID: ENTITY,
      ...overrides,
    };
  }

  function create(b: Record<string, unknown>) {
    return request(server.port, "POST", `${BASE}/rvs/transactions-requests`, {
      headers: { authorization: `Bearer ${auth}` },
      body: b,
    });
  }

  it("rejects a currency other than EUR (400 HL-VAL-001)", async () => {
    const res = await create(body({ currency: "USD" }));
    expect(res.status).toBe(400);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-VAL-001");
  });

  it("rejects instructingPartyID that doesn't match the authenticated caller (400 HL-VAL-001)", async () => {
    const res = await create(body({ instructingPartyID: "SOMEOTHERBIC" }));
    expect(res.status).toBe(400);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-VAL-001");
  });

  it("rejects an unknown cbdcRequestType (400 HL-VAL-001)", async () => {
    const res = await create(body({ cbdcRequestType: "BOGUS" }));
    expect(res.status).toBe(400);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-VAL-001");
  });

  it("rejects an ISD that isn't the current business date (400 HL-VAL-001)", async () => {
    const res = await create(body({ ISD: "2020-01-01" }));
    expect(res.status).toBe(400);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-VAL-001");
  });

  it("rejects a debitedCashWalletManagerID that doesn't match the debited wallet's manager (400 HL-WAL-004)", async () => {
    const res = await create(body({ debitedCashWalletManagerID: "WRONGMGR" }));
    expect(res.status).toBe(400);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-WAL-004");
  });

  it("rejects a creditedCashWalletManagerID that doesn't match the credited wallet's manager (400 HL-WAL-005)", async () => {
    const res = await create(body({ creditedCashWalletManagerID: "WRONGMGR" }));
    expect(res.status).toBe(400);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-WAL-005");
  });

  it("rejects cbdcRequestType OPERATION across two different managers (400 HL-WAL-006)", async () => {
    const res = await create(
      body({ creditedCashWalletAlias: "T-DST-DIFF", creditedCashWalletManagerID: "ECBFDEFFXXX" }),
    );
    expect(res.status).toBe(400);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-WAL-006");
  });

  it("rejects cbdcRequestType PAYMENT across the same manager (400 HL-WAL-006)", async () => {
    const res = await create(body({ cbdcRequestType: "PAYMENT" })); // T-SRC/T-DST-SAME share a manager
    expect(res.status).toBe(400);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-WAL-006");
  });

  it("accepts a well-formed request and returns the enriched OperationRequest shape (201)", async () => {
    const isd = new Date().toISOString().slice(0, 10);
    const created = await create(body({ instructionID: "TR-CLIENT-IGNORED", ISD: isd }));
    expect(created.status).toBe(201);

    const view = created.json;
    // A client-supplied id is a duplicate-check only — always minted server-side.
    expect(view.instructionID).not.toBe("TR-CLIENT-IGNORED");
    expect(view.etatsUX).toBe("INITIALIZED");
    expect(view.type).toBe("TRANSFER");
    expect(view.amountTransferred).toBe("10.00");
    expect(view.currency).toBe("EUR");
    expect(view.creditedCashWalletManagerID).toBe("BDFEFRPPXXX");
    expect(view.debitedCashWalletManagerID).toBe("BDFEFRPPXXX");
    expect(view.senderID).toBe("BDFEFRPPXXX");
    expect(view.instructingPartyID).toBe(ENTITY);
    expect(view.cbdcRequestType).toBe("OPERATION");
    expect(view.ISD).toBe(isd);
    expect(view.creationDate).toBe(store.getBusinessDay().businessDate);
    expect(view.debitedNetworkID).toBe("mock-pontes");
    expect(view.creditedNetworkID).toBe("mock-pontes");
    expect(view.isValidated).toBe(true);
    expect(view.settlementType).toBe("CLRG");
    expect(view.historicStatus).toEqual(["INITIALIZED", "PENDING_APPROVAL"]);
    expect(view.timestamps.INITIALIZED).toBeTruthy();
    expect(view.timestamps.PENDING_APPROVAL).toBeTruthy();
    expect(typeof view.techCBDCOperationID).toBe("string");
    expect(view.techCBDCOperationID).not.toBe("");

    assertConforms(view, "requestvalidation.OperationRequest", [
      "techCBDCOperationID",
      "onBehalfUser",
      "paymentInstructionID",
      "validationErrorsReport",
      "cbdcTipsiTxID",
      "toBeRouted",
      "poaID",
      "bizMsgID",
      "approverUserUUID",
      "supplementaryData",
    ]);

    // The persisted status is PENDING_APPROVAL even though the create response
    // presents the transient INITIALIZED state.
    const single = await request(server.port, "GET", `${BASE}/rvs/transactions-drafts/${view.instructionID}`, {
      headers: { authorization: `Bearer ${auth}` },
    });
    expect(single.status).toBe(200);
    expect(single.json.etatsUX).toBe("PENDING_APPROVAL");
    expect(single.json.instructionID).toBe(view.instructionID);

    const list = await request(server.port, "GET", `${BASE}/ims/transactions`, {
      headers: { authorization: `Bearer ${auth}` },
    });
    const row = list.json.find((t: any) => t.instructionLTID === view.instructionID);
    expect(row).toBeTruthy();
    expect(row.creditedCashWalletManagerID).toBe("BDFEFRPPXXX");
    expect(row.cbdcRequestType).toBe("OPERATION");

    const approve = await request(server.port, "PUT", `${BASE}/rvs/transactions-drafts/${view.instructionID}/approve`, {
      headers: { authorization: `Bearer ${approverAuth}` },
    });
    expect(approve.status).toBe(200);
    expect(approve.json.etatsUX).toBe("SETTLED");
    expect(approve.json.historicStatus).toEqual(["INITIALIZED", "PENDING_APPROVAL", "SETTLED"]);
    expect(approve.json.timestamps.SETTLED).toBeTruthy();
  });

  it("rejects a duplicate client-supplied instructionID (409 HL-GER-004)", async () => {
    const first = await create(body({ instructionID: "TR-DUP-109" }));
    expect(first.status).toBe(201);
    // Re-submit the exact minted id as the client-supplied one.
    const dup = await create(body({ instructionID: first.json.instructionID }));
    expect(dup.status).toBe(409);
    expect(dup.json.businessErrors[0].errorCode).toBe("HL-GER-004");
  });
});
