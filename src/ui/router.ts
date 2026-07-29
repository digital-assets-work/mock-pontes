/**
 * Native (no-build) UI served directly from the mock-pontes backend.
 *
 * Routes (all unauthenticated — dev only):
 *   GET  /                     → redirect to /ui
 *   GET  /ca.pem               → runtime server-CA certificate (PEM) for TLS verification
 *   GET  /ui                   → home: marketing landing page
 *   GET  /ui/config            → control panel: runtime config + connectivity URLs
 *   GET  /ui/enroll            → upload a CSR, enroll a user, download the signed cert
 *   GET  /ui/docs              → embedded Swagger UI (OpenAPI "try it out")
 *   GET  /ui/static/**         → static assets (CSS/JS) backing the pages above
 *   GET  /openapi.json         → OpenAPI spec (consumed by Swagger UI)
 *   GET  /openapi.yaml         → OpenAPI spec as YAML
 *   GET  /openapi/official.json → vendored official ECB Pontes spec
 *   GET  /openapi/official.yaml → vendored official ECB Pontes spec as YAML
 *   GET  /ui/config.json       → runtime config as JSON (consumed by the home page)
 *   POST /ui/inspect           → parse a submitted PEM (CSR/cert) and return details
 *   POST /ui/p12               → bundle a key + cert into a PKCS#12 download
 *
 * The pages, stylesheets and client scripts live as real static files under
 * `src/ui/static/` and are served from disk (copied to `dist/static` at build
 * time). HTML pages that need runtime values (release version, image tag, repo
 * URL) are delivered by the backend with a small `{{TOKEN}}` substitution pass.
 */

