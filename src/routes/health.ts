import {
  createRouter,
  defineEventHandler,
  getRequestHeader,
  setResponseStatus,
} from "h3";
import type { PeerCertificate } from "node:tls";
import type { InMemoryAuthUsersRepository } from "../auth/users-repository.js";

/**
 * Health endpoint — unauthenticated, matches real Pontes common.Health schema.
 * Adds `mock: true` so a client can detect it's connected to mock-pontes.
 *
 * Also exposes the gateway connectivity troubleshooting endpoints documented in
 * the ECB SDD (§6.3): `/check/ip` and `/check/mtls`. On the real Pontes these
 * live at the domain root (not under /dlt/{ncb}); the mock mirrors that so a
 * client's preflight validator can exercise Stage 1 (transport) locally.
 */

/** Strip the IPv4-mapped IPv6 prefix (::ffff:) for readability. */
function normalizeIp(ip: string | undefined): string {
  if (!ip) return "unknown";
  return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
}

export function createHealthRouter(authUsersRepository: InMemoryAuthUsersRepository) {
  const router = createRouter();

  router.get(
    "/dlt/:ncb/api/octopus/health",
    defineEventHandler(() => {
      return {
        octopus: "UP",
        server: "UP",
        mock: true,
      };
    }),
  );

  // GET /check/ip — IP whitelisting check (no client cert required).
  // Returns the caller's source IP address (honouring X-Forwarded-For when set).
  router.get(
    "/check/ip",
    defineEventHandler((event) => {
      const forwarded = getRequestHeader(event, "x-forwarded-for");
      const ip = forwarded
        ? forwarded.split(",")[0]!.trim()
        : event.node?.req?.socket?.remoteAddress;
      return { status: "OK", check: "ip", ip: normalizeIp(ip), mock: true };
    }),
  );

  // GET /check/mtls — client certificate acceptance check.
  // Rejects (403) any request that does not present a VALID client certificate
  // (i.e. one signed by the mock's client-signing CA). On success returns the
  // SHA-256 fingerprint of the presented certificate, the certificate's
  // subject Common Name, and whether that exact certificate is currently
  // bound to an enrolled user (a valid, CA-signed cert can still belong to a
  // user who was since removed via `DELETE /admin/enrolled-users/{username}`).
  router.get(
    "/check/mtls",
    defineEventHandler((event) => {
      const fingerprint = event.context.mtlsCertFingerprint as string | undefined;
      const valid = event.context.mtlsCertValid as boolean | undefined;

      if (!fingerprint || !valid) {
        setResponseStatus(event, 403);
        return {
          status: "REJECTED",
          check: "mtls",
          error: fingerprint
            ? "Client certificate is not trusted (not signed by the accepted CA)"
            : "No client certificate presented",
          mock: true,
        };
      }

      const cert = event.context.mtlsCert as PeerCertificate | undefined;
      const user = cert?.subject?.CN;
      const enrolled = authUsersRepository.getUsernameByFingerprint(fingerprint) !== undefined;

      return { status: "OK", check: "mtls", fingerprint, user, enrolled, mock: true };
    }),
  );

  return router;
}
