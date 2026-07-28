/**
 * The access-token JWT signing key is a dedicated key carried in the persisted
 * runtime PKI bundle (issue #47), so it is shared across replicas and survives
 * restarts instead of being regenerated in-memory per pod.
 *
 * These tests run with no REDIS_URL, so the bundle is generated once and
 * memoised; they assert the JWT key is present, is a valid ES256 keypair, is
 * stable across calls, and is distinct from the CA issuance key.
 */

import { describe, it, expect } from "@jest/globals";
import jwt from "jsonwebtoken";
import { getRuntimePkiBundle } from "../src/auth/runtime-pki.js";
import { buildJwks, SIGNING_KEY_ID } from "../src/auth/oidc.js";

describe("JWT signing key in the runtime PKI bundle (#47)", () => {
  it("exposes a dedicated JWT signing keypair (PEM), separate from the CA key", async () => {
    const pki = await getRuntimePkiBundle();
    expect(pki.jwtSigningPrivateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
    expect(pki.jwtSigningPublicKeyPem).toContain("-----BEGIN PUBLIC KEY-----");
    // Not the same material as the certificate-issuance (client CA) key.
    expect(pki.jwtSigningPrivateKeyPem).not.toBe(pki.clientSigningCaPrivateKeyPem);
  });

  it("is stable across calls (shared, not regenerated)", async () => {
    const a = await getRuntimePkiBundle();
    const b = await getRuntimePkiBundle();
    expect(b.jwtSigningPrivateKeyPem).toBe(a.jwtSigningPrivateKeyPem);
    expect(b.jwtSigningPublicKeyPem).toBe(a.jwtSigningPublicKeyPem);
  });

  it("signs an ES256 JWT that verifies with the bundle public key", async () => {
    const pki = await getRuntimePkiBundle();
    const token = jwt.sign({ sub: "u1" }, pki.jwtSigningPrivateKeyPem, {
      algorithm: "ES256",
      keyid: SIGNING_KEY_ID,
    });
    const decoded = jwt.verify(token, pki.jwtSigningPublicKeyPem, {
      algorithms: ["ES256"],
    }) as jwt.JwtPayload;
    expect(decoded.sub).toBe("u1");
  });

  it("rejects a token signed by a different key", async () => {
    const pki = await getRuntimePkiBundle();
    // Sign with the (unrelated) client-CA key; verification must fail.
    const forged = jwt.sign({ sub: "attacker" }, pki.clientSigningCaPrivateKeyPem, {
      algorithm: "ES256",
    });
    expect(() =>
      jwt.verify(forged, pki.jwtSigningPublicKeyPem, { algorithms: ["ES256"] }),
    ).toThrow();
  });

  it("publishes the public key via JWKS under the expected kid", async () => {
    const pki = await getRuntimePkiBundle();
    const jwks = buildJwks(pki.jwtSigningPublicKeyPem);
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0].kid).toBe(SIGNING_KEY_ID);
    expect(jwks.keys[0].alg).toBe("ES256");
  });
});
