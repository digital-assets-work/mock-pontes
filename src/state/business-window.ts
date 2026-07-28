/**
 * Business-window model helpers (issue #59).
 *
 * The mock's business window is now *enforced* (optionally) on official write
 * calls, not merely displayed. `openTime`/`closeTime` are interpreted in
 * **Frankfurt local time** (the ECB Pontes reference timezone), so the window is
 * open when the current Frankfurt wall-clock time falls inside `[openTime,
 * closeTime)` — unless an admin has hard-closed it (`currentWindow: "CLOSED"`).
 *
 * These helpers are pure (side-effect-free, `now` is injectable) so the window
 * logic can be unit-tested independently of HTTP.
 */

import type { BusinessWindow } from "./mock-store.js";

/** ECB Pontes reference timezone (FFT local time). */
export const FRANKFURT_TZ = "Europe/Berlin";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WINDOW_STATES: BusinessWindow["currentWindow"][] = [
  "CLOSED",
  "START_OF_DAY",
  "OPEN_FOR_ALL",
  "END_OF_DAY",
];
/** The mutable admin fields, mirroring what `GET /admin/business-window` returns. */
export const BUSINESS_WINDOW_FIELDS = [
  "currentWindow",
  "businessDate",
  "openTime",
  "closeTime",
] as const;

/** Current Frankfurt-local wall-clock time as a zero-padded `HH:mm` string. */
export function frankfurtTimeHHmm(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: FRANKFURT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  // Some ICU builds render midnight as "24"; normalise to "00".
  return `${hh === "24" ? "00" : hh}:${mm}`;
}

/**
 * Is the window currently open? Open ⇔ not hard-closed by the admin AND the
 * Frankfurt-local time is within `[openTime, closeTime)`. A non-positive range
 * (`openTime >= closeTime`) is treated as closed.
 */
export function isBusinessWindowOpen(bw: BusinessWindow, now: Date = new Date()): boolean {
  if (bw.currentWindow === "CLOSED") return false;
  if (bw.openTime >= bw.closeTime) return false;
  const t = frankfurtTimeHHmm(now);
  return bw.openTime <= t && t < bw.closeTime;
}

/** Human-readable window name per the official spec, derived from the live state. */
export function effectiveWindowName(bw: BusinessWindow, now: Date = new Date()): string {
  return isBusinessWindowOpen(bw, now) ? "Open for All" : "Closed";
}

/** The name of the window that follows the current effective one. */
export function nextEffectiveWindowName(bw: BusinessWindow, now: Date = new Date()): string {
  return isBusinessWindowOpen(bw, now) ? "Closed" : "Open for All";
}

export interface BusinessWindowUpdateResult {
  update?: Partial<BusinessWindow>;
  error?: string;
}

/**
 * Validate a `PUT /admin/business-window` body: it must be a **sub-list of the
 * fields returned by `GET /admin/business-window`** (no unknown fields), each of
 * the right shape, and the resulting `closeTime` must be strictly greater than
 * `openTime` (issue #59). Returns the sanitised partial update or an error
 * message.
 */
export function validateBusinessWindowUpdate(
  body: unknown,
  current: BusinessWindow,
): BusinessWindowUpdateResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }
  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0) {
    return { error: `Provide at least one of: ${BUSINESS_WINDOW_FIELDS.join(", ")}.` };
  }
  const allowed = BUSINESS_WINDOW_FIELDS as readonly string[];
  const unknown = keys.filter((k) => !allowed.includes(k));
  if (unknown.length) {
    return {
      error: `Unknown field(s): ${unknown.join(", ")}. Allowed: ${BUSINESS_WINDOW_FIELDS.join(", ")}.`,
    };
  }

  const update: Partial<BusinessWindow> = {};
  if ("currentWindow" in input) {
    const v = input.currentWindow;
    if (typeof v !== "string" || !WINDOW_STATES.includes(v as BusinessWindow["currentWindow"])) {
      return { error: `currentWindow must be one of: ${WINDOW_STATES.join(", ")}.` };
    }
    update.currentWindow = v as BusinessWindow["currentWindow"];
  }
  for (const field of ["openTime", "closeTime"] as const) {
    if (field in input) {
      const v = input[field];
      if (typeof v !== "string" || !HHMM.test(v)) {
        return { error: `${field} must be a 24-hour HH:mm value (00:00–23:59).` };
      }
      update[field] = v;
    }
  }
  if ("businessDate" in input) {
    const v = input.businessDate;
    if (typeof v !== "string" || !DATE.test(v)) {
      return { error: "businessDate must be an ISO date (YYYY-MM-DD)." };
    }
    update.businessDate = v;
  }

  const openTime = update.openTime ?? current.openTime;
  const closeTime = update.closeTime ?? current.closeTime;
  if (closeTime <= openTime) {
    return { error: `closeTime (${closeTime}) must be greater than openTime (${openTime}).` };
  }
  return { update };
}