import { readFile, access } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import {
  createRouter,
  defineEventHandler,
  getRequestURL,
  getRouterParam,
  readBody,
  sendRedirect,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { buildServedSpec } from "./openapi.js";
import { inspectPem } from "./inspect.js";
import { buildP12 } from "./p12.js";
import { adminTokenConfigured } from "../auth/admin-token.js";
import { stringify as stringifyYaml } from "yaml";
// Official ECB Pontes OpenAPI v1.0 (EII API), vendored as JSON.
// Source: https://www.ecb.europa.eu/paym/target/target-professional-use-documents-links/pontes/shared/pdf/ecb.pontes26_05_15_OpenAPI_Document_v1.0_Pontes_Pilot.en.zip
// Retrieved 2026-07-24; pristine (converted from YAML). Refresh from that URL when ECB updates the spec.
import officialSpec from "./spec/pontes-official-v1.0.json";

/** Release version — from the release build's baked git ref, falling back to the
 *  npm package version (dev) so the UI always shows something meaningful. */
import { mockVersion, mockCommit } from "../version.js";

const REPO_URL = "https://github.com/digital-assets-work/mock-pontes";
const IMAGE = "ghcr.io/digital-assets-work/mock-pontes";

// The served spec is derived from the official spec + the route registry, so it
// must be built AFTER all routes are registered. Build lazily on first request
// and memoize (routes are stable once the app has started). `info.version` is
// stamped with the running release so the docs match the build.
let _servedSpec: ReturnType<typeof buildServedSpec> | undefined;
let _openapiYaml: string | undefined;
function getServedSpec(): ReturnType<typeof buildServedSpec> {
  if (!_servedSpec) _servedSpec = buildServedSpec(mockVersion());
  return _servedSpec;
}
function getOpenapiYaml(): string {
  if (_openapiYaml === undefined) {
    _openapiYaml = stringifyYaml(getServedSpec(), { lineWidth: 0 });
  }
  return _openapiYaml;
}
const officialYaml = stringifyYaml(officialSpec, { lineWidth: 0 });

function baseUrlFor(event: Parameters<typeof getRequestURL>[0]): string {
  const envUrl = process.env.PUBLIC_EXTERNAL_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  try {
    const u = getRequestURL(event);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Static asset serving
// ---------------------------------------------------------------------------

/**
 * Directory holding the static UI assets. Resolved lazily against the process
 * working directory so it works both in development (tsx runs from the repo
 * root, live assets at `src/ui/static`) and in the bundled build (the container
 * runs `node dist/index.js` from the app root, where only `dist/static` exists
 * — the build copies the assets there). Source is preferred when present so dev
 * edits are served live; the build layout is the production fallback.
 */
const STATIC_CANDIDATES = [
  join(process.cwd(), "src", "ui", "static"),
  join(process.cwd(), "dist", "static"),
];
let _staticDir: string | undefined;
async function getStaticDir(): Promise<string> {
  if (_staticDir) return _staticDir;
  for (const dir of STATIC_CANDIDATES) {
    try {
      await access(join(dir, "marketing.html"));
      _staticDir = dir;
      return dir;
    } catch {
      // try the next candidate
    }
  }
  // Fall back to the build layout; readFile will surface a clear ENOENT if the
  // assets are genuinely missing.
  _staticDir = STATIC_CANDIDATES[STATIC_CANDIDATES.length - 1];
  return _staticDir;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Resolve a request-supplied relative path to an absolute path inside the
 * static dir, rejecting any attempt to escape the directory (path traversal).
 * Returns undefined if the path is unsafe.
 */
function resolveStatic(staticDir: string, relPath: string): string | undefined {
  const clean = normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = normalize(join(staticDir, clean));
  if (full !== staticDir && !full.startsWith(staticDir + sep)) return undefined;
  return full;
}

/** Tokens substituted into HTML pages delivered by the backend. */
function htmlTokens(): Record<string, string> {
  const version = mockVersion();
  const imageTag = version && /^\d+\.\d+/.test(version)
    ? version.split(".").slice(0, 2).join(".") // e.g. 1.2
    : "1.2";
  return {
    VERSION: version,
    COMMIT: mockCommit() ?? "",
    IMAGE_TAG: imageTag,
    REPO_URL,
    REPO_HOST: REPO_URL.replace("https://", ""),
    IMAGE,
  };
}

function applyTokens(html: string, extra: Record<string, string> = {}): string {
  const tokens = { ...htmlTokens(), ...extra };
  return html.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : match,
  );
}

/**
 * Is a host a **public DNS** name (issue #78)? True for a real, dotted, non-IP
 * hostname (or when a public external URL is configured); false for localhost,
 * `*.local`, loopback and bare IPs.
 */
export function hostIsPublic(hostname: string | undefined, hasPublicExternalUrl: boolean): boolean {
  if (hasPublicExternalUrl) return true;
  const host = (hostname || "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost")) return false;
  if (host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return false;
  const isIp = /^[0-9.]+$/.test(host) || host.includes(":");
  if (isIp) return false;
  return host.includes(".");
}

/** Control-panel banner wording for the (public-host, admin-token) state (issue #78). */
export function controlPanelBanner(
  publicHost: boolean,
  adminTokenSet: boolean,
): { MOCK_SCOPE_LABEL: string; ADMIN_AUTH_LABEL: string } {
  return {
    MOCK_SCOPE_LABEL: publicHost
      ? "Shared public mock of the ECB Pontes A2A API."
      : "Local mock of the ECB Pontes A2A API.",
    ADMIN_AUTH_LABEL: adminTokenSet
      ? "Admin endpoint requires the secret ADMIN_TOKEN in authorisation header."
      : "Admin endpoint requires no authentication (Dev deployment).",
  };
}

/**
 * Is the mock reached over a **public DNS** host (issue #78)? Drives the
 * control-panel banner wording.
 */
function isPublicHost(event: Parameters<typeof getRequestURL>[0]): boolean {
  let host: string | undefined;
  try {
    host = getRequestURL(event).hostname;
  } catch {
    host = undefined;
  }
  return hostIsPublic(host, Boolean(process.env.PUBLIC_EXTERNAL_URL));
}

/** Control-panel banner tokens, computed per request (issue #78). */
function controlPanelTokens(event: Parameters<typeof getRequestURL>[0]): Record<string, string> {
  return controlPanelBanner(isPublicHost(event), adminTokenConfigured());
}

/** Read and serve an HTML page from the static dir, applying token substitution. */
async function renderPage(
  event: Parameters<typeof setResponseHeader>[0],
  file: string,
  extra: Record<string, string> = {},
): Promise<string> {
  const html = await readFile(join(await getStaticDir(), file), "utf8");
  setResponseHeader(event, "content-type", "text/html; charset=utf-8");
  return applyTokens(html, extra);
}

export interface UiRouterOptions {
  /**
   * The runtime PKI's server-CA certificate (PEM). Exposed unauthenticated at
   * `GET /ca.pem` so clients can verify the mock's self-signed server cert
   * instead of disabling TLS verification (issue #89). When the mock is fronted
   * by a publicly-trusted cert (e.g. Let's Encrypt via `TLS_CERT_FILE`) this CA
   * is not needed for verification but is still served (harmless).
   */
  serverCaCertificatePem?: string;
}

export function createUiRouter(options: UiRouterOptions = {}) {
  const router = createRouter();

  router.get(
    "/",
    defineEventHandler((event) => sendRedirect(event, "/ui", 302)),
  );

  // Expose the runtime server CA so clients can verify the mock's self-signed
  // TLS cert (issue #89). Unauthenticated by design — a CA certificate is
  // public material. Returns 404 only if the bundle lacks the CA (should not
  // happen in normal operation).
  router.get(
    "/ca.pem",
    defineEventHandler((event) => {
      const pem = options.serverCaCertificatePem;
      if (!pem) {
        setResponseStatus(event, 404);
        return { error: "not_found", detail: "server CA certificate is not available" };
      }
      setResponseHeader(event, "content-type", "application/x-pem-file");
      setResponseHeader(event, "content-disposition", 'inline; filename="mock-ca.pem"');
      return pem;
    }),
  );

  router.get(
    "/ui",
    defineEventHandler((event) => renderPage(event, "marketing.html")),
  );

  router.get(
    "/ui/config",
    defineEventHandler((event) => renderPage(event, "control-panel.html", controlPanelTokens(event))),
  );

  router.get(
    "/ui/enroll",
    defineEventHandler((event) => renderPage(event, "enroll.html")),
  );

  router.get(
    "/ui/docs",
    defineEventHandler((event) => renderPage(event, "docs.html")),
  );

  router.get(
    "/ui/static/**:file",
    defineEventHandler(async (event) => {
      const rel = getRouterParam(event, "file") ?? "";
      const full = resolveStatic(await getStaticDir(), rel);
      if (!full) {
        setResponseStatus(event, 400);
        return { error: "invalid_path" };
      }
      try {
        const data = await readFile(full);
        setResponseHeader(event, "content-type", contentTypeFor(full));
        setResponseHeader(event, "cache-control", "public, max-age=3600");
        return data;
      } catch {
        setResponseStatus(event, 404);
        return { error: "not_found" };
      }
    }),
  );

  router.get(
    "/openapi.json",
    defineEventHandler(() => getServedSpec()),
  );

  router.get(
    "/openapi.yaml",
    defineEventHandler((event) => {
      setResponseHeader(event, "content-type", "application/yaml; charset=utf-8");
      return getOpenapiYaml();
    }),
  );

  router.get(
    "/openapi/official.json",
    defineEventHandler(() => officialSpec),
  );

  router.get(
    "/openapi/official.yaml",
    defineEventHandler((event) => {
      setResponseHeader(event, "content-type", "application/yaml; charset=utf-8");
      return officialYaml;
    }),
  );

  router.get(
    "/ui/config.json",
    defineEventHandler((event) => {
      const baseUrl = baseUrlFor(event);
      const ncb = (process.env.PONTES_DEFAULT_NCB || "bdf").toLowerCase();
      return {
        baseUrl,
        externalUrl: process.env.PUBLIC_EXTERNAL_URL || baseUrl,
        ncb,
        version: mockVersion(),
        commit: mockCommit(),
        endpoints: {
          health: `${baseUrl}/dlt/${ncb}/api/octopus/health`,
          checkIp: `${baseUrl}/check/ip`,
          checkMtls: `${baseUrl}/check/mtls`,
          caPem: `${baseUrl}/ca.pem`,
          csr: `${baseUrl}/iam/realms/${ncb}/protocol/openid-connect/csr`,
          token: `${baseUrl}/iam/realms/${ncb}/protocol/openid-connect/token`,
          openapi: `${baseUrl}/openapi.json`,
          openapiYaml: `${baseUrl}/openapi.yaml`,
          officialOpenapi: `${baseUrl}/openapi/official.json`,
          officialOpenapiYaml: `${baseUrl}/openapi/official.yaml`,
        },
        runtime: {
          port: Number(process.env.PORT || 3001),
          redis: Boolean(process.env.REDIS_URL),
          publicHost: isPublicHost(event),
          adminTokenRequired: adminTokenConfigured(),
        },
      };
    }),
  );

  router.post(
    "/ui/inspect",
    defineEventHandler(async (event) => {
      const body = (await readBody(event)) as { pem?: string } | undefined;
      return inspectPem(body?.pem ?? "");
    }),
  );

  router.post(
    "/ui/p12",
    defineEventHandler(async (event) => {
      const body = (await readBody(event)) as
        | { keyPem?: string; certPem?: string; password?: string; name?: string }
        | undefined;
      if (!body?.keyPem || !body?.certPem) {
        setResponseStatus(event, 400);
        return { error: "invalid_request", detail: "keyPem and certPem are required" };
      }
      const name = (body.name || "certificate").replace(/[^A-Za-z0-9._-]/g, "_");
      try {
        const der = await buildP12(body.keyPem, body.certPem, body.password ?? "", name);
        setResponseHeader(event, "content-type", "application/x-pkcs12");
        setResponseHeader(event, "content-disposition", `attachment; filename="${name}.p12"`);
        return der;
      } catch (e) {
        setResponseStatus(event, 501);
        return {
          error: "p12_failed",
          detail: `Could not build PKCS#12 (is openssl installed?): ${String(e).slice(0, 300)}`,
        };
      }
    }),
  );

  return router;
}
