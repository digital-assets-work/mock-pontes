/**
 * Served OpenAPI builder (issue #34).
 *
 * The mock no longer maintains a hand-written spec (which drifted to 39 paths /
 * 2 schemas). Instead the served `GET /openapi.json` is derived at runtime from
 * the vendored **official** ECB Pontes EII spec (full request/response/error
 * schemas), annotated against the routes this mock actually declares:
 *
 *   - operations the mock implements keep the official schemas and get
 *     `x-mock-implemented: true`;
 *   - operations it does not implement are tagged `NotImplemented` and get
 *     `x-mock-implemented: false` (kept visible, not removed);
 *   - every operation gains a default error response referencing the official
 *     `ErrorResponse` (issue #33);
 *   - the mock-only helpers (CSR enrolment, connectivity checks, `/admin/**`)
 *     are appended under `Mock ·` tags so they stay documented.
 *
 * The implemented-set comes from the {@link registeredKeySet} route registry —
 * populated as routes are declared — so it cannot drift from the live routes.
 * The pristine official spec remains available at `/openapi/official.json`.
 */

import officialSpec from "./spec/pontes-official-v1.0.json";
import { registeredKeySet, normalizePath } from "../http/route-registry.js";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"];

const MOCK_INFO_DESCRIPTION =
  "Served by **mock-pontes**. This is the official ECB Pontes Pilot *EII API* " +
  "OpenAPI, dynamically annotated: operations this mock does not implement are " +
  "tagged `NotImplemented` (`x-mock-implemented: false`) and, when called, return " +
  "**`501 Not Implemented`** (not a generic `404`) so \"try it out\" is self-" +
  "explanatory (issue #62). Mock-only helpers (CSR enrolment, connectivity " +
  "checks, `/admin/**`) are appended under `Mock ·` tags. The pristine official " +
  "spec is at `/openapi/official.json`.";

const NCB_PARAM = {
  name: "ncb",
  in: "path",
  required: true,
  schema: { type: "string", example: "bdf" },
  description: "Managing NCB / ORG id (lowercase in the path)",
};

/**
 * Mock-only additions (not present in the official spec) merged into the served
 * document so the mock's own helpers stay documented. Parameters are inlined to
 * avoid colliding with the official component parameters.
 */
