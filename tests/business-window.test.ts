/**
 * Business-day / business-window model (issues #59, #81).
 *
 * - The day is partitioned into Start of Day / Open for All / End of Day /
 *   Closed by the four boundary times, interpreted in Frankfurt (Europe/Berlin);
 * - the current window is derived from the wall-clock — never stored;
 * - admin updates accept a sub-list of day fields and must keep the times in
 *   increasing order;
 * - enforcement is spec-driven: each official operation is accessible only in
 *   the windows its spec description lists (e.g. bridge payments = Open for All
 *   only; transfer create = Start of Day / Open for All / End of Day, since its
 *   "(only for ISSUANCE/REDEMPTION)" qualifiers do not narrow an ordinary
 *   transfer — issue #94).
 */

import { describe, it, expect } from "@jest/globals";
import type { BusinessDay } from "../src/state/mock-store.js";
import {
  frankfurtTimeHHmm,
  currentWindow,
  nextWindowName,
  windowDisplayName,
  isBusinessOpen,
  validateBusinessDayUpdate,
} from "../src/state/business-window.js";
import {
  businessWindowDecision,
  isOfficialApiPath,
} from "../src/http/business-window-guard.js";
import { allowedWindowsForRequest, parseWindowList } from "../src/http/business-window-rules.js";

// A summer (CEST, UTC+2) business day. FFT = UTC + 2.
function day(overrides: Partial<BusinessDay> = {}): BusinessDay {
  return {
    businessDate: "2026-06-15",
    sodStart: "07:00",
    ofaStart: "09:00",
    ofaEnd: "17:00",
    eodEnd: "18:00",
    ...overrides,
  };
}
const AT_SOD = new Date("2026-06-15T06:30:00Z"); // 08:30 FFT
const AT_OFA = new Date("2026-06-15T10:00:00Z"); // 12:00 FFT
const AT_EOD = new Date("2026-06-15T15:30:00Z"); // 17:30 FFT
const CLOSED_AM = new Date("2026-06-15T04:00:00Z"); // 06:00 FFT
const CLOSED_PM = new Date("2026-06-15T16:30:00Z"); // 18:30 FFT

describe("frankfurtTimeHHmm", () => {
  it("renders the instant in Europe/Berlin, honouring DST", () => {
    expect(frankfurtTimeHHmm(AT_OFA)).toBe("12:00");
    expect(frankfurtTimeHHmm(new Date("2026-01-15T10:00:00Z"))).toBe("11:00"); // CET
  });
});

describe("currentWindow (issue #81)", () => {
  it("maps Frankfurt time onto the four windows with their bounds", () => {
    expect(currentWindow(day(), AT_SOD)).toMatchObject({
      name: "START_OF_DAY",
      displayName: "Start of Day",
      startTime: "07:00",
      endTime: "09:00",
      nextName: "OPEN_FOR_ALL",
    });
    expect(currentWindow(day(), AT_OFA)).toMatchObject({
      name: "OPEN_FOR_ALL",
      startTime: "09:00",
      endTime: "17:00",
      nextName: "END_OF_DAY",
    });
    expect(currentWindow(day(), AT_EOD)).toMatchObject({
      name: "END_OF_DAY",
      startTime: "17:00",
      endTime: "18:00",
      nextName: "CLOSED",
    });
  });
  it("is Closed before Start of Day and after End of Day (bounds wrap)", () => {
    expect(currentWindow(day(), CLOSED_AM)).toMatchObject({
      name: "CLOSED",
      startTime: "18:00",
      endTime: "07:00",
      nextName: "START_OF_DAY",
    });
    expect(currentWindow(day(), CLOSED_PM)).toMatchObject({ name: "CLOSED" });
  });
  it("treats window boundaries as half-open [start, end)", () => {
    // exactly 09:00 FFT → Open for All (not Start of Day)
    expect(currentWindow(day(), new Date("2026-06-15T07:00:00Z")).name).toBe("OPEN_FOR_ALL");
    // exactly 17:00 FFT → End of Day (not Open for All)
    expect(currentWindow(day(), new Date("2026-06-15T15:00:00Z")).name).toBe("END_OF_DAY");
  });
});

