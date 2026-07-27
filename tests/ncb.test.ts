/**
 * NCB path-parameter validation tests (issue #36).
 */

import { describe, it, expect, afterEach } from "@jest/globals";
import type { H3Event } from "h3";
import {
  isValidNcb,
  extractNcb,
  OFFICIAL_NCBS,
  createNcbValidationMiddleware,
} from "../src/auth/ncb-middleware.js";

const ORIGINAL = process.env.PONTES_MOCK_LENIENT_NCB;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PONTES_MOCK_LENIENT_NCB;
  else process.env.PONTES_MOCK_LENIENT_NCB = ORIGINAL;
});

function fakeEvent(path: string): H3Event {
  return {
    path,
    node: { req: { headers: {} }, res: { statusCode: 200 } },
  } as unknown as H3Event;
}

describe("isValidNcb (issue #36)", () => {
  it("accepts official NCBs case-insensitively", () => {
    expect(isValidNcb("BDF")).toBe(true);
    expect(isValidNcb("bdf")).toBe(true);
    expect(isValidNcb("Bdf")).toBe(true);
    expect(isValidNcb("ecb")).toBe(true);
  });
  it("rejects unknown NCBs", () => {
    expect(isValidNcb("ZZZZ")).toBe(false);
    expect(isValidNcb("")).toBe(false);
  });
  it("has the 23 official short names", () => {
    expect(OFFICIAL_NCBS).toHaveLength(23);
  });
});

describe("extractNcb (issue #36)", () => {
  it("extracts the ncb segment from /dlt and /igw", () => {
    expect(extractNcb("/dlt/bdf/api/octopus/ams/wallets")).toBe("bdf");
    expect(extractNcb("/igw/ecb/v1/xvps")).toBe("ecb");
  });
  it("returns null for non-ncb-scoped paths", () => {
    expect(extractNcb("/ui/docs")).toBeNull();
    expect(extractNcb("/iam/realms/bdf/protocol/openid-connect/token")).toBeNull();
    expect(extractNcb("/")).toBeNull();
  });
});

describe("createNcbValidationMiddleware (issue #36)", () => {
  const mw = createNcbValidationMiddleware() as unknown as (
    e: H3Event,
  ) => unknown;

  it("passes a valid ncb through (any case)", () => {
    const ev = fakeEvent("/dlt/BDF/api/octopus/ams/wallets");
    expect(mw(ev)).toBeUndefined();
    expect(ev.node.res.statusCode).toBe(200);
  });

  it("404s an unknown ncb with a normalisable error body", () => {
    const ev = fakeEvent("/dlt/ZZZZ/api/octopus/ams/wallets");
    const body = mw(ev) as { businessErrors: { errorCode: string }[] };
    expect(ev.node.res.statusCode).toBe(404);
    expect(body.businessErrors[0].errorCode).toBe("HL-GER-001");
  });

  it("ignores non-ncb-scoped paths", () => {
    expect(mw(fakeEvent("/ui/docs"))).toBeUndefined();
  });

  it("is bypassed by PONTES_MOCK_LENIENT_NCB=true", () => {
    process.env.PONTES_MOCK_LENIENT_NCB = "true";
    const ev = fakeEvent("/dlt/ZZZZ/api/octopus/ams/wallets");
    expect(mw(ev)).toBeUndefined();
    expect(ev.node.res.statusCode).toBe(200);
  });
});
