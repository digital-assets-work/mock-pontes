# src/auth/runtime-pki.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 59.52% (75/126) | `██████░░░░` |
| Branches | 32.61% (15/46) | `███░░░░░░░` |
| Functions | 69.23% (18/26) | `███████░░░` |
| Lines | 60.17% (71/118) | `██████░░░░` |

**Uncovered lines:** 38-39, 48-50, 54, 57-59, 68-69, 79-81, 85-86, 91-92, 97, 99, 168, 173-174, 186-188, 190, 246, 251-254, 273-274, 282-284, 289-291, 293-294, 298-300, 308-309, 318-321

**Partial branches:** L64 (binary-expr), L167 (if), L172 (if), L180 (binary-expr), L245 (if), L250 (if), L278 (if)

**Never called:** `delay` (L38), `(anonymous_11)` (L39), `assertPem` (L57), `(anonymous_14)` (L58), `getTlsCertConfig` (L186), `(anonymous_27)` (L190), `(anonymous_33)` (L290), `closeRuntimePkiPersistence` (L318)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   35 | const subtle = crypto.webcrypto.subtle as unknown as SubtleCrypto;
   36 | const SIGNING_ALG: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };
   37 | 
-  38 | function delay(ms: number): Promise<void> {
-  39 |   return new Promise((resolve) => setTimeout(resolve, ms));
   40 | }
   41 | 
   42 | async function withRetries<T>(operation: () => Promise<T>, maxAttempts = 12): Promise<T> {
  ⋮
   45 |     try {
   46 |       return await operation();
   47 |     } catch (error) {
-  48 |       lastError = error;
-  49 |       if (attempt < maxAttempts) {
-  50 |         await delay(100);
   51 |       }
   52 |     }
   53 |   }
-  54 |   throw lastError;
   55 | }
   56 | 
-  57 | function assertPem(value: string, expectedHeaders: string[], fieldName: string): void {
-  58 |   if (!expectedHeaders.some((header) => value.includes(header))) {
-  59 |     throw new Error(`Invalid persisted PKI field '${fieldName}'`);
   60 |   }
   61 | }
   62 | 
   63 | function validateBundle(raw: unknown): RuntimePkiBundle | null {
!  64 |   if (!raw || typeof raw !== "object") {
   65 |     return null;
   66 |   }
   67 | 
-  68 |   const candidate = raw as Partial<RuntimePkiBundle>;
-  69 |   const requiredFields: Array<keyof RuntimePkiBundle> = [
   70 |     "version",
   71 |     "generatedAt",
   72 |     "serverCaCertificatePem",
  ⋮
   76 |     "clientSigningCaCertificatePem",
   77 |   ];
   78 | 
-  79 |   for (const field of requiredFields) {
-  80 |     if (!(field in candidate) || candidate[field] === undefined || candidate[field] === null) {
-  81 |       throw new Error(`Persisted PKI bundle is incomplete (missing '${field}')`);
   82 |     }
   83 |   }
   84 | 
-  85 |   assertPem(candidate.serverCaCertificatePem as string, ["-----BEGIN CERTIFICATE-----"], "serverCaCertificatePem");
-  86 |   assertPem(
   87 |     candidate.serverPrivateKeyPem as string,
   88 |     ["-----BEGIN PRIVATE KEY-----", "-----BEGIN EC PRIVATE KEY-----"],
   89 |     "serverPrivateKeyPem",
   90 |   );
-  91 |   assertPem(candidate.serverCertificatePem as string, ["-----BEGIN CERTIFICATE-----"], "serverCertificatePem");
-  92 |   assertPem(
   93 |     candidate.clientSigningCaPrivateKeyPem as string,
   94 |     ["-----BEGIN PRIVATE KEY-----", "-----BEGIN EC PRIVATE KEY-----"],
   95 |     "clientSigningCaPrivateKeyPem",
   96 |   );
-  97 |   assertPem(candidate.clientSigningCaCertificatePem as string, ["-----BEGIN CERTIFICATE-----"], "clientSigningCaCertificatePem");
   98 | 
-  99 |   return candidate as RuntimePkiBundle;
  100 | }
  101 | 
  102 | async function exportKeyToPem(key: CryptoKey): Promise<string> {
  ⋮
  164 |     .filter(Boolean)
  165 |     .map((entry) => {
  166 |       const colonIdx = entry.indexOf(":");
! 167 |       if (colonIdx === -1) {
- 168 |         throw new Error(`Invalid TLS_SAN entry (expected type:value): '${entry}'`);
  169 |       }
  170 |       const type = entry.substring(0, colonIdx).toLowerCase();
  171 |       const value = entry.substring(colonIdx + 1);
! 172 |       if (type === "dns") return { type: "dns" as const, value };
- 173 |       if (type === "ip") return { type: "ip" as const, value };
- 174 |       throw new Error(`Unsupported TLS_SAN type '${type}' (supported: dns, ip)`);
  175 |     });
  176 | }
  177 | 
  178 | function resolveTlsSubject(sans: x509.JsonGeneralName[]): string {
  179 |   return process.env.TLS_SUBJECT
! 180 |     || `CN=${sans.find((s) => s.type === "dns")?.value ?? "localhost"}, O=MockPontes, C=DEV`;
  181 | }
  182 | 
  183 | /**
  184 |  * Returns the resolved TLS certificate configuration for logging/display purposes.
  185 |  */
