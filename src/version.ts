/**
 * Release-version helpers (shared).
 *
 * `mockVersion()` prefers the release build's baked git ref (`PUBLIC_GIT_REF_NAME`,
 * e.g. `v1.1.1` → `1.1.1`), then the npm package version from the environment,
 * then the version baked from `package.json` — so a plain `node dist/index.js`
 * shows e.g. `1.4.0` instead of `dev`. The UI, the served OpenAPI, and the
 * `X-Mock-Pontes-Version` header (#41) therefore always show a real version.
 */

import pkg from "../package.json";

export function mockVersion(): string {
  const ref = process.env.PUBLIC_GIT_REF_NAME;
  if (ref && ref !== "no_ref_name") return ref.replace(/^v/, "");
  return process.env.npm_package_version || (pkg as { version?: string }).version || "dev";
}

/** Short commit hash baked at build time, when available. */
export function mockCommit(): string | undefined {
  const c = process.env.PUBLIC_COMMIT_HASH;
  return c && c !== "no_commit_hash" ? c.slice(0, 7) : undefined;
}
