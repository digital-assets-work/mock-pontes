/**
 * Business-window enforcement (issue #59).
 *
 * The reviewer (F-06) noted the business window was display-only: setting it to
 * closed had no effect on writes. This middleware rejects **mutating official
 * API calls** (`POST`/`PUT`/`PATCH`/`DELETE` on `/dlt/…` and `/igw/…`) when the
 * window is not open, interpreting `openTime`/`closeTime` in Frankfurt local
 * time (see {@link isBusinessWindowOpen}).
 *
 * Enforcement is **opt-in** via `PONTES_MOCK_ENFORCE_BUSINESS_WINDOW=true` so it
 * never blocks local seeding / tests by default; the hosted instance turns it
 * on. Reads (GET), the admin/business-window endpoint, health, UI and enrolment
 * are never gated.
 */

import { defineEventHandler, getMethod, setResponseStatus, type H3Event } from "h3";
import type { MockStore, BusinessWindow } from "../state/mock-store.js";
import { isBusinessWindowOpen } from "../state/business-window.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** True for official DLT/IGW API paths (the surface the window governs). */
export function isOfficialApiPath(path: string): boolean {
  return /^\/(?:dlt|igw)\//.test(path);
}

/**
 * Pure decision: should this request be blocked by a closed business window?
 * Only mutating official-API requests are ever blocked.
 */
export function businessWindowBlocks(
  method: string,
  path: string,
  bw: BusinessWindow,
  now: Date = new Date(),
): boolean {
  if (!MUTATING_METHODS.has(method.toUpperCase())) return false;
  if (!isOfficialApiPath(path)) return false;
  return !isBusinessWindowOpen(bw, now);
}

export interface BusinessWindowGuardOptions {
  /** Defaults to the `PONTES_MOCK_ENFORCE_BUSINESS_WINDOW` env flag. */
  enabled?: boolean;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export function createBusinessWindowGuardMiddleware(
  store: MockStore,
  options: BusinessWindowGuardOptions = {},
) {
  const enabled =
    options.enabled ?? process.env.PONTES_MOCK_ENFORCE_BUSINESS_WINDOW === "true";
  const now = options.now ?? (() => new Date());

  return defineEventHandler((event: H3Event) => {
    if (!enabled) return;
    const path = event.path || "";
    const method = getMethod(event);
    const bw = store.getBusinessWindow();
    if (!businessWindowBlocks(method, path, bw, now())) return;
    setResponseStatus(event, 403);
    return {
      businessErrors: [
        {
          errorCode: "HL-BW-001",
          errorDescription:
            `The Pontes business window is closed (open ${bw.openTime}–${bw.closeTime} ` +
            `Europe/Berlin). The window can be changed via the ` +
            `PUT /admin/business-window endpoint.`,
        },
      ],
    };
  });
}
