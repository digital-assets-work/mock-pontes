// @peculiar/x509's CJS build depends on tsyringe which requires a reflect polyfill
import "reflect-metadata";
import "dotenv/config";
import { createApp, toNodeListener } from "h3";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import * as x509 from "@peculiar/x509";


import { MemoryStore } from "./state/memory-store.js";

// Auth layer
import {
  createJwtMiddleware,
  createEnrollmentAuthRouter,
  createNroMiddleware,
  createProfileAuthorizationMiddleware,
} from "./auth/index.js";

// Route factories
import { createWalletsRouter } from "./routes/wallets.js";
import { createTransfersRouter } from "./routes/transfers.js";
import { createFundingRouter } from "./routes/funding.js";
import { createBusinessWindowRouter } from "./routes/business-window.js";
import { createHealthRouter } from "./routes/health.js";
import { createBridgePaymentsRouter } from "./routes/bridge-payments.js";

// UI (native, no-build) served directly from the backend
import { createUiRouter } from "./ui/router.js";

// Admin route factories
// Only mock-only controls with no official-API equivalent remain: business-window
// simulation config and the test-harness reset. State-changing/querying admin
// endpoints (fund/defund/transfer/list) were removed in favour of the official
// Pontes endpoints (see docs/ENDPOINT-COVERAGE.md).
import { createAdminBusinessWindowRouter } from "./admin/business-window.js";
import { createAdminResetRouter } from "./admin/reset.js";
import { getRuntimePkiBundle, closeRuntimePkiPersistence, getTlsCertConfig } from "./auth/runtime-pki.js";
import { createNroCertCheckMiddleware } from "./auth/nro-middleware.js";
import { createLoggingMiddleware } from "./logger/middleware.js";
import { createMtlsConsistencyMiddleware } from "./auth/middleware.js";
import { createInMemoryAuthUsersRepository, createPersistedAuthUsersRepository } from "./auth/users-repository.js";
import { RedisCache } from "./cache/index.js";

// --- State ---
const store = new MemoryStore();
const runtimePki = await getRuntimePkiBundle();


// --- Auth users repository (Redis-backed if available) ---
const redisUrl = process.env.REDIS_URL;
const authUsersRepository = redisUrl
  ? await createPersistedAuthUsersRepository(new RedisCache(redisUrl, "mock-pontes:users"))
  : createInMemoryAuthUsersRepository();
if (redisUrl) {
  console.log(`[mock-pontes] Users persistence enabled via Redis (${redisUrl})`);
}

// List of the API patterns that need NRO signature verification. 
const nroRoutePatterns: readonly RegExp[] = [
  /\/dlt\/[^/]+\/api\/octopus\/tms\/funding-requests/,
  /\/dlt\/[^/]+\/api\/octopus\/tms\/defunding-requests/,
];

// --- H3 App ---
const app = createApp();

// --- Global request logging + mTLS context enrichment middleware ---
// Attaches certificate-derived context (e.g. presented client cert, fingerprint, validity)
// and emits request/response logs used by downstream auth and troubleshooting.
app.use(createLoggingMiddleware());

// --- Health endpoint (unauthenticated, before JWT middleware) ---
app.use(createHealthRouter().handler);

// --- Native UI (unauthenticated, dev only) ---
// Registered before the auth middlewares so the control panel, API docs and CSR
// enrollment page are reachable without a client certificate or token.
app.use(createUiRouter().handler);

app.use(
  createEnrollmentAuthRouter({
    runtimePki,
    authUsersRepository,
  }).handler,
);

// --- JWT auth middleware ---
// Validates bearer tokens and populates event.context.auth so identity-aware checks
// and route handlers can enforce user-scoped certificate associations.
app.use(createJwtMiddleware(["/dlt"]));

// --- mTLS/JWT consistency middleware ---
// For authenticated calls, ensures the presented mTLS client certificate matches
// the certificate previously associated with the authenticated username.
app.use(createMtlsConsistencyMiddleware(authUsersRepository));

// --- Profile authorization middleware ---
// Enforces that 1-step bridge endpoints require EXTERNAL_USER and
// 2-step draft/approve/funding/defunding require PILOT_READ_WRITE.
// Skipped when PONTES_MOCK_LENIENT_PROFILE=true.
app.use(createProfileAuthorizationMiddleware());

// --- NRO signer certificate vs mTLS certificate consistency middleware ---
// On NRO-protected write routes, checks that signerPEM and the current mTLS cert
// represent the same certificate before the cryptographic signature verification step.
app.use(createNroCertCheckMiddleware(nroRoutePatterns));

// --- NRO signature verification middleware ---
// On NRO-protected write routes, verifies signature fields against signerPEM
// using the Pontes canonical payload construction rules.
app.use(createNroMiddleware(nroRoutePatterns));

