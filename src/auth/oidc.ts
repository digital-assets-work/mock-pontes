/**
 * OpenID Connect helpers for the mock IAM (Keycloak-compatible) endpoints.
 *
 * Pure, side-effect-free builders so they can be unit-tested directly:
 *   - buildJwks()                 → JWKS document served at .../openid-connect/certs
 *   - buildOpenIdConfiguration()  → discovery document served at .../.well-known/openid-configuration
 */

import { createPublicKey } from "node:crypto";

/** Key id stamped on issued JWTs (see the token endpoint) and advertised in the JWKS. */
export const SIGNING_KEY_ID = "mock-pontes-key-1";

/**
 * Build the JWK Set (JWKS) for the mock's signing key.
 * The public key PEM is converted to a JWK and annotated with kid/use/alg so a
 * client can look up the key by the `kid` in a JWT header and verify ES256.
 */
export function buildJwks(publicKeyPem: string): { keys: Array<Record<string, unknown>> } {
  const jwk = createPublicKey(publicKeyPem).export({ format: "jwk" }) as Record<string, unknown>;
  return {
    keys: [
      {
        ...jwk,
        kid: SIGNING_KEY_ID,
        use: "sig",
        alg: "ES256",
      },
    ],
  };
}

/**
 * Build the OpenID Connect discovery document for a realm.
 * `issuer` is the realm base URL, e.g. `https://host/iam/realms/bdf`.
 */
export function buildOpenIdConfiguration(issuer: string): Record<string, unknown> {
  const base = issuer.replace(/\/$/, "");
  return {
    issuer: base,
    token_endpoint: `${base}/protocol/openid-connect/token`,
    jwks_uri: `${base}/protocol/openid-connect/certs`,
    grant_types_supported: ["password", "refresh_token"],
    response_types_supported: ["token"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["ES256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    scopes_supported: ["openid"],
  };
}
