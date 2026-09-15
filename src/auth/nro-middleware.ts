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
 *
 * FUNDING/DEFUNDING use a distinct signing-string/digest convention from
 * Direct RTGS payment and XvP — a 2-decimal-place amount, one BIC slot
 * substituted with a fixed constant, and a double SHA-256 hash — confirmed
 * live against real Pontes UTEST (workbench issue #124). See
 * {@link buildSigningData}'s doc comment for the full breakdown.
 */

import {
  defineEventHandler,
  getMethod,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { createHash, createVerify, X509Certificate } from "node:crypto";
import officialSpec from "../ui/spec/pontes-official-v1.0.json";

/**
 * Real Pontes UTEST substitutes a fixed "issuer trigger" BIC constant for one
 * of the two wallet-owner slots when building the FUNDING/DEFUNDING NRO
 * signing string (confirmed live — workbench issue #124). This constant is
 * NOT a real business field: it never appears in the request body, only in
 * the signing string. Configurable since UTEST vs a future PROD environment
 * may use a different value.
 */
export const ISSUER_TRIGGER_BIC = process.env.PONTES_NRO_ISSUER_TRIGGER_BIC || "ECBFDEFFTOK";

/** Normalize an amount to exactly 2 decimal places for NRO signing; null if not numeric. */
function amountFor2dpSigning(amount: unknown): string | null {
  const n = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

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
 * Build the canonical signing preimage from request fields — the exact bytes
 * `verifySignature()` hashes-and-verifies (once, per its SHA256withECDSA
 * primitive below).
 *
 * FUNDING / DEFUNDING — confirmed LIVE against real Pontes UTEST (workbench
 * issue #124), reversing the earlier issue #29 pinning (which had been based
 * on the documented OpenAPI/Service-Description prose, itself confirmed wrong
 * here):
 *   1. `amount` is forced to exactly 2 decimal places for signing, regardless
 *      of how it's formatted in the request body (e.g. body `"1000"` signs as
 *      `"1000.00"`).
 *   2. One of the two wallet-owner BIC slots is replaced by a fixed
 *      "issuer trigger" constant (`ISSUER_TRIGGER_BIC`) — NOT a real business
 *      field, it never appears in the request body:
 *        FUNDING:   techFundRequestID + amount(2dp) + creditedCashWalletOwnerID + ISSUER_TRIGGER_BIC
 *        DEFUNDING: techFundRequestID + amount(2dp) + ISSUER_TRIGGER_BIC + debitedCashWalletOwnerID
 *   3. The concatenated string above is itself SHA-256'd to a LOWERCASE HEX
 *      STRING, and that hex string — not the raw digest bytes, not the
 *      original concatenated string — is the actual preimage fed onward to
 *      `verifySignature()`'s own (single) hash-and-verify step. This is a
 *      genuine double hash; this function performs the first pass and returns
 *      the hex digest.
 *
 * Direct RTGS payment / XvP below are UNCHANGED (single hash, real business
 * fields only, no substitution) — issue #124's live evidence covers
 * funding/defunding only; those two are untested against real Pontes for this
 * behavior.
 */
export function buildSigningData(body: Record<string, any>): string | null {
  if (body.techFundRequestID != null) {
    const { amount, creditedCashWalletOwnerID, debitedCashWalletOwnerID, type } = body;
    if (
      amount == null ||
      creditedCashWalletOwnerID == null ||
      debitedCashWalletOwnerID == null ||
      type == null
    ) {
      return null;
    }
    const amount2dp = amountFor2dpSigning(amount);
    if (amount2dp == null) return null;
    const parts =
      type === "DEFUNDING"
        ? [body.techFundRequestID, amount2dp, ISSUER_TRIGGER_BIC, debitedCashWalletOwnerID]
        : [body.techFundRequestID, amount2dp, creditedCashWalletOwnerID, ISSUER_TRIGGER_BIC];
    return createHash("sha256").update(parts.join(""), "utf8").digest("hex");
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
 * Verify an ECDSA P-256 + SHA-256 signature over `data` — the exact preimage
 * returned by `buildSigningData()`.
 *
 * DIGEST CONVENTION — this function itself always hashes exactly **once**
 * (the standard `SHA256withECDSA` primitive: `data` is fed *directly* to the
 * signer/verifier, which applies SHA-256 internally):
 *
 *   Reference producer:  createSign("SHA256").update(data).sign(privKeyPem)
 *   Matching verifier:    createVerify("SHA256").update(data).verify(cert, sig)
 *
 * For Direct RTGS payment / XvP, `data` is the plain concatenated field
 * string, so this is a true single hash overall — confirmed by the Service
 * Description's verification pseudocode (§4.4 step 5, runs over the RAW
 * concatenated fields) and reference signing snippet, despite prose in §4.3
 * that can be misread as two hashing rounds.
 *
 * For FUNDING/DEFUNDING, `buildSigningData()` already returns a SHA-256 hex
 * digest of the concatenated fields as `data` (see its own doc comment) — so
 * calling this function on it produces the genuine DOUBLE hash real Pontes
 * UTEST expects for those two operation types (issue #124).
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
 *
 * Real Pontes UTEST expects `signerPEM` = base64(full armored PEM text, headers
 * + newlines included) — confirmed live against UTEST (issue #121). A literal
 * (non-base64) PEM string is also accepted, for convenience.
 *
 * `base64(bare DER)` — the mock's original (incorrect) assumption — is
 * intentionally NOT accepted: real Pontes UTEST rejects that shape outright
 * (`400 ERR-FR-SIGN-001 "This is not a certificate in the expected format."`),
 * so the mock deliberately mirrors that rejection instead of being more
 * lenient than the real platform.
 */
export function decodeCertPem(signerPEM: string): string {
  // Shape 1: already a literal PEM string.
  if (signerPEM.includes("-----BEGIN CERTIFICATE-----")) {
    return signerPEM;
  }

  // Shape 2 (the only base64 shape Pontes accepts): base64(full armored PEM
  // text). Anything else (e.g. base64(bare DER)) decodes to non-PEM text here
  // and is left as-is, so it fails PEM/X.509 parsing downstream exactly like
  // the real platform would reject it.
  return Buffer.from(signerPEM, "base64").toString("utf-8");
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

    const signerPem = decodeCertPem(body.signerPEM);

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