describe("nextWindowName / windowDisplayName", () => {
  it("follows the daily sequence and wraps Closed → Start of Day", () => {
    expect(nextWindowName("START_OF_DAY")).toBe("OPEN_FOR_ALL");
    expect(nextWindowName("OPEN_FOR_ALL")).toBe("END_OF_DAY");
    expect(nextWindowName("END_OF_DAY")).toBe("CLOSED");
    expect(nextWindowName("CLOSED")).toBe("START_OF_DAY");
  });
  it("renders display names", () => {
    expect(windowDisplayName("OPEN_FOR_ALL")).toBe("Open for All");
    expect(windowDisplayName("END_OF_DAY")).toBe("End of Day");
  });
});

describe("isBusinessOpen", () => {
  it("is open in any window other than Closed", () => {
    expect(isBusinessOpen(day(), AT_OFA)).toBe(true);
    expect(isBusinessOpen(day(), AT_SOD)).toBe(true);
    expect(isBusinessOpen(day(), CLOSED_AM)).toBe(false);
  });
  it("the sane defaults keep the day open essentially all day", () => {
    const wide = day({ sodStart: "00:00", ofaStart: "00:01", ofaEnd: "23:58", eodEnd: "23:59" });
    expect(isBusinessOpen(wide, AT_OFA)).toBe(true);
    expect(currentWindow(wide, AT_OFA).name).toBe("OPEN_FOR_ALL");
  });
});

describe("validateBusinessDayUpdate (issue #81)", () => {
  const current = day();
  it("accepts a sub-list of day fields", () => {
    expect(validateBusinessDayUpdate({ ofaStart: "10:00" }, current).update).toEqual({ ofaStart: "10:00" });
    expect(validateBusinessDayUpdate({ businessDate: "2026-07-01" }, current).update).toEqual({
      businessDate: "2026-07-01",
    });
  });
  it("rejects unknown fields (e.g. the old openTime/currentWindow)", () => {
    expect(validateBusinessDayUpdate({ openTime: "08:00" }, current).error).toMatch(/Unknown field/);
    expect(validateBusinessDayUpdate({ currentWindow: "CLOSED" }, current).error).toMatch(/Unknown field/);
  });
  it("rejects an empty body", () => {
    expect(validateBusinessDayUpdate({}, current).error).toMatch(/at least one/);
  });
  it("rejects a bad time / date format", () => {
    expect(validateBusinessDayUpdate({ sodStart: "7am" }, current).error).toMatch(/HH:mm/);
    expect(validateBusinessDayUpdate({ eodEnd: "25:00" }, current).error).toMatch(/HH:mm/);
    expect(validateBusinessDayUpdate({ businessDate: "15-06-2026" }, current).error).toMatch(/YYYY-MM-DD/);
  });
  it("requires the merged times to be in increasing order", () => {
    // ofaStart before sodStart
    expect(validateBusinessDayUpdate({ ofaStart: "06:00" }, current).error).toMatch(/increasing order/);
    // eodEnd before ofaEnd
    expect(validateBusinessDayUpdate({ eodEnd: "16:00" }, current).error).toMatch(/increasing order/);
    // equal adjacent times are allowed (a zero-length window)
    expect(validateBusinessDayUpdate({ ofaStart: "07:00" }, current).update).toEqual({ ofaStart: "07:00" });
  });
});

describe("allowedWindowsForRequest — spec-driven (issue #81)", () => {
  it("reads the per-operation window lists from the official spec", () => {
    // Transfer creation lists "Start of day (only for ISSUANCE) / Open for all /
    // End of day (only for REDEMPTION)"; the qualifiers do not narrow an ordinary
    // transfer, so all three windows are accessible (#94).
    const transfer = allowedWindowsForRequest("POST", "/dlt/bdf/api/octopus/rvs/transactions-requests");
    expect(transfer?.has("START_OF_DAY")).toBe(true);
    expect(transfer?.has("OPEN_FOR_ALL")).toBe(true);
    expect(transfer?.has("END_OF_DAY")).toBe(true);
    expect(transfer?.has("CLOSED")).toBe(false);
    expect([...(allowedWindowsForRequest("POST", "/dlt/bdf/api/bridge/payments") ?? [])]).toEqual(["OPEN_FOR_ALL"]);
    const reads = allowedWindowsForRequest("GET", "/dlt/bdf/api/octopus/ams/wallets");
    expect(reads?.has("START_OF_DAY")).toBe(true);
    expect(reads?.has("OPEN_FOR_ALL")).toBe(true);
    expect(reads?.has("END_OF_DAY")).toBe(true);
    expect(reads?.has("CLOSED")).toBe(false);
  });
  it("returns undefined for operations without a window rule", () => {
    expect(allowedWindowsForRequest("GET", "/dlt/bdf/api/octopus/health")).toBeUndefined();
    expect(allowedWindowsForRequest("GET", "/dlt/bdf/api/nonsense")).toBeUndefined();
  });
});

