/**
 * Error-response normalisation tests (issue #33).
 *
 * Verifies every error collapses to the official
 * `{ status, title, businessErrors: [{ errorCode, errorDescription }] }` shape,
 * preserves `errorCode`, never carries a `stack`, and keeps the OAuth shape only
 * on the IAM token endpoint.
 */

import { describe, it, expect } from "@jest/globals";
import {
  toErrorResponse,
  titleForStatus,
  normalizeReturnedErrorBody,
  normalizeThrownError,
  isErrorResponseShape,
} from "../src/http/error-response.js";

describe("toErrorResponse (issue #33)", () => {
  it("builds the official shape and preserves errorCode", () => {
    const r = toErrorResponse(422, [
      { errorCode: "HL-BAL-001", errorDescription: "Insufficient funds" },
    ]);
    expect(r).toEqual({
      status: 422,
      title: "Unprocessable Entity",
      businessErrors: [
        { errorCode: "HL-BAL-001", errorDescription: "Insufficient funds" },
      ],
    });
    expect("stack" in r).toBe(false);
  });

  it("synthesises a business error when none is supplied", () => {
    const r = toErrorResponse(404, undefined, "Draft X not found");
    expect(r.status).toBe(404);
    expect(r.title).toBe("Not Found");
    expect(r.businessErrors).toEqual([
      { errorCode: "HL-GER-001", errorDescription: "Draft X not found" },
    ]);
  });

  it("fills a fallback errorCode for a business error missing one", () => {
    const r = toErrorResponse(409, [{ errorDescription: "dupe" }]);
    expect(r.businessErrors[0].errorCode).toBe("HL-GER-004");
  });

  it("maps titles for the standard statuses", () => {
    expect(titleForStatus(400)).toBe("Bad Request");
    expect(titleForStatus(401)).toBe("Unauthorized");
    expect(titleForStatus(403)).toBe("Forbidden");
    expect(titleForStatus(404)).toBe("Not Found");
    expect(titleForStatus(409)).toBe("Conflict");
    expect(titleForStatus(422)).toBe("Unprocessable Entity");
  });
});

describe("normalizeReturnedErrorBody (issue #33)", () => {
  it("leaves success responses untouched", () => {
    expect(normalizeReturnedErrorBody(200, "/dlt/x", { ok: true })).toBeNull();
  });

  it("reshapes a bare {businessErrors} body (NRO 400) and keeps errorCode", () => {
    const r = normalizeReturnedErrorBody(400, "/dlt/x", {
      businessErrors: [
        { errorCode: "HL-NRO-003", errorDescription: "bad sig" },
      ],
    });
    expect(r).toEqual({
      status: 400,
      title: "Bad Request",
      businessErrors: [
        { errorCode: "HL-NRO-003", errorDescription: "bad sig" },
      ],
    });
  });

  it("normalises the JWT 401 OAuth body on /dlt", () => {
    const r = normalizeReturnedErrorBody(401, "/dlt/bdf/api/octopus", {
      error: "invalid_token",
      error_description: "Token has expired",
    });
    expect(r).toEqual({
      status: 401,
      title: "Unauthorized",
      businessErrors: [
        { errorCode: "HL-ATH-001", errorDescription: "Token has expired" },
      ],
    });
  });

  it("KEEPS the OAuth shape on the IAM token endpoint", () => {
    const r = normalizeReturnedErrorBody(
      401,
      "/iam/realms/bdf/protocol/openid-connect/token",
      { error: "invalid_grant", error_description: "bad creds" },
    );
    expect(r).toBeNull();
  });

  it("leaves an already-normalised body unchanged", () => {
    const already = {
      status: 409,
      title: "Conflict",
      businessErrors: [{ errorCode: "HL-GER-004", errorDescription: "dupe" }],
    };
    expect(isErrorResponseShape(already)).toBe(true);
    expect(normalizeReturnedErrorBody(409, "/dlt/x", already)).toBeNull();
  });
});

describe("normalizeThrownError (issue #33)", () => {
  it("reshapes an H3 createError with data.businessErrors (409) and drops stack", () => {
    const err = {
      statusCode: 409,
      statusMessage: "Conflict",
      stack: "Error: boom\n  at ...",
      data: {
        businessErrors: [
          { errorCode: "HL-GER-002", errorDescription: "bad state" },
        ],
      },
    };
    const r = normalizeThrownError(err);
    expect(r).toEqual({
      status: 409,
      title: "Conflict",
      businessErrors: [
        { errorCode: "HL-GER-002", errorDescription: "bad state" },
      ],
    });
    expect("stack" in r).toBe(false);
  });

  it("handles a framework 404 with no data", () => {
    const r = normalizeThrownError({
      statusCode: 404,
      statusMessage: "Cannot find any path matching /nope.",
    });
    expect(r.status).toBe(404);
    expect(r.businessErrors[0].errorCode).toBe("HL-GER-001");
    expect(r.businessErrors[0].errorDescription).toContain("Cannot find");
  });

  it("defaults to 500 for an error without a status", () => {
    const r = normalizeThrownError({ message: "boom" });
    expect(r.status).toBe(500);
    expect(r.title).toBe("Internal Server Error");
    expect(r.businessErrors[0].errorDescription).toBe("boom");
  });
});
