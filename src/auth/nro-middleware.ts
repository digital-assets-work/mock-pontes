/**
 * NRO (Non-Repudiation of Origin) signature verification middleware.
 *
 * Only applies to funding/defunding routes that require signature + signerPEM.
 * Verifies ECDSA P-256 + SHA-256 signature against the provided certificate.
 */

import {
  defineEventHandler,
  getMethod,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { createVerify, X509Certificate } from "node:crypto";

function requiresNRO(
  path: string,
  method: string,
  routePatterns: readonly RegExp[],
): boolean {
  if (method !== "POST" && method !== "PUT") return false;
  return routePatterns.some((pattern) => pattern.test(path));
}

/**
 * Build the canonical signing data from request fields, per Pontes v1.0 spec.
 * Field order: ID first, then amount, then BICs.
 */
function buildSigningData(body: Record<string, any>): string | null {
  // Funding / Defunding: techFundRequestID + amount + creditedCashWalletOwnerID + debitedCashWalletOwnerID
  if (body.techFundRequestID != null) {
    const parts = [
      body.techFundRequestID,
      body.amount,
      body.creditedCashWalletOwnerID,
      body.debitedCashWalletOwnerID,
    ];
    if (parts.some((p) => p == null)) return null;
    return parts.join("");
  }

  // Direct RTGS Payment: id + amount + payerBank + receiverBank
  if (body.payerBank != null) {
    const parts = [body.id, body.amount, body.payerBank, body.receiverBank];
    if (parts.some((p) => p == null)) return null;
    return parts.join("");
  }

  // XvP: transform xvpTransactionId + amount + buyer.bic + seller.bic
  if (body.xvpTransactionId != null) {
    const xvpId = "xvp" + String(body.xvpTransactionId).replace(/-/g, "");
    const parts = [xvpId, body.amount, body.buyer?.bic, body.seller?.bic];
    if (parts.some((p) => p == null)) return null;
    return parts.join("");
  }

  return null;
}

/**
 * Verify an ECDSA P-256 + SHA-256 signature.
 */
function verifySignature(
  data: string,
  signatureBase64: string,
  certPem: string,
): boolean {
  try {
    const verify = createVerify("SHA256");
    verify.update(data);
    verify.end();
    return verify.verify(certPem, signatureBase64, "base64");
  } catch {
    return false;
  }
}

/**
 * Decode the signerPEM field back to a PEM certificate.
 * The signerPEM is the base64-encoded DER certificate without PEM headers.
 */
function decodeCertPem(signerPEM: string): string {
  // If it already has PEM headers, return as-is
  if (signerPEM.includes("-----BEGIN CERTIFICATE-----")) {
    return signerPEM;
  }
  // Wrap base64 DER in PEM headers
  const lines = signerPEM.match(/.{1,64}/g) || [signerPEM];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
}

export function createNroMiddleware(routePatterns: readonly RegExp[]) {
  return defineEventHandler(async (event: H3Event) => {
    const path = event.path || "";
    const method = getMethod(event);

    if (!requiresNRO(path, method, routePatterns)) return;

    // Read body — we need to peek at it for NRO validation
    const body = await readBody(event);

    if (!body || !body.signature || !body.signerPEM) {
      setResponseStatus(event, 400);
      return {
        businessErrors: [
          {
            errorCode: "HL-NRO-001",
            errorDescription:
              "Missing required NRO fields: signature and signerPEM",
          },
        ],
      };
    }

    const signingData = buildSigningData(body);
    if (!signingData) {
      setResponseStatus(event, 400);
      return {
        businessErrors: [
          {
            errorCode: "HL-NRO-002",
            errorDescription:
              "Cannot determine signing fields from request body",
          },
        ],
      };
    }

    const certPem = decodeCertPem(body.signerPEM);
    const valid = verifySignature(signingData, body.signature, certPem);

    if (!valid) {
      setResponseStatus(event, 400);
      return {
        businessErrors: [
          {
            errorCode: "HL-NRO-003",
            errorDescription: "NRO signature verification failed",
          },
        ],
      };
    }

    // Store parsed body so handlers don't need to re-read
    event.context.parsedBody = body;
    event.context.nroVerified = true;
  });
}

export function createNroCertCheckMiddleware(routePatterns: readonly RegExp[]) {
  return defineEventHandler(async (event) => {
    const path = event.path || "";
    const method = getMethod(event);

    if (!requiresNRO(path, method, routePatterns)) return;

    const body =
      event.context?.parsedBody ||
      (event.node.req.method === "POST" || event.node.req.method === "PUT"
        ? await readBody(event)
        : undefined);

    if (body && body.signerPEM && event.context.mtlsCert) {
      try {
        // Decode NRO cert
        let signerPem = body.signerPEM;
        if (!signerPem.includes("-----BEGIN CERTIFICATE-----")) {
          const lines = signerPem.match(/.{1,64}/g) || [signerPem];
          signerPem = `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
        }
        const nroCert = new X509Certificate(signerPem);
        const mtlsCert = event.context.mtlsCert;
        // Compare raw DER
        if (Buffer.compare(nroCert.raw, mtlsCert.raw) !== 0) {
          setResponseStatus(event, 400);
          return {
            businessErrors: [
              {
                errorCode: "HL-NRO-004",
                errorDescription:
                  "NRO certificate does not match mTLS certificate",
              },
            ],
          };
        }
      } catch {
        // Invalid signerPEM format is handled by downstream NRO middleware.
      }
    }
  });
}
