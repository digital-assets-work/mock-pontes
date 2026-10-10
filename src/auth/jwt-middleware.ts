/**
 * JWT authentication middleware for mock-pontes.
 *
 * Validates Bearer tokens on all /dlt/ routes, plus any individually named
 * `extraRoutes` (method + exact path template) elsewhere — issue #143 added
 * the XvP payment POST on the `/igw` surface this way, deliberately *not*
 * widening the blanket prefix (which would also cover XvP init, reads,
 * payment-key queries and direct-RTGS routes that are intentionally out of
 * this issue's scope; see `XVP_PAYMENT_JWT_ROUTES` in app.ts).
 * Skips /admin/, /iam/, /health, /check/ routes.
 * Attaches decoded user context to event.context.auth.
 */

import {
  defineEventHandler,
  getHeader,
  getMethod,
  setResponseStatus,
  type H3Event,
} from "h3";
import jwt from "jsonwebtoken";
import { CLIENT_ID_BACKEND_SERVICE, CLIENT_ID_WEB_APP_U2A } from "./profile-enforcement.js";

export interface AuthContext {
  userUUID: string;
  username: string;
  profile: string;
  entityBIC: string;
  realm: string;
}

/**
 * Default JWT audience allow-list (issue #118) — direct reproduction against
 * the real `utest` pilot showed tokens whose `aud` doesn't contain one of
 * these two client ids get rejected with `401 session is not valid`
 * (notably including tokens requested with `client_id=esydlt-web-app`,
 * which is Table U's documented client for several profiles — see the issue
 * for the full discrepancy writeup). Configurable via
 * `PONTES_JWT_AUDIENCE_ALLOWLIST` (comma-separated).
 */
const DEFAULT_JWT_AUDIENCE_ALLOWLIST = [CLIENT_ID_WEB_APP_U2A, CLIENT_ID_BACKEND_SERVICE];

/** Parse `PONTES_JWT_AUDIENCE_ALLOWLIST` (comma-separated), falling back to the default list. */
export function resolveAudienceAllowlist(): string[] {
  const raw = process.env.PONTES_JWT_AUDIENCE_ALLOWLIST;
  if (!raw) return DEFAULT_JWT_AUDIENCE_ALLOWLIST;
  const parsed = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_JWT_AUDIENCE_ALLOWLIST;
}

/** A single individually JWT-protected route: an exact method + path template. */
export interface JwtRouteMatcher {
  readonly method: string;
  /** `{param}`/`{}`-style template, e.g. "/igw/{ncb}/v1/xvps/{id}/payment". */
  readonly pathTemplate: string;
}

/** Turn a `{param}` path template into an anchored regex (one `{}` per path segment). */
function routeTemplateToRegex(template: string): RegExp {
  const body = template
    .split("/")
    .map((seg) => (/^\{.*\}$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${body}(?:$|\\?)`);
}

function shouldApplyAuth(
  path: string,
  method: string,
  protectedPrefixes: readonly string[],
  extraRoutes: readonly { method: string; regex: RegExp }[],
): boolean {
  if (protectedPrefixes.length === 0 && extraRoutes.length === 0) return true;
  if (protectedPrefixes.some((prefix) => path.startsWith(prefix))) return true;
  return extraRoutes.some((r) => r.method === method && r.regex.test(path));
}

/**
 * JWT verification middleware. `jwtPublicKeyPem` is the persisted, shared JWT
 * signing public key from the runtime PKI bundle (#47) so tokens verify across
 * restarts and replicas. `extraRoutes` (issue #143) names individual
 * method+path routes to protect outside `protectedPrefixes`, without widening
 * a whole prefix's scope.
 */
export function createJwtMiddleware(
  protectedPrefixes: readonly string[],
  jwtPublicKeyPem: string,
  extraRoutes: readonly JwtRouteMatcher[] = [],
) {
  const extraMatchers = extraRoutes.map((r) => ({
    method: r.method,
    regex: routeTemplateToRegex(r.pathTemplate),
  }));

  return defineEventHandler(async (event: H3Event) => {
    const path = event.path || "";
    const method = getMethod(event);

    if (!shouldApplyAuth(path, method, protectedPrefixes, extraMatchers)) return;

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

      // Audience allow-list (issue #118): reproduces the real `utest`
      // behavior of rejecting tokens whose `aud` isn't one of a small set of
      // accepted client ids — returned in the exact shape captured from the
      // real environment, not the mock's own businessErrors envelope (see
      // error-response.ts's dedicated pass-through for this shape).
      const aud = decoded.aud;
      const audList = Array.isArray(aud) ? aud : aud ? [aud] : [];
      const allowlist = resolveAudienceAllowlist();
      if (!audList.some((a) => allowlist.includes(a))) {
        setResponseStatus(event, 401);
        return { status: 401, message: "session is not valid", code: "unauthorized" };
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
