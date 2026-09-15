# src/ui/router.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 39.13% (54/138) | `████░░░░░░` |
| Branches | 36.11% (26/72) | `████░░░░░░` |
| Functions | 13.79% (4/29) | `█░░░░░░░░░` |
| Lines | 38.46% (50/130) | `████░░░░░░` |

**Uncovered lines:** 62-64, 66-68, 70, 74-79, 81, 102-108, 115-116, 130-133, 141-145, 149-151, 154, 164-167, 205, 207-208, 210, 212, 216-217, 221, 226-228, 247, 270, 275, 280, 285, 290-295, 297-301, 303-304, 311, 316-318, 324, 329-331, 337-340, 376-378, 384-385, 388-390, 392-397, 399-400

**Partial branches:** L152 (cond-expr), L153 (cond-expr), L156 (binary-expr), L224 (default-arg), L342 (binary-expr), L359 (binary-expr)

**Never called:** `getServedSpec` (L62), `getOpenapiYaml` (L66), `baseUrlFor` (L74), `getStaticDir` (L102), `contentTypeFor` (L130), `resolveStatic` (L141), `htmlTokens` (L149), `applyTokens` (L164), `(anonymous_9)` (L166), `isPublicHost` (L205), `controlPanelTokens` (L216), `renderPage` (L221), `(anonymous_16)` (L247), `(anonymous_18)` (L270), `(anonymous_19)` (L275), `(anonymous_20)` (L280), `(anonymous_21)` (L285), `(anonymous_22)` (L290), `(anonymous_23)` (L311), `(anonymous_24)` (L316), `(anonymous_25)` (L324), `(anonymous_26)` (L329), `(anonymous_27)` (L337), `(anonymous_28)` (L376), `(anonymous_29)` (L384)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   59 | // stamped with the running release so the docs match the build.
   60 | let _servedSpec: ReturnType<typeof buildServedSpec> | undefined;
   61 | let _openapiYaml: string | undefined;
-  62 | function getServedSpec(): ReturnType<typeof buildServedSpec> {
-  63 |   if (!_servedSpec) _servedSpec = buildServedSpec(mockVersion());
-  64 |   return _servedSpec;
   65 | }
-  66 | function getOpenapiYaml(): string {
-  67 |   if (_openapiYaml === undefined) {
-  68 |     _openapiYaml = stringifyYaml(getServedSpec(), { lineWidth: 0 });
   69 |   }
-  70 |   return _openapiYaml;
   71 | }
   72 | const officialYaml = stringifyYaml(officialSpec, { lineWidth: 0 });
   73 | 
-  74 | function baseUrlFor(event: Parameters<typeof getRequestURL>[0]): string {
-  75 |   const envUrl = process.env.PUBLIC_EXTERNAL_URL;
-  76 |   if (envUrl) return envUrl.replace(/\/$/, "");
-  77 |   try {
-  78 |     const u = getRequestURL(event);
-  79 |     return `${u.protocol}//${u.host}`;
   80 |   } catch {
-  81 |     return "";
   82 |   }
   83 | }
   84 | 
  ⋮
   99 |   join(process.cwd(), "dist", "static"),
  100 | ];
  101 | let _staticDir: string | undefined;
- 102 | async function getStaticDir(): Promise<string> {
- 103 |   if (_staticDir) return _staticDir;
- 104 |   for (const dir of STATIC_CANDIDATES) {
- 105 |     try {
- 106 |       await access(join(dir, "marketing.html"));
- 107 |       _staticDir = dir;
- 108 |       return dir;
  109 |     } catch {
  110 |       // try the next candidate
  111 |     }
  112 |   }
  113 |   // Fall back to the build layout; readFile will surface a clear ENOENT if the
  114 |   // assets are genuinely missing.
- 115 |   _staticDir = STATIC_CANDIDATES[STATIC_CANDIDATES.length - 1];
- 116 |   return _staticDir;
  117 | }
  118 | 
  119 | const CONTENT_TYPES: Record<string, string> = {
  ⋮
  127 |   ".woff2": "font/woff2",
  128 | };
  129 | 
