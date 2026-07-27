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
import { annotateSpec, mockExtras } from "../src/ui/openapi.js";

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
});
