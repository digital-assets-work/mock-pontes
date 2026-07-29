/**
 * Business-day / business-window helpers (issues #59, #81).
 *
 * The mock records the *structure of a day* ({@link BusinessDay}: the four
 * boundary times that partition the Frankfurt day) and derives the current
 * official window from the Frankfurt-local wall-clock time. There is no stored
 * "current window" — it is always computed, so the admin panel and the API can
 * never contradict each other.
 *
 *   [sodStart, ofaStart) → Start of Day
 *   [ofaStart, ofaEnd)   → Open for All
 *   [ofaEnd,  eodEnd)    → End of Day
 *   otherwise             → Closed   (bounds wrap: eodEnd → sodStart)
 *
 * All helpers are pure (side-effect-free, `now` is injectable) so the window
 * logic can be unit-tested independently of HTTP.
 */

import type { BusinessDay, BusinessWindowName } from "./mock-store.js";

/** ECB Pontes reference timezone (FFT local time). */
export const FRANKFURT_TZ = "Europe/Berlin";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The mutable admin fields, mirroring the body accepted by the admin endpoint. */
export const BUSINESS_DAY_FIELDS = [
  "businessDate",
  "sodStart",
  "ofaStart",
  "ofaEnd",
  "eodEnd",
] as const;

/** Time fields, in the order they must be non-decreasing. */
const TIME_FIELDS = ["sodStart", "ofaStart", "ofaEnd", "eodEnd"] as const;

/** Window sequence within a day (used to compute the "next" window). */
export const WINDOW_SEQUENCE: readonly BusinessWindowName[] = [
  "START_OF_DAY",
  "OPEN_FOR_ALL",
  "END_OF_DAY",
  "CLOSED",
];

const DISPLAY_NAME: Record<BusinessWindowName, string> = {
  START_OF_DAY: "Start of Day",
  OPEN_FOR_ALL: "Open for All",
  END_OF_DAY: "End of Day",
  CLOSED: "Closed",
};

/** Human-readable window name per the official spec. */
export function windowDisplayName(name: BusinessWindowName): string {
  return DISPLAY_NAME[name];
}

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

export interface CurrentWindow {
  /** Machine name, e.g. `OPEN_FOR_ALL`. */
  name: BusinessWindowName;
  /** Human-readable name, e.g. `Open for All`. */
  displayName: string;
  /** Start of the current window (HH:mm, Frankfurt time). */
  startTime: string;
  /** End of the current window (HH:mm, Frankfurt time). */
  endTime: string;
  /** Name of the window that follows the current one in sequence. */
  nextName: BusinessWindowName;
}

/**
 * Derive the current window from a business day and an instant. Boundaries are
 * half-open: a window runs `[start, end)`. Outside `[sodStart, eodEnd)` the day
 * is Closed (its bounds wrap: `eodEnd → sodStart`).
 */
export function currentWindow(day: BusinessDay, now: Date = new Date()): CurrentWindow {
  const t = frankfurtTimeHHmm(now);
  let name: BusinessWindowName;
  let startTime: string;
  let endTime: string;
  if (t < day.sodStart) {
    name = "CLOSED";
    startTime = day.eodEnd;
    endTime = day.sodStart;
  } else if (t < day.ofaStart) {
    name = "START_OF_DAY";
    startTime = day.sodStart;
    endTime = day.ofaStart;
  } else if (t < day.ofaEnd) {
    name = "OPEN_FOR_ALL";
    startTime = day.ofaStart;
    endTime = day.ofaEnd;
  } else if (t < day.eodEnd) {
    name = "END_OF_DAY";
    startTime = day.ofaEnd;
    endTime = day.eodEnd;
  } else {
    name = "CLOSED";
    startTime = day.eodEnd;
    endTime = day.sodStart;
  }
  return { name, displayName: DISPLAY_NAME[name], startTime, endTime, nextName: nextWindowName(name) };
}

/** The window that follows `name` in the daily sequence (Closed → Start of Day). */
export function nextWindowName(name: BusinessWindowName): BusinessWindowName {
  const i = WINDOW_SEQUENCE.indexOf(name);
  return WINDOW_SEQUENCE[(i + 1) % WINDOW_SEQUENCE.length];
}

/** Is the market open (any window other than Closed) at `now`? */
export function isBusinessOpen(day: BusinessDay, now: Date = new Date()): boolean {
  return currentWindow(day, now).name !== "CLOSED";
}

export interface BusinessDayUpdateResult {
  update?: Partial<BusinessDay>;
  error?: string;
}

/**
 * Validate an admin business-window update: it must be a **sub-list of the day
 * fields** (no unknown fields), each of the right shape, and the resulting time
 * boundaries must be non-decreasing (`sodStart ≤ ofaStart ≤ ofaEnd ≤ eodEnd`).
 * Returns the sanitised partial update or an error message.
 */
export function validateBusinessDayUpdate(
  body: unknown,
  current: BusinessDay,
): BusinessDayUpdateResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }
  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0) {
    return { error: `Provide at least one of: ${BUSINESS_DAY_FIELDS.join(", ")}.` };
  }
  const allowed = BUSINESS_DAY_FIELDS as readonly string[];
  const unknown = keys.filter((k) => !allowed.includes(k));
  if (unknown.length) {
    return {
      error: `Unknown field(s): ${unknown.join(", ")}. Allowed: ${BUSINESS_DAY_FIELDS.join(", ")}.`,
    };
  }

  const update: Partial<BusinessDay> = {};
  for (const field of TIME_FIELDS) {
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

  // Coherence: the merged boundary times must be in non-decreasing order.
  const merged = { ...current, ...update };
  for (let i = 1; i < TIME_FIELDS.length; i++) {
    const prev = TIME_FIELDS[i - 1];
    const cur = TIME_FIELDS[i];
    if (merged[cur] < merged[prev]) {
      return {
        error:
          `Times must be in increasing order (sodStart ≤ ofaStart ≤ ofaEnd ≤ eodEnd): ` +
          `${cur} (${merged[cur]}) is before ${prev} (${merged[prev]}).`,
      };
    }
  }
  return { update };
}
