/**
 * "Not Implemented" signalling for declared-but-unimplemented official paths
 * (issue #62 / F-09).
 *
 * The served OpenAPI (issue #34) already tags operations the mock does not
 * implement with `x-mock-implemented: false`. At *call* time, though, such a
 * path used to fall through to the generic framework `404` ("Cannot find any
 * path matching …"), so a "try it out" in Swagger UI looked like a broken mock
 * rather than an intentionally-unimplemented operation.
 *
 * This middleware runs as the final fallback (after all routers): if an
 * unmatched request corresponds to an official operation the mock does not
 * implement, it returns a clear **`501 Not Implemented`** instead of `404`.
 * Truly unknown paths still fall through to `404`.
 */

import { defineEventHandler, getMethod, setResponseStatus, type H3Event } from "h3";
import officialSpec from "../ui/spec/pontes-official-v1.0.json";
import { normalizePath, registeredKeySet } from "./route-registry.js";

const METHODS = ["get", "post", "put", "delete", "patch"] as const;

export interface OfficialOp {
  method: string;
  /** Path template split into segments, e.g. ["", "dlt", "{ncb}", ...]. */
  segs: string[];
  /** Original template, e.g. `/dlt/{ncb}/api/octopus/tms/…/extract`. */
  template: string;
  /** `"<METHOD> <normalized-template>"` key, matching the route registry. */
  key: string;
}

/** Every operation declared by the official spec (method × path). */
function buildOfficialOps(): OfficialOp[] {
  const ops: OfficialOp[] = [];
  const paths = (officialSpec as { paths?: Record<string, Record<string, unknown>> }).paths || {};
  for (const [template, item] of Object.entries(paths)) {
    for (const m of METHODS) {
      if (!item[m]) continue;
      ops.push({
        method: m.toUpperCase(),
        segs: template.split("/"),
        template,
        key: `${m.toUpperCase()} ${normalizePath(template)}`,
      });
    }
  }
  return ops;
}

const OFFICIAL_OPS = buildOfficialOps();

export function segmentsMatch(reqSegs: string[], tmplSegs: string[]): boolean {
  if (reqSegs.length !== tmplSegs.length) return false;
  for (let i = 0; i < tmplSegs.length; i++) {
    const t = tmplSegs[i];
    if (t.startsWith("{") && t.endsWith("}")) continue; // template param: matches any segment
    if (t !== reqSegs[i]) return false;
  }
  return true;
}

/**
 * Find the official operation a concrete request matches (method + path), or
 * `undefined` if the path is not part of the official surface at all.
 */
export function findOfficialOp(method: string, path: string): OfficialOp | undefined {
  const reqSegs = (path.split("?")[0] || "").split("/");
  const m = method.toUpperCase();
  return OFFICIAL_OPS.find((op) => op.method === m && segmentsMatch(reqSegs, op.segs));
}

/**
 * Does this request target a declared official operation that the mock does not
 * implement? `implemented` is the route registry's key set.
 */
export function findUnimplementedOp(
  method: string,
  path: string,
  implemented: Set<string>,
): OfficialOp | undefined {
  const op = findOfficialOp(method, path);
  if (!op) return undefined;
  return implemented.has(op.key) ? undefined : op;
}

/**
 * Fallback middleware: mounted after all routers. Returns `501` for a declared-
 * but-unimplemented official operation; passes through (→ `404`) otherwise.
 */
export function createNotImplementedMiddleware() {
  let implemented: Set<string> | null = null; // memoised after first request (routes are static)
  return defineEventHandler((event: H3Event) => {
    const path = event.path || "";
    if (!/^\/(?:dlt|igw)\//.test(path)) return; // only the official API surface
    implemented ??= registeredKeySet();
    const op = findUnimplementedOp(getMethod(event), path, implemented);
    if (!op) return; // unknown path → let the framework 404
    setResponseStatus(event, 501);
    return {
      businessErrors: [
        {
          errorCode: "HL-NIMP-001",
          errorDescription:
            `Operation '${op.method} ${op.template}' is declared by the official ECB ` +
            `Pontes API but is not implemented by this mock (x-mock-implemented: false). ` +
            `See /openapi.json and docs/ENDPOINT-COVERAGE.md for the implemented subset.`,
        },
      ],
    };
  });
}
