/**
 * Refresh token support (issue #64).
 *
 * The password grant now also returns a `refresh_token` (10-day lifetime,
 * `typ: "Refresh"`), and the token endpoint accepts `grant_type=refresh_token`.
 * A refresh token must NOT be usable as a bearer access token — the JWT
 * middleware rejects it. Discovery advertises the refresh grant.
 */

import { describe, it, expect } from "@jest/globals";
import jwt from "jsonwebtoken";
import { getRuntimePkiBundle } from "../src/auth/runtime-pki.js";
import { createJwtMiddleware } from "../src/auth/jwt-middleware.js";
import { buildOpenIdConfiguration, SIGNING_KEY_ID } from "../src/auth/oidc.js";

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

function token(pki: Awaited<ReturnType<typeof getRuntimePkiBundle>>, typ: string) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: "u1",
      iat: now,
      exp: now + 300,
      typ,
      preferred_username: "PFRBSUIFRPPXXX0001",
      user_uuid: "u1",
      user_profile: "PILOT_READ_WRITE",
      entity_bic: "BSUIFRPPXXX",
      realm: "bdf",
    },
    pki.jwtSigningPrivateKeyPem,
    { algorithm: "ES256", keyid: SIGNING_KEY_ID },
  );
}

describe("Refresh token vs access token (issue #64)", () => {
  it("accepts a normal (Bearer) access token and attaches auth context", async () => {
    const pki = await getRuntimePkiBundle();
    const mw = createJwtMiddleware(["/dlt"], pki.jwtSigningPublicKeyPem);
    const event = fakeEvent("/dlt/bdf/api/octopus/ams/wallets", `Bearer ${token(pki, "Bearer")}`);
    const res = await (mw as unknown as (e: unknown) => Promise<unknown>)(event);
    expect(res).toBeUndefined(); // pass-through
    expect(event.node.res.statusCode).toBe(200);
    expect((event.context.auth as { entityBIC: string }).entityBIC).toBe("BSUIFRPPXXX");
  });

  it("rejects a refresh token used as a bearer access token", async () => {
    const pki = await getRuntimePkiBundle();
    const mw = createJwtMiddleware(["/dlt"], pki.jwtSigningPublicKeyPem);
    const event = fakeEvent("/dlt/bdf/api/octopus/ams/wallets", `Bearer ${token(pki, "Refresh")}`);
    const res = (await (mw as unknown as (e: unknown) => Promise<unknown>)(event)) as {
      error: string;
      error_description: string;
    };
    expect(event.node.res.statusCode).toBe(401);
    expect(res.error).toBe("invalid_token");
    expect(res.error_description).toMatch(/Refresh tokens cannot be used/i);
  });

  it("advertises the refresh_token grant in discovery", () => {
    const cfg = buildOpenIdConfiguration("https://host/iam/realms/bdf");
    expect(cfg.grant_types_supported).toContain("refresh_token");
    expect(cfg.grant_types_supported).toContain("password");
  });
});
