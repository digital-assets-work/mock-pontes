/**
 * Mock IAM token endpoint — simulates Pontes Keycloak per-NCB realm.
 *
 * POST /iam/realms/:ncb/protocol/openid-connect/token
 * Accepts: grant_type=password, username, password, scope=openid, client_id
 * Returns: { access_token, token_type, expires_in, scope }
 */

import {
  createRouter,
  defineEventHandler,
  getRouterParam,
  readRawBody,
  readBody,
  setResponseStatus,
} from "h3";
import jwt from "jsonwebtoken";
import { createPublicKey } from "node:crypto";
import { getTestKeys } from "./test-keys.js";
import type { InMemoryAuthUsersRepository } from "./users-repository.js";
import { isStrictMode, validateClientIdForProfile } from "./profile-enforcement.js";

interface TokenRouterOptions {
  authUsersRepository: InMemoryAuthUsersRepository;
}

export function createTokenRouter(options: TokenRouterOptions) {
  const router = createRouter();

  router.post(
    "/iam/realms/:ncb/protocol/openid-connect/token",
    defineEventHandler(async (event) => {
      const ncb = getRouterParam(event, "ncb")!;

      // Always parse as URL-encoded using URLSearchParams for spec-compliant decoding.
      // H3's readBody auto-parses form data with ufo's parseQuery which can mangle
      // passwords containing special characters (+, %, etc.).
      const rawBody = await readRawBody(event, "utf-8");
      const params = rawBody ? new URLSearchParams(rawBody) : null;

      let grantType: string;
      let username: string;
      let password: string;
      let scope: string;
      let clientId: string;
      let body: any = null;

      if (params) {
        grantType = params.get("grant_type") || "";
        username = params.get("username") || "";
        password = params.get("password") || "";
        scope = params.get("scope") || "openid";
        clientId = params.get("client_id") || "esydlt-web-app";
      } else {
        // Fallback: JSON body
        body = await readBody(event);
        grantType = body.grant_type || "";
        username = body.username || "";
        password = body.password || "";
        scope = body.scope || "openid";
        clientId = body.client_id || "esydlt-web-app";
      }

      // Validate grant type
      if (grantType !== "password") {
        setResponseStatus(event, 400);
        return {
          error: "unsupported_grant_type",
          error_description: `Grant type '${grantType}' not supported. Use 'password'.`,
        };
      }

      // Validate user credentials
      const user = options.authUsersRepository.validateCredentials(username, password);
      if (!user) {
        const knownUser = options.authUsersRepository.getUserByUsername(username);
        console.warn(
          `[mock-pontes] token:invalid_grant username=${username} userExists=${Boolean(knownUser)} passwordLength=${password.length}`,
        );
        setResponseStatus(event, 401);
        return {
          error: "invalid_grant",
          error_description: "Invalid user credentials",
        };
      }

      // Strict profile/client_id enforcement (Table U)
      if (isStrictMode()) {
        const clientSecret = params
          ? params.get("client_secret") || null
          : (body?.client_secret || null);
        const validation = validateClientIdForProfile(user.profile, clientId, clientSecret);
        if (!validation.valid) {
          console.warn(
            `[mock-pontes] token:invalid_client username=${username} profile=${user.profile} client_id=${clientId} reason=${validation.error}`,
          );
          setResponseStatus(event, 401);
          return {
            error: "invalid_client",
            error_description: validation.error,
          };
        }
      }

      const keys = await getTestKeys();
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = 300; // 5 minutes per Pontes spec

      // Build JWT payload matching Pontes structure
      const payload = {
        sub: user.uuid,
        iss: `mock-pontes/iam/realms/${ncb}`,
        aud: clientId,
        iat: now,
        exp: now + expiresIn,
        scope,
        preferred_username: username,
        user_uuid: user.uuid,
        user_profile: user.profile,
        entity_bic: user.entityBIC,
        realm: ncb,
      };

      // Sign JWT with the test ECDSA P-256 key
      const accessToken = jwt.sign(payload, keys.privateKeyPem, {
        algorithm: "ES256",
        keyid: "mock-pontes-key-1",
      });

      return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: expiresIn,
        scope,
        not_before_policy: 0,
        session_state: `mock-session-${user.uuid}`,
      };
    }),
  );

  // JWKS endpoint for token verification
  router.get(
    "/iam/realms/:ncb/protocol/openid-connect/certs",
    defineEventHandler(async () => {
      const keys = await getTestKeys();
      // Return the public key in JWK format
      const publicKeyJwk = jwkFromPem(keys.publicKeyPem);
      return {
        keys: [
          {
            ...publicKeyJwk,
            kid: "mock-pontes-key-1",
            use: "sig",
            alg: "ES256",
          },
        ],
      };
    }),
  );

  return router;
}

/**
 * Convert a PEM public key to JWK format (minimal implementation for EC P-256).
 */
function jwkFromPem(publicKeyPem: string): Record<string, string> {
  const keyObject = createPublicKey(publicKeyPem);
  const jwk = keyObject.export({ format: "jwk" });
  return jwk as unknown as Record<string, string>;
}
