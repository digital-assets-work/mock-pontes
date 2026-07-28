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
 * only read named fields — with the exception that the mock-only
 * `supplementaryData` field is preserved by the handlers that support it.
 */

import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";
import {
  defineEventHandler,
  getMethod,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import officialSpec from "../ui/spec/pontes-official-v1.0.json";

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
 * Relax `additionalProperties: false` everywhere so unknown fields are ignored
 * (not rejected) — the issue #53 policy — and the mock-only `supplementaryData`
 * field is always accepted, even on schemas (e.g. XvP) that otherwise seal the
 * object. Required/type/pattern constraints are unaffected.
 */
function relaxAdditionalProps(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(relaxAdditionalProps);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj.additionalProperties === false) delete obj.additionalProperties;
    for (const value of Object.values(obj)) relaxAdditionalProps(value);
  }
}

const specForAjv = JSON.parse(JSON.stringify(officialSpec)) as object;
relaxAdditionalProps(specForAjv);
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
    if (errors.length === 0) return;
    setResponseStatus(event, 400);
    return { businessErrors: errors };
  });
}
