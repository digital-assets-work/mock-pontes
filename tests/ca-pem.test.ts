/**
 * `GET /ca.pem` (issue #89): expose the runtime server-CA certificate so clients
 * can verify the mock's self-signed TLS cert instead of disabling verification.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import http from "node:http";
import { createApp, toNodeListener, type App } from "h3";
import { createUiRouter } from "../src/ui/router.js";

const CA_PEM =
  "-----BEGIN CERTIFICATE-----\nMIIB/test/only/not/a/real/cert==\n-----END CERTIFICATE-----\n";

interface Res {
  status: number;
  text: string;
  headers: http.IncomingHttpHeaders;
}

function listen(app: App): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(toNodeListener(app));
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function get(port: number, path: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode || 0, text: data, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("GET /ca.pem (issue #89)", () => {
  let server: { port: number; close: () => Promise<void> };

  beforeAll(async () => {
    const app = createApp();
    app.use(createUiRouter({ serverCaCertificatePem: CA_PEM }).handler);
    server = await listen(app);
  });

  afterAll(async () => {
    await server.close();
  });

  it("returns the server CA as a PEM download", async () => {
    const res = await get(server.port, "/ca.pem");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/x-pem-file/);
    expect(res.headers["content-disposition"]).toMatch(/mock-ca\.pem/);
    expect(res.text).toBe(CA_PEM);
  });

  it("404s when the CA is not available", async () => {
    const app = createApp();
    app.use(createUiRouter().handler);
    const bare = await listen(app);
    try {
      const res = await get(bare.port, "/ca.pem");
      expect(res.status).toBe(404);
      expect(res.text).toMatch(/not_found/);
    } finally {
      await bare.close();
    }
  });
});
