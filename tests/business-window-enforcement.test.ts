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
// 03:00 Frankfurt (before Start of Day) — the market is Closed.
const NIGHT_FFT = () => new Date("2026-06-15T01:00:00Z");

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
  // Narrow the day so 12:00 FFT is Open for All and 03:00 FFT is Closed.
  store.setBusinessDay({ sodStart: "07:00", ofaStart: "09:00", ofaEnd: "17:00", eodEnd: "18:00" });

  let enforced: { port: number; close: () => Promise<void> };
  let closed: { port: number; close: () => Promise<void> };
  let open: { port: number; close: () => Promise<void> };

  beforeAll(async () => {
    enforced = await listen(appWith(createBusinessWindowGuardMiddleware(store, { now: NOON_FFT })));
    closed = await listen(appWith(createBusinessWindowGuardMiddleware(store, { now: NIGHT_FFT })));
    open = await listen(appWith(createBusinessWindowGuardMiddleware(store, { alwaysOpen: true, now: NOON_FFT })));
  });
  afterAll(async () => {
    await enforced.close();
    await closed.close();
    await open.close();
  });

  it("passes a transfer creation during Open for All (#94: not Start-of-Day only)", async () => {
    // The spec's "(only for ISSUANCE)"/"(only for REDEMPTION)" qualifiers confine
    // CB issuance/redemption to Start/End of day; an ordinary transfer's open
    // period is Open for all, so it must not be blocked at noon.
    const res = await post(enforced.port, "/dlt/bdf/api/octopus/rvs/transactions-requests");
    expect(res.status).toBe(200);
  });

  it("passes a bridge payment during Open for All", async () => {
    const res = await post(enforced.port, "/dlt/bdf/api/bridge/payments");
    expect(res.status).toBe(200);
  });

  it("403s an operation when the market is Closed", async () => {
    const res = await post(closed.port, "/dlt/bdf/api/octopus/rvs/transactions-requests");
    expect(res.status).toBe(403);
    expect(res.text).toMatch(/HL-BW-001/);
    expect(res.text).toMatch(/POST \/admin\/business-window/);
  });

  it("ALWAYS_OPEN disables enforcement entirely", async () => {
    const res = await post(open.port, "/dlt/bdf/api/octopus/rvs/transactions-requests");
    expect(res.status).toBe(200);
  });
});