- 130 | function contentTypeFor(path: string): string {
- 131 |   const dot = path.lastIndexOf(".");
- 132 |   const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
- 133 |   return CONTENT_TYPES[ext] ?? "application/octet-stream";
  134 | }
  135 | 
  136 | /**
  ⋮
  138 |  * static dir, rejecting any attempt to escape the directory (path traversal).
  139 |  * Returns undefined if the path is unsafe.
  140 |  */
- 141 | function resolveStatic(staticDir: string, relPath: string): string | undefined {
- 142 |   const clean = normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
- 143 |   const full = normalize(join(staticDir, clean));
- 144 |   if (full !== staticDir && !full.startsWith(staticDir + sep)) return undefined;
- 145 |   return full;
  146 | }
  147 | 
  148 | /** Tokens substituted into HTML pages delivered by the backend. */
- 149 | function htmlTokens(): Record<string, string> {
- 150 |   const version = mockVersion();
- 151 |   const imageTag = version && /^\d+\.\d+/.test(version)
! 152 |     ? version.split(".").slice(0, 2).join(".") // e.g. 1.2
! 153 |     : "1.2";
- 154 |   return {
  155 |     VERSION: version,
! 156 |     COMMIT: mockCommit() ?? "",
  157 |     IMAGE_TAG: imageTag,
  158 |     REPO_URL,
  159 |     REPO_HOST: REPO_URL.replace("https://", ""),
  ⋮
  161 |   };
  162 | }
  163 | 
