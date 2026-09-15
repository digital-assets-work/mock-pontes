# src/auth/enrollment-routes.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 41.45% (63/152) | `████░░░░░░` |
| Branches | 20.00% (19/95) | `██░░░░░░░░` |
| Functions | 50.00% (6/12) | `█████░░░░░` |
| Lines | 41.89% (62/148) | `████░░░░░░` |

**Uncovered lines:** 143-147, 149-151, 157-158, 168-172, 174-178, 184-187, 190-191, 195-196, 204-206, 208-212, 220-221, 233, 238-241, 246, 258, 260, 273, 284-285, 292-293, 312-313, 333-334, 354-356, 363, 382-384, 390-392, 427, 430-431, 437-441, 443-445, 451, 463-464, 471-473, 481-485, 487-489, 491, 494

**Partial branches:** L134 (if), L173 (if), L200 (cond-expr), L201 (cond-expr), L223 (binary-expr), L225 (binary-expr), L226 (cond-expr), L228 (binary-expr), L283 (if), L291 (if), L311 (if), L350 (cond-expr), L362 (if), L412 (binary-expr), L486 (if)

**Never called:** `(anonymous_5)` (L143), `(anonymous_8)` (L427), `(anonymous_9)` (L437), `(anonymous_10)` (L463), `(anonymous_11)` (L471), `realmIssuer` (L481)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
  131 | }
  132 | 
  133 | function getCertFingerprint(cert: { raw: Buffer } | undefined): string | null {
! 134 |   if (!cert || !cert.raw) return null;
  135 |   return createHash("sha256").update(cert.raw).digest("hex");
  136 | }
  137 | 
  ⋮
  140 | 
  141 |   router.post(
  142 |     "/iam/realms/:ncb/protocol/openid-connect/token",
- 143 |     defineEventHandler(async (event) => {
- 144 |       const ncb = getRouterParam(event, "ncb")!;
- 145 |       const cert = event.context.mtlsCert as { raw?: Buffer } | undefined;
- 146 |       const fingerprint = event.context.mtlsCertFingerprint as string | undefined;
- 147 |       const certValid = event.context.mtlsCertValid as boolean | undefined;
  148 | 
- 149 |       if (!cert || !certValid || !fingerprint) {
- 150 |         setResponseStatus(event, 401);
- 151 |         return {
  152 |           error: "invalid_client",
  153 |           error_description: "Valid client certificate required for token endpoint",
  154 |         };
  155 |       }
  156 | 
- 157 |       const rawBody = await readRawBody(event, "utf-8");
- 158 |       const params = rawBody ? new URLSearchParams(rawBody) : null;
  159 | 
  160 |       // `client_secret` is parsed but intentionally unused (issue #118): the
  161 |       // real IAM doesn't require one at issuance, and the mock accepts any
  ⋮
  165 |       let grantType: string;
  166 |       let refreshToken: string | null;
  167 | 
- 168 |       if (params) {
- 169 |         clientId = params.get("client_id") || "esydlt-web-app";
- 170 |         scope = params.get("scope") || "openid";
- 171 |         grantType = params.get("grant_type") || "password";
- 172 |         refreshToken = params.get("refresh_token");
! 173 |       } else {
- 174 |         const body = await readBody(event);
- 175 |         clientId = body.client_id || "esydlt-web-app";
- 176 |         scope = body.scope || "openid";
- 177 |         grantType = body.grant_type || "password";
- 178 |         refreshToken = body.refresh_token || null;
  179 |       }
  180 | 
  181 |       // Refresh grant (issue #64): exchange a valid refresh token for a fresh
  182 |       // token pair. The presented client cert must still be the one bound to
  183 |       // the user (same mTLS invariant as the password grant below).
- 184 |       if (grantType === "refresh_token") {
- 185 |         if (!refreshToken) {
- 186 |           setResponseStatus(event, 400);
- 187 |           return { error: "invalid_request", error_description: "refresh_token is required" };
  188 |         }
  189 |         let claims: jwt.JwtPayload;
- 190 |         try {
- 191 |           claims = jwt.verify(refreshToken, options.runtimePki.jwtSigningPublicKeyPem, {
  192 |             algorithms: ["ES256"],
  193 |           }) as jwt.JwtPayload;
  194 |         } catch (err: any) {
- 195 |           setResponseStatus(event, 401);
- 196 |           return {
  197 |             error: "invalid_grant",
  198 |             error_description:
  199 |               err?.name === "TokenExpiredError"
! 200 |                 ? "Refresh token has expired"
! 201 |                 : "Invalid refresh token",
  202 |           };
  203 |         }
- 204 |         if (claims.typ !== "Refresh") {
- 205 |           setResponseStatus(event, 401);
- 206 |           return { error: "invalid_grant", error_description: "Not a refresh token" };
  207 |         }
- 208 |         const refreshUsername = String(claims.preferred_username || "");
- 209 |         const boundFp = options.authUsersRepository.getFingerprintByUsername(refreshUsername);
- 210 |         if (boundFp && boundFp !== fingerprint) {
- 211 |           setResponseStatus(event, 401);
- 212 |           return {
  213 |             error: "invalid_client",
  214 |             error_description: "User must always use the same certificate",
  215 |           };
  ⋮
  217 |         // `aud` is now an array ([clientId, "account"]) — `azp` is the
  218 |         // single original requesting client_id, carry that forward instead
  219 |         // (issue #118).
- 220 |         const refreshScope = String(claims.scope || scope);
- 221 |         const { accessToken, refreshToken: newRefresh } = signTokens(
  222 |           {
! 223 |             uuid: String(claims.user_uuid || claims.sub || ""),
  224 |             username: refreshUsername,
! 225 |             profile: String(claims.user_profile || ""),
! 226 |             entityBIC: claims.entity_bic ? String(claims.entity_bic) : undefined,
  227 |             ncb,
! 228 |             clientId: String(claims.azp || clientId),
  229 |             scope: refreshScope,
  230 |           },
  231 |           options.runtimePki.jwtSigningPrivateKeyPem,
  232 |         );
- 233 |         return tokenResponse(accessToken, newRefresh, refreshScope, String(claims.user_uuid || claims.sub || ""));
  234 |       }
  235 | 
  236 |       // Password grant: real Pontes A2A auth has no per-user password —
  237 |       // identity comes solely from the enrolled mTLS certificate.
- 238 |       const username = options.authUsersRepository.getUsernameByFingerprint(fingerprint);
- 239 |       if (!username) {
- 240 |         setResponseStatus(event, 401);
- 241 |         return {
  242 |           error: "invalid_client",
  243 |           error_description: "Certificate not enrolled — enrol via /csr first",
  244 |         };
  245 |       }
- 246 |       const user = options.authUsersRepository.getUserByUsername(username)!;
  247 | 
  248 |       // Client_id is no longer validated against the user's profile at
  249 |       // issuance (issue #118): direct reproduction against `utest` showed
  ⋮
  255 |       // available and unit-tested, just no longer called here.
  256 |       // The caller's requested `scope` is ignored — the mock always issues
  257 |       // the fixed scope captured from real tokens (see FIXED_JWT_SCOPE).
- 258 |       scope = FIXED_JWT_SCOPE;
  259 | 
- 260 |       const { accessToken, refreshToken: issuedRefresh } = signTokens(
  261 |         {
  262 |           uuid: user.uuid,
  263 |           username,
  ⋮
  270 |         options.runtimePki.jwtSigningPrivateKeyPem,
  271 |       );
  272 | 
- 273 |       return tokenResponse(accessToken, issuedRefresh, scope, user.uuid);
  274 |     }),
  275 |   );
  276 | 
  ⋮
  280 |       const body = await readBody(event);
  281 |       const { username, profile, entityBIC, csr } = body;
  282 | 
! 283 |       if (!username) {
- 284 |         setResponseStatus(event, 400);
- 285 |         return {
  286 |           error: "invalid_request",
  287 |           error_description: "username is required",
  288 |         };
  289 |       }
  290 | 
! 291 |       if (!csr) {
- 292 |         setResponseStatus(event, 400);
- 293 |         return {
  294 |           error: "invalid_request",
  295 |           error_description: "csr (PKCS#10 in PEM format) required",
  296 |         };
  ⋮
  308 |         };
  309 |       }
  310 | 
! 311 |       if (!profile || !entityBIC) {
- 312 |         setResponseStatus(event, 400);
- 313 |         return {
  314 |           error: "invalid_request",
  315 |           error_description:
  316 |             "profile and entityBIC are required when declaring a new user",
  ⋮
  330 |       try {
  331 |         validateCsr(csr);
  332 |       } catch (err) {
- 333 |         setResponseStatus(event, 400);
- 334 |         return { error: "invalid_request", error_description: String(err) };
  335 |       }
  336 | 
  337 |       let signedCertPem: string;
  ⋮
  347 |           {
  348 |             username,
  349 |             entityBIC,
! 350 |             ...(adminTokenConfigured() ? { validityMinutes: ADMIN_ENROLMENT_CERT_MINUTES } : {}),
  351 |           },
  352 |         );
  353 |       } catch (err) {
- 354 |         setResponseStatus(event, 500);
- 355 |         console.error("[mock-pontes] CSR signing failed:", err);
- 356 |         return { error: "server_error", error_description: "Failed to sign certificate" };
  357 |       }
  358 | 
  359 |       try {
  360 |         const certObj = new X509Certificate(signedCertPem);
  361 |         const newFingerprint = getCertFingerprint({ raw: certObj.raw });
! 362 |         if (!newFingerprint) {
- 363 |           throw new Error("CERT_FINGERPRINT_MISSING");
  364 |         }
  365 | 
  366 |         const user = options.authUsersRepository.createDeclaredUser({
  ⋮
  379 |           `[mock-pontes] CSR signed for user=${username} uuid=${user.uuid} cert=${newFingerprint}`,
  380 |         );
  381 |       } catch (err) {
- 382 |         if (err instanceof Error && err.message === "FINGERPRINT_ALREADY_MAPPED") {
- 383 |           setResponseStatus(event, 409);
- 384 |           return {
  385 |             error: "conflict",
  386 |             error_description: "Certificate fingerprint already associated with another user",
  387 |           };
  388 |         }
  389 | 
- 390 |         setResponseStatus(event, 500);
- 391 |         console.error("[mock-pontes] Failed to register signed certificate:", err);
- 392 |         return {
  393 |           error: "server_error",
  394 |           error_description: "Failed to register enrolled user certificate",
  395 |         };
  ⋮
  409 |     "/admin/enrolled-users/:username",
  410 |     defineEventHandler((event) => {
  411 |       if (!enforceAdminToken(event)) return adminUnauthorizedBody();
! 412 |       const username = decodeURIComponent(getRouterParam(event, "username") || "");
  413 |       const removed = options.authUsersRepository.deleteUser(username);
  414 |       if (!removed) {
  415 |         setResponseStatus(event, 404);
  ⋮
  424 | 
  425 |   router.get(
  426 |     "/admin/enrolled-users",
- 427 |     defineEventHandler((event) => {
  428 |       // When ADMIN_TOKEN is set, listing enrolled users requires the token;
  429 |       // otherwise behaviour is unchanged (#35).
- 430 |       if (!enforceAdminToken(event)) return adminUnauthorizedBody();
- 431 |       return { users: options.authUsersRepository.listEnrolledUsers() };
  432 |     }),
  433 |   );
  434 | 
  435 |   router.get(
  436 |     "/admin/enrolled-users/:username/certificate",
- 437 |     defineEventHandler((event) => {
- 438 |       if (!enforceAdminToken(event)) return adminUnauthorizedBody();
- 439 |       const username = decodeURIComponent(getRouterParam(event, "username") || "");
- 440 |       const certificateFingerprint = options.authUsersRepository.getFingerprintByUsername(username);
- 441 |       const certificate = options.authUsersRepository.getCertificateByUsername(username);
  442 | 
- 443 |       if (!certificateFingerprint || !certificate) {
- 444 |         setResponseStatus(event, 404);
- 445 |         return {
  446 |           error: "not_found",
  447 |           error_description: `No enrolled certificate found for user '${username}'`,
  448 |         };
  449 |       }
  450 | 
- 451 |       return {
  452 |         username,
  453 |         certificateFingerprint,
  454 |         certificate,
  ⋮
  460 |   // JWKS: the signing public key so clients can verify issued JWTs by `kid`.
  461 |   router.get(
  462 |     "/iam/realms/:ncb/protocol/openid-connect/certs",
- 463 |     defineEventHandler(() => {
- 464 |       return buildJwks(options.runtimePki.jwtSigningPublicKeyPem);
  465 |     }),
  466 |   );
  467 | 
  468 |   // OpenID Connect discovery document for the realm.
  469 |   router.get(
  470 |     "/iam/realms/:ncb/.well-known/openid-configuration",
- 471 |     defineEventHandler((event) => {
- 472 |       const ncb = getRouterParam(event, "ncb")!;
- 473 |       return buildOpenIdConfiguration(realmIssuer(event, ncb));
  474 |     }),
  475 |   );
  476 | 
  ⋮
  478 | }
  479 | 
  480 | /** Compute the realm issuer URL, e.g. `https://host/iam/realms/bdf`. */
- 481 | function realmIssuer(event: Parameters<typeof getRequestURL>[0], ncb: string): string {
- 482 |   const envUrl = process.env.PUBLIC_EXTERNAL_URL;
- 483 |   let origin = "";
- 484 |   if (envUrl) {
- 485 |     origin = envUrl.replace(/\/$/, "");
! 486 |   } else {
- 487 |     try {
- 488 |       const u = getRequestURL(event);
- 489 |       origin = `${u.protocol}//${u.host}`;
  490 |     } catch {
- 491 |       origin = "";
  492 |     }
  493 |   }
- 494 |   return `${origin}/iam/realms/${ncb}`;
  495 | }
  496 | 
```
