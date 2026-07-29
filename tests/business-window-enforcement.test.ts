/**
 * Business-window guard middleware end-to-end (issue #81): the spec-driven guard
 * returns 403 HL-BW-001 for an operation not accessible in the current window,
 * and the PONTES_MOCK_BUSINESS_WINDOW_ALWAYS_OPEN escape hatch disables it.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import http from "node:http";
import { createApp, toNodeListener, defineEventHandler, type App } from "h3";
import { createBusinessWindowGuardMiddleware } from "../src/http/business-window-guard.js";
import { MemoryStore } from "../src/state/memory-store.js";

// 12:00 Frankfurt on a summer day.
const NOON_FFT = () => new Date("2026-06-15T10:00:00Z");

function listen(app: App): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(toNodeListener(app));
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

function post(port: number, path: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode || 0, text: data }));
    });
    req.on("error", reject);
    req.end();
  });
}

function appWith(guard: ReturnType<typeof createBusinessWindowGuardMiddleware>): App {
  const app = createApp();
  app.use(guard);
  app.use(defineEventHandler(() => ({ ok: true })));
  return app;
}

describe("business-window guard middleware (issue #81)", () => {
  const store = new MemoryStore();
  // Narrow the day so 12:00 FFT is Open for All (bridge payments allowed,
  // transfer creation — Start of Day only — is not).
  store.setBusinessDay({ sodStart: "07:00", ofaStart: "09:00", ofaEnd: "17:00", eodEnd: "18:00" });

  let enforced: { port: number; close: () => Promise<void> };
  let open: { port: number; close: () => Promise<void> };

  beforeAll(async () => {
    enforced = await listen(appWith(createBusinessWindowGuardMiddleware(store, { now: NOON_FFT })));
    open = await listen(appWith(createBusinessWindowGuardMiddleware(store, { alwaysOpen: true, now: NOON_FFT })));
  });
  afterAll(async () => {
    await enforced.close();
    await open.close();
  });

  it("403s a transfer creation during Open for All (Start-of-Day only)", async () => {
    const res = await post(enforced.port, "/dlt/bdf/api/octopus/rvs/transactions-requests");
    expect(res.status).toBe(403);
    expect(res.text).toMatch(/HL-BW-001/);
    expect(res.text).toMatch(/Start of Day/);
  });

  it("passes a bridge payment during Open for All", async () => {
    const res = await post(enforced.port, "/dlt/bdf/api/bridge/payments");
    expect(res.status).toBe(200);
  });

  it("ALWAYS_OPEN disables enforcement entirely", async () => {
    const res = await post(open.port, "/dlt/bdf/api/octopus/rvs/transactions-requests");
    expect(res.status).toBe(200);
  });
});
