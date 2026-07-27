/**
 * Admin-token gate tests (issue #35).
 */

import { describe, it, expect, afterEach } from "@jest/globals";
import type { H3Event } from "h3";
import {
  adminTokenConfigured,
  hasValidAdminToken,
  enforceAdminToken,
} from "../src/auth/admin-token.js";

const ORIGINAL = process.env.ADMIN_TOKEN;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = ORIGINAL;
});

function fakeEvent(headers: Record<string, string> = {}): H3Event {
  return {
    node: { req: { headers }, res: { statusCode: 200 } },
  } as unknown as H3Event;
}

describe("adminTokenConfigured (issue #35)", () => {
  it("is false when unset or empty, true when set", () => {
    delete process.env.ADMIN_TOKEN;
    expect(adminTokenConfigured()).toBe(false);
    process.env.ADMIN_TOKEN = "";
    expect(adminTokenConfigured()).toBe(false);
    process.env.ADMIN_TOKEN = "s3cret";
    expect(adminTokenConfigured()).toBe(true);
  });
});

describe("hasValidAdminToken (issue #35)", () => {
  it("matches the X-Admin-Token header", () => {
    process.env.ADMIN_TOKEN = "s3cret";
    expect(hasValidAdminToken(fakeEvent({ "x-admin-token": "s3cret" }))).toBe(true);
    expect(hasValidAdminToken(fakeEvent({ "x-admin-token": "nope" }))).toBe(false);
  });

  it("accepts the token via Authorization: Bearer", () => {
    process.env.ADMIN_TOKEN = "s3cret";
    expect(hasValidAdminToken(fakeEvent({ authorization: "Bearer s3cret" }))).toBe(true);
    expect(hasValidAdminToken(fakeEvent({ authorization: "Bearer wrong" }))).toBe(false);
  });

  it("is false when no token is presented or none is configured", () => {
    process.env.ADMIN_TOKEN = "s3cret";
    expect(hasValidAdminToken(fakeEvent())).toBe(false);
    delete process.env.ADMIN_TOKEN;
    expect(hasValidAdminToken(fakeEvent({ "x-admin-token": "anything" }))).toBe(false);
  });
});

describe("enforceAdminToken (issue #35)", () => {
  it("is open (returns true) when ADMIN_TOKEN is not configured", () => {
    delete process.env.ADMIN_TOKEN;
    const ev = fakeEvent();
    expect(enforceAdminToken(ev)).toBe(true);
    expect(ev.node.res.statusCode).toBe(200);
  });

  it("allows a valid token when configured", () => {
    process.env.ADMIN_TOKEN = "s3cret";
    const ev = fakeEvent({ "x-admin-token": "s3cret" });
    expect(enforceAdminToken(ev)).toBe(true);
    expect(ev.node.res.statusCode).toBe(200);
  });

  it("rejects a missing/invalid token with 401 when configured", () => {
    process.env.ADMIN_TOKEN = "s3cret";
    const ev = fakeEvent();
    expect(enforceAdminToken(ev)).toBe(false);
    expect(ev.node.res.statusCode).toBe(401);
  });
});
