/**
 * Business-window enforcement (issue #59):
 * - openTime/closeTime interpreted in Frankfurt (Europe/Berlin) time;
 * - the window is open only inside [openTime, closeTime) and never when the
 *   admin has hard-closed it (currentWindow: "CLOSED");
 * - mutating official API calls are blocked when the window is closed;
 * - PUT /admin/business-window accepts a sub-list of fields and requires
 *   closeTime > openTime.
 */

import { describe, it, expect } from "@jest/globals";
import type { BusinessWindow } from "../src/state/mock-store.js";
import {
  frankfurtTimeHHmm,
  isBusinessWindowOpen,
  effectiveWindowName,
  nextEffectiveWindowName,
  validateBusinessWindowUpdate,
} from "../src/state/business-window.js";
import { businessWindowBlocks, isOfficialApiPath } from "../src/http/business-window-guard.js";

// 2026-06-15 is DST (CEST, UTC+2) → 10:00Z is 12:00 Frankfurt.
const SUMMER_NOON = new Date("2026-06-15T10:00:00Z");
// 2026-01-15 is standard time (CET, UTC+1) → 10:00Z is 11:00 Frankfurt.
const WINTER_1100 = new Date("2026-01-15T10:00:00Z");

function bw(overrides: Partial<BusinessWindow> = {}): BusinessWindow {
  return {
    currentWindow: "OPEN_FOR_ALL",
    businessDate: "2026-06-15",
    openTime: "08:00",
    closeTime: "18:00",
    ...overrides,
  };
}

describe("frankfurtTimeHHmm (issue #59)", () => {
  it("renders the instant in Europe/Berlin, honouring DST", () => {
    expect(frankfurtTimeHHmm(SUMMER_NOON)).toBe("12:00");
    expect(frankfurtTimeHHmm(WINTER_1100)).toBe("11:00");
  });
});

describe("isBusinessWindowOpen (issue #59)", () => {
  it("is open when the Frankfurt time is inside [open, close)", () => {
    expect(isBusinessWindowOpen(bw({ openTime: "08:00", closeTime: "18:00" }), SUMMER_NOON)).toBe(true);
  });
  it("is closed before open and after close", () => {
    expect(isBusinessWindowOpen(bw({ openTime: "13:00", closeTime: "18:00" }), SUMMER_NOON)).toBe(false);
    expect(isBusinessWindowOpen(bw({ openTime: "06:00", closeTime: "11:00" }), SUMMER_NOON)).toBe(false);
  });
  it("is closed at the exact close boundary (half-open interval)", () => {
    expect(isBusinessWindowOpen(bw({ openTime: "08:00", closeTime: "12:00" }), SUMMER_NOON)).toBe(false);
  });
  it("honours a hard admin close regardless of time", () => {
    expect(isBusinessWindowOpen(bw({ currentWindow: "CLOSED" }), SUMMER_NOON)).toBe(false);
  });
  it("treats a non-positive range as closed", () => {
    expect(isBusinessWindowOpen(bw({ openTime: "18:00", closeTime: "08:00" }), SUMMER_NOON)).toBe(false);
  });
});

describe("windowName derivation (issue #59)", () => {
  it("reports Open for All only when inside the window", () => {
    expect(effectiveWindowName(bw(), SUMMER_NOON)).toBe("Open for All");
    expect(nextEffectiveWindowName(bw(), SUMMER_NOON)).toBe("Closed");
    expect(effectiveWindowName(bw({ openTime: "13:00", closeTime: "18:00" }), SUMMER_NOON)).toBe("Closed");
    expect(nextEffectiveWindowName(bw({ openTime: "13:00", closeTime: "18:00" }), SUMMER_NOON)).toBe("Open for All");
  });
});

describe("businessWindowBlocks (issue #59)", () => {
  const closed = bw({ currentWindow: "CLOSED" });
  it("blocks a mutating official API call when closed", () => {
    expect(businessWindowBlocks("POST", "/dlt/bdf/api/octopus/tms/funding-requests", closed, SUMMER_NOON)).toBe(true);
    expect(businessWindowBlocks("PUT", "/igw/bdf/v1/xvps/x1", closed, SUMMER_NOON)).toBe(true);
  });
  it("never blocks reads", () => {
    expect(businessWindowBlocks("GET", "/dlt/bdf/api/bridge/current-business-window", closed, SUMMER_NOON)).toBe(false);
  });
  it("never blocks non-official paths (admin/health/ui)", () => {
    expect(businessWindowBlocks("PUT", "/admin/business-window", closed, SUMMER_NOON)).toBe(false);
    expect(businessWindowBlocks("POST", "/admin/reset", closed, SUMMER_NOON)).toBe(false);
  });
  it("does not block when the window is open", () => {
    expect(businessWindowBlocks("POST", "/dlt/bdf/api/octopus/tms/funding-requests", bw(), SUMMER_NOON)).toBe(false);
  });
  it("recognises official API paths", () => {
    expect(isOfficialApiPath("/dlt/bdf/api/octopus/tms/funding-requests")).toBe(true);
    expect(isOfficialApiPath("/igw/bdf/v1/xvps")).toBe(true);
    expect(isOfficialApiPath("/admin/business-window")).toBe(false);
    expect(isOfficialApiPath("/check/health")).toBe(false);
  });
});

describe("validateBusinessWindowUpdate (issue #59)", () => {
  const current = bw();
  it("accepts a sub-list of fields", () => {
    expect(validateBusinessWindowUpdate({ currentWindow: "CLOSED" }, current)).toEqual({
      update: { currentWindow: "CLOSED" },
    });
    expect(validateBusinessWindowUpdate({ openTime: "09:00" }, current).update).toEqual({ openTime: "09:00" });
  });
  it("rejects unknown fields", () => {
    const r = validateBusinessWindowUpdate({ foo: "bar" }, current);
    expect(r.error).toMatch(/Unknown field/);
  });
  it("rejects an empty body", () => {
    expect(validateBusinessWindowUpdate({}, current).error).toMatch(/at least one/);
  });
  it("rejects a bad time format", () => {
    expect(validateBusinessWindowUpdate({ openTime: "9am" }, current).error).toMatch(/HH:mm/);
    expect(validateBusinessWindowUpdate({ closeTime: "25:00" }, current).error).toMatch(/HH:mm/);
  });
  it("rejects an invalid currentWindow", () => {
    expect(validateBusinessWindowUpdate({ currentWindow: "MAYBE" }, current).error).toMatch(/currentWindow/);
  });
  it("requires closeTime > openTime (against the merged result)", () => {
    expect(validateBusinessWindowUpdate({ closeTime: "07:00" }, current).error).toMatch(/must be greater/);
    expect(validateBusinessWindowUpdate({ openTime: "18:00", closeTime: "18:00" }, current).error).toMatch(/must be greater/);
    // Partial update compared against the stored openTime (08:00).
    expect(validateBusinessWindowUpdate({ closeTime: "07:30" }, current).error).toMatch(/must be greater/);
  });
  it("rejects a bad businessDate", () => {
    expect(validateBusinessWindowUpdate({ businessDate: "15-06-2026" }, current).error).toMatch(/YYYY-MM-DD/);
  });
});
