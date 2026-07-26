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
import { getTestKeys } from "./test-keys.js";

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

export function createJwtMiddleware(protectedPrefixes: readonly string[]) {
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
    const keys = await getTestKeys();

    try {
      const decoded = jwt.verify(token, keys.publicKeyPem, {
        algorithms: ["ES256"],
      }) as jwt.JwtPayload;

      // Attach auth context for downstream handlers
      event.context.auth = {
        userUUID: decoded.user_uuid || decoded.sub,
        username: decoded.preferred_username,
        profile: decoded.user_profile,
        entityBIC: decoded.entity_bic,
        realm: decoded.realm,
      } satisfies AuthContext;
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
