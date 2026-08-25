/**
 * Request-body validation (issue #53 / F-01): create bodies are validated
 * against the official request schemas, invalid amounts / missing required
 * fields are rejected, unknown fields are ignored, and the mock-only
 * `supplementaryData` field is accepted.
 */

import { describe, it, expect } from "@jest/globals";
import {
  schemaForRequest,
  validateRequestBody,
  currencyError,
  moneyPrecisionErrors,
  MONEY_PATTERN,
} from "../src/http/request-validation.js";
function validFunding() {
  return {
    type: "FUNDING",
    techFundRequestID: "F1",
    amount: "1000.00",
    currency: "EUR",
    creditedCashWalletAlias: "W-01",
    creditedCashWalletManagerID: "MARKDEFFXXX",
    creditedCashWalletOwnerID: "BSUIFRPPXXX",
    debitedCashWalletAlias: "ISSUANCE",
    debitedCashWalletManagerID: "ECBFDEFFXXX",
    debitedCashWalletOwnerID: "ECBFDEFFXXX",
    signature: "sig",
    signerPEM: "pem",
  };
}

const FUNDING = "triggermanagement.CreateFundingRequest";
const codes = (b: unknown) => validateRequestBody(FUNDING, b).map((e) => e.errorDescription);

describe("currencyError (issue #80)", () => {
  it("rejects a non-EUR currency", () => {
    expect(currencyError({ currency: "USD" })?.errorCode).toBe("HL-VAL-001");
    expect(currencyError({ currency: "USD" })?.errorDescription).toMatch(/Unsupported currency 'USD'/);
    expect(currencyError({ currency: "gbp" })?.errorCode).toBe("HL-VAL-001");
  });
  it("accepts EUR or an absent currency", () => {
    expect(currencyError({ currency: "EUR" })).toBeNull();
    expect(currencyError({})).toBeNull();
    expect(currencyError({ amount: "1.00" })).toBeNull();
    expect(currencyError(undefined)).toBeNull();
  });
});

describe("moneyPrecisionErrors (issue #97)", () => {
  const TRANSFER = "requestvalidation.CreateOperationRequest";
  it("rejects an over-precise transfer amountTransferred (>2 decimals)", () => {
    const errs = moneyPrecisionErrors(TRANSFER, { amountTransferred: "10.123" });
    expect(errs).toHaveLength(1);
    expect(errs[0].errorCode).toBe("HL-VAL-001");
    expect(errs[0].errorDescription).toMatch(/amountTransferred/);
  });
  it("accepts a 0/1/2-decimal transfer amount", () => {
    expect(moneyPrecisionErrors(TRANSFER, { amountTransferred: "10" })).toEqual([]);
    expect(moneyPrecisionErrors(TRANSFER, { amountTransferred: "10.5" })).toEqual([]);
    expect(moneyPrecisionErrors(TRANSFER, { amountTransferred: "10.50" })).toEqual([]);
  });
  it("does not double-report `amount` fields the schema already patterns", () => {
    // Funding `amount` carries a spec pattern (ajv covers it), so the overlay
    // must add nothing — avoiding a duplicate HL-VAL-001 for the same field.
    expect(moneyPrecisionErrors(FUNDING, { amount: "10.123" })).toEqual([]);
  });
  it("uses the canonical 2-decimal money pattern", () => {
    expect(MONEY_PATTERN.test("10.12")).toBe(true);
    expect(MONEY_PATTERN.test("10.123")).toBe(false);
  });
});

describe("schemaForRequest (issue #53)", () => {
  it("maps the create write endpoints (realm collapsed)", () => {
    expect(schemaForRequest("POST", "/dlt/bdf/api/octopus/tms/funding-requests")).toBe(FUNDING);
    expect(schemaForRequest("POST", "/dlt/ecb/api/octopus/tms/defunding-requests")).toBe("triggermanagement.CreateDefundingRequest");
    expect(schemaForRequest("POST", "/dlt/bdf/api/octopus/rvs/transactions-requests")).toBe("requestvalidation.CreateOperationRequest");
    expect(schemaForRequest("POST", "/igw/bdf/v1/xvps")).toBe("XvPInitRequest");
  });
  it("does not validate reads or the approve/cancel transitions", () => {
    expect(schemaForRequest("GET", "/dlt/bdf/api/octopus/ams/wallets")).toBeUndefined();
    expect(schemaForRequest("PUT", "/dlt/bdf/api/octopus/tms/funding-requests-drafts/FRQ1/approve")).toBeUndefined();
  });
});

describe("validateRequestBody — funding create (issue #53)", () => {
  it("accepts a valid body", () => {
    expect(validateRequestBody(FUNDING, validFunding())).toEqual([]);
  });

  it("rejects a negative amount", () => {
    expect(codes({ ...validFunding(), amount: "-500.00" }).join()).toMatch(/amount/);
  });
  it("rejects a non-numeric amount", () => {
    expect(codes({ ...validFunding(), amount: "banana" }).join()).toMatch(/amount/);
  });
  it("rejects an over-precision amount (3 decimals)", () => {
    expect(codes({ ...validFunding(), amount: "10.999" }).join()).toMatch(/amount/);
  });

  it("rejects missing required fields", () => {
    const { type, debitedCashWalletAlias, ...rest } = validFunding();
    const errs = codes(rest).join();
    expect(errs).toMatch(/type/);
    expect(errs).toMatch(/debitedCashWalletAlias/);
  });

  it("ignores unknown extra fields", () => {
    expect(validateRequestBody(FUNDING, { ...validFunding(), somethingUnknown: "x" })).toEqual([]);
  });

  it("accepts the mock-only supplementaryData field", () => {
    expect(validateRequestBody(FUNDING, { ...validFunding(), supplementaryData: "free text" })).toEqual([]);
  });

  it("ignores extras even on a sealed schema (XvP additionalProperties:false)", () => {
    // The XvP schema sets additionalProperties:false; validation must still not
    // reject unknown / supplementaryData fields (issue #53 policy).
    const errs = validateRequestBody("XvPInitRequest", { supplementaryData: "x", unknownField: 1 })
      .map((e) => e.errorDescription)
      .join(" ");
    expect(errs).not.toMatch(/additional/i);
  });
});

describe("XvP validator compiles despite the ECB `{1, 15}` quantifier typo", () => {
  const validXvp = {
    seller: { bic: "SELLFRPPXXX", marketDLTOperator: "MARKDEFFXXX" },
    buyer: { bic: "BUYRDEFFXXX" },
    amount: "10000.50",
    currency: "EUR",
    type: "DVP",
  };

  it("accepts a valid XvP init body (validator is active, not failed-open)", () => {
    expect(validateRequestBody("XvPInitRequest", validXvp)).toEqual([]);
  });

  it("reports missing required fields — proving validation runs, not skipped", () => {
    const errs = validateRequestBody("XvPInitRequest", { amount: "10.00", currency: "EUR", type: "DVP" })
      .map((e) => e.errorDescription)
      .join(" ");
    expect(errs).toMatch(/seller/);
    expect(errs).toMatch(/buyer/);
  });

  it("enforces the amount pattern once the quantifier is normalised", () => {
    const errs = validateRequestBody("XvPInitRequest", { ...validXvp, amount: "10.123" })
      .map((e) => e.errorDescription)
      .join(" ");
    expect(errs).toMatch(/amount/i);
  });
});
