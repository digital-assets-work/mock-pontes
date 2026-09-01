/**
 * HTTP integration tests for the no-password A2A enrollment flow (issue #100).
 *
 * Real Pontes A2A auth has no per-user password — confirmed by direct testing
 * against the `utest` environment. This exercises the resulting CSR/admin state
 * machine: a brand-new username enrolls without a password; re-enrolling an
 * already-enrolled username is rejected; only a full admin deletion frees it up
 * again (with no trace of the removed user left behind).
 *
 * The token endpoint's cert-driven identity resolution is not covered here —
 * it requires a real mTLS handshake (peer certificate on the TLS socket), which
 * this plain-HTTP test harness (like the rest of the suite) does not simulate;
 * see tests/users-repository.test.ts for direct coverage of the underlying
 * fingerprint↔username resolution the token endpoint relies on.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import http from "node:http";
import { webcrypto } from "node:crypto";
import { toNodeListener, type App } from "h3";
import * as x509 from "@peculiar/x509";

import { buildApp } from "../../src/app.js";
import { MemoryStore } from "../../src/state/memory-store.js";
import { getRuntimePkiBundle } from "../../src/auth/runtime-pki.js";
import { createInMemoryAuthUsersRepository, type InMemoryAuthUsersRepository } from "../../src/auth/users-repository.js";

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
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
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

const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;

async function makeCsr(username: string): Promise<string> {
  const keys = await webcrypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const csr = await x509.Pkcs10CertificateRequestGenerator.create({
    name: `C=FR, O=BSUIFRPPXXX, OU=client, CN=${username}`,
    keys,
    signingAlgorithm: ALG,
  });
  return csr.toString("pem");
}

const NCB = "bdf";

describe("Enrollment flow — no password (issue #100)", () => {
  let server: Server;
  let authUsersRepository: InMemoryAuthUsersRepository;

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    const store = new MemoryStore();
    const runtimePki = await getRuntimePkiBundle();
    authUsersRepository = createInMemoryAuthUsersRepository();
    server = await listen(buildApp({ store, runtimePki, authUsersRepository }));
  }, 30_000);

  afterAll(async () => {
    await server.close();
  });

  afterEach(() => {
    delete process.env.ADMIN_TOKEN;
  });

  it("declares a brand-new user via CSR with no password field at all", async () => {
    const username = "PFRBSUIFRPPXXX-NEW1";
    const csr = await makeCsr(username);
    const res = await request(server.port, "POST", `/iam/realms/${NCB}/protocol/openid-connect/csr`, {
      body: { username, profile: "PILOT_READ_WRITE", entityBIC: "BSUIFRPPXXX", csr },
    });
    expect(res.status).toBe(200);
    expect(res.json.certificate).toMatch(/BEGIN CERTIFICATE/);
    expect(authUsersRepository.getUserByUsername(username)).toBeDefined();
  });

  it("rejects re-enrolling an already-enrolled username with 409", async () => {
    const username = "PFRBSUIFRPPXXX-DUP1";
    const csr1 = await makeCsr(username);
    const first = await request(server.port, "POST", `/iam/realms/${NCB}/protocol/openid-connect/csr`, {
      body: { username, profile: "PILOT_READ_WRITE", entityBIC: "BSUIFRPPXXX", csr: csr1 },
    });
    expect(first.status).toBe(200);

    const csr2 = await makeCsr(username);
    const second = await request(server.port, "POST", `/iam/realms/${NCB}/protocol/openid-connect/csr`, {
      body: { username, profile: "PILOT_READ_WRITE", entityBIC: "BSUIFRPPXXX", csr: csr2 },
    });
    expect(second.status).toBe(409);
    expect(second.json.businessErrors[0].errorDescription).toMatch(/already enrolled/);
    expect(second.json.businessErrors[0].errorDescription).toMatch(/DELETE \/admin\/enrolled-users/);
  });

  it("admin DELETE fully removes a user (no trace left) and frees it for re-enrollment with a new uuid", async () => {
    const username = "PFRBSUIFRPPXXX-DEL1";
    const csr1 = await makeCsr(username);
    await request(server.port, "POST", `/iam/realms/${NCB}/protocol/openid-connect/csr`, {
      body: { username, profile: "PILOT_READ_WRITE", entityBIC: "BSUIFRPPXXX", csr: csr1 },
    });
    const firstUuid = authUsersRepository.getUserByUsername(username)?.uuid;
    expect(firstUuid).toBeDefined();

    const del = await request(server.port, "DELETE", `/admin/enrolled-users/${username}`);
    expect(del.status).toBe(200);
    expect(del.json).toMatchObject({ ok: true });
    expect(authUsersRepository.getUserByUsername(username)).toBeUndefined();

    // Re-enrolling now succeeds — as a brand-new record (fresh uuid), nothing retained.
    const csr2 = await makeCsr(username);
    const reEnroll = await request(server.port, "POST", `/iam/realms/${NCB}/protocol/openid-connect/csr`, {
      body: { username, profile: "PILOT_READ_ONLY", entityBIC: "BSUIFRPPXXX", csr: csr2 },
    });
    expect(reEnroll.status).toBe(200);
    const secondUuid = authUsersRepository.getUserByUsername(username)?.uuid;
    expect(secondUuid).toBeDefined();
    expect(secondUuid).not.toBe(firstUuid);
  });

  it("admin DELETE returns 404 for an unknown user", async () => {
    const res = await request(server.port, "DELETE", "/admin/enrolled-users/no-such-user");
    expect(res.status).toBe(404);
    expect(res.json.businessErrors[0].errorCode).toBe("HL-GER-001");
  });

  it("admin DELETE requires the admin token when ADMIN_TOKEN is configured", async () => {
    const username = "PFRBSUIFRPPXXX-GATE1";
    const csr = await makeCsr(username);
    await request(server.port, "POST", `/iam/realms/${NCB}/protocol/openid-connect/csr`, {
      body: { username, profile: "PILOT_READ_WRITE", entityBIC: "BSUIFRPPXXX", csr },
    });

    process.env.ADMIN_TOKEN = "s3cret";
    const denied = await request(server.port, "DELETE", `/admin/enrolled-users/${username}`);
    expect(denied.status).toBe(401);
    expect(authUsersRepository.getUserByUsername(username)).toBeDefined();

    const allowed = await request(server.port, "DELETE", `/admin/enrolled-users/${username}`, {
      headers: { "x-admin-token": "s3cret" },
    });
    expect(allowed.status).toBe(200);
    expect(authUsersRepository.getUserByUsername(username)).toBeUndefined();
  });
});