describe("parseWindowList", () => {
  it("parses a Business Window bullet list", () => {
    const set = parseWindowList("## Business Rules\nBusiness Window:\n  - Start of day\n  - Open for all\n");
    expect([...(set ?? [])].sort()).toEqual(["OPEN_FOR_ALL", "START_OF_DAY"]);
  });
  it("keeps every window when entries carry a (only for …) qualifier (#94)", () => {
    const set = parseWindowList(
      "Business Window:\n  - Start of day (only for ISSUANCE)\n  - Open for all\n  - End of day (only for REDEMPTION)\nWorkflow:",
    );
    expect([...(set ?? [])].sort()).toEqual(["END_OF_DAY", "OPEN_FOR_ALL", "START_OF_DAY"]);
  });
  it("returns undefined when absent", () => {
    expect(parseWindowList("no window section here")).toBeUndefined();
  });
});

describe("businessWindowDecision (issue #81)", () => {
  it("allows transfer creation through the whole trading day (#94)", () => {
    // The "(only for ISSUANCE/REDEMPTION)" qualifiers don't narrow an ordinary
    // transfer, so it is accessible in Start of Day, Open for All and End of Day.
    expect(businessWindowDecision("POST", "/dlt/bdf/api/octopus/rvs/transactions-requests", day(), AT_SOD).blocked).toBe(
      false,
    );
    expect(businessWindowDecision("POST", "/dlt/bdf/api/octopus/rvs/transactions-requests", day(), AT_OFA).blocked).toBe(
      false,
    );
  });
  it("blocks transfer creation only when Closed", () => {
    const d = businessWindowDecision("POST", "/dlt/bdf/api/octopus/rvs/transactions-requests", day(), CLOSED_AM);
    expect(d.blocked).toBe(true);
    expect(d.windowName).toBe("Closed");
    expect(d.allowed).toEqual(["Start of Day", "Open for All", "End of Day"]);
  });
  it("blocks bridge payments outside Open for All", () => {
    expect(businessWindowDecision("POST", "/dlt/bdf/api/bridge/payments", day(), AT_SOD).blocked).toBe(true);
    expect(businessWindowDecision("POST", "/dlt/bdf/api/bridge/payments", day(), AT_OFA).blocked).toBe(false);
  });
  it("blocks reads only when Closed", () => {
    expect(businessWindowDecision("GET", "/dlt/bdf/api/octopus/ams/wallets", day(), AT_OFA).blocked).toBe(false);
    expect(businessWindowDecision("GET", "/dlt/bdf/api/octopus/ams/wallets", day(), CLOSED_AM).blocked).toBe(true);
  });
  it("never blocks the bridge current-business-window read (accessible incl. Closed)", () => {
    expect(
      businessWindowDecision("GET", "/dlt/bdf/api/bridge/current-business-window", day(), CLOSED_AM).blocked,
    ).toBe(false);
  });
  it("never gates health, unknown, or non-official paths", () => {
    expect(businessWindowDecision("GET", "/dlt/bdf/api/octopus/health", day(), CLOSED_AM).blocked).toBe(false);
    expect(businessWindowDecision("POST", "/admin/business-window", day(), CLOSED_AM).blocked).toBe(false);
    expect(businessWindowDecision("GET", "/check/ip", day(), CLOSED_AM).blocked).toBe(false);
  });
  it("recognises official API paths", () => {
    expect(isOfficialApiPath("/dlt/bdf/api/octopus/tms/funding-requests")).toBe(true);
    expect(isOfficialApiPath("/igw/bdf/v1/xvps")).toBe(true);
    expect(isOfficialApiPath("/admin/business-window")).toBe(false);
  });
});
