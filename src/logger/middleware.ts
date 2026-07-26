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
      const fp = event.context.mtlsCertFingerprint || "<none>";
      const valid = event.context.mtlsCertValid
        ? "valid"
        : `INVALID (${event.context.mtlsCertError || "unknown"})`;
      console.log(
        `[mock-pontes] ${method} ${url} status=${status} durationMs=${durationMs.toFixed(1)} user=${user} cert=${fp} certValid=${valid}`,
      );
    });
  });
};