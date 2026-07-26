/**
 * Minimal OpenAPI 3.0 description of the endpoints this mock actually implements.
 * Served at `GET /openapi.json` and rendered by the embedded Swagger UI (`/ui/docs`).
 *
 * Endpoints are grouped into two categories via tag naming (and `x-tagGroups`):
 *   - "Pontes · …"  → faithful reflections of the real ECB Pontes API.
 *   - "Mock · …"    → mock-specific helpers that do NOT exist on real Pontes
 *                     (local CA/enrollment convenience + state-simulation admin API).
 */
export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Mock Pontes API",
    version: "1.0.0",
    description:
      "Local mock of the ECB Pontes Pilot A2A API.\n\n" +
      "**Endpoint categories:**\n" +
      "- **Pontes · …** — reflect the real ECB Pontes API (same paths/verbs). `/dlt/**` require a " +
      "Bearer JWT (and mTLS on the real transport); use the IAM token endpoint to obtain one.\n" +
      "- **Mock · …** — mock-only helpers with no equivalent on real Pontes: certificate enrollment " +
      "(real Pontes issues certs via the TARGET Service Desk, not an API) and the `/admin/**` " +
      "state-simulation API.",
  },
  servers: [{ url: "/", description: "This mock instance" }],
  "x-tagGroups": [
    {
      name: "Pontes API (mock reflects the official ECB API)",
      tags: [
        "Pontes · Connectivity",
        "Pontes · IAM",
        "Pontes · Wallets",
        "Pontes · Transactions",
        "Pontes · Funding",
        "Pontes · Payments",
      ],
    },
    {
      name: "Mock-specific (no equivalent on real Pontes)",
      tags: ["Mock · Enrollment", "Mock · Admin"],
    },
  ],
  tags: [
    { name: "Pontes · Connectivity", description: "Official connectivity-test endpoints (SDD §6.3)." },
    { name: "Pontes · IAM", description: "Official OAuth2 token endpoint." },
    { name: "Pontes · Wallets", description: "Official DCW queries." },
    { name: "Pontes · Transactions", description: "Official cash-token transaction endpoints." },
    { name: "Pontes · Funding", description: "Official funding/defunding endpoints." },
    { name: "Pontes · Payments", description: "Official 1-step bridge payments." },
    {
      name: "Mock · Enrollment",
      description:
        "Mock-only. Local CA that signs submitted CSRs and lists enrolled users. On real Pontes, " +
        "certificates are issued manually by the TARGET Service Desk — there is no such API.",
    },
    {
      name: "Mock · Admin",
      description: "Mock-only state-simulation API (seed/inspect/reset wallets, transfers, business window).",
    },
  ],
  paths: {
    // ---------------- Pontes · Connectivity ----------------
    "/dlt/{ncb}/api/octopus/health": {
      get: {
        tags: ["Pontes · Connectivity"],
        summary: "DLT node health",
        parameters: [{ $ref: "#/components/parameters/ncb" }],
        responses: { "200": { description: "Health status" } },
      },
    },
    "/check/ip": {
      get: {
        tags: ["Pontes · Connectivity"],
        summary: "IP whitelisting check",
        responses: { "200": { description: "Caller source IP" } },
      },
    },
    "/check/mtls": {
      get: {
        tags: ["Pontes · Connectivity"],
        summary: "mTLS client-certificate check",
        responses: {
          "200": { description: "Certificate accepted (fingerprint returned)" },
          "403": { description: "No/untrusted client certificate" },
        },
      },
    },
    // ---------------- Pontes · IAM ----------------
    "/iam/realms/{ncb}/protocol/openid-connect/token": {
      post: {
        tags: ["Pontes · IAM"],
        summary: "Acquire an OAuth2 JWT (grant_type=password)",
        parameters: [{ $ref: "#/components/parameters/ncb" }],
        requestBody: {
          required: true,
          content: {
            "application/x-www-form-urlencoded": {
              schema: {
                type: "object",
                properties: {
                  grant_type: { type: "string", example: "password" },
                  username: { type: "string" },
                  password: { type: "string" },
                  scope: { type: "string", example: "openid" },
                  client_id: { type: "string", example: "esydlt-web-app" },
                  client_secret: { type: "string", description: "Required for EXTERNAL_USER" },
                },
                required: ["grant_type", "username", "password"],
              },
            },
          },
        },
        responses: { "200": { description: "Access token" }, "401": { description: "Auth failure" } },
      },
    },
    // ---------------- Pontes · Wallets ----------------
    "/dlt/{ncb}/api/octopus/ams/wallets/{walias}": {
      get: {
        tags: ["Pontes · Wallets"],
        summary: "Wallet details",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/ncb" },
          { $ref: "#/components/parameters/walias" },
        ],
        responses: { "200": { description: "Wallet" }, "401": { description: "Unauthorized" } },
      },
    },
    // ---------------- Pontes · Transactions ----------------
    "/dlt/{ncb}/api/octopus/ams/wallets/{walias}/transactions": {
      get: {
        tags: ["Pontes · Transactions"],
        summary: "Wallet settled transactions",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/ncb" },
          { $ref: "#/components/parameters/walias" },
        ],
        responses: { "200": { description: "Transactions" } },
      },
    },
    "/dlt/{ncb}/api/octopus/rvs/transactions-requests": {
      post: {
        tags: ["Pontes · Transactions"],
        summary: "Create a cash-token transfer/payment draft (2-step)",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/ncb" }],
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { "200": { description: "Draft created" } },
      },
    },
    // ---------------- Pontes · Payments ----------------
    "/dlt/{ncb}/api/bridge/cash-token/payments": {
      post: {
        tags: ["Pontes · Payments"],
        summary: "1-step cash-token payment (EXTERNAL_USER)",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/ncb" }],
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { "200": { description: "Payment settled" } },
      },
    },
    // ---------------- Pontes · Funding ----------------
    "/dlt/{ncb}/api/octopus/tms/funding-requests": {
      post: {
        tags: ["Pontes · Funding"],
        summary: "Create a funding draft (2-step, NRO-signed)",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/ncb" }],
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { "200": { description: "Funding draft" } },
      },
    },
    // ---------------- Mock · Enrollment ----------------
    "/iam/realms/{ncb}/protocol/openid-connect/csr": {
      post: {
        tags: ["Mock · Enrollment"],
        summary: "MOCK: submit a CSR and receive a signed certificate",
        description:
          "Mock-only local CA. Declares the user (when new) and returns a signed certificate. " +
          "Real Pontes has no CSR API — certificates are issued via the TARGET Service Desk.",
        parameters: [{ $ref: "#/components/parameters/ncb" }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CsrRequest" } } },
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
        description: "Returns the users that have a certificate enrolled in this mock instance.",
        responses: {
          "200": {
            description: "Enrolled users",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    users: { type: "array", items: { $ref: "#/components/schemas/EnrolledUser" } },
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
          { name: "username", in: "path", required: true, schema: { type: "string", example: "PFRBSUIFRPPXXX0001" } },
        ],
        responses: {
          "200": { description: "Certificate (PEM)" },
          "404": { description: "No enrolled certificate for that user" },
        },
      },
    },
    // ---------------- Mock · Admin (simulation) ----------------
    "/admin/wallets": {
      get: { tags: ["Mock · Admin"], summary: "MOCK: list all wallets & balances", responses: { "200": { description: "Wallets" } } },
    },
    "/admin/wallets/{alias}/fund": {
      post: {
        tags: ["Mock · Admin"],
        summary: "MOCK: simulate funding (credit a wallet)",
        parameters: [{ $ref: "#/components/parameters/alias" }],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { amount: { type: "string", example: "1000000.00" } } } } } },
        responses: { "200": { description: "Funded" } },
      },
    },
    "/admin/wallets/{alias}/defund": {
      post: {
        tags: ["Mock · Admin"],
        summary: "MOCK: simulate defunding (debit a wallet)",
        parameters: [{ $ref: "#/components/parameters/alias" }],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { amount: { type: "string", example: "1000000.00" } } } } } },
        responses: { "200": { description: "Defunded" } },
      },
    },
    "/admin/transfers": {
      post: {
        tags: ["Mock · Admin"],
        summary: "MOCK: simulate a wallet-to-wallet transfer",
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { "200": { description: "Transferred" } },
      },
    },
    "/admin/transactions": {
      get: { tags: ["Mock · Admin"], summary: "MOCK: list all transactions", responses: { "200": { description: "Transactions" } } },
    },
    "/admin/business-window": {
      get: { tags: ["Mock · Admin"], summary: "MOCK: get business window", responses: { "200": { description: "Business window" } } },
      put: {
        tags: ["Mock · Admin"],
        summary: "MOCK: set business window",
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { "200": { description: "Updated" } },
      },
    },
    "/admin/reset": {
      post: { tags: ["Mock · Admin"], summary: "MOCK: reset mock state", responses: { "200": { description: "Reset done" } } },
    },
  },
  components: {
    parameters: {
      ncb: {
        name: "ncb",
        in: "path",
        required: true,
        schema: { type: "string", example: "bdf" },
        description: "Managing NCB / ORG id (lowercase in the path)",
      },
      walias: {
        name: "walias",
        in: "path",
        required: true,
        schema: { type: "string", example: "WFREURBSUIFRPPXXX-01" },
        description: "Dedicated Cash Wallet alias",
      },
      alias: {
        name: "alias",
        in: "path",
        required: true,
        schema: { type: "string", example: "WFREURBSUIFRPPXXX-01" },
        description: "Wallet alias",
      },
    },
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
          entityBIC: { type: "string", example: "BSUIFRPPXXX", description: "Required when declaring a new user" },
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
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
} as const;