// Pontes-compatible routes
app.use(createWalletsRouter(store).handler);
app.use(createTransfersRouter(store).handler);
app.use(createFundingRouter(store).handler);
app.use(createBusinessWindowRouter(store).handler);
app.use(createBridgePaymentsRouter(store).handler);

// Admin routes (mock-only, no official equivalent)
app.use(createAdminBusinessWindowRouter(store).handler);
app.use(createAdminResetRouter(store).handler);

// --- Server ---
const port = Number(process.env.PORT || 3001);
let effectiveUrl: string;

// TLS server identity.
// By default the mock presents its runtime self-signed server certificate. When
// TLS_CERT_FILE and TLS_KEY_FILE are set (e.g. a cert-manager / Let's Encrypt
// secret mounted into the pod) that certificate is served instead — while the
// mTLS trust root (clientSigningCa) and requestCert behaviour stay unchanged.
const tlsConfig = getTlsCertConfig();
console.log(`[mock-pontes] TLS subject: ${tlsConfig.subject}`);
console.log(`[mock-pontes] TLS SAN: ${tlsConfig.san}`);

const clientCaPem = runtimePki.clientSigningCaCertificatePem;

// Self-signed secure context — always available; default + internal-SNI fallback.
const selfSignedContext = tls.createSecureContext({
  cert: runtimePki.serverCertificatePem,
  key: runtimePki.serverPrivateKeyPem,
  ca: clientCaPem,
});

const externalCertFile = process.env.TLS_CERT_FILE;
const externalKeyFile = process.env.TLS_KEY_FILE;
const useExternalCert = Boolean(externalCertFile && externalKeyFile);

// Externally-provided (e.g. Let's Encrypt) context + the hostnames it covers.
let externalContext: tls.SecureContext | undefined;
let externalHosts = new Set<string>();

function loadExternalContext(): void {
  if (!externalCertFile || !externalKeyFile) return;
  const certPem = fs.readFileSync(externalCertFile, "utf-8");
  const keyPem = fs.readFileSync(externalKeyFile, "utf-8");
  externalContext = tls.createSecureContext({ cert: certPem, key: keyPem, ca: clientCaPem });
  const hosts = new Set<string>();
  try {
    const leaf = new x509.X509Certificate(certPem);
    const san = leaf.getExtension(x509.SubjectAlternativeNameExtension);
    for (const name of san?.names.toJSON() ?? []) {
      if (name.type === "dns") hosts.add(name.value.toLowerCase());
    }
  } catch (err) {
    console.warn(`[mock-pontes] Could not parse external cert SANs: ${(err as Error).message}`);
  }
  externalHosts = hosts;
  console.log(`[mock-pontes] External TLS server certificate loaded (hosts: ${[...hosts].join(", ") || "n/a"})`);
}

if (useExternalCert) {
  loadExternalContext();
  // Hot-reload on renewal: cert-manager swaps the mounted secret atomically, so
  // watch the containing directory rather than the file itself.
  try {
    const watchDir = path.dirname(externalCertFile!);
    let reloadTimer: NodeJS.Timeout | null = null;
    fs.watch(watchDir, () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        try {
          loadExternalContext();
          console.log("[mock-pontes] External TLS certificate reloaded");
        } catch (err) {
          console.warn(`[mock-pontes] External TLS reload failed: ${(err as Error).message}`);
        }
      }, 1000);
    });
  } catch (err) {
    console.warn(`[mock-pontes] Could not watch TLS cert directory: ${(err as Error).message}`);
  }
}

const server = https.createServer(
  {
    // Default identity: external cert when provided, otherwise self-signed.
    cert: useExternalCert ? fs.readFileSync(externalCertFile!, "utf-8") : runtimePki.serverCertificatePem,
    key: useExternalCert ? fs.readFileSync(externalKeyFile!, "utf-8") : runtimePki.serverPrivateKeyPem,
    ca: clientCaPem,
    requestCert: true, // Request client certificate (mTLS)
    rejectUnauthorized: false, // Allow connections without certs (CSR endpoint); auth middleware validates
    // SNI split: serve the external cert only for the hostnames it covers,
    // self-signed for everything else (e.g. in-cluster Service names).
    ...(useExternalCert
      ? {
          SNICallback: (servername: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void) => {
            const ctx =
              externalContext && externalHosts.has((servername || "").toLowerCase())
                ? externalContext
                : selfSignedContext;
            cb(null, ctx);
          },
        }
      : {}),
  },
  toNodeListener(app),
);
console.log(
  `[mock-pontes] TLS mode: ${useExternalCert ? "external certificate (SNI split with self-signed)" : "self-signed (runtime PKI)"}`,
);

const listenHost = process.env.HOST || "localhost";
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, listenHost, () => resolve());
});

effectiveUrl = `https://${listenHost}:${port}/`;

const effectivePort = new URL(effectiveUrl).port || String(port);
console.log(`[mock-pontes] Listening on ${effectiveUrl} (port ${effectivePort})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    closeRuntimePkiPersistence();
  });
}
