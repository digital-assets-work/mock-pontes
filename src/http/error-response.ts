/**
 * Error-response normalisation (issue #33).
 *
 * Every error the mock emits is normalised to the official Pontes `ErrorResponse`
 * shape:
 *
 *   { status: <int>, title: <string>, businessErrors: [{ errorCode, errorDescription }] }
 *
 * This removes the three divergent envelopes the mock previously returned (bare
 * `{businessErrors}`, the H3 default `{statusCode, stack, data}` that leaked a
 * `stack` and dropped `errorCode`, and OAuth `{error, error_description}`), while
 * preserving `errorCode` (what real client error handling switches on) and never
 * exposing a stack.
 *
 * The OAuth `{error, error_description}` shape is kept ONLY on the IAM token
 * endpoint (where the real IAM uses it); every other error — including the JWT
 * middleware's `401` on `/dlt` — is normalised.
 */

export interface BusinessError {
  errorCode: string;
  errorDescription: string;
}

export interface ErrorResponse {
  status: number;
  title: string;
  businessErrors: BusinessError[];
}

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

export function titleForStatus(status: number): string {
  return TITLES[status] || (status >= 500 ? "Server Error" : "Error");
}

/**
 * Fallback `errorCode` (official `BusinessErrorType` family) for errors that do
 * not already carry a business error — e.g. the framework 404 or the OAuth 401.
 * Errors that already carry an `errorCode` keep it.
 */
function fallbackErrorCode(status: number): string {
  switch (status) {
    case 401:
      return "HL-ATH-001";
    case 403:
      return "HL-ATH-002";
    case 404:
      return "HL-GER-001";
    case 409:
      return "HL-GER-004";
    default:
      return "HL-GER-000";
  }
}

function coerceBusinessErrors(
  input: unknown,
  status: number,
  fallbackDescription?: string,
): BusinessError[] {
  if (Array.isArray(input) && input.length > 0) {
    return input.map((e) => {
      const obj = (e ?? {}) as Record<string, unknown>;
      const errorCode =
        typeof obj.errorCode === "string" && obj.errorCode
          ? obj.errorCode
          : fallbackErrorCode(status);
      const errorDescription =
        typeof obj.errorDescription === "string" && obj.errorDescription
          ? obj.errorDescription
          : typeof obj.message === "string" && obj.message
            ? (obj.message as string)
            : titleForStatus(status);
      return { errorCode, errorDescription };
    });
  }
  return [
    {
      errorCode: fallbackErrorCode(status),
      errorDescription: fallbackDescription || titleForStatus(status),
    },
  ];
}

export function toErrorResponse(
  status: number,
  businessErrors?: unknown,
  fallbackDescription?: string,
): ErrorResponse {
  const s = Number.isFinite(status) && status >= 400 ? status : 500;
  return {
    status: s,
    title: titleForStatus(s),
    businessErrors: coerceBusinessErrors(businessErrors, s, fallbackDescription),
  };
}

export function isErrorResponseShape(body: unknown): boolean {
  return (
    !!body &&
    typeof body === "object" &&
    "status" in body &&
    "title" in body &&
    "businessErrors" in body
  );
}

/** The IAM token endpoint keeps the OAuth error shape (the real IAM uses it). */
const TOKEN_ENDPOINT =
  /\/iam\/realms\/[^/]+\/protocol\/openid-connect\/token/;

/**
 * Normalise a handler-*returned* error body (status already set on the response).
 * Returns the normalised body, or `null` to leave the body unchanged.
 */
export function normalizeReturnedErrorBody(
  status: number,
  path: string,
  body: unknown,
): ErrorResponse | null {
  if (status < 400) return null;
  if (!body || typeof body !== "object") return null;
  if (isErrorResponseShape(body)) return null;

  const b = body as Record<string, unknown>;

  if ("error" in b || "error_description" in b) {
    if (TOKEN_ENDPOINT.test(path)) return null; // keep OAuth on the IAM token endpoint
    const desc =
      (typeof b.error_description === "string" && b.error_description) ||
      (typeof b.error === "string" && b.error) ||
      undefined;
    return toErrorResponse(status, undefined, desc || undefined);
  }

  if ("businessErrors" in b) {
    return toErrorResponse(status, b.businessErrors);
  }

  return null; // not an error-shaped body; leave it alone
}

/** Normalise a *thrown* error (H3Error / createError) to the official shape. */
export function normalizeThrownError(error: {
  statusCode?: number | string;
  statusMessage?: string;
  message?: string;
  data?: unknown;
}): ErrorResponse {
  const status = Number(error.statusCode) || 500;
  const data = error.data;
  const businessErrors =
    data && typeof data === "object"
      ? (data as Record<string, unknown>).businessErrors
      : undefined;
  return toErrorResponse(
    status,
    businessErrors,
    error.statusMessage || error.message,
  );
}
