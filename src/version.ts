/**
 * Release-version helpers (shared).
 *
 * `mockVersion()` prefers the release build's baked git ref (`PUBLIC_GIT_REF_NAME`,
 * e.g. `v1.1.1` → `1.1.1`), falling back to the npm package version (dev) so the
 * UI, the served OpenAPI, and the `X-Mock-Pontes-Version` header (#41) always
 * show something meaningful and consistent.
 */

export function mockVersion(): string {
  const ref = process.env.PUBLIC_GIT_REF_NAME;
  if (ref && ref !== "no_ref_name") return ref.replace(/^v/, "");
  return process.env.npm_package_version || "dev";
}

/** Short commit hash baked at build time, when available. */
export function mockCommit(): string | undefined {
  const c = process.env.PUBLIC_COMMIT_HASH;
  return c && c !== "no_commit_hash" ? c.slice(0, 7) : undefined;
}
