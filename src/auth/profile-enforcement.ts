/**
 * Centralized profile ↔ client_id mapping for mock-pontes.
 *
 * Documents Table U (SDD §6.3.3), the *specified* mapping:
 *   EXTERNAL_USER        → client_id=esydlt-backend-service, client_secret=esydlt-backend-service
 *   PILOT_READ_WRITE     → client_id=esydlt-web-app (no secret)
 *   PILOT_READ_ONLY      → client_id=esydlt-web-app (no secret)
 *   REFERENTIAL_READ_ONLY  → client_id=esydlt-web-app (no secret)
 *   REFERENTIAL_READ_WRITE → client_id=esydlt-web-app (no secret)
 *
 * `validateClientIdForProfile()` below still implements this strict mapping
 * and stays directly unit-tested, but as of issue #118 it is no longer
 * called from the token endpoint's issuance path: direct reproduction
 * against the real `utest` pilot showed the real IAM does not reject/require
 * a specific client_id at token issuance (any client_id — and no
 * client_secret — is accepted there), it only affects which claims end up in
 * the returned JWT (see `signTokens()` in enrollment-routes.ts) and, in
 * turn, whether downstream endpoints accept the token's `aud` (see the
 * audience allow-list in jwt-middleware.ts). This function remains available
 * for anyone who wants to assert the documented Table U mapping directly.
 */

export const CLIENT_ID_BACKEND_SERVICE = "esydlt-backend-service";
export const CLIENT_ID_WEB_APP = "esydlt-web-app";
/**
 * The browser/U2A PKCE client id (issue #118) — distinct from
 * `esydlt-web-app` (used for A2A password-grant requests). Not part of
 * Table U's A2A client_id validation this module performs, but part of the
 * default JWT audience allow-list in jwt-middleware.ts, since real-world
 * captures show it as an accepted `aud` value.
 */
export const CLIENT_ID_WEB_APP_U2A = "esydlt-web-app-u2a";

/** Profiles that require the backend-service client_id + secret */
const BACKEND_SERVICE_PROFILES = new Set(["EXTERNAL_USER"]);

/** Profiles that require the web-app client_id (no secret) */
const WEB_APP_PROFILES = new Set([
  "PILOT_READ_WRITE",
  "PILOT_READ_ONLY",
  "REFERENTIAL_READ_ONLY",
  "REFERENTIAL_READ_WRITE",
]);

/** Every profile recognised by Table U — the enrolment allow-list (issue #84). */
export const KNOWN_PROFILES: ReadonlySet<string> = new Set<string>([
  ...BACKEND_SERVICE_PROFILES,
  ...WEB_APP_PROFILES,
]);

/** Is this a known Table U profile? (Used to reject typo'd profiles at CSR.) */
export function isKnownProfile(profile: string): boolean {
  return KNOWN_PROFILES.has(profile);
}

export interface ClientIdValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate that the provided client_id (and optionally client_secret) matches
 * the user's profile per Table U.
 */
export function validateClientIdForProfile(
  profile: string,
  clientId: string,
  clientSecret?: string | null,
): ClientIdValidationResult {
  if (BACKEND_SERVICE_PROFILES.has(profile)) {
    if (clientId !== CLIENT_ID_BACKEND_SERVICE) {
      return {
        valid: false,
        error: `Profile ${profile} requires client_id=${CLIENT_ID_BACKEND_SERVICE}`,
      };
    }
    if (clientSecret !== CLIENT_ID_BACKEND_SERVICE) {
      return {
        valid: false,
        error: `Profile ${profile} requires client_secret=${CLIENT_ID_BACKEND_SERVICE}`,
      };
    }
    return { valid: true };
  }

  if (WEB_APP_PROFILES.has(profile)) {
    if (clientId !== CLIENT_ID_WEB_APP) {
      return {
        valid: false,
        error: `Profile ${profile} requires client_id=${CLIENT_ID_WEB_APP}`,
      };
    }
    return { valid: true };
  }

  // Unknown profile — lenient (allow)
  return { valid: true };
}

/** Profiles allowed on 1-step bridge endpoints */
export const BRIDGE_1STEP_PROFILES = new Set(["EXTERNAL_USER"]);

/** Profiles allowed on 2-step draft/approve and funding/defunding endpoints */
export const DRAFT_APPROVE_PROFILES = new Set(["PILOT_READ_WRITE"]);
