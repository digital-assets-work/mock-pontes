# src/index.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 0.00% (0/80) | `░░░░░░░░░░` |
| Branches | 0.00% (0/42) | `░░░░░░░░░░` |
| Functions | 0.00% (0/9) | `░░░░░░░░░░` |
| Lines | 0.00% (0/76) | `░░░░░░░░░░` |

**Uncovered lines:** 22-24, 26-28, 32, 39-45, 47, 50, 54-56, 58, 61, 63, 67, 70-71, 75, 78, 86-88, 90, 93, 99-101, 105, 107-117, 120, 122-123, 126-127, 130-138, 140, 145, 149, 161, 163, 166, 173, 177-180, 183, 185-186, 188-190

**Partial branches:** L68 (cond-expr), L69 (cond-expr), L152 (cond-expr), L153 (cond-expr), L160 (cond-expr), L164 (cond-expr), L165 (cond-expr), L169 (cond-expr), L174 (cond-expr)

**Never called:** `(anonymous_0)` (L22), `(anonymous_1)` (L26), `loadExternalContext` (L107), `(anonymous_3)` (L133), `(anonymous_4)` (L135), `(anonymous_5)` (L161), `(anonymous_6)` (L178), `(anonymous_7)` (L180), `(anonymous_8)` (L189)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   19 | // Per issue #46 a lost persistence write (or any stray rejection) must stop the
   20 | // process rather than leave it running in an inconsistent state; k8s relaunches
   21 | // it with a fresh Redis connection.
-  22 | process.on("unhandledRejection", (reason) => {
-  23 |   console.error("[mock-pontes] FATAL unhandledRejection:", reason);
-  24 |   process.exit(1);
   25 | });
-  26 | process.on("uncaughtException", (err) => {
-  27 |   console.error("[mock-pontes] FATAL uncaughtException:", err);
-  28 |   process.exit(1);
   29 | });
   30 | 
   31 | // --- State ---
-  32 | const redisUrl = process.env.REDIS_URL;
   33 | 
   34 | // When REDIS_URL is set the mock must not start unless it can reach Redis:
   35 | // starting with persistence configured but unavailable would silently drop
   36 | // state and mislead integrators. Connect up front and exit non-zero on failure.
   37 | let stateCache: RedisCache | undefined;
   38 | let usersCache: RedisCache | undefined;
-  39 | if (redisUrl) {
-  40 |   stateCache = new RedisCache(redisUrl, "mock-pontes:state");
-  41 |   usersCache = new RedisCache(redisUrl, "mock-pontes:users");
-  42 |   try {
-  43 |     await stateCache.connect();
-  44 |     await usersCache.connect();
-  45 |     console.log(`[mock-pontes] Connected to Redis (${redisUrl})`);
   46 |   } catch (err) {
-  47 |     console.error(
   48 |       `[mock-pontes] FATAL: REDIS_URL is set but Redis is unreachable; refusing to start. ${(err as Error).message}`,
   49 |     );
-  50 |     process.exit(1);
   51 |   }
   52 | }
   53 | 
-  54 | const store = new MemoryStore(stateCache);
-  55 | try {
-  56 |   await store.hydrate();
   57 | } catch (err) {
-  58 |   console.error(
   59 |     `[mock-pontes] FATAL: could not load persisted state from Redis; refusing to start. ${(err as Error).message}`,
   60 |   );
-  61 |   process.exit(1);
   62 | }
-  63 | const runtimePki = await getRuntimePkiBundle();
   64 | 
   65 | 
   66 | // --- Auth users repository (Redis-backed if available) ---
-  67 | const authUsersRepository = usersCache
!  68 |   ? await createPersistedAuthUsersRepository(usersCache)
!  69 |   : createInMemoryAuthUsersRepository();
-  70 | if (redisUrl) {
-  71 |   console.log(`[mock-pontes] Users persistence enabled via Redis (${redisUrl})`);
   72 | }
   73 | 
   74 | // --- H3 App ---
-  75 | const app = buildApp({ store, runtimePki, authUsersRepository });
   76 | 
   77 | // --- Server ---
-  78 | const port = Number(process.env.PORT || 3001);
   79 | let effectiveUrl: string;
   80 | 
   81 | // TLS server identity.
  ⋮
   83 | // TLS_CERT_FILE and TLS_KEY_FILE are set (e.g. a cert-manager / Let's Encrypt
   84 | // secret mounted into the pod) that certificate is served instead — while the
   85 | // mTLS trust root (clientSigningCa) and requestCert behaviour stay unchanged.
-  86 | const tlsConfig = getTlsCertConfig();
-  87 | console.log(`[mock-pontes] TLS subject: ${tlsConfig.subject}`);
-  88 | console.log(`[mock-pontes] TLS SAN: ${tlsConfig.san}`);
   89 | 
-  90 | const clientCaPem = runtimePki.clientSigningCaCertificatePem;
   91 | 
   92 | // Self-signed secure context — always available; default + internal-SNI fallback.
-  93 | const selfSignedContext = tls.createSecureContext({
   94 |   cert: runtimePki.serverCertificatePem,
   95 |   key: runtimePki.serverPrivateKeyPem,
   96 |   ca: clientCaPem,
   97 | });
   98 | 
