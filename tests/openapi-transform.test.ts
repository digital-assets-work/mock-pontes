/**
 * OpenAPI transform tests (issue #34).
 */

import { describe, it, expect } from "@jest/globals";
import {
  normalizePath,
  registeredKeySet,
  track,
  recordRoute,
} from "../src/http/route-registry.js";
import { annotateSpec, mockExtras, SUPPLEMENTARY_DATA_SCHEMAS } from "../src/ui/openapi.js";

describe("normalizePath (issue #34)", () => {
  it("collapses :param and {param} to {} (param-name-agnostic)", () => {
    expect(normalizePath("/dlt/:ncb/api/octopus/ams/wallets")).toBe(
      "/dlt/{}/api/octopus/ams/wallets",
    );
    expect(
      normalizePath("/dlt/{ncb}/api/octopus/rvs/transactions-drafts/{instructionID}/{status}"),
    ).toBe("/dlt/{}/api/octopus/rvs/transactions-drafts/{}/{}");
  });

  it("matches an h3 route against the official path template", () => {
    expect(normalizePath("/dlt/:ncb/api/octopus/tms/funding-requests-drafts/:id/:status")).toBe(
      normalizePath("/dlt/{ncb}/api/octopus/tms/funding-requests-drafts/{id}/{status}"),
    );
  });
});

describe("route registry track()/registeredKeySet (issue #34)", () => {
  it("records routes registered through a tracked router", () => {
    const calls: string[] = [];
    const fakeRouter = {
      get(p: string) {
        calls.push(`GET ${p}`);
        return this;
      },
      post(p: string) {
        calls.push(`POST ${p}`);
        return this;
      },
      put(p: string) {
        calls.push(`PUT ${p}`);
        return this;
      },
      delete(p: string) {
        calls.push(`DELETE ${p}`);
        return this;
      },
    };
    const r = track(fakeRouter as any);
    r.get("/dlt/:ncb/api/octopus/ams/wallets", () => {});
    r.post("/dlt/:ncb/api/octopus/tms/funding-requests", () => {});

    // Delegation still happens.
    expect(calls).toEqual([
      "GET /dlt/:ncb/api/octopus/ams/wallets",
      "POST /dlt/:ncb/api/octopus/tms/funding-requests",
    ]);

    const keys = registeredKeySet();
    expect(keys.has("GET /dlt/{}/api/octopus/ams/wallets")).toBe(true);
    expect(keys.has("POST /dlt/{}/api/octopus/tms/funding-requests")).toBe(true);
  });
});

describe("annotateSpec (issue #34)", () => {
  function fakeOfficial() {
    return {
      openapi: "3.0.3",
      info: { title: "Official", version: "1.0.0", description: "Official EII." },
      paths: {
        "/dlt/{ncb}/api/octopus/ams/wallets": {
          get: { tags: ["Wallets"], responses: { "200": { description: "ok" } } },
        },
        "/dlt/{ncb}/api/octopus/grs/entities-drafts/{id}/{status}": {
          put: { tags: ["GRS"], responses: { "200": { description: "ok" } } },
        },
      },
      components: {
        schemas: { ErrorResponse: { type: "object" } },
      },
      tags: [{ name: "Wallets" }, { name: "GRS" }],
    };
  }

  it("marks implemented ops and leaves them untagged", () => {
    const implemented = new Set(["GET /dlt/{}/api/octopus/ams/wallets"]);
    const spec = annotateSpec(fakeOfficial(), implemented, "9.9.9");
    const op = spec.paths["/dlt/{ncb}/api/octopus/ams/wallets"].get;
    expect(op["x-mock-implemented"]).toBe(true);
    expect(op.tags).toEqual(["Wallets"]);
    // default error response referencing ErrorResponse
    expect(op.responses.default.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/ErrorResponse",
    );
  });

  it("tags unimplemented ops NotImplemented + x-mock-implemented:false", () => {
    const spec = annotateSpec(fakeOfficial(), new Set(), "9.9.9");
    const op = spec.paths["/dlt/{ncb}/api/octopus/grs/entities-drafts/{id}/{status}"].put;
    expect(op["x-mock-implemented"]).toBe(false);
    expect(op.tags[0]).toBe("NotImplemented");
    expect(op.tags).toContain("GRS");
    expect(op.description).toContain("Not implemented by this mock");
  });

  it("merges the mock-only extras and stamps info", () => {
    const spec = annotateSpec(fakeOfficial(), new Set(), "9.9.9");
    expect(spec.paths["/admin/reset"]).toBeDefined();
    expect(spec.paths["/iam/realms/{ncb}/protocol/openid-connect/csr"]).toBeDefined();
    // The token endpoint every client must call is documented (issue #88).
    const token = spec.paths["/iam/realms/{ncb}/protocol/openid-connect/token"];
    expect(token?.post).toBeDefined();
    expect(token.post.requestBody.content["application/x-www-form-urlencoded"].schema.$ref).toBe(
      "#/components/schemas/TokenRequest",
    );
    expect(token.post.responses["200"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/TokenResponse",
    );
    expect(spec.components.schemas.TokenRequest).toBeDefined();
    expect(spec.components.schemas.TokenResponse).toBeDefined();
    // Wire fidelity carried into the doc (issue #87).
    expect(spec.components.schemas.TokenResponse.properties).toHaveProperty("not-before-policy");
    expect(spec.components.schemas.CsrRequest).toBeDefined();
    expect(spec.components.schemas.EnrolledUser).toBeDefined();
    expect(spec.tags.some((t: any) => t.name === "NotImplemented")).toBe(true);
    expect(spec.info.version).toBe("9.9.9");
    expect(spec.info.title).toContain("Mock Pontes");
  });

  it("exposes the mock-only paths via mockExtras", () => {
    expect(Object.keys(mockExtras.paths)).toContain("/admin/reset");
    expect(Object.keys(mockExtras.paths)).toContain("/check/mtls");
  });

  it("annotates supplementaryData onto the confirmed-but-undocumented schemas", () => {
    const spec = fakeOfficial() as any;
    spec.components.schemas["bridge.PaymentRequest"] = {
      type: "object",
      properties: { amount: { type: "string" } },
    };
    spec.components.schemas["requestvalidation.CreateOperationRequest"] = { type: "object", properties: {} };
    spec.components.schemas["requestvalidation.OperationRequest"] = { type: "object", properties: {} };

    const annotated = annotateSpec(spec, new Set(), "9.9.9");

    for (const name of SUPPLEMENTARY_DATA_SCHEMAS) {
      const prop = annotated.components.schemas[name].properties.supplementaryData;
      expect(prop.type).toBe("string");
      expect(prop.description).toContain("ECB support");
    }
    // Pre-existing properties are untouched.
    expect(annotated.components.schemas["bridge.PaymentRequest"].properties.amount).toEqual({ type: "string" });
  });

  it("skips supplementaryData annotation when a confirmed-but-undocumented schema is absent (no crash)", () => {
    expect(() => annotateSpec(fakeOfficial(), new Set(), "9.9.9")).not.toThrow();
  });
});