export const mockExtras = {
  tags: [
    {
      name: "NotImplemented",
      description:
        "Declared by the official ECB Pontes API but NOT implemented by this mock.",
    },
    {
      name: "Mock · Connectivity",
      description: "Mock-only connectivity checks (no official equivalent).",
    },
    {
      name: "Mock · Enrollment",
      description:
        "Mock-only local CA that signs submitted CSRs and lists enrolled users. " +
        "On real Pontes, certificates are issued by the TARGET Service Desk — there is no such API.",
    },
    {
      name: "Mock · Admin",
      description: "Mock-only state-simulation API (business window, reset).",
    },
  ],
  paths: {
    "/check/ip": {
      get: {
        tags: ["Mock · Connectivity"],
        summary: "MOCK: IP whitelisting check",
        responses: { "200": { description: "Caller source IP" } },
      },
    },
    "/check/mtls": {
      get: {
        tags: ["Mock · Connectivity"],
        summary: "MOCK: mTLS client-certificate check",
        responses: {
          "200": { description: "Certificate accepted (fingerprint returned)" },
          "403": { description: "No/untrusted client certificate" },
        },
      },
    },
    "/iam/realms/{ncb}/protocol/openid-connect/csr": {
      post: {
        tags: ["Mock · Enrollment"],
        summary: "MOCK: submit a CSR and receive a signed certificate",
        description:
          "Mock-only local CA. Declares the user (when new) and returns a signed certificate. " +
          "Real Pontes has no CSR API — certificates are issued via the TARGET Service Desk.",
        parameters: [NCB_PARAM],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CsrRequest" },
            },
          },
        },
        responses: {
          "200": { description: "Signed certificate (PEM)" },
          "400": { description: "Missing fields or invalid CSR" },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/admin/enrolled-users": {
      get: {
        tags: ["Mock · Enrollment"],
        summary: "MOCK: list enrolled users",
        description:
          "Returns the users that have a certificate enrolled in this mock instance. " +
          "Requires the admin token when ADMIN_TOKEN is configured.",
        responses: {
          "200": {
            description: "Enrolled users",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    users: {
                      type: "array",
                      items: { $ref: "#/components/schemas/EnrolledUser" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/admin/enrolled-users/{username}/certificate": {
      get: {
        tags: ["Mock · Enrollment"],
        summary: "MOCK: get an enrolled user's certificate (PEM)",
        parameters: [
          {
            name: "username",
            in: "path",
            required: true,
            schema: { type: "string", example: "PFRBSUIFRPPXXX0001" },
          },
        ],
        responses: {
          "200": { description: "Certificate (PEM)" },
          "404": { description: "No enrolled certificate for that user" },
        },
      },
    },
    "/admin/business-window": {
      get: {
        tags: ["Mock · Admin"],
        summary: "MOCK: get business day + current window",
        description:
          "Returns the stored business day (businessDate, sodStart, ofaStart, ofaEnd, eodEnd) plus the live window derived from Frankfurt time (currentWindow, windowName, windowStartTime, windowEndTime, nextWindowName, isOpen) — issue #81.",
        responses: { "200": { description: "Business day + current window" } },
      },
      post: {
        tags: ["Mock · Admin"],
        summary: "MOCK: set business day",
        description:
          "Accepts a sub-list of the day fields (businessDate, sodStart, ofaStart, ofaEnd, eodEnd); rejects unknown fields and requires the times to stay in increasing order (sodStart ≤ ofaStart ≤ ofaEnd ≤ eodEnd). PUT is also accepted (issue #81).",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  businessDate: { type: "string", example: "2026-06-15" },
                  sodStart: { type: "string", example: "07:00" },
                  ofaStart: { type: "string", example: "09:00" },
                  ofaEnd: { type: "string", example: "17:00" },
                  eodEnd: { type: "string", example: "18:00" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated business day + current window" },
          "400": { description: "Invalid body (unknown field / bad time / times not increasing)" },
        },
      },
    },
    "/admin/reset": {
      post: {
        tags: ["Mock · Admin"],
        summary: "MOCK: reset mock state",
        responses: { "200": { description: "Reset done" } },
      },
    },
    "/dlt/{ncb}/api/octopus/ams/wallets/one-step": {
      post: {
        tags: ["Mock · Admin"],
        summary: "MOCK: one-step Dedicated Cash Wallet creation",
        description:
          "Mock-only convenience (issue #77). The official `POST .../ams/wallets` creates a wallet " +
          "*draft* that a second user must validate (four-eyes); this one-step variant creates the DCW " +
          "immediately. Authenticated: the wallet is owned by the caller's own entity (from the JWT) — " +
          "you may only create wallets for your own entity.",
        parameters: [NCB_PARAM],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["walletAlias"],
                properties: {
                  walletAlias: { type: "string", example: "WFREURBSUIFRPPXXX-01" },
                  currency: { type: "string", example: "EUR" },
                  managerNCB: { type: "string", example: "BDF" },
                  isMainWallet: { type: "boolean", example: false },
                  validFrom: { type: "string", format: "date-time" },
                  validTo: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Wallet created (owned by the caller's entity)" },
          "400": { description: "walletAlias is required" },
          "403": { description: "No authenticated entity / foreign ownerEntityID" },
          "409": { description: "Wallet already exists" },
        },
      },
    },
  },
  components: {
    schemas: {
      CsrRequest: {
        type: "object",
        required: ["username", "password", "csr"],
        properties: {
          username: { type: "string", example: "PFRBSUIFRPPXXX0001" },
          password: { type: "string", example: "initiator-secret" },
          profile: {
            type: "string",
            example: "PILOT_READ_WRITE",
            description: "Required when declaring a new user",
          },
          entityBIC: {
            type: "string",
            example: "BSUIFRPPXXX",
            description: "Required when declaring a new user",
          },
          csr: { type: "string", description: "PKCS#10 CSR in PEM format" },
        },
      },
      EnrolledUser: {
        type: "object",
        properties: {
          username: { type: "string", example: "PFRBSUIFRPPXXX0001" },
          profile: { type: "string", example: "PILOT_READ_WRITE" },
          entityBIC: { type: "string", example: "BSUIFRPPXXX" },
          createdAt: { type: "string", format: "date-time" },
          certificateFingerprint: { type: "string" },
          hasCertificate: { type: "boolean" },
        },
      },
    },
  },
} as const;

type AnyObj = Record<string, any>;

/**
 * Pure transform: annotate a (cloned) official spec against the implemented-set
 * and merge the mock-only extras. Exposed for testing.
 */
export function annotateSpec(
  spec: AnyObj,
  implementedKeys: Set<string>,
  version: string,
): AnyObj {
  const hasErrorResponse = Boolean(spec.components?.schemas?.ErrorResponse);

  for (const [path, item] of Object.entries<AnyObj>(spec.paths || {})) {
    for (const method of Object.keys(item)) {
      if (!HTTP_METHODS.includes(method)) continue;
      const op = item[method] as AnyObj;
      const key = `${method.toUpperCase()} ${normalizePath(path)}`;
      const implemented = implementedKeys.has(key);
      op["x-mock-implemented"] = implemented;
      if (!implemented) {
        op.tags = ["NotImplemented", ...(op.tags || [])];
        op.description =
          "**⚠ Not implemented by this mock.**\n\n" + (op.description || "");
      }
      op.responses = op.responses || {};
      if (!op.responses.default && hasErrorResponse) {
        op.responses.default = {
          description: "Error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        };
      }
    }
  }

  // Merge mock-only helpers.
  spec.paths = { ...spec.paths, ...mockExtras.paths };
  spec.components = spec.components || {};
  spec.components.schemas = {
    ...(spec.components.schemas || {}),
    ...mockExtras.components.schemas,
  };
  spec.tags = [...(spec.tags || []), ...mockExtras.tags];

  spec.info = {
    ...(spec.info || {}),
    title: "Mock Pontes API (official EII spec, annotated)",
    version,
    description: spec.info?.description
      ? `${MOCK_INFO_DESCRIPTION}\n\n---\n\n${spec.info.description}`
      : MOCK_INFO_DESCRIPTION,
  };
  spec.servers = [{ url: "/", description: "This mock instance" }];
  return spec;
}

/**
 * Build the served OpenAPI document from the official spec + the current route
 * registry. Call after all routes are registered (e.g. lazily on first request).
 */
export function buildServedSpec(version: string): AnyObj {
  const clone = structuredClone(officialSpec) as AnyObj;
  return annotateSpec(clone, registeredKeySet(), version);
}