- 186 | export function getTlsCertConfig(): { subject: string; san: string } {
- 187 |   const sans = parseSanEntries();
- 188 |   return {
  189 |     subject: resolveTlsSubject(sans),
- 190 |     san: sans.map((s) => `${s.type}:${s.value}`).join(", "),
  191 |   };
  192 | }
  193 | 
  ⋮
  242 | }
  243 | 
  244 | function getCache(): CacheInterface {
! 245 |   if (cache) {
- 246 |     return cache;
  247 |   }
  248 | 
  249 |   const redisUrl = process.env.REDIS_URL;
! 250 |   if (redisUrl) {
- 251 |     cache = new RedisCache(redisUrl, PKI_CACHE_PREFIX);
- 252 |     usingRedis = true;
- 253 |     console.log(`[mock-pontes] PKI persistence enabled via Redis (${redisUrl})`);
- 254 |     return cache;
  255 |   }
  256 | 
  257 |   cache = new CacheMemory();
  ⋮
  270 |   try {
  271 |     persisted = validateBundle(await withRetries(() => pkiCache.get<RuntimePkiBundle>(PKI_CACHE_KEY)));
  272 |   } catch (err) {
- 273 |     if (usingRedis) {
- 274 |       throw new Error(`Failed to read PKI bundle from Redis: ${String(err)}`);
  275 |     }
  276 |   }
  277 | 
! 278 |   if (persisted) {
  279 |     // Backward-compatible upgrade: a bundle persisted before #47 has no JWT
  280 |     // signing key. Generate one and merge it in-place (preserving the CAs so
  281 |     // already-enrolled client certificates stay valid), then re-persist.
- 282 |     if (!persisted.jwtSigningPrivateKeyPem || !persisted.jwtSigningPublicKeyPem) {
- 283 |       const jwtKeys = await generateSigningKeyPair();
- 284 |       persisted = {
  285 |         ...persisted,
  286 |         jwtSigningPrivateKeyPem: jwtKeys.privateKeyPem,
  287 |         jwtSigningPublicKeyPem: jwtKeys.publicKeyPem,
  288 |       };
- 289 |       try {
- 290 |         await withRetries(() => pkiCache.put(PKI_CACHE_KEY, persisted, Number.NaN));
- 291 |         console.log("[mock-pontes] Upgraded persisted PKI bundle with a JWT signing key");
  292 |       } catch (err) {
- 293 |         if (usingRedis) {
- 294 |           throw new Error(`Failed to persist upgraded PKI bundle to Redis: ${String(err)}`);
  295 |         }
  296 |       }
  297 |     }
- 298 |     cachedBundle = persisted;
- 299 |     console.log("[mock-pontes] Reusing PKI bundle from persisted cache");
- 300 |     return cachedBundle;
  301 |   }
  302 | 
  303 |   const generated = await generateRuntimePkiBundle();
  ⋮
  305 |   try {
  306 |     await withRetries(() => pkiCache.put(PKI_CACHE_KEY, generated, Number.NaN));
  307 |   } catch (err) {
- 308 |     if (usingRedis) {
- 309 |       throw new Error(`Failed to persist PKI bundle to Redis: ${String(err)}`);
  310 |     }
  311 |   }
  312 | 
  ⋮
  315 |   return cachedBundle;
  316 | }
  317 | 
- 318 | export function closeRuntimePkiPersistence(): void {
- 319 |   if (cache) {
- 320 |     cache.close();
- 321 |     cache = null;
  322 |   }
  323 | }
  324 | 
```
