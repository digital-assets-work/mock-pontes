// @peculiar/x509's CJS build depends on tsyringe which requires a reflect polyfill
import "reflect-metadata";
import "dotenv/config";
import { toNodeListener } from "h3";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import * as x509 from "@peculiar/x509";


import { MemoryStore } from "./state/memory-store.js";
import { buildApp } from "./app.js";
import { getRuntimePkiBundle, closeRuntimePkiPersistence, getTlsCertConfig } from "./auth/runtime-pki.js";
import { createInMemoryAuthUsersRepository, createPersistedAuthUsersRepository } from "./auth/users-repository.js";
import { RedisCache } from "./cache/index.js";

// --- State ---
const redisUrl = process.env.REDIS_URL;
const store = new MemoryStore(
  redisUrl ? new RedisCache(redisUrl, "mock-pontes:state") : undefined,
);
await store.hydrate();
const runtimePki = await getRuntimePkiBundle();


// --- Auth users repository (Redis-backed if available) ---
const authUsersRepository = redisUrl
  ? await createPersistedAuthUsersRepository(new RedisCache(redisUrl, "mock-pontes:users"))
  : createInMemoryAuthUsersRepository();
if (redisUrl) {
  console.log(`[mock-pontes] Users persistence enabled via Redis (${redisUrl})`);
}

// --- H3 App ---
const app = buildApp({ store, runtimePki, authUsersRepository });

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
