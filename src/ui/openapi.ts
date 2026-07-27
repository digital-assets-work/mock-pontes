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
    version: "1.1.1",
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
        "Pontes · Business Window",
        "Pontes · Transactions",
        "Pontes · Funding",
        "Pontes · Payments",
        "Pontes · Direct RTGS",
        "Pontes · PFoD",
        "Pontes · XvP",
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
    { name: "Pontes · Business Window", description: "Official business-window / business-date queries." },
    { name: "Pontes · Transactions", description: "Official cash-token transaction endpoints (2-step + queries)." },
    { name: "Pontes · Funding", description: "Official funding/defunding endpoints (2-step, NRO-signed)." },
    { name: "Pontes · Payments", description: "Official 1-step bridge payments." },
    { name: "Pontes · Direct RTGS", description: "Official direct-RTGS payments (defund+fund composite): 2-step and 1-step." },
    { name: "Pontes · PFoD", description: "Official Payment-Free-of-Delivery matched legs (deliver + receive)." },
    { name: "Pontes · XvP", description: "Official XvP hash-link (hashed time-lock) on the IGW surface." },
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
    "/iam/realms/{ncb}/protocol/openid-connect/certs": {
      get: {
        tags: ["Pontes · IAM"],
        summary: "JWKS — signing public keys for JWT verification",
        parameters: [{ $ref: "#/components/parameters/ncb" }],
        responses: { "200": { description: "JWK Set" } },
      },
    },
    "/iam/realms/{ncb}/.well-known/openid-configuration": {
      get: {
        tags: ["Pontes · IAM"],
        summary: "OpenID Connect discovery document",
        parameters: [{ $ref: "#/components/parameters/ncb" }],
        responses: { "200": { description: "OIDC configuration (issuer, token_endpoint, jwks_uri)" } },
      },
    },
    // ---------------- Pontes · Wallets ----------------
    "/dlt/{ncb}/api/octopus/ams/wallets": {
      get: {
        tags: ["Pontes · Wallets"],
        summary: "Retrieve Dedicated Cash Wallet list",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/ncb" }],
        responses: { "200": { description: "Wallets" }, "401": { description: "Unauthorized" } },
      },
    },
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
    "/dlt/{ncb}/api/bridge/payments": {
      post: {
        tags: ["Pontes · Payments"],
        summary: "1-step cash-token payment (EXTERNAL_USER)",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/ncb" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: [
                  "amount",
                  "currency",
                  "paymentID",
                  "creditedCashWalletAlias",
                  "creditedCashWalletManagerID",
                  "debitedCashWalletAlias",
                ],
                properties: {
                  paymentID: { type: "string", example: "payment_517ae232-29e7-4efb-8743-0177bbe6d576" },
                  amount: { type: "string", example: "100.50" },
                  currency: { type: "string", example: "EUR" },
                  creditedCashWalletAlias: { type: "string", example: "WDEEURMP01DEAAXXX-01" },
                  creditedCashWalletManagerID: { type: "string", example: "MARKDEFFXXX" },
                  debitedCashWalletAlias: { type: "string", example: "WFREURMP01FRAAXXX-01" },
                  debitedCashWalletManagerID: { type: "string", example: "BDFEFR2TXXX" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Payment settled (plain-text confirmation)" },
          "400": { description: "Missing/invalid fields" },
        },
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
    // ---------------- Pontes · Business Window ----------------
    "/dlt/{ncb}/api/bridge/current-business-window": {
      get: { tags: ["Pontes · Business Window"], summary: "Current business window (bridge)", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }], responses: { "200": { description: "Business window" } } },
    },
    "/dlt/{ncb}/api/octopus/grs/current-business-window": {
      get: { tags: ["Pontes · Business Window"], summary: "Current business window (GRS)", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }], responses: { "200": { description: "Business window" } } },
    },
    "/dlt/{ncb}/api/octopus/grs/businessdate": {
      get: { tags: ["Pontes · Business Window"], summary: "Current business date", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }], responses: { "200": { description: "Business date" } } },
    },
    // ---------------- Pontes · Transactions (queries + lifecycle) ----------------
    "/dlt/{ncb}/api/octopus/ims/transactions": {
      get: { tags: ["Pontes · Transactions"], summary: "Query in-flight cash-token transactions (drafts)", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }], responses: { "200": { description: "Transactions / drafts list" } } },
    },
    "/dlt/{ncb}/api/octopus/rvs/transactions-drafts/{id}": {
      get: { tags: ["Pontes · Transactions"], summary: "Read a transfer draft by id", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }, { $ref: "#/components/parameters/draftId" }], responses: { "200": { description: "Draft" }, "404": { description: "Not found" } } },
    },
    "/dlt/{ncb}/api/octopus/rvs/transactions-drafts/{id}/{status}": {
      put: { tags: ["Pontes · Transactions"], summary: "Approve or cancel a transfer draft (4-eyes; availability checked at approve)", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }, { $ref: "#/components/parameters/draftId" }, { $ref: "#/components/parameters/status" }], responses: { "200": { description: "Transitioned" }, "403": { description: "Four-eyes / no debit right" }, "404": { description: "Unknown draft" }, "409": { description: "Wrong state" }, "422": { description: "Insufficient funds" } } },
    },
    // ---------------- Pontes · Funding (defunding + lifecycle + reads) ----------------
    "/dlt/{ncb}/api/octopus/tms/funding-requests-drafts/{id}/{status}": {
      put: { tags: ["Pontes · Funding"], summary: "Approve or cancel a funding draft (4-eyes)", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }, { $ref: "#/components/parameters/draftId" }, { $ref: "#/components/parameters/status" }], responses: { "200": { description: "Transitioned" }, "403": { description: "Four-eyes" }, "404": { description: "Unknown draft" }, "409": { description: "Wrong state" } } },
    },
    "/dlt/{ncb}/api/octopus/tms/defunding-requests": {
      post: { tags: ["Pontes · Funding"], summary: "Create a defunding draft (2-step, NRO-signed)", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }], requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "201": { description: "Defunding draft" } } },
    },
    "/dlt/{ncb}/api/octopus/tms/defunding-requests-drafts/{id}/{status}": {
      put: { tags: ["Pontes · Funding"], summary: "Approve or cancel a defunding draft (4-eyes; availability checked at approve)", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }, { $ref: "#/components/parameters/draftId" }, { $ref: "#/components/parameters/status" }], responses: { "200": { description: "Transitioned" }, "403": { description: "Four-eyes / no debit right" }, "404": { description: "Unknown draft" }, "409": { description: "Wrong state" }, "422": { description: "Insufficient funds" } } },
    },
    "/dlt/{ncb}/api/octopus/tms/funding-defunding-requests-drafts/{id}": {
      get: { tags: ["Pontes · Funding"], summary: "Read a funding or defunding draft by id", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }, { $ref: "#/components/parameters/draftId" }], responses: { "200": { description: "Request" }, "404": { description: "Not found" } } },
    },
    "/dlt/{ncb}/api/octopus/tms/funding-defunding-requests/{id}": {
      get: { tags: ["Pontes · Funding"], summary: "Read a funding or defunding request by id", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }, { $ref: "#/components/parameters/draftId" }], responses: { "200": { description: "Request" }, "404": { description: "Not found" } } },
    },
    // ---------------- Pontes · Direct RTGS ----------------
    "/dlt/{ncb}/api/octopus/tms/direct-rtgs/payments": {
      post: { tags: ["Pontes · Direct RTGS"], summary: "Create a direct-RTGS payment draft (2-step, NRO-signed) — defund payer + fund receiver", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }], requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "201": { description: "Draft" } } },
    },
    "/dlt/{ncb}/api/octopus/tms/direct-rtgs/payments-drafts/{id}/{status}": {
      put: { tags: ["Pontes · Direct RTGS"], summary: "Approve or cancel a direct-RTGS draft (4-eyes; availability at approve)", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }, { $ref: "#/components/parameters/draftId" }, { $ref: "#/components/parameters/status" }], responses: { "200": { description: "Transitioned" }, "403": { description: "Four-eyes / no debit right" }, "404": { description: "Unknown draft" }, "409": { description: "Wrong state" }, "422": { description: "Insufficient funds" } } },
    },
    "/dlt/{ncb}/api/octopus/tms/direct-rtgs/payments-drafts/{id}": {
      get: { tags: ["Pontes · Direct RTGS"], summary: "Read a direct-RTGS draft by id", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }, { $ref: "#/components/parameters/draftId" }], responses: { "200": { description: "Draft" }, "404": { description: "Not found" } } },
    },
    "/dlt/{ncb}/api/octopus/tms/direct-rtgs/payments/{id}": {
      get: { tags: ["Pontes · Direct RTGS"], summary: "Read a direct-RTGS payment by id", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }, { $ref: "#/components/parameters/draftId" }], responses: { "200": { description: "Payment" }, "404": { description: "Not found" } } },
    },
    "/dlt/{ncb}/api/bridge/direct-rtgs/payments": {
      post: { tags: ["Pontes · Direct RTGS"], summary: "1-step direct-RTGS payment (EXTERNAL_USER, NRO-signed)", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }], requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "200": { description: "Settled (plain-text confirmation)" }, "422": { description: "Insufficient funds" } } },
    },
    // ---------------- Pontes · PFoD ----------------
    "/dlt/{ncb}/api/bridge/initpfoddeli": {
      post: { tags: ["Pontes · PFoD"], summary: "PFoD deliver leg (seller). Matched with the receive leg on tradeID", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["tradeID", "amount", "currency", "sellerCashTokenWalletRef"], properties: { tradeID: { type: "string" }, amount: { type: "string", example: "100.00" }, currency: { type: "string", example: "EUR" }, sellerCashTokenWalletRef: { type: "string" }, sellerID: { type: "string" }, sellerCAMBIC: { type: "string" }, buyerID: { type: "string" } } } } } }, responses: { "201": { description: "Leg stored (PENDING_MATCH) or matched (SETTLED)" }, "400": { description: "Missing fields" }, "410": { description: "Expired" }, "422": { description: "Inconsistent legs / insufficient funds" } } },
    },
    "/dlt/{ncb}/api/bridge/initpfodrece": {
      post: { tags: ["Pontes · PFoD"], summary: "PFoD receive leg (buyer). Matched with the deliver leg on tradeID", security: [{ bearerAuth: [] }], parameters: [{ $ref: "#/components/parameters/ncb" }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["tradeID", "amount", "currency", "buyerCashTokenWalletRef"], properties: { tradeID: { type: "string" }, amount: { type: "string", example: "100.00" }, currency: { type: "string", example: "EUR" }, buyerCashTokenWalletRef: { type: "string" }, buyerID: { type: "string" }, buyerCAMBIC: { type: "string" }, sellerCAMBIC: { type: "string" } } } } } }, responses: { "201": { description: "Leg stored (PENDING_MATCH) or matched (SETTLED)" }, "400": { description: "Missing fields" }, "410": { description: "Expired" }, "422": { description: "Inconsistent legs / insufficient funds" } } },
    },
    // ---------------- Pontes · XvP (IGW, hash-link) ----------------
    "/igw/{ncb}/v1/xvps": {
      post: { tags: ["Pontes · XvP"], summary: "XvP init (cash-token). Locks the seller's funds, returns execution/cancellation hashes + timeout", parameters: [{ $ref: "#/components/parameters/ncb" }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["xvpTransactionId", "amount", "currency"], properties: { xvpTransactionId: { type: "string" }, type: { type: "string", enum: ["DVP", "PVP"] }, amount: { type: "string", example: "10000.50" }, currency: { type: "string", example: "EUR" }, seller: { type: "object", properties: { bic: { type: "string" }, cashWalletAlias: { type: "string" } } }, buyer: { type: "object", properties: { bic: { type: "string" }, cashWalletAlias: { type: "string" } } } } } } } }, responses: { "201": { description: "XvPInitResponse (hashes, timeout, keys)" }, "403": { description: "No debit right" }, "422": { description: "Insufficient funds" } } },
    },
    "/igw/{ncb}/v1/direct-rtgs/xvps": {
      post: { tags: ["Pontes · XvP"], summary: "XvP init (direct-RTGS variant)", parameters: [{ $ref: "#/components/parameters/ncb" }], requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } }, responses: { "201": { description: "XvPInitResponse" } } },
    },
    "/igw/{ncb}/v1/xvps/{xvpTransactionId}": {
      get: { tags: ["Pontes · XvP"], summary: "XvP status", parameters: [{ $ref: "#/components/parameters/ncb" }, { $ref: "#/components/parameters/xvpTransactionId" }], responses: { "200": { description: "XvP status" }, "404": { description: "Not found" } } },
    },
    "/igw/{ncb}/v1/xvps/{xvpTransactionId}/payment": {
      post: { tags: ["Pontes · XvP"], summary: "XvP payment — reveal a preimage to EXECUTE (settle + reveal key) or CANCEL", parameters: [{ $ref: "#/components/parameters/ncb" }, { $ref: "#/components/parameters/xvpTransactionId" }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["key"], properties: { key: { type: "string", description: "Preimage that hashes to the execution or cancellation hash" } } } } } }, responses: { "200": { description: "SETTLED (executionKey revealed) or CANCELLED" }, "400": { description: "Invalid preimage" }, "409": { description: "Already terminal" }, "410": { description: "Timed out" } } },
      get: { tags: ["Pontes · XvP"], summary: "XvP payment status", parameters: [{ $ref: "#/components/parameters/ncb" }, { $ref: "#/components/parameters/xvpTransactionId" }], responses: { "200": { description: "PaymentStatus" }, "404": { description: "Not found" } } },
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
      draftId: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", example: "TR260727123456" },
        description: "Draft / request id",
      },
      status: {
        name: "status",
        in: "path",
        required: true,
        schema: { type: "string", enum: ["approve", "cancel"] },
        description: "Target transition (also accepts the uppercase APPROVED/CANCELED target states).",
      },
      xvpTransactionId: {
        name: "xvpTransactionId",
        in: "path",
        required: true,
        schema: { type: "string", example: "517ae232-29e7-4efb-8743-0177bbe6d576" },
        description: "XvP transaction id",
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
