/**
 * Route-level profile authorization middleware for mock-pontes.
 *
 * Enforces that:
 * - 1-step bridge endpoints require EXTERNAL_USER profile
 * - 2-step draft/approve and funding/defunding endpoints require PILOT_READ_WRITE profile
 *
 * Skipped when PONTES_MOCK_LENIENT_PROFILE=true.
 */

import { defineEventHandler, setResponseStatus, type H3Event } from "h3";
import {
  isStrictMode,
  BRIDGE_1STEP_PROFILES,
  DRAFT_APPROVE_PROFILES,
} from "./profile-enforcement.js";

/** Route patterns requiring EXTERNAL_USER (1-step bridge operations) */
const BRIDGE_1STEP_PATTERNS: readonly RegExp[] = [
  /\/dlt\/[^/]+\/api\/bridge\/payments/,
  /\/dlt\/[^/]+\/api\/bridge\/direct-rtgs\//,
  /\/dlt\/[^/]+\/api\/bridge\/initpfod/,
  // PFoD / XvP bridge endpoints (reserved for future)
  /\/dlt\/[^/]+\/api\/bridge\/pfod\//,
  /\/dlt\/[^/]+\/api\/bridge\/xvp\//,
];

/** Route patterns requiring PILOT_READ_WRITE (2-step draft/approve + funding/defunding) */
const DRAFT_APPROVE_PATTERNS: readonly RegExp[] = [
  /\/dlt\/[^/]+\/api\/octopus\/rvs\/transactions-requests/,
  /\/dlt\/[^/]+\/api\/octopus\/rvs\/transactions-drafts\/[^/]+\/approve/,
  /\/dlt\/[^/]+\/api\/octopus\/rvs\/transactions-drafts\/[^/]+\/cancel/,
  /\/dlt\/[^/]+\/api\/octopus\/tms\/funding-requests/,
  /\/dlt\/[^/]+\/api\/octopus\/tms\/funding-requests-drafts\//,
  /\/dlt\/[^/]+\/api\/octopus\/tms\/defunding-requests/,
  /\/dlt\/[^/]+\/api\/octopus\/tms\/defunding-requests-drafts\//,
  /\/dlt\/[^/]+\/api\/octopus\/tms\/direct-rtgs\//,
];

function matchesAny(path: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(path));
}

function createAuthorizationError(profile: string, requiredProfiles: Set<string>) {
  return {
    businessErrors: [
      {
        errorCode: "HL-AUTH-001",
        errorDescription: `Profile '${profile}' is not authorized for this operation. Required: ${[...requiredProfiles].join(" | ")}`,
      },
    ],
  };
}

/**
 * Middleware that enforces profile-based route authorization.
 * Must be placed AFTER jwt-middleware so event.context.auth is populated.
 */
export function createProfileAuthorizationMiddleware() {
  return defineEventHandler((event: H3Event) => {
    if (!isStrictMode()) return;

    const path = event.path || "";
    // Only apply to /dlt/ routes (same scope as JWT middleware)
    if (!path.startsWith("/dlt")) return;

    const auth = event.context.auth as { profile?: string } | undefined;
    if (!auth?.profile) return; // No auth context → JWT middleware already handled it

    const profile = auth.profile;

    // Check 1-step bridge routes (POST only for payments)
    if (matchesAny(path, BRIDGE_1STEP_PATTERNS)) {
      if (!BRIDGE_1STEP_PROFILES.has(profile)) {
        setResponseStatus(event, 403);
        return createAuthorizationError(profile, BRIDGE_1STEP_PROFILES);
      }
    }

    // Check 2-step draft/approve/funding/defunding routes (POST/PUT write operations)
    if (matchesAny(path, DRAFT_APPROVE_PATTERNS)) {
      if (!DRAFT_APPROVE_PROFILES.has(profile)) {
        setResponseStatus(event, 403);
        return createAuthorizationError(profile, DRAFT_APPROVE_PROFILES);
      }
    }
  });
}
