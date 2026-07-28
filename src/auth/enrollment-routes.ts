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
import { buildJwks, buildOpenIdConfiguration } from "./oidc.js";
import { signCsr, validateCsr } from "./csr-handler.js";
import type { InMemoryAuthUsersRepository } from "./users-repository.js";
import { isStrictMode, validateClientIdForProfile } from "./profile-enforcement.js";
import { track } from "../http/route-registry.js";
import {
  adminTokenConfigured,
  enforceAdminToken,
  adminUnauthorizedBody,
  ADMIN_ENROLMENT_CERT_MINUTES,
} from "./admin-token.js";

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
      let body: any = null;

      if (params) {
        username = params.get("username") || "";
        password = params.get("password") || "";
        clientId = params.get("client_id") || "esydlt-web-app";
        clientSecret = params.get("client_secret") || null;
        scope = params.get("scope") || "openid";
      } else {
        body = await readBody(event);
        username = body.username || "";
        password = body.password || "";
        clientId = body.client_id || "esydlt-web-app";
        clientSecret = body.client_secret || null;
        scope = body.scope || "openid";
      }

      const user = options.authUsersRepository.validateCredentials(username, password);
      if (!user) {
        setResponseStatus(event, 401);
        return { error: "invalid_grant", error_description: "Invalid user credentials" };
      }

      // Strict profile/client_id enforcement (Table U)
      if (isStrictMode()) {
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

      const now = Math.floor(Date.now() / 1000);
      const expiresIn = 300;
      const payload = {
        sub: user.uuid,
        iss: `mock-pontes/iam/realms/${ncb}`,
        aud: clientId,
        iat: now,
        exp: now + expiresIn,
        scope,
        preferred_username: username,
        user_uuid: user.uuid,
        user_profile: user.profile,
        entity_bic: user.entityBIC,
        realm: ncb,
      };

      const accessToken = jwt.sign(payload, options.runtimePki.jwtSigningPrivateKeyPem, {
        algorithm: "ES256",
        keyid: "mock-pontes-key-1",
      });

      return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: expiresIn,
        scope,
        not_before_policy: 0,
        session_state: `mock-session-${user.uuid}`,
      };
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
        // short-lived (1 hour) certificate (#35).
        signedCertPem = await signCsr(
          csr,
          options.runtimePki.clientSigningCaPrivateKeyPem,
          options.runtimePki.clientSigningCaCertificatePem,
          adminTokenConfigured()
            ? { validityMinutes: ADMIN_ENROLMENT_CERT_MINUTES }
            : {},
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
