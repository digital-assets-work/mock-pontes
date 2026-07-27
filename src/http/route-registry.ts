/**
 * Route registry (issue #34).
 *
 * The served OpenAPI (`GET /openapi.json`) is derived from the vendored official
 * spec, with each operation the mock does NOT implement tagged `NotImplemented`.
 * To know which operations ARE implemented we record every route as it is
 * declared — at registration time, not request time — so the manifest is
 * complete and cannot drift from the live routes (they are driven by the same
 * call).
 *
 * Wrap a router with {@link track} and it records `{ method, path }` for every
 * `.get/.post/.put/.delete/.patch` registration.
 */

export interface RouteEntry {
  method: string;
  path: string;
}

const routes: RouteEntry[] = [];

export function recordRoute(method: string, path: string): void {
  routes.push({ method: method.toUpperCase(), path });
}

export function getRegisteredRoutes(): RouteEntry[] {
  return [...routes];
}

/**
 * Normalise a path template to be param-name-agnostic: both h3 `:param` and
 * OpenAPI `{param}` segments collapse to `{}`, so `/x/:id` and `/x/{instructionID}`
 * compare equal.
 */
export function normalizePath(path: string): string {
  return path
    .split("/")
    .map((seg) =>
      seg.startsWith(":") || (seg.startsWith("{") && seg.endsWith("}"))
        ? "{}"
        : seg,
    )
    .join("/");
}

/** `Set` of `"<METHOD> <normalized-path>"` keys for the declared routes. */
export function registeredKeySet(): Set<string> {
  return new Set(
    routes.map((r) => `${r.method} ${normalizePath(r.path)}`),
  );
}

const METHODS = ["get", "post", "put", "delete", "patch"] as const;

/**
 * Instrument an h3 router so every route registration is recorded in the
 * registry. Returns the same router (methods delegate to the originals).
 */
export function track<T>(router: T): T {
  const r = router as unknown as Record<string, unknown>;
  for (const m of METHODS) {
    const orig = r[m];
    if (typeof orig !== "function") continue;
    const bound = (orig as (p: string, h: unknown) => unknown).bind(router);
    r[m] = (path: string, handler: unknown) => {
      recordRoute(m, path);
      return bound(path, handler);
    };
  }
  return router;
}
