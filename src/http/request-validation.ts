/**
 * Request-body validation for the write endpoints (issue #53 / F-01).
 *
 * Before this, create handlers read the body positionally with defaults
 * (`body.amount || "0.00"`) and never validated, so the mock accepted bodies
 * that real Pontes rejects (negative / non-numeric / over-precision amounts,
 * missing required fields). That produces false negatives on exactly the bug
 * class the mock exists to catch.
 *
 * This middleware validates each create body against the request schema the
 * service already serves at `/openapi.json` (the vendored official spec) with
 * ajv, and returns the normalised `400` ErrorResponse on failure.
 *
 * Extra-field policy (issue #53 decision): unknown fields are **ignored** (not
 * rejected) — the schemas leave `additionalProperties` open and the handlers
 * only read named fields — with the exception that `supplementaryData` is
 * preserved by the handlers that support it. It's official-but-undocumented
 * (confirmed accepted/echoed via direct correspondence with ECB support on
 * `bridge/payments`; the transfer/`rvs` path's acceptance of it remains an
 * unconfirmed mock extension — see issue #101), not a mock-only invention.
 */

import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";
import {
  defineEventHandler,
  getMethod,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import officialSpec from "../ui/spec/pontes-official-v1.1.json";

/**
 * Create (POST) write endpoints → the official request schema to validate the
 * body against. Keys are `"<METHOD> <normalized-path>"` (params collapsed to
 * `{}` by {@link normalizePath}). Only create bodies are validated; the PUT
 * approve/cancel transitions carry no meaningful body.
 */
const ROUTE_SCHEMAS: Record<string, string> = {
  "POST /dlt/{}/api/octopus/tms/funding-requests": "triggermanagement.CreateFundingRequest",
  "POST /dlt/{}/api/octopus/tms/defunding-requests": "triggermanagement.CreateDefundingRequest",
  "POST /dlt/{}/api/octopus/tms/direct-rtgs/payments": "triggermanagement.DirectRTGSPaymentInstruction",
  "POST /dlt/{}/api/octopus/rvs/transactions-requests": "requestvalidation.CreateOperationRequest",
  "POST /dlt/{}/api/bridge/payments": "bridge.PaymentRequest",
  "POST /dlt/{}/api/bridge/direct-rtgs/payments": "bridge.DirectRTGSPaymentInstruction",
  "POST /dlt/{}/api/bridge/initpfoddeli": "bridge.PFoDDeliRequest",
  "POST /dlt/{}/api/bridge/initpfodrece": "bridge.PFoDReceRequest",
  "POST /igw/{}/v1/xvps": "XvPInitRequest",
  "POST /igw/{}/v1/direct-rtgs/xvps": "RTGSXvPInitRequest",
};

// `strict:false` so the OpenAPI-3 dialect keywords (nullable/example/format …)
// are tolerated; `allErrors` so one 400 reports every failing constraint.
const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Sanitise the vendored spec before ajv compiles it:
 *  - relax `additionalProperties: false` everywhere so unknown fields are ignored
 *    (issue #53 policy) and the official-but-undocumented `supplementaryData`
 *    is always accepted, even on schemas (e.g. XvP) that otherwise seal the
 *    object;
 *  - normalise malformed regex quantifiers in `pattern` keywords. The v1.0 ECB
 *    spec shipped `{1, 15}` / `{64, 128}` (a space after the comma), an invalid
 *    ECMAScript quantifier: ajv throws "Incomplete quantifier" and fails the
 *    schema open, silently disabling validation (e.g. XvPInitRequest). v1.1
 *    fixes the `{1, 15}` (amount) occurrences upstream but still ships the
 *    `{64, 128}` (executionHash/cancellationHash) ones broken, so this
 *    normalisation stays necessary. Stripping the space at compile time keeps
 *    the vendored spec byte-faithful to the ECB source while restoring
 *    validation; it is a no-op on patterns that are already well-formed.
 * Required/type/pattern semantics are otherwise unaffected.
 */
function sanitizeForAjv(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(sanitizeForAjv);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj.additionalProperties === false) delete obj.additionalProperties;
    if (typeof obj.pattern === "string") {
      obj.pattern = obj.pattern.replace(/\{(\d+)\s*,\s*(\d+)\}/g, "{$1,$2}");
    }
    for (const value of Object.values(obj)) sanitizeForAjv(value);
  }
}

