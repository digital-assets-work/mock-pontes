import {
  createRouter,
  defineEventHandler,
  getRequestURL,
  getRouterParam,
  readBody,
  readRawBody,
  setResponseStatus,
} from "h3";
import { createHash, X509Certificate } from "node:crypto";
import jwt from "jsonwebtoken";
import { buildJwks, buildOpenIdConfiguration, SIGNING_KEY_ID } from "./oidc.js";
import { signCsr, validateCsr } from "./csr-handler.js";
import type { InMemoryAuthUsersRepository } from "./users-repository.js";
import { validateClientIdForProfile, isKnownProfile, KNOWN_PROFILES } from "./profile-enforcement.js";
import { track } from "../http/route-registry.js";
import {
  adminTokenConfigured,
  enforceAdminToken,
  adminUnauthorizedBody,
  ADMIN_ENROLMENT_CERT_MINUTES,
} from "./admin-token.js";

/** Access token lifetime (Keycloak default parity). */
const ACCESS_TOKEN_TTL_SEC = 300;
/** Refresh token lifetime — 10 days (issue #64). */
const REFRESH_TOKEN_TTL_SEC = 10 * 24 * 60 * 60;

interface TokenSubject {
  uuid: string;
  username: string;
  profile: string;
  entityBIC?: string;
  ncb: string;
  clientId: string;
  scope: string;
}

/**
 * Mint the access + refresh token pair for a subject (issue #64). Both are
 * ES256 JWTs signed with the runtime PKI JWT key; the refresh token carries
 * `typ: "Refresh"` and a 10-day expiry and is only accepted at the token
 * endpoint's refresh grant (the JWT middleware rejects it as a bearer token).
 */
function signTokens(subject: TokenSubject, privateKeyPem: string): {
  accessToken: string;
  refreshToken: string;
} {
  const now = Math.floor(Date.now() / 1000);
  const common = {
    sub: subject.uuid,
    iss: `mock-pontes/iam/realms/${subject.ncb}`,
    aud: subject.clientId,
    scope: subject.scope,
    preferred_username: subject.username,
    user_uuid: subject.uuid,
    user_profile: subject.profile,
    entity_bic: subject.entityBIC,
    realm: subject.ncb,
  };
  const accessToken = jwt.sign(
    { ...common, iat: now, exp: now + ACCESS_TOKEN_TTL_SEC, typ: "Bearer" },
    privateKeyPem,
    { algorithm: "ES256", keyid: SIGNING_KEY_ID },
  );
  const refreshToken = jwt.sign(
    { ...common, iat: now, exp: now + REFRESH_TOKEN_TTL_SEC, typ: "Refresh" },
    privateKeyPem,
    { algorithm: "ES256", keyid: SIGNING_KEY_ID },
  );
  return { accessToken, refreshToken };
}

/** Shape the Keycloak-compatible token response (issue #64 adds refresh_token). */
function tokenResponse(accessToken: string, refreshToken: string, scope: string, uuid: string) {
  return {
    access_token: accessToken,
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: refreshToken,
    refresh_expires_in: REFRESH_TOKEN_TTL_SEC,
    token_type: "Bearer",
    not_before_policy: 0,
    session_state: `mock-session-${uuid}`,
    scope,
  };
}

interface RuntimePkiMaterial {
  clientSigningCaPrivateKeyPem: string;
  clientSigningCaCertificatePem: string;
  serverCaCertificatePem: string;
  jwtSigningPrivateKeyPem: string;
  jwtSigningPublicKeyPem: string;
}

interface EnrollmentRouterOptions {
  runtimePki: RuntimePkiMaterial;
  authUsersRepository: InMemoryAuthUsersRepository;
}

function getCertFingerprint(cert: { raw: Buffer } | undefined): string | null {
  if (!cert || !cert.raw) return null;
  return createHash("sha256").update(cert.raw).digest("hex");
}

