/**
 * Unit tests for the mock IAM (Keycloak-compatible) OIDC endpoints:
 * JWKS (`/certs`) and discovery (`/.well-known/openid-configuration`).
 */

import { describe, it, expect } from "@jest/globals";
import jwt from "jsonwebtoken";
import { createPublicKey } from "node:crypto";
import { getTestKeys } from "../src/auth/test-keys.js";
import { buildJwks, buildOpenIdConfiguration, SIGNING_KEY_ID } from "../src/auth/oidc.js";

describe("JWKS (/certs)", () => {
  it("returns a single ES256 EC P-256 JWK annotated with the signing kid", async () => {
    const keys = await getTestKeys();
    const jwks = buildJwks(keys.publicKeyPem);

    expect(jwks.keys).toHaveLength(1);
    const k = jwks.keys[0]!;
    expect(k.kid).toBe(SIGNING_KEY_ID);
    expect(k.kty).toBe("EC");
    expect(k.crv).toBe("P-256");
    expect(k.use).toBe("sig");
    expect(k.alg).toBe("ES256");
    expect(typeof k.x).toBe("string");
    expect(typeof k.y).toBe("string");
    // The private component must never be exposed.
    expect(k.d).toBeUndefined();
  });

  it("produces a key that verifies a JWT issued by the mock (kid lookup)", async () => {
    const keys = await getTestKeys();
    const token = jwt.sign({ sub: "u1" }, keys.privateKeyPem, {
      algorithm: "ES256",
      keyid: SIGNING_KEY_ID,
      expiresIn: 60,
    });

    const header = JSON.parse(
      Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"),
    );
    const jwks = buildJwks(keys.publicKeyPem);
    const jwk = jwks.keys.find((entry) => entry.kid === header.kid);
    expect(jwk).toBeDefined();

    const publicKey = createPublicKey({ key: jwk as any, format: "jwk" });
    const decoded = jwt.verify(token, publicKey, { algorithms: ["ES256"] }) as jwt.JwtPayload;
    expect(decoded.sub).toBe("u1");
  });
});

describe("OIDC discovery (/.well-known/openid-configuration)", () => {
  it("exposes issuer, token_endpoint and jwks_uri for the realm", () => {
    const cfg = buildOpenIdConfiguration("https://host/iam/realms/bdf");
    expect(cfg.issuer).toBe("https://host/iam/realms/bdf");
    expect(cfg.token_endpoint).toBe(
      "https://host/iam/realms/bdf/protocol/openid-connect/token",
    );
    expect(cfg.jwks_uri).toBe(
      "https://host/iam/realms/bdf/protocol/openid-connect/certs",
    );
    expect(cfg.id_token_signing_alg_values_supported).toContain("ES256");
    expect(cfg.grant_types_supported).toContain("password");
  });

  it("normalises a trailing slash on the issuer", () => {
    const cfg = buildOpenIdConfiguration("https://host/iam/realms/bdf/");
    expect(cfg.issuer).toBe("https://host/iam/realms/bdf");
  });
});
