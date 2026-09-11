/**
 * `GET /dlt/{ncb}/api/octopus/health` response-shape conformance (workbench
 * issue #115): the declared schema is `common.Health[]`, but the mock was
 * returning a bare object. Asserts the response is now a one-element array
 * whose element carries the spec's `octopus`/`server` fields (plus the
 * mock-only `mock: true` marker, harmless since `common.Health` has no
 * `additionalProperties: false` restriction).
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import http from "node:http";
import { toNodeListener, type App } from "h3";

import { buildApp } from "../../src/app.js";
import { MemoryStore } from "../../src/state/memory-store.js";
import { getRuntimePkiBundle } from "../../src/auth/runtime-pki.js";
import { createInMemoryAuthUsersRepository } from "../../src/auth/users-repository.js";
import officialSpec from "../../src/ui/spec/pontes-official-v1.0.json";

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
}

function request(port: number, path: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json: any;
          try {
            json = data ? JSON.parse(data) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode || 0, json });
        });
      })
      .on("error", reject);
  });
}

function officialProps(schemaName: string): Set<string> {
  const schema = (officialSpec as any).components.schemas[schemaName];
  return new Set(Object.keys(schema?.properties || {}));
}

describe("GET .../octopus/health — common.Health[] alignment (workbench #115)", () => {
  let server: Server;

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    const store = new MemoryStore();
    const runtimePki = await getRuntimePkiBundle();
    const app = buildApp({ store, runtimePki, authUsersRepository: createInMemoryAuthUsersRepository() });
    server = await listen(app);
  }, 30_000);

  afterAll(async () => {
    await server.close();
  });

  it("returns a JSON array containing the expected common.Health-shaped object", async () => {
    const res = await request(server.port, "/dlt/bdf/api/octopus/health");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json)).toBe(true);
    expect(res.json).toHaveLength(1);
    const [health] = res.json;
    expect(health.octopus).toBe("UP");
    expect(health.server).toBe("UP");
    expect(health.mock).toBe(true);

    const allowed = officialProps("common.Health");
    const unexpected = Object.keys(health).filter((k) => k !== "mock" && !allowed.has(k));
    expect(unexpected).toEqual([]);
  });
});