function derCertificateToPem(raw: Buffer): string {
  const base64 = raw.toString("base64");
  const wrapped = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
  return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----`;
}

export function createEnrollmentAuthRouter(options: EnrollmentRouterOptions) {
  const router = track(createRouter());

  router.post(
    "/iam/realms/:ncb/protocol/openid-connect/token",
    defineEventHandler(async (event) => {
      const ncb = getRouterParam(event, "ncb")!;
      const cert = event.context.mtlsCert as { raw?: Buffer } | undefined;
      const fingerprint = event.context.mtlsCertFingerprint as string | undefined;
      const certValid = event.context.mtlsCertValid as boolean | undefined;

      if (!cert || !certValid || !fingerprint) {
        setResponseStatus(event, 401);
        return {
          error: "invalid_client",
          error_description: "Valid client certificate required for token endpoint",
        };
      }

      const rawBody = await readRawBody(event, "utf-8");
      const params = rawBody ? new URLSearchParams(rawBody) : null;

      let username: string;
      let password: string;
      let clientId: string;
      let clientSecret: string | null;
      let scope: string;
      let grantType: string;
      let refreshToken: string | null;
      let body: any = null;

      if (params) {
        username = params.get("username") || "";
        password = params.get("password") || "";
        clientId = params.get("client_id") || "esydlt-web-app";
        clientSecret = params.get("client_secret") || null;
        scope = params.get("scope") || "openid";
        grantType = params.get("grant_type") || "password";
        refreshToken = params.get("refresh_token");
      } else {
        body = await readBody(event);
        username = body.username || "";
        password = body.password || "";
        clientId = body.client_id || "esydlt-web-app";
        clientSecret = body.client_secret || null;
        scope = body.scope || "openid";
        grantType = body.grant_type || "password";
        refreshToken = body.refresh_token || null;
      }

      // Refresh grant (issue #64): exchange a valid refresh token for a fresh
      // token pair without re-supplying the password. The presented client cert
      // must still be the one bound to the user (same mTLS invariant).
      if (grantType === "refresh_token") {
        if (!refreshToken) {
          setResponseStatus(event, 400);
          return { error: "invalid_request", error_description: "refresh_token is required" };
        }
        let claims: jwt.JwtPayload;
        try {
          claims = jwt.verify(refreshToken, options.runtimePki.jwtSigningPublicKeyPem, {
            algorithms: ["ES256"],
          }) as jwt.JwtPayload;
        } catch (err: any) {
          setResponseStatus(event, 401);
          return {
            error: "invalid_grant",
            error_description:
              err?.name === "TokenExpiredError"
                ? "Refresh token has expired"
                : "Invalid refresh token",
          };
        }
        if (claims.typ !== "Refresh") {
          setResponseStatus(event, 401);
          return { error: "invalid_grant", error_description: "Not a refresh token" };
        }
        const refreshUsername = String(claims.preferred_username || "");
        const boundFp = options.authUsersRepository.getFingerprintByUsername(refreshUsername);
        if (boundFp && boundFp !== fingerprint) {
          setResponseStatus(event, 401);
          return {
            error: "invalid_client",
            error_description: "User must always use the same certificate",
          };
        }
        const refreshScope = String(claims.scope || scope);
        const { accessToken, refreshToken: newRefresh } = signTokens(
          {
            uuid: String(claims.user_uuid || claims.sub || ""),
            username: refreshUsername,
            profile: String(claims.user_profile || ""),
            entityBIC: claims.entity_bic ? String(claims.entity_bic) : undefined,
            ncb,
            clientId: String(claims.aud || clientId),
            scope: refreshScope,
          },
          options.runtimePki.jwtSigningPrivateKeyPem,
        );
        return tokenResponse(accessToken, newRefresh, refreshScope, String(claims.user_uuid || claims.sub || ""));
      }

      const user = options.authUsersRepository.validateCredentials(username, password);
      if (!user) {
        setResponseStatus(event, 401);
        return { error: "invalid_grant", error_description: "Invalid user credentials" };
      }

      // Profile/client_id enforcement (Table U) — always strict.
      const validation = validateClientIdForProfile(user.profile, clientId, clientSecret);
      if (!validation.valid) {
        console.warn(
          `[mock-pontes] enrollment-token:invalid_client username=${username} profile=${user.profile} client_id=${clientId} reason=${validation.error}`,
        );
        setResponseStatus(event, 401);
        return {
          error: "invalid_client",
          error_description: validation.error,
        };
      }

      const prevFp = options.authUsersRepository.getFingerprintByUsername(username);
      if (prevFp) {
        if (prevFp !== fingerprint) {
          setResponseStatus(event, 401);
          return {
            error: "invalid_client",
            error_description: "User must always use the same certificate",
          };
        }
      }

      const prevUser = options.authUsersRepository.getUsernameByFingerprint(fingerprint);
      if (prevUser && prevUser !== username) {
        setResponseStatus(event, 401);
        return {
          error: "invalid_client",
          error_description: "Certificate already associated with a different user",
        };
      }

      if (cert.raw && fingerprint) {
        options.authUsersRepository.setUserCertificate(
          username,
          derCertificateToPem(cert.raw),
          fingerprint,
        );
      }

      const { accessToken, refreshToken: issuedRefresh } = signTokens(
        {
          uuid: user.uuid,
          username,
          profile: user.profile,
          entityBIC: user.entityBIC,
          ncb,
          clientId,
          scope,
        },
        options.runtimePki.jwtSigningPrivateKeyPem,
      );

      return tokenResponse(accessToken, issuedRefresh, scope, user.uuid);
    }),
  );

  router.post(
    "/iam/realms/:ncb/protocol/openid-connect/csr",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      const { username, password, profile, entityBIC, csr } = body;

      if (!username || !password) {
        setResponseStatus(event, 400);
        return {
          error: "invalid_request",
          error_description: "username and password are required",
        };
      }

      if (!csr) {
        setResponseStatus(event, 400);
        return {
          error: "invalid_request",
          error_description: "csr (PKCS#10 in PEM format) required",
        };
      }

      const existingUser = options.authUsersRepository.getUserByUsername(username);
      if (!existingUser && (!profile || !entityBIC)) {
        setResponseStatus(event, 400);
        return {
          error: "invalid_request",
          error_description:
            "profile and entityBIC are required when declaring a new user",
        };
      }

      // Reject a typo'd / unknown profile at enrolment (issue #84) so it cannot
      // silently produce a user that bypasses the Table U client_id binding.
      if (profile && !isKnownProfile(profile)) {
        setResponseStatus(event, 400);
        return {
          error: "invalid_request",
          error_description: `Unknown profile '${profile}'. Expected one of: ${[...KNOWN_PROFILES].join(", ")}`,
        };
      }

      if (existingUser) {
        const verifiedUser = options.authUsersRepository.validateCredentials(
          username,
          password,
        );
        if (!verifiedUser) {
          setResponseStatus(event, 401);
          return {
            error: "invalid_grant",
            error_description: "Invalid user credentials",
          };
        }
      }

      try {
        validateCsr(csr);
      } catch (err) {
        setResponseStatus(event, 400);
        return { error: "invalid_request", error_description: String(err) };
      }

      let signedCertPem: string;
      try {
        // When the admin gate is enabled, enrolment still works but issues a
        // short-lived (1 hour) certificate (#35). The enrolment identity is
        // passed through so the issued cert carries the Fabric attributes
        // (enrolment id + MSP id + CSR-supplied privilege) like the real CA (#72).
        const effectiveEntityBIC = entityBIC || existingUser?.entityBIC;
        signedCertPem = await signCsr(
          csr,
          options.runtimePki.clientSigningCaPrivateKeyPem,
          options.runtimePki.clientSigningCaCertificatePem,
          {
            username,
            entityBIC: effectiveEntityBIC,
            ...(adminTokenConfigured() ? { validityMinutes: ADMIN_ENROLMENT_CERT_MINUTES } : {}),
          },
        );
      } catch (err) {
        setResponseStatus(event, 500);
        console.error("[mock-pontes] CSR signing failed:", err);
        return { error: "server_error", error_description: "Failed to sign certificate" };
      }

      try {
        const certObj = new X509Certificate(signedCertPem);
        const newFingerprint = getCertFingerprint({ raw: certObj.raw });
        if (!newFingerprint) {
          throw new Error("CERT_FINGERPRINT_MISSING");
        }

        const user = existingUser
          ? options.authUsersRepository.updateUserMetadata(username, {
              profile,
              entityBIC,
            })
          : options.authUsersRepository.createDeclaredUser({
              username,
              password,
              profile,
              entityBIC,
            });

        options.authUsersRepository.setUserCertificate(
          username,
          signedCertPem,
          newFingerprint,
        );

        console.log(
          `[mock-pontes] CSR signed for user=${username} uuid=${user.uuid} cert=${newFingerprint}`,
        );
      } catch (err) {
        if (err instanceof Error && err.message === "FINGERPRINT_ALREADY_MAPPED") {
          setResponseStatus(event, 409);
          return {
            error: "conflict",
            error_description: "Certificate fingerprint already associated with another user",
          };
        }

        setResponseStatus(event, 500);
        console.error("[mock-pontes] Failed to register signed certificate:", err);
        return {
          error: "server_error",
          error_description: "Failed to register enrolled user certificate",
        };
      }

      return {
        certificate: signedCertPem,
      };
    }),
  );

  router.get(
    "/admin/enrolled-users",
    defineEventHandler((event) => {
      // When ADMIN_TOKEN is set, listing enrolled users requires the token;
      // otherwise behaviour is unchanged (#35).
      if (!enforceAdminToken(event)) return adminUnauthorizedBody();
      return { users: options.authUsersRepository.listEnrolledUsers() };
    }),
  );

  router.get(
    "/admin/enrolled-users/:username/certificate",
    defineEventHandler((event) => {
      if (!enforceAdminToken(event)) return adminUnauthorizedBody();
      const username = decodeURIComponent(getRouterParam(event, "username") || "");
      const certificateFingerprint = options.authUsersRepository.getFingerprintByUsername(username);
      const certificate = options.authUsersRepository.getCertificateByUsername(username);

      if (!certificateFingerprint || !certificate) {
        setResponseStatus(event, 404);
        return {
          error: "not_found",
          error_description: `No enrolled certificate found for user '${username}'`,
        };
      }

      return {
        username,
        certificateFingerprint,
        certificate,
      };
    }),
  );

  // --- IAM (Keycloak-compatible) discovery + JWKS ---
  // JWKS: the signing public key so clients can verify issued JWTs by `kid`.
  router.get(
    "/iam/realms/:ncb/protocol/openid-connect/certs",
    defineEventHandler(() => {
      return buildJwks(options.runtimePki.jwtSigningPublicKeyPem);
    }),
  );

  // OpenID Connect discovery document for the realm.
  router.get(
    "/iam/realms/:ncb/.well-known/openid-configuration",
    defineEventHandler((event) => {
      const ncb = getRouterParam(event, "ncb")!;
      return buildOpenIdConfiguration(realmIssuer(event, ncb));
    }),
  );

  return router;
}

/** Compute the realm issuer URL, e.g. `https://host/iam/realms/bdf`. */
function realmIssuer(event: Parameters<typeof getRequestURL>[0], ncb: string): string {
  const envUrl = process.env.PUBLIC_EXTERNAL_URL;
  let origin = "";
  if (envUrl) {
    origin = envUrl.replace(/\/$/, "");
  } else {
    try {
      const u = getRequestURL(event);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = "";
    }
  }
  return `${origin}/iam/realms/${ncb}`;
}
