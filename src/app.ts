/**
 * App builder (issue #39).
 *
 * Constructs the h3 application — error normalisation, the full middleware
 * chain, and every route — WITHOUT any I/O side effects (no PKI generation, no
 * Redis, no TLS server). The entrypoint (`index.ts`) assembles the dependencies
 * and listens; tests build the same app in-process to exercise the HTTP routes.
 */

import { createApp, setResponseStatus, type App } from "h3";

import type { MockStore } from "./state/mock-store.js";
import type { InMemoryAuthUsersRepository } from "./auth/users-repository.js";

import {
  createJwtMiddleware,
  createEnrollmentAuthRouter,
  createNroMiddleware,
  createProfileAuthorizationMiddleware,
} from "./auth/index.js";
import { createNroCertCheckMiddleware } from "./auth/nro-middleware.js";
import { createNcbValidationMiddleware } from "./auth/ncb-middleware.js";
import { createMtlsConsistencyMiddleware } from "./auth/middleware.js";
import { createLoggingMiddleware } from "./logger/middleware.js";

import { createWalletsRouter } from "./routes/wallets.js";
import { createTransfersRouter } from "./routes/transfers.js";
import { createFundingRouter } from "./routes/funding.js";
import { createBusinessWindowRouter } from "./routes/business-window.js";
import { createHealthRouter } from "./routes/health.js";
import { createBridgePaymentsRouter } from "./routes/bridge-payments.js";
import { createDirectRtgsRouter } from "./routes/direct-rtgs.js";
import { createPfodRouter } from "./routes/pfod.js";
import { createXvpRouter } from "./routes/xvp.js";
import { createUiRouter } from "./ui/router.js";
import { createAdminBusinessWindowRouter } from "./admin/business-window.js";
import { createAdminResetRouter } from "./admin/reset.js";

import {
  normalizeReturnedErrorBody,
  normalizeThrownError,
} from "./http/error-response.js";
import { createRequestValidationMiddleware } from "./http/request-validation.js";
import { mockVersion } from "./version.js";

/** API patterns that require NRO signature verification (CREATE endpoints only). */
export const nroRoutePatterns: readonly RegExp[] = [
  /\/dlt\/[^/]+\/api\/octopus\/tms\/funding-requests(?:$|\?)/,
  /\/dlt\/[^/]+\/api\/octopus\/tms\/defunding-requests(?:$|\?)/,
  /\/dlt\/[^/]+\/api\/octopus\/tms\/direct-rtgs\/payments(?:$|\?)/,
  /\/dlt\/[^/]+\/api\/bridge\/direct-rtgs\/payments(?:$|\?)/,
  /\/igw\/[^/]+\/v1\/xvps(?:$|\?)/,
  /\/igw\/[^/]+\/v1\/direct-rtgs\/xvps(?:$|\?)/,
];

export interface AppDeps {
  store: MockStore;
  runtimePki: {
    clientSigningCaPrivateKeyPem: string;
    clientSigningCaCertificatePem: string;
    serverCaCertificatePem: string;
    jwtSigningPrivateKeyPem: string;
    jwtSigningPublicKeyPem: string;
  };
  authUsersRepository: InMemoryAuthUsersRepository;
}

/**
 * Build the h3 app. Every error is normalised to the official Pontes
 * `ErrorResponse` shape ({ status, title, businessErrors[] }) — thrown errors
 * via `onError`, returned error bodies via `onBeforeResponse`; stacks are never
 * exposed (issue #33).
 */
export function buildApp({ store, runtimePki, authUsersRepository }: AppDeps): App {
  const app = createApp({
    // Mark every response as coming from the mock (issue #41) — a cheap safety
    // net so production config accidentally pointed at the mock is obvious.
    onRequest: (event) => {
      event.node.res.setHeader("X-Mock-Pontes", "true");
      event.node.res.setHeader("X-Mock-Pontes-Version", mockVersion());
    },
    onError: (error, event) => {
      if (event.handled) return;
      const body = normalizeThrownError(error);
      setResponseStatus(event, body.status);
      event.node.res.setHeader("content-type", "application/json");
      event.node.res.end(JSON.stringify(body));
    },
    onBeforeResponse: (event, response) => {
      const normalised = normalizeReturnedErrorBody(
        event.node.res.statusCode,
        event.path || "",
        response.body,
      );
      if (normalised) response.body = normalised;
    },
  });

  // Logging + mTLS context enrichment.
  app.use(createLoggingMiddleware());

  // NCB validation first, so it also covers the health route (issue #48) and
  // uses the store-sourced NCB list (issue #57). Non-NCB paths pass through.
  app.use(createNcbValidationMiddleware(store));

  // Health + native UI (unauthenticated), before the auth middlewares.
  app.use(createHealthRouter().handler);
  app.use(createUiRouter().handler);

  // Enrolment (token + CSR).
  app.use(
    createEnrollmentAuthRouter({ runtimePki, authUsersRepository }).handler,
  );

  // Auth chain.
  app.use(createJwtMiddleware(["/dlt"], runtimePki.jwtSigningPublicKeyPem));
  app.use(createMtlsConsistencyMiddleware(authUsersRepository));
  app.use(createProfileAuthorizationMiddleware());
  app.use(createNroCertCheckMiddleware(nroRoutePatterns));
  app.use(createNroMiddleware(nroRoutePatterns));

  // Request-body validation for write endpoints (issue #53) — after auth/NRO,
  // before the routers, so invalid bodies are rejected with a normalised 400.
  app.use(createRequestValidationMiddleware());

  // Pontes-compatible routes.
  app.use(createWalletsRouter(store).handler);
  app.use(createTransfersRouter(store).handler);
  app.use(createFundingRouter(store).handler);
  app.use(createBusinessWindowRouter(store).handler);
  app.use(createBridgePaymentsRouter(store).handler);
  app.use(createDirectRtgsRouter(store).handler);
  app.use(createPfodRouter(store).handler);
  app.use(createXvpRouter(store).handler);

  // Admin routes (mock-only).
  app.use(createAdminBusinessWindowRouter(store).handler);
  app.use(createAdminResetRouter(store).handler);

  return app;
}
