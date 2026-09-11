/**
 * JWT middleware audience allow-list (issue #118).
 *
 * Direct reproduction against the real `utest` pilot showed tokens whose
 * `aud` doesn't contain `esydlt-web-app-u2a` or `esydlt-backend-service`
 * (notably tokens requested with `client_id=esydlt-web-app`, Table U's
 * documented client for several profiles) get rejected with a `401`
 * `{ status, message: "session is not valid", code: "unauthorized" }` body.
 * This reproduces that gate directly (same direct-invocation pattern as
 * tests/token-refresh.test.ts — no HTTP/mTLS harness needed).
 */

import { describe, it, expect, afterEach } from "@jest/globals";
import jwt from "jsonwebtoken";
import { getRuntimePkiBundle } from "../src/auth/runtime-pki.js";
import { createJwtMiddleware, resolveAudienceAllowlist } from "../src/auth/jwt-middleware.js";
import { SIGNING_KEY_ID } from "../src/auth/oidc.js";

interface FakeRes {
  statusCode: number;
}

function fakeEvent(path: string, authHeader?: string): {
  path: string;
  node: { req: { headers: Record<string, string> }; res: FakeRes };
  context: Record<string, unknown>;
} {
  return {
    path,
    node: {
      req: { headers: authHeader ? { authorization: authHeader } : {} },
      res: { statusCode: 200 },
    },
    context: {},
  };
}

function tokenWithAud(pki: Awaited<ReturnType<typeof getRuntimePkiBundle>>, aud: unknown) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: "u1",
      iat: now,
      exp: now + 300,
      typ: "Bearer",
      preferred_username: "PFRBSUIFRPPXXX0001",
      user_uuid: "u1",
      user_profile: "PILOT_READ_WRITE",
      entity_bic: "BSUIFRPPXXX",
      realm: "bdf",
      aud,
    },
    pki.jwtSigningPrivateKeyPem,
    { algorithm: "ES256", keyid: SIGNING_KEY_ID },
  );
}

const ORIGINAL_ENV = process.env.PONTES_JWT_AUDIENCE_ALLOWLIST;

describe("JWT audience allow-list (issue #118)", () => {
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.PONTES_JWT_AUDIENCE_ALLOWLIST;
    else process.env.PONTES_JWT_AUDIENCE_ALLOWLIST = ORIGINAL_ENV;
  });

  it("defaults to [esydlt-web-app-u2a, esydlt-backend-service]", () => {
    delete process.env.PONTES_JWT_AUDIENCE_ALLOWLIST;
    expect(resolveAudienceAllowlist()).toEqual(["esydlt-web-app-u2a", "esydlt-backend-service"]);
  });

  it("parses a custom comma-separated PONTES_JWT_AUDIENCE_ALLOWLIST", () => {
    process.env.PONTES_JWT_AUDIENCE_ALLOWLIST = " foo , bar ,baz";
    expect(resolveAudienceAllowlist()).toEqual(["foo", "bar", "baz"]);
  });

  it("accepts a token whose aud contains esydlt-backend-service (default allow-list)", async () => {
    const pki = await getRuntimePkiBundle();
    delete process.env.PONTES_JWT_AUDIENCE_ALLOWLIST;
    const mw = createJwtMiddleware(["/dlt"], pki.jwtSigningPublicKeyPem);
    const token = tokenWithAud(pki, ["esydlt-backend-service", "account"]);
    const event = fakeEvent("/dlt/bdf/api/octopus/ams/wallets", `Bearer ${token}`);
    const res = await (mw as unknown as (e: unknown) => Promise<unknown>)(event);
    expect(res).toBeUndefined();
    expect(event.node.res.statusCode).toBe(200);
  });

  it("rejects a token requested with client_id=esydlt-web-app — reproduces the real utest 401", async () => {
    const pki = await getRuntimePkiBundle();
    delete process.env.PONTES_JWT_AUDIENCE_ALLOWLIST;
    const mw = createJwtMiddleware(["/dlt"], pki.jwtSigningPublicKeyPem);
    // Matches signTokens()'s shape for client_id=esydlt-web-app: aud=[clientId, "account"].
    const token = tokenWithAud(pki, ["esydlt-web-app", "account"]);
    const event = fakeEvent("/dlt/bdf/api/octopus/ams/wallets", `Bearer ${token}`);
    const res = (await (mw as unknown as (e: unknown) => Promise<unknown>)(event)) as {
      status: number;
      message: string;
      code: string;
    };
    expect(event.node.res.statusCode).toBe(401);
    expect(res).toEqual({ status: 401, message: "session is not valid", code: "unauthorized" });
  });

  it("rejects a token with no aud claim at all", async () => {
    const pki = await getRuntimePkiBundle();
    delete process.env.PONTES_JWT_AUDIENCE_ALLOWLIST;
    const mw = createJwtMiddleware(["/dlt"], pki.jwtSigningPublicKeyPem);
    const token = tokenWithAud(pki, undefined);
    const event = fakeEvent("/dlt/bdf/api/octopus/ams/wallets", `Bearer ${token}`);
    const res = (await (mw as unknown as (e: unknown) => Promise<unknown>)(event)) as { status: number };
    expect(event.node.res.statusCode).toBe(401);
    expect(res.status).toBe(401);
  });

  it("honors a custom PONTES_JWT_AUDIENCE_ALLOWLIST override", async () => {
    const pki = await getRuntimePkiBundle();
    process.env.PONTES_JWT_AUDIENCE_ALLOWLIST = "esydlt-web-app";
    const mw = createJwtMiddleware(["/dlt"], pki.jwtSigningPublicKeyPem);
    // Now accepted, since the override allow-lists esydlt-web-app...
    const allowed = tokenWithAud(pki, ["esydlt-web-app", "account"]);
    const okEvent = fakeEvent("/dlt/bdf/api/octopus/ams/wallets", `Bearer ${allowed}`);
    await (mw as unknown as (e: unknown) => Promise<unknown>)(okEvent);
    expect(okEvent.node.res.statusCode).toBe(200);

    // ...and esydlt-backend-service (not in the override) is now rejected.
    const rejected = tokenWithAud(pki, ["esydlt-backend-service", "account"]);
    const rejectedEvent = fakeEvent("/dlt/bdf/api/octopus/ams/wallets", `Bearer ${rejected}`);
    await (mw as unknown as (e: unknown) => Promise<unknown>)(rejectedEvent);
    expect(rejectedEvent.node.res.statusCode).toBe(401);
  });
});