const specForAjv = JSON.parse(JSON.stringify(officialSpec)) as object;
sanitizeForAjv(specForAjv);
ajv.addSchema({ $id: "pontes", ...specForAjv });

/** Cache of compiled validators (or `null` when a schema failed to compile). */
const validators = new Map<string, ValidateFunction | null>();

function validatorFor(schemaName: string): ValidateFunction | null {
  if (validators.has(schemaName)) return validators.get(schemaName) ?? null;
  let validate: ValidateFunction | null = null;
  try {
    validate = ajv.compile({ $ref: `pontes#/components/schemas/${schemaName}` });
  } catch (err) {
    // Never let a schema quirk break a request path — fail open (skip) + log.
    console.warn(`[mock-pontes] could not compile validator for ${schemaName}: ${(err as Error).message}`);
    validate = null;
  }
  validators.set(schemaName, validate);
  return validate;
}

function describeError(e: ErrorObject): string {
  const field = e.instancePath ? e.instancePath.replace(/^\//, "").replace(/\//g, ".") : "(body)";
  if (e.keyword === "required") {
    return `Missing required field '${(e.params as { missingProperty: string }).missingProperty}'`;
  }
  if (e.keyword === "pattern") {
    return `Field '${field}' ${e.message} (${(e.params as { pattern: string }).pattern})`;
  }
  return `Field '${field}' ${e.message}`;
}

/**
 * Validate a create body against the given official schema. Returns the
 * business-error list (empty when valid, or when the schema could not be
 * compiled — fail open).
 */
export function validateRequestBody(
  schemaName: string,
  body: unknown,
): Array<{ errorCode: string; errorDescription: string }> {
  const validate = validatorFor(schemaName);
  if (!validate) return [];
  if (validate(body)) return [];
  return (validate.errors ?? []).map((e) => ({
    errorCode: "HL-VAL-001",
    errorDescription: describeError(e),
  }));
}

/** Look up the schema name for a request, if this endpoint is validated. */
export function schemaForRequest(method: string, path: string): string | undefined {
  const clean = (path || "").split("?")[0];
  // The mapped create endpoints have exactly one path parameter — the `{ncb}`
  // realm at segment 2 of `/dlt/{ncb}/…` or `/igw/{ncb}/…`. Collapse it to `{}`
  // so the concrete realm (e.g. `bdf`) matches the templated keys above.
  const segs = clean.split("/");
  if (segs[1] === "dlt" || segs[1] === "igw") segs[2] = "{}";
  return ROUTE_SCHEMAS[`${method.toUpperCase()} ${segs.join("/")}`];
}

/** The only currency Pontes settles in (central-bank digital EUR). */
export const SUPPORTED_CURRENCY = "EUR";

/**
 * Canonical 2-decimal money pattern — the same one the official spec applies to
 * the funding/defunding/bridge/direct-rtgs `amount` field.
 */
export const MONEY_PATTERN = /^\d{1,15}(\.\d{0,2})?$/;

/** Body fields that carry a settlement amount. */
const MONEY_FIELD_NAMES = ["amount", "amountTransferred", "maximumAmount"] as const;

const schemasNode =
  (officialSpec as { components?: { schemas?: Record<string, { properties?: Record<string, { pattern?: string }> }> } })
    .components?.schemas ?? {};

/**
 * The money fields a validated schema leaves **without** a numeric pattern. The
 * official spec patterns `amount` everywhere but leaves the transfer
 * `amountTransferred` unconstrained, so the mock used to accept over-precise
 * amounts (e.g. `"10.123"`) that real Pontes rejects — a realism gap (issue
 * #97). We enforce {@link MONEY_PATTERN} on exactly these fields so enforcement
 * is uniform without producing duplicate errors for already-patterned fields.
 */
function unpatternedMoneyFields(schemaName: string): string[] {
  const props = schemasNode[schemaName]?.properties ?? {};
  return MONEY_FIELD_NAMES.filter((f) => props[f] && !props[f].pattern);
}

const moneyFieldCache = new Map<string, string[]>();
function moneyFieldsFor(schemaName: string): string[] {
  let fields = moneyFieldCache.get(schemaName);
  if (!fields) {
    fields = unpatternedMoneyFields(schemaName);
    moneyFieldCache.set(schemaName, fields);
  }
  return fields;
}

/**
 * Enforce {@link MONEY_PATTERN} on the money fields the schema leaves
 * unpatterned (issue #97). Returns the business-error list (empty when valid).
 */
export function moneyPrecisionErrors(
  schemaName: string,
  body: unknown,
): Array<{ errorCode: string; errorDescription: string }> {
  const errors: Array<{ errorCode: string; errorDescription: string }> = [];
  if (!body || typeof body !== "object") return errors;
  const b = body as Record<string, unknown>;
  for (const f of moneyFieldsFor(schemaName)) {
    const v = b[f];
    if (typeof v === "string" && v.length > 0 && !MONEY_PATTERN.test(v)) {
      errors.push({
        errorCode: "HL-VAL-001",
        errorDescription: `Field '${f}' must be a EUR amount with at most 2 decimals (pattern ${MONEY_PATTERN.source}).`,
      });
    }
  }
  return errors;
}

/**
 * Reject a non-EUR `currency` (issue #80). Pontes is EUR-only; previously
 * funding/defunding/transfer **silently coerced** any value to EUR while other
 * routes honoured it — both hide a client bug. A supplied non-EUR currency is
 * now a clear 400 rather than a silent rewrite. Returns the error or `null`.
 */
export function currencyError(body: unknown): { errorCode: string; errorDescription: string } | null {
  if (body && typeof body === "object") {
    const c = (body as Record<string, unknown>).currency;
    if (typeof c === "string" && c && c !== SUPPORTED_CURRENCY) {
      return {
        errorCode: "HL-VAL-001",
        errorDescription: `Unsupported currency '${c}'. Only ${SUPPORTED_CURRENCY} is supported.`,
      };
    }
  }
  return null;
}

/**
 * The undocumented real-UTEST `supplementaryData` charset/length rule
 * (issue #126, live-bisected against `bridge/payments`): max 30 characters,
 * `[A-Za-z0-9_-]` only. Real UTEST reuses the same charset-sounding error
 * message for both violations, so the mock does too (wire compatibility).
 *
 * Extended (issue #134) to the PFoD deliver/receive legs, where v1.1 newly
 * documents the field. It is deliberately NOT applied to
 * `rvs/transactions-requests` — real UTEST accepts values well beyond 30
 * chars there (see the `bridge/payments`-specific caveat above and issue
 * #101) — see issue #134's follow-up comment for the open question on
 * whether that route should gain the same cap.
 */
export const SUPPLEMENTARY_DATA_PATTERN = /^[A-Za-z0-9_-]{0,30}$/;
export const SUPPLEMENTARY_DATA_ERROR =
  "Error validating payment request. Reason: only letters, numbers, dashes, and underscores are allowed in SupplementaryData field";

/**
 * Validate an optional `supplementaryData` value against
 * {@link SUPPLEMENTARY_DATA_PATTERN}. Returns the business error (HL-VAL-004)
 * or `null` when absent/valid.
 */
export function supplementaryDataError(value: unknown): { errorCode: string; errorDescription: string } | null {
  if (value !== undefined && !SUPPLEMENTARY_DATA_PATTERN.test(value as string)) {
    return { errorCode: "HL-VAL-004", errorDescription: SUPPLEMENTARY_DATA_ERROR };
  }
  return null;
}

/**
 * Middleware that validates create request bodies. Placed after the auth/NRO
 * chain and before the route routers, so authentication and signer binding are
 * checked first, then the body shape.
 */
export function createRequestValidationMiddleware() {
  return defineEventHandler(async (event: H3Event) => {
    const schemaName = schemaForRequest(getMethod(event), event.path || "");
    if (!schemaName) return;

    let body: unknown;
    try {
      body = (event.context.parsedBody as unknown) ?? (await readBody(event));
      event.context.parsedBody = body;
    } catch {
      setResponseStatus(event, 400);
      return {
        businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "Request body is not valid JSON" }],
      };
    }

    const errors = validateRequestBody(schemaName, body);
    // Enforce 2-decimal money precision on fields the spec leaves unpatterned
    // (issue #97) — e.g. transfer `amountTransferred`.
    errors.push(...moneyPrecisionErrors(schemaName, body));
    // Enforce EUR-only settlement (issue #80) — no silent coercion.
    const currency = currencyError(body);
    if (currency) errors.push(currency);
    if (errors.length === 0) return;
    setResponseStatus(event, 400);
    return { businessErrors: errors };
  });
}