- 164 | function applyTokens(html: string, extra: Record<string, string> = {}): string {
- 165 |   const tokens = { ...htmlTokens(), ...extra };
- 166 |   return html.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
- 167 |     Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : match,
  168 |   );
  169 | }
  170 | 
  ⋮
  202 |  * Is the mock reached over a **public DNS** host (issue #78)? Drives the
  203 |  * control-panel banner wording.
  204 |  */
- 205 | function isPublicHost(event: Parameters<typeof getRequestURL>[0]): boolean {
  206 |   let host: string | undefined;
- 207 |   try {
- 208 |     host = getRequestURL(event).hostname;
  209 |   } catch {
- 210 |     host = undefined;
  211 |   }
- 212 |   return hostIsPublic(host, Boolean(process.env.PUBLIC_EXTERNAL_URL));
  213 | }
  214 | 
  215 | /** Control-panel banner tokens, computed per request (issue #78). */
- 216 | function controlPanelTokens(event: Parameters<typeof getRequestURL>[0]): Record<string, string> {
- 217 |   return controlPanelBanner(isPublicHost(event), adminTokenConfigured());
  218 | }
  219 | 
  220 | /** Read and serve an HTML page from the static dir, applying token substitution. */
- 221 | async function renderPage(
  222 |   event: Parameters<typeof setResponseHeader>[0],
  223 |   file: string,
! 224 |   extra: Record<string, string> = {},
  225 | ): Promise<string> {
- 226 |   const html = await readFile(join(await getStaticDir(), file), "utf8");
- 227 |   setResponseHeader(event, "content-type", "text/html; charset=utf-8");
- 228 |   return applyTokens(html, extra);
  229 | }
  230 | 
  231 | export interface UiRouterOptions {
  ⋮
  244 | 
  245 |   router.get(
  246 |     "/",
- 247 |     defineEventHandler((event) => sendRedirect(event, "/ui", 302)),
  248 |   );
  249 | 
  250 |   // Expose the runtime server CA so clients can verify the mock's self-signed
  ⋮
  267 | 
  268 |   router.get(
  269 |     "/ui",
- 270 |     defineEventHandler((event) => renderPage(event, "marketing.html")),
  271 |   );
  272 | 
  273 |   router.get(
  274 |     "/ui/config",
- 275 |     defineEventHandler((event) => renderPage(event, "control-panel.html", controlPanelTokens(event))),
  276 |   );
  277 | 
  278 |   router.get(
  279 |     "/ui/enroll",
- 280 |     defineEventHandler((event) => renderPage(event, "enroll.html")),
  281 |   );
  282 | 
  283 |   router.get(
  284 |     "/ui/docs",
- 285 |     defineEventHandler((event) => renderPage(event, "docs.html")),
  286 |   );
  287 | 
  288 |   router.get(
  289 |     "/ui/static/**:file",
- 290 |     defineEventHandler(async (event) => {
- 291 |       const rel = getRouterParam(event, "file") ?? "";
- 292 |       const full = resolveStatic(await getStaticDir(), rel);
- 293 |       if (!full) {
- 294 |         setResponseStatus(event, 400);
- 295 |         return { error: "invalid_path" };
  296 |       }
- 297 |       try {
- 298 |         const data = await readFile(full);
- 299 |         setResponseHeader(event, "content-type", contentTypeFor(full));
- 300 |         setResponseHeader(event, "cache-control", "public, max-age=3600");
- 301 |         return data;
  302 |       } catch {
- 303 |         setResponseStatus(event, 404);
- 304 |         return { error: "not_found" };
  305 |       }
  306 |     }),
  307 |   );
  308 | 
  309 |   router.get(
  310 |     "/openapi.json",
- 311 |     defineEventHandler(() => getServedSpec()),
  312 |   );
  313 | 
  314 |   router.get(
  315 |     "/openapi.yaml",
- 316 |     defineEventHandler((event) => {
- 317 |       setResponseHeader(event, "content-type", "application/yaml; charset=utf-8");
- 318 |       return getOpenapiYaml();
  319 |     }),
  320 |   );
  321 | 
  322 |   router.get(
  323 |     "/openapi/official.json",
- 324 |     defineEventHandler(() => officialSpec),
  325 |   );
  326 | 
  327 |   router.get(
  328 |     "/openapi/official.yaml",
- 329 |     defineEventHandler((event) => {
- 330 |       setResponseHeader(event, "content-type", "application/yaml; charset=utf-8");
- 331 |       return officialYaml;
  332 |     }),
  333 |   );
  334 | 
  335 |   router.get(
  336 |     "/ui/config.json",
- 337 |     defineEventHandler((event) => {
- 338 |       const baseUrl = baseUrlFor(event);
- 339 |       const ncb = (process.env.PONTES_DEFAULT_NCB || "bdf").toLowerCase();
- 340 |       return {
  341 |         baseUrl,
! 342 |         externalUrl: process.env.PUBLIC_EXTERNAL_URL || baseUrl,
  343 |         ncb,
  344 |         version: mockVersion(),
  345 |         commit: mockCommit(),
  ⋮
  356 |           officialOpenapiYaml: `${baseUrl}/openapi/official.yaml`,
  357 |         },
  358 |         runtime: {
! 359 |           port: Number(process.env.PORT || 3001),
  360 |           redis: Boolean(process.env.REDIS_URL),
  361 |           publicHost: isPublicHost(event),
  362 |           adminTokenRequired: adminTokenConfigured(),
  ⋮
  373 | 
  374 |   router.post(
  375 |     "/ui/inspect",
- 376 |     defineEventHandler(async (event) => {
- 377 |       const body = (await readBody(event)) as { pem?: string } | undefined;
- 378 |       return inspectPem(body?.pem ?? "");
  379 |     }),
  380 |   );
  381 | 
  382 |   router.post(
  383 |     "/ui/p12",
- 384 |     defineEventHandler(async (event) => {
- 385 |       const body = (await readBody(event)) as
  386 |         | { keyPem?: string; certPem?: string; password?: string; name?: string }
  387 |         | undefined;
- 388 |       if (!body?.keyPem || !body?.certPem) {
- 389 |         setResponseStatus(event, 400);
- 390 |         return { error: "invalid_request", detail: "keyPem and certPem are required" };
  391 |       }
- 392 |       const name = (body.name || "certificate").replace(/[^A-Za-z0-9._-]/g, "_");
- 393 |       try {
- 394 |         const der = await buildP12(body.keyPem, body.certPem, body.password ?? "", name);
- 395 |         setResponseHeader(event, "content-type", "application/x-pkcs12");
- 396 |         setResponseHeader(event, "content-disposition", `attachment; filename="${name}.p12"`);
- 397 |         return der;
  398 |       } catch (e) {
- 399 |         setResponseStatus(event, 501);
- 400 |         return {
  401 |           error: "p12_failed",
  402 |           detail: `Could not build PKCS#12 (is openssl installed?): ${String(e).slice(0, 300)}`,
  403 |         };
```
