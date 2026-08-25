/**
 * NRO route derivation (issue #102).
 *
 * NRO enforcement is derived from the vendored OpenAPI spec: a POST/PUT operation
 * requires NRO iff its request schema carries `signature`/`signerPEM` (equivalently
 * it documents a `## Signing Rules:` section). This test pins the derived set so
 * enforcement stays aligned with the contract — the ECB signs exactly the writes
 * that update RTGS directly.
 */

import { describe, it, expect } from "@jest/globals";
import { deriveNroRouteMatchers } from "../src/auth/nro-middleware.js";

const matchers = deriveNroRouteMatchers();
const nroRequired = (method: "POST" | "PUT", path: string): boolean =>
  matchers.some((m) => m.method === method && m.regex.test(path));

const NCB = "bdf";

describe("deriveNroRouteMatchers (issue #102)", () => {
  it("derives exactly the 8 NRO-signed operations from the spec", () => {
    // 4 creates + 3 draft transitions + 1 direct-RTGS XvP payment.
    expect(matchers).toHaveLength(8);
  });

  it("enforces NRO on the RTGS-affecting creates", () => {
    expect(nroRequired("POST", `/dlt/${NCB}/api/octopus/tms/funding-requests`)).toBe(true);
    expect(nroRequired("POST", `/dlt/${NCB}/api/octopus/tms/defunding-requests`)).toBe(true);
    expect(nroRequired("POST", `/dlt/${NCB}/api/octopus/tms/direct-rtgs/payments`)).toBe(true);
    expect(nroRequired("POST", `/dlt/${NCB}/api/bridge/direct-rtgs/payments`)).toBe(true);
  });

  it("enforces NRO on the draft approve/cancel transitions the spec signs (GAP-2)", () => {
    expect(nroRequired("PUT", `/dlt/${NCB}/api/octopus/tms/funding-requests-drafts/FRQ1/approve`)).toBe(true);
    expect(nroRequired("PUT", `/dlt/${NCB}/api/octopus/tms/defunding-requests-drafts/DRQ1/cancel`)).toBe(true);
    expect(nroRequired("PUT", `/dlt/${NCB}/api/octopus/tms/direct-rtgs/payments-drafts/DRTGS1/approve`)).toBe(true);
  });

  it("enforces NRO on the direct-RTGS XvP payment the spec signs (GAP-2)", () => {
    expect(nroRequired("POST", `/igw/${NCB}/v1/direct-rtgs/xvps/XVP1/payment`)).toBe(true);
  });

  it("does NOT enforce NRO on XvP init — the spec models no Signing Rules there (GAP-1)", () => {
    expect(nroRequired("POST", `/igw/${NCB}/v1/xvps`)).toBe(false);
    expect(nroRequired("POST", `/igw/${NCB}/v1/direct-rtgs/xvps`)).toBe(false);
  });

  it("does NOT enforce NRO where the spec carries no signature fields", () => {
    // The non-RTGS XvP payment settles via a preimage, not NRO.
    expect(nroRequired("POST", `/igw/${NCB}/v1/xvps/XVP1/payment`)).toBe(false);
    // Cash-token (1-step) bridge payments and the PFoD legs are unsigned.
    expect(nroRequired("POST", `/dlt/${NCB}/api/bridge/payments`)).toBe(false);
    expect(nroRequired("POST", `/dlt/${NCB}/api/bridge/initpfoddeli`)).toBe(false);
    expect(nroRequired("POST", `/dlt/${NCB}/api/bridge/initpfodrece`)).toBe(false);
  });

  it("the init matcher does not leak into its sub-paths", () => {
    // `/xvps` must not match `/xvps/{id}` or `/xvps/{id}/payment`.
    expect(nroRequired("POST", `/dlt/${NCB}/api/octopus/tms/funding-requests`)).toBe(true);
    expect(nroRequired("POST", `/dlt/${NCB}/api/octopus/tms/funding-requests-drafts/FRQ1/approve`)).toBe(false);
  });
});
