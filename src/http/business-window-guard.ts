/**
 * Business-window enforcement (issues #59, #81).
 *
 * Every official operation declares, in the spec, the windows during which it is
 * accessible (see {@link allowedWindowsForRequest}). This middleware derives the
 * **current** window from the stored business day in Frankfurt time and rejects
 * any official `/dlt` or `/igw` request whose operation is not accessible in
 * that window with `403 HL-BW-001`.
 *
 * Because the default business day is Open-for-All for essentially the whole day
 * (issue #81), enforcement is **always on** and never contradicts what the API
 * reports — so there is no opt-in flag. The one escape hatch,
 * `PONTES_MOCK_BUSINESS_WINDOW_ALWAYS_OPEN=true`, disables enforcement entirely
 * (handy for CI running at odd hours). Health, admin, UI, enrolment and any
 * operation without a window rule are never gated.
 */

import { defineEventHandler, getMethod, setResponseStatus, type H3Event } from "h3";
import type { MockStore, BusinessDay } from "../state/mock-store.js";
import { currentWindow, windowDisplayName } from "../state/business-window.js";
import { allowedWindowsForRequest } from "./business-window-rules.js";

/** True for official DLT/IGW API paths (the surface the window governs). */
export function isOfficialApiPath(path: string): boolean {
  return /^\/(?:dlt|igw)\//.test(path);
}

export interface BusinessWindowDecision {
  blocked: boolean;
  /** The current window name (present when a rule applied). */
  windowName?: string;
  /** The windows the operation allows (present when a rule applied). */
  allowed?: string[];
}

/**
 * Pure decision: is this request blocked by the current business window? A
 * request is blocked only when it targets an official operation that carries a
 * window rule and the current window is not in that rule's allowed set.
 */
export function businessWindowDecision(
  method: string,
  path: string,
  day: BusinessDay,
  now: Date = new Date(),
): BusinessWindowDecision {
  if (!isOfficialApiPath(path)) return { blocked: false };
  const allowed = allowedWindowsForRequest(method, path);
  if (!allowed) return { blocked: false }; // no rule → never gated
  const cw = currentWindow(day, now);
  return {
    blocked: !allowed.has(cw.name),
    windowName: cw.displayName,
    allowed: [...allowed].map(windowDisplayName),
  };
}

export interface BusinessWindowGuardOptions {
  /** Disable enforcement entirely. Defaults to the `PONTES_MOCK_BUSINESS_WINDOW_ALWAYS_OPEN` env flag. */
  alwaysOpen?: boolean;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export function createBusinessWindowGuardMiddleware(
  store: MockStore,
  options: BusinessWindowGuardOptions = {},
) {
  const alwaysOpen =
    options.alwaysOpen ?? process.env.PONTES_MOCK_BUSINESS_WINDOW_ALWAYS_OPEN === "true";
  const now = options.now ?? (() => new Date());

  return defineEventHandler((event: H3Event) => {
    if (alwaysOpen) return;
    const path = event.path || "";
    if (!isOfficialApiPath(path)) return;
    const method = getMethod(event);
    const decision = businessWindowDecision(method, path, store.getBusinessDay(), now());
    if (!decision.blocked) return;
    setResponseStatus(event, 403);
    return {
      businessErrors: [
        {
          errorCode: "HL-BW-001",
          errorDescription:
            `The current Pontes business window is "${decision.windowName}"; this operation is ` +
            `only accessible during: ${decision.allowed?.join(", ")} (Europe/Berlin time). ` +
            `The business day can be changed via POST /admin/business-window.`,
        },
      ],
    };
  });
}
