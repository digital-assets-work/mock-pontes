/**
 * Centralized profile ↔ client_id enforcement for mock-pontes.
 *
 * Mirrors real Pontes (SDD §6.3.3, Table U):
 *   EXTERNAL_USER        → client_id=esydlt-backend-service, client_secret=esydlt-backend-service
 *   PILOT_READ_WRITE     → client_id=esydlt-web-app (no secret)
 *   PILOT_READ_ONLY      → client_id=esydlt-web-app (no secret)
 *   REFERENTIAL_READ_ONLY  → client_id=esydlt-web-app (no secret)
 *   REFERENTIAL_READ_WRITE → client_id=esydlt-web-app (no secret)
 *
 * Enforcement is strict by default; set PONTES_MOCK_LENIENT_PROFILE=true to disable.
 */

export const CLIENT_ID_BACKEND_SERVICE = "esydlt-backend-service";
export const CLIENT_ID_WEB_APP = "esydlt-web-app";

/** Profiles that require the backend-service client_id + secret */
const BACKEND_SERVICE_PROFILES = new Set(["EXTERNAL_USER"]);

/** Profiles that require the web-app client_id (no secret) */
const WEB_APP_PROFILES = new Set([
  "PILOT_READ_WRITE",
  "PILOT_READ_ONLY",
  "REFERENTIAL_READ_ONLY",
  "REFERENTIAL_READ_WRITE",
]);

/**
 * Returns true when strict profile/client_id enforcement is active (default).
 * Returns false when PONTES_MOCK_LENIENT_PROFILE=true.
 */
export function isStrictMode(): boolean {
  return process.env.PONTES_MOCK_LENIENT_PROFILE !== "true";
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
