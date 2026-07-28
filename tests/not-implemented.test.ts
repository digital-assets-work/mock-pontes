/**
 * Not-Implemented signalling (issue #62 / F-09).
 *
 * Pure matcher tests: an official-but-unimplemented operation is recognised so
 * the middleware can return 501; truly unknown paths are not, so they still 404.
 */

import { describe, it, expect } from "@jest/globals";
import { findOfficialOp, findUnimplementedOp } from "../src/http/not-implemented.js";

const EXTRACT = "/dlt/bdf/api/octopus/tms/funding-defunding-requests/extract";
const EXTRACT_KEY = "POST /dlt/{}/api/octopus/tms/funding-defunding-requests/extract";
const FUNDING_KEY = "POST /dlt/{}/api/octopus/tms/funding-requests";

describe("findOfficialOp (issue #62)", () => {
  it("matches a concrete path to its official template", () => {
    const op = findOfficialOp("POST", EXTRACT);
    expect(op?.template).toBe("/dlt/{ncb}/api/octopus/tms/funding-defunding-requests/extract");
    expect(op?.key).toBe(EXTRACT_KEY);
  });

  it("resolves the literal `extract` sub-resource for POST (not shadowed)", () => {
    const op = findOfficialOp("POST", EXTRACT);
    expect(op?.template).toBe("/dlt/{ncb}/api/octopus/tms/funding-defunding-requests/extract");
  });

  it("is method-sensitive (no PATCH op on that path)", () => {
    expect(findOfficialOp("PATCH", EXTRACT)).toBeUndefined();
  });

  it("returns undefined for a path outside the official surface", () => {
    expect(findOfficialOp("GET", "/dlt/bdf/api/octopus/tms/not-a-real-endpoint")).toBeUndefined();
    expect(findOfficialOp("GET", "/totally/unknown")).toBeUndefined();
  });
});

describe("findUnimplementedOp (issue #62)", () => {
  it("flags a declared official op that is not in the implemented set", () => {
    const op = findUnimplementedOp("POST", EXTRACT, new Set());
    expect(op?.template).toBe("/dlt/{ncb}/api/octopus/tms/funding-defunding-requests/extract");
  });

  it("does not flag an op that IS implemented", () => {
    const implemented = new Set([EXTRACT_KEY]);
    expect(findUnimplementedOp("POST", EXTRACT, implemented)).toBeUndefined();
  });

  it("does not flag a non-official path (so it can 404 normally)", () => {
    expect(findUnimplementedOp("POST", "/dlt/bdf/api/octopus/tms/nope", new Set())).toBeUndefined();
  });

  it("treats a genuinely implemented official create as implemented", () => {
    // funding-requests POST is implemented by the mock; with its key present it
    // must not be reported as unimplemented.
    const implemented = new Set([FUNDING_KEY]);
    expect(findUnimplementedOp("POST", "/dlt/bdf/api/octopus/tms/funding-requests", implemented)).toBeUndefined();
  });
});
