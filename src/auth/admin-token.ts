/**
 * Admin-token gate (issue #35).
 *
 * Opt-in protection for the mock's administrative surface. Controlled by the
 * `ADMIN_TOKEN` environment variable:
 *
 *  - When `ADMIN_TOKEN` is **unset**, every admin/enrolment endpoint keeps its
 *    current (open) behaviour — nothing changes for existing users.
 *  - When `ADMIN_TOKEN` is **set**, state-changing admin endpoints
 *    (`PUT /admin/business-window`, `POST /admin/reset`) and the enrolled-user
 *    listing require the token; CSR enrolment still works but issues short-lived
 *    (1 hour) certificates. `GET /admin/business-window` stays open.
 *
 * The token is presented via the `X-Admin-Token` header (or
 * `Authorization: Bearer <token>`).
 */

import { getHeader, setResponseStatus, type H3Event } from "h3";

export function adminTokenConfigured(): boolean {
  const t = process.env.ADMIN_TOKEN;
  return typeof t === "string" && t.length > 0;
}

/** Short-lived certificate validity (minutes) when the admin gate is enabled. */
export const ADMIN_ENROLMENT_CERT_MINUTES = 60;

function presentedToken(event: H3Event): string | undefined {
  const header = getHeader(event, "x-admin-token");
  if (header) return header;
  const auth = getHeader(event, "authorization");
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7);
  return undefined;
}

/** True when the request carries the configured admin token. */
export function hasValidAdminToken(event: H3Event): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  return presentedToken(event) === expected;
}

export function adminUnauthorizedBody() {
  return {
    businessErrors: [
      {
        errorCode: "HL-ATH-001",
        errorDescription:
          "A valid admin token is required (X-Admin-Token header)",
      },
    ],
  };
}

/**
 * Enforce the admin token on a protected endpoint.
 * - `ADMIN_TOKEN` unset → open (returns true), preserving current behaviour.
 * - set + valid token → returns true.
 * - set + missing/invalid token → sets a 401 status and returns false; the
 *   caller should return {@link adminUnauthorizedBody}.
 */
export function enforceAdminToken(event: H3Event): boolean {
  if (!adminTokenConfigured()) return true;
  if (hasValidAdminToken(event)) return true;
  setResponseStatus(event, 401);
  return false;
}
