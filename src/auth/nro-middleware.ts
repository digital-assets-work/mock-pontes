/**
 * NRO (Non-Repudiation of Origin) signature verification middleware.
 *
 * Applies to exactly the operations the official spec marks as NRO-signed — the
 * RTGS-affecting writes that carry `signature` + `signerPEM` in their request
 * schema (equivalently, a `## Signing Rules:` section). The enforced route set is
 * derived from the vendored spec (see {@link deriveNroRouteMatchers}) so it stays
 * in lock-step with the contract instead of a hand-maintained list.
 *
 * Verifies an ECDSA P-256 + SHA-256 signature against the provided certificate.
 */

import {
  defineEventHandler,
  getMethod,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { createVerify, X509Certificate } from "node:crypto";
import officialSpec from "../ui/spec/pontes-official-v1.0.json";

/** An NRO-enforced route: the HTTP method plus a matcher for the request path. */
export interface NroRouteMatcher {
  readonly method: "POST" | "PUT";
  readonly regex: RegExp;
}

type SpecNode = Record<string, unknown>;

/** Follow `$ref` chains within the vendored spec (cycle-safe). */
function resolveRef(node: unknown, seen: Set<string>): unknown {
  let current = node;
  while (
    current &&
    typeof current === "object" &&
    typeof (current as SpecNode).$ref === "string"
  ) {
    const ref = (current as SpecNode).$ref as string;
    if (seen.has(ref)) return undefined;
    seen.add(ref);
    current = ref
      .split("/")
      .slice(1)
      .reduce<unknown>(
        (acc, key) => (acc == null ? acc : (acc as SpecNode)[key]),
        officialSpec as unknown,
      );
  }
  return current;
}

/** True if a request schema (following `$ref`/`allOf`/`oneOf`/`anyOf`) carries NRO fields. */
function schemaHasNroFields(schema: unknown, seen: Set<string>): boolean {
  const resolved = resolveRef(schema, seen) as SpecNode | undefined;
  if (!resolved || typeof resolved !== "object") return false;
  const props = resolved.properties as SpecNode | undefined;
  if (props && (props.signature || props.signerPEM)) return true;
  for (const key of ["allOf", "oneOf", "anyOf"] as const) {
    const branch = resolved[key];
    if (Array.isArray(branch) && branch.some((s) => schemaHasNroFields(s, seen)))
      return true;
  }
  return false;
}

/** True if the operation's JSON request body carries `signature`/`signerPEM`. */
function operationRequiresNro(operation: unknown): boolean {
  const op = operation as SpecNode | undefined;
  if (!op) return false;
  const requestBody = resolveRef(op.requestBody, new Set()) as SpecNode | undefined;
  const content = requestBody?.content as SpecNode | undefined;
  if (!content) return false;
  const media = (content["application/json"] ??
    content[Object.keys(content)[0]]) as SpecNode | undefined;
  return schemaHasNroFields(media?.schema, new Set());
}

/** Turn an OpenAPI path template into an anchored regex (each `{param}` → one path segment). */
function pathTemplateToRegex(template: string): RegExp {
  const body = template
    .split("/")
    .map((seg) =>
      /^\{.+\}$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${body}(?:$|\\?)`);
}

/**
 * Derive the NRO-enforced route set directly from the vendored OpenAPI spec: a
 * POST/PUT operation needs NRO iff its request body schema carries a
 * `signature`/`signerPEM` field. This is the single source of truth for "which
 * endpoints require NRO", keeping enforcement aligned with the published
 * contract (ECB signs the writes that update RTGS directly).
 */
export function deriveNroRouteMatchers(): readonly NroRouteMatcher[] {
  const matchers: NroRouteMatcher[] = [];
  const paths = ((officialSpec as SpecNode).paths ?? {}) as Record<string, SpecNode>;
  for (const [template, item] of Object.entries(paths)) {
    for (const method of ["post", "put"] as const) {
      if (operationRequiresNro(item[method])) {
        matchers.push({
          method: method.toUpperCase() as "POST" | "PUT",
          regex: pathTemplateToRegex(template),
        });
      }
    }
  }
  return matchers;
}

function requiresNRO(
  path: string,
  method: string,
  matchers: readonly NroRouteMatcher[],
): boolean {
  return matchers.some((m) => m.method === method && m.regex.test(path));
}

/**
 * Build the canonical signing data from request fields, per Pontes v1.0 spec.
 * Field order: ID first, then amount, then BICs.
 */
export function buildSigningData(body: Record<string, any>): string | null {
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
 * Verify an ECDSA P-256 + SHA-256 signature over the plain concatenated signing
 * string (NRO).
 *
 * DIGEST CONVENTION — SINGLE HASH (`SHA256withECDSA`):
 * The Pontes v1.0 signing string is hashed with SHA-256 exactly **once** and
 * then signed with ECDSA P-256. This is the standard `SHA256withECDSA`
 * primitive: the concatenated field string is fed *directly* to the signer,
 * which applies SHA-256 internally. It is **not** a double hash — do NOT
 * pre-compute a SHA-256 digest and then sign that digest.
 *
 * The Service Description prose (§4.3) reads "compute SHA-256 hash … then sign
 * with SHA256withECDSA", which can be misread as two separate hashing rounds.
 * The authoritative reading is fixed by (a) the verification pseudocode (§4.4
 * step 5) — `verify(signature, critical_payload_fields)` runs over the RAW
 * concatenated fields, not a pre-hash — and (b) the reference signing snippet
 * `sign.update(concatenatedString)`. Both confirm a single hash.
 *
 *   Reference producer:  createSign("SHA256").update(concat).sign(privKeyPem)
 *   Matching verifier:    createVerify("SHA256").update(concat).verify(cert, sig)
 */
export function verifySignature(
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

export function createNroMiddleware(matchers: readonly NroRouteMatcher[]) {
  return defineEventHandler(async (event: H3Event) => {
    const path = event.path || "";
    const method = getMethod(event);

    if (!requiresNRO(path, method, matchers)) return;

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

/**
 * Extract a forwarded client certificate from a proxy header into PEM.
 *
 * Only consulted when TRUST_PROXY_CLIENT_CERT=true (TLS/mTLS terminated by a
 * trusted reverse proxy in front of the mock). Accepts:
 *  - a raw PEM certificate,
 *  - a URL-encoded PEM (nginx `$ssl_client_escaped_cert`), and
 *  - Envoy XFCC syntax `Cert="...";Chain="..."` (the `Cert`/`Chain` element).
 */
function decodeForwardedCertHeader(value: string): string | null {
  let v = value.trim();
  const xfccMatch = v.match(/(?:^|;)\s*(?:Cert|Chain)="?([^";]+)"?/i);
  if (xfccMatch) v = xfccMatch[1];
  if (!v.includes("BEGIN CERTIFICATE")) {
    try {
      v = decodeURIComponent(v);
    } catch {
      /* leave as-is */
    }
  }
  return v.includes("BEGIN CERTIFICATE") ? v : null;
}

/**
 * Resolve the effective client certificate used to bind the NRO signer.
 *
 * Primary source is the real mTLS peer certificate terminated at the pod
 * (`event.context.mtlsCert`). When TLS/mTLS is terminated by a trusted proxy,
 * set TRUST_PROXY_CLIENT_CERT=true and forward the client certificate in the
 * `x-forwarded-client-cert` (or `ssl-client-cert`) header.
 *
 * Returns an X509Certificate, or null when no client certificate is available.
 */
function resolveClientCert(event: H3Event): X509Certificate | null {
  const mtls = event.context.mtlsCert as { raw?: Buffer } | undefined;
  if (mtls && mtls.raw) {
    try {
      return new X509Certificate(mtls.raw);
    } catch {
      return null;
    }
  }

  if (process.env.TRUST_PROXY_CLIENT_CERT === "true") {
    const headers = event.node.req.headers;
    const raw =
      (headers["x-forwarded-client-cert"] as string | undefined) ||
      (headers["ssl-client-cert"] as string | undefined);
    if (raw) {
      const pem = decodeForwardedCertHeader(raw);
      if (pem) {
        try {
          return new X509Certificate(pem);
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

export function createNroCertCheckMiddleware(matchers: readonly NroRouteMatcher[]) {
  return defineEventHandler(async (event) => {
    const path = event.path || "";
    const method = getMethod(event);

    if (!requiresNRO(path, method, matchers)) return;

    const body =
      event.context?.parsedBody ||
      (event.node.req.method === "POST" || event.node.req.method === "PUT"
        ? await readBody(event)
        : undefined);

    // No signer certificate on the request → nothing to bind here. Absence of
    // signerPEM on an NRO route is handled by the NRO signature middleware
    // (HL-NRO-001).
    if (!body || !body.signerPEM) return;

    const clientCert = resolveClientCert(event);

    // FAIL CLOSED (issue #30): the request presents an NRO signer certificate
    // but no client certificate was established (no mTLS peer cert and no
    // trusted forwarded cert). Previously the binding check was silently
    // skipped, letting a caller sign with an arbitrary certificate. Reject.
    if (!clientCert) {
      setResponseStatus(event, 403);
      return {
        businessErrors: [
          {
            errorCode: "HL-NRO-005",
            errorDescription:
              "NRO operation requires a client (mTLS) certificate to bind the signer, but none was presented",
          },
        ],
      };
    }

    let signerPem = body.signerPEM;
    if (!signerPem.includes("-----BEGIN CERTIFICATE-----")) {
      const lines = signerPem.match(/.{1,64}/g) || [signerPem];
      signerPem = `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
    }

    let nroCert: X509Certificate;
    try {
      nroCert = new X509Certificate(signerPem);
    } catch {
      // Invalid signerPEM format is handled by the downstream NRO middleware.
      return;
    }

    // Compare raw DER: the NRO signer must be the same certificate presented
    // for mTLS (self-signed origin binding).
    if (Buffer.compare(nroCert.raw, clientCert.raw) !== 0) {
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
  });
}