-  99 | const externalCertFile = process.env.TLS_CERT_FILE;
- 100 | const externalKeyFile = process.env.TLS_KEY_FILE;
- 101 | const useExternalCert = Boolean(externalCertFile && externalKeyFile);
  102 | 
  103 | // Externally-provided (e.g. Let's Encrypt) context + the hostnames it covers.
  104 | let externalContext: tls.SecureContext | undefined;
- 105 | let externalHosts = new Set<string>();
  106 | 
- 107 | function loadExternalContext(): void {
- 108 |   if (!externalCertFile || !externalKeyFile) return;
- 109 |   const certPem = fs.readFileSync(externalCertFile, "utf-8");
- 110 |   const keyPem = fs.readFileSync(externalKeyFile, "utf-8");
- 111 |   externalContext = tls.createSecureContext({ cert: certPem, key: keyPem, ca: clientCaPem });
- 112 |   const hosts = new Set<string>();
- 113 |   try {
- 114 |     const leaf = new x509.X509Certificate(certPem);
- 115 |     const san = leaf.getExtension(x509.SubjectAlternativeNameExtension);
- 116 |     for (const name of san?.names.toJSON() ?? []) {
- 117 |       if (name.type === "dns") hosts.add(name.value.toLowerCase());
  118 |     }
  119 |   } catch (err) {
- 120 |     console.warn(`[mock-pontes] Could not parse external cert SANs: ${(err as Error).message}`);
  121 |   }
- 122 |   externalHosts = hosts;
- 123 |   console.log(`[mock-pontes] External TLS server certificate loaded (hosts: ${[...hosts].join(", ") || "n/a"})`);
  124 | }
  125 | 
- 126 | if (useExternalCert) {
- 127 |   loadExternalContext();
  128 |   // Hot-reload on renewal: cert-manager swaps the mounted secret atomically, so
  129 |   // watch the containing directory rather than the file itself.
- 130 |   try {
- 131 |     const watchDir = path.dirname(externalCertFile!);
- 132 |     let reloadTimer: NodeJS.Timeout | null = null;
- 133 |     fs.watch(watchDir, () => {
- 134 |       if (reloadTimer) clearTimeout(reloadTimer);
- 135 |       reloadTimer = setTimeout(() => {
- 136 |         try {
- 137 |           loadExternalContext();
- 138 |           console.log("[mock-pontes] External TLS certificate reloaded");
  139 |         } catch (err) {
- 140 |           console.warn(`[mock-pontes] External TLS reload failed: ${(err as Error).message}`);
  141 |         }
  142 |       }, 1000);
  143 |     });
  144 |   } catch (err) {
- 145 |     console.warn(`[mock-pontes] Could not watch TLS cert directory: ${(err as Error).message}`);
  146 |   }
  147 | }
  148 | 
- 149 | const server = https.createServer(
  150 |   {
  151 |     // Default identity: external cert when provided, otherwise self-signed.
! 152 |     cert: useExternalCert ? fs.readFileSync(externalCertFile!, "utf-8") : runtimePki.serverCertificatePem,
! 153 |     key: useExternalCert ? fs.readFileSync(externalKeyFile!, "utf-8") : runtimePki.serverPrivateKeyPem,
  154 |     ca: clientCaPem,
  155 |     requestCert: true, // Request client certificate (mTLS)
  156 |     rejectUnauthorized: false, // Allow connections without certs (CSR endpoint); auth middleware validates
  157 |     // SNI split: serve the external cert only for the hostnames it covers,
  158 |     // self-signed for everything else (e.g. in-cluster Service names).
  159 |     ...(useExternalCert
! 160 |       ? {
- 161 |           SNICallback: (servername: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void) => {
  162 |             const ctx =
- 163 |               externalContext && externalHosts.has((servername || "").toLowerCase())
! 164 |                 ? externalContext
! 165 |                 : selfSignedContext;
- 166 |             cb(null, ctx);
  167 |           },
  168 |         }
! 169 |       : {}),
  170 |   },
  171 |   toNodeListener(app),
  172 | );
- 173 | console.log(
! 174 |   `[mock-pontes] TLS mode: ${useExternalCert ? "external certificate (SNI split with self-signed)" : "self-signed (runtime PKI)"}`,
  175 | );
  176 | 
- 177 | const listenHost = process.env.HOST || "localhost";
- 178 | await new Promise<void>((resolve, reject) => {
- 179 |   server.once("error", reject);
- 180 |   server.listen(port, listenHost, () => resolve());
  181 | });
  182 | 
- 183 | effectiveUrl = `https://${listenHost}:${port}/`;
  184 | 
- 185 | const effectivePort = new URL(effectiveUrl).port || String(port);
- 186 | console.log(`[mock-pontes] Listening on ${effectiveUrl} (port ${effectivePort})`);
  187 | 
- 188 | for (const signal of ["SIGINT", "SIGTERM"] as const) {
- 189 |   process.once(signal, () => {
- 190 |     closeRuntimePkiPersistence();
  191 |   });
  192 | }
  193 | 
```
