/**
 * JWT authentication middleware for mock-pontes.
 *
 * Validates Bearer tokens on all /dlt/ routes.
 * Skips /admin/, /iam/, /health, /check/ routes.
 * Attaches decoded user context to event.context.auth.
 */

import {
  defineEventHandler,
  getHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import jwt from "jsonwebtoken";

export interface AuthContext {
  userUUID: string;
  username: string;
  profile: string;
  entityBIC: string;
  realm: string;
}

function shouldApplyAuth(path: string, protectedPrefixes: readonly string[]): boolean {
  if (protectedPrefixes.length === 0) return true;
  return protectedPrefixes.some((prefix) => path.startsWith(prefix));
}

/**
 * JWT verification middleware. `jwtPublicKeyPem` is the persisted, shared JWT
 * signing public key from the runtime PKI bundle (#47) so tokens verify across
 * restarts and replicas.
 */
export function createJwtMiddleware(
  protectedPrefixes: readonly string[],
  jwtPublicKeyPem: string,
) {
  return defineEventHandler(async (event: H3Event) => {
    const path = event.path || "";

    if (!shouldApplyAuth(path, protectedPrefixes)) return;

    const authHeader = getHeader(event, "authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      setResponseStatus(event, 401);
      return {
        error: "unauthorized",
        error_description: "Missing or invalid Authorization header. Expected: Bearer <jwt>",
      };
    }

    const token = authHeader.slice(7);

    try {
      const decoded = jwt.verify(token, jwtPublicKeyPem, {
        algorithms: ["ES256"],
      }) as jwt.JwtPayload;

      // A refresh token (issue #64) must not be accepted as a bearer access
      // token — it is only valid at the token endpoint's refresh grant.
      if (decoded.typ === "Refresh") {
        setResponseStatus(event, 401);
        return {
          error: "invalid_token",
          error_description: "Refresh tokens cannot be used as access tokens",
        };
      }

      // Attach auth context for downstream handlers
      event.context.auth = {
        userUUID: decoded.user_uuid || decoded.sub,
        username: decoded.preferred_username,
        profile: decoded.user_profile,
        entityBIC: decoded.entity_bic,
        realm: decoded.realm,
      } satisfies AuthContext;

      // NCB scoping (issue #97): the `{ncb}` segment of the URL must match the
      // token's `realm`. Real Pontes partitions per NCB, but the mock keeps a
      // single global ledger — so without this check a `bdf`-realm token could
      // query `/dlt/bbk/...` and appear to work, masking an isolation bug that
      // would fail against the real environment. Reject a cross-realm call 403.
      const urlNcb = path.split("/")[2];
      const realm = decoded.realm;
      if (urlNcb && realm && urlNcb.toLowerCase() !== String(realm).toLowerCase()) {
        setResponseStatus(event, 403);
        return {
          businessErrors: [
            {
              errorCode: "HL-ATH-003",
              errorDescription:
                `Token realm '${realm}' is not authorized for NCB '${urlNcb}'. ` +
                `Acquire a token from /iam/realms/${urlNcb}/protocol/openid-connect/token.`,
            },
          ],
        };
      }
    } catch (err: any) {
      setResponseStatus(event, 401);
      return {
        error: "invalid_token",
        error_description:
          err.name === "TokenExpiredError"
            ? "Token has expired"
            : `Invalid token: ${err.message}`,
      };
    }
  });
}
