import { defineEventHandler } from "h3";
import type { TLSSocket } from "node:tls";
import { createHash } from "node:crypto";

function getCertFingerprint(cert: { raw: Buffer } | undefined): string | null {
  if (!cert || !cert.raw) return null;
  return createHash("sha256").update(cert.raw).digest("hex");
}

export const createLoggingMiddleware = () => {
  return defineEventHandler((event) => {
    const start = process.hrtime.bigint();

    // Only for mTLS mode
    const socket = event.node?.req?.socket as TLSSocket;
    if (socket && typeof socket.getPeerCertificate === "function") {
      const cert = socket.getPeerCertificate();
      if (cert && cert.raw) {
        const fingerprint = getCertFingerprint(cert);
        event.context.mtlsCert = cert;
        event.context.mtlsCertFingerprint = fingerprint;
      }
      event.context.mtlsCertValid = socket.authorized;
      event.context.mtlsCertError = socket.authorizationError || null;
    }

    // Log every HTTP call at end of response with user/cert info + duration
    const url = event.path;
    const method = event.method;
    event.node.res.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const status = event.node.res.statusCode;
      const user = event.context?.auth?.username || "<unauth>";
      // Only emit a cert verdict when a client certificate was actually
      // presented. Normal unauthenticated traffic presents none and none is
      // required, so log `cert=<none>` rather than a misleading
      // `certValid=INVALID (UNABLE_TO_GET_ISSUER_CERT)` (issue #98).
      const fingerprint = event.context.mtlsCertFingerprint;
      const certInfo = fingerprint
        ? `cert=${fingerprint} certValid=${
            event.context.mtlsCertValid ? "valid" : `INVALID (${event.context.mtlsCertError || "unknown"})`
          }`
        : "cert=<none>";
      console.log(
        `[mock-pontes] ${method} ${url} status=${status} durationMs=${durationMs.toFixed(1)} user=${user} ${certInfo}`,
      );
    });
  });
};