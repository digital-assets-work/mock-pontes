# src/ui/router.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 39.13% (54/138) | `████░░░░░░` |
| Branches | 36.11% (26/72) | `████░░░░░░` |
| Functions | 13.79% (4/29) | `█░░░░░░░░░` |
| Lines | 38.46% (50/130) | `████░░░░░░` |

**Uncovered lines:** 64-66, 68-70, 72, 76-81, 83, 104-110, 117-118, 132-135, 143-147, 151-153, 156, 166-169, 207, 209-210, 212, 214, 218-219, 223, 228-230, 249, 272, 277, 282, 287, 292-297, 299-303, 305-306, 313, 318-320, 326, 331-333, 339-342, 378-380, 386-387, 390-392, 394-399, 401-402

**Partial branches:** L154 (cond-expr), L155 (cond-expr), L158 (binary-expr), L226 (default-arg), L344 (binary-expr), L361 (binary-expr)

**Never called:** `getServedSpec` (L64), `getOpenapiYaml` (L68), `baseUrlFor` (L76), `getStaticDir` (L104), `contentTypeFor` (L132), `resolveStatic` (L143), `htmlTokens` (L151), `applyTokens` (L166), `(anonymous_9)` (L168), `isPublicHost` (L207), `controlPanelTokens` (L218), `renderPage` (L223), `(anonymous_16)` (L249), `(anonymous_18)` (L272), `(anonymous_19)` (L277), `(anonymous_20)` (L282), `(anonymous_21)` (L287), `(anonymous_22)` (L292), `(anonymous_23)` (L313), `(anonymous_24)` (L318), `(anonymous_25)` (L326), `(anonymous_26)` (L331), `(anonymous_27)` (L339), `(anonymous_28)` (L378), `(anonymous_29)` (L386)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   61 | // stamped with the running release so the docs match the build.
   62 | let _servedSpec: ReturnType<typeof buildServedSpec> | undefined;
   63 | let _openapiYaml: string | undefined;
-  64 | function getServedSpec(): ReturnType<typeof buildServedSpec> {
-  65 |   if (!_servedSpec) _servedSpec = buildServedSpec(mockVersion());
-  66 |   return _servedSpec;
   67 | }
-  68 | function getOpenapiYaml(): string {
-  69 |   if (_openapiYaml === undefined) {
-  70 |     _openapiYaml = stringifyYaml(getServedSpec(), { lineWidth: 0 });
   71 |   }
-  72 |   return _openapiYaml;
   73 | }
   74 | const officialYaml = stringifyYaml(officialSpec, { lineWidth: 0 });
   75 | 
-  76 | function baseUrlFor(event: Parameters<typeof getRequestURL>[0]): string {
-  77 |   const envUrl = process.env.PUBLIC_EXTERNAL_URL;
-  78 |   if (envUrl) return envUrl.replace(/\/$/, "");
-  79 |   try {
-  80 |     const u = getRequestURL(event);
-  81 |     return `${u.protocol}//${u.host}`;
   82 |   } catch {
-  83 |     return "";
   84 |   }
   85 | }
   86 | 
  ⋮
  101 |   join(process.cwd(), "dist", "static"),
  102 | ];
  103 | let _staticDir: string | undefined;
- 104 | async function getStaticDir(): Promise<string> {
- 105 |   if (_staticDir) return _staticDir;
- 106 |   for (const dir of STATIC_CANDIDATES) {
- 107 |     try {
- 108 |       await access(join(dir, "marketing.html"));
- 109 |       _staticDir = dir;
- 110 |       return dir;
  111 |     } catch {
  112 |       // try the next candidate
  113 |     }
  114 |   }
  115 |   // Fall back to the build layout; readFile will surface a clear ENOENT if the
  116 |   // assets are genuinely missing.
- 117 |   _staticDir = STATIC_CANDIDATES[STATIC_CANDIDATES.length - 1];
- 118 |   return _staticDir;
  119 | }
  120 | 
  121 | const CONTENT_TYPES: Record<string, string> = {
  ⋮
  129 |   ".woff2": "font/woff2",
  130 | };
  131 | 
- 132 | function contentTypeFor(path: string): string {
- 133 |   const dot = path.lastIndexOf(".");
- 134 |   const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
- 135 |   return CONTENT_TYPES[ext] ?? "application/octet-stream";
  136 | }
  137 | 
  138 | /**
  ⋮
  140 |  * static dir, rejecting any attempt to escape the directory (path traversal).
  141 |  * Returns undefined if the path is unsafe.
  142 |  */
- 143 | function resolveStatic(staticDir: string, relPath: string): string | undefined {
- 144 |   const clean = normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
- 145 |   const full = normalize(join(staticDir, clean));
- 146 |   if (full !== staticDir && !full.startsWith(staticDir + sep)) return undefined;
- 147 |   return full;
  148 | }
  149 | 
  150 | /** Tokens substituted into HTML pages delivered by the backend. */
- 151 | function htmlTokens(): Record<string, string> {
- 152 |   const version = mockVersion();
- 153 |   const imageTag = version && /^\d+\.\d+/.test(version)
! 154 |     ? version.split(".").slice(0, 2).join(".") // e.g. 1.2
! 155 |     : "1.2";
- 156 |   return {
  157 |     VERSION: version,
! 158 |     COMMIT: mockCommit() ?? "",
  159 |     IMAGE_TAG: imageTag,
  160 |     REPO_URL,
  161 |     REPO_HOST: REPO_URL.replace("https://", ""),
  ⋮
  163 |   };
  164 | }
  165 | 
- 166 | function applyTokens(html: string, extra: Record<string, string> = {}): string {
- 167 |   const tokens = { ...htmlTokens(), ...extra };
- 168 |   return html.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
- 169 |     Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : match,
  170 |   );
  171 | }
  172 | 
  ⋮
  204 |  * Is the mock reached over a **public DNS** host (issue #78)? Drives the
  205 |  * control-panel banner wording.
  206 |  */
- 207 | function isPublicHost(event: Parameters<typeof getRequestURL>[0]): boolean {
  208 |   let host: string | undefined;
- 209 |   try {
- 210 |     host = getRequestURL(event).hostname;
  211 |   } catch {
- 212 |     host = undefined;
  213 |   }
- 214 |   return hostIsPublic(host, Boolean(process.env.PUBLIC_EXTERNAL_URL));
  215 | }
  216 | 
  217 | /** Control-panel banner tokens, computed per request (issue #78). */
- 218 | function controlPanelTokens(event: Parameters<typeof getRequestURL>[0]): Record<string, string> {
- 219 |   return controlPanelBanner(isPublicHost(event), adminTokenConfigured());
  220 | }
  221 | 
  222 | /** Read and serve an HTML page from the static dir, applying token substitution. */
- 223 | async function renderPage(
  224 |   event: Parameters<typeof setResponseHeader>[0],
  225 |   file: string,
! 226 |   extra: Record<string, string> = {},
  227 | ): Promise<string> {
- 228 |   const html = await readFile(join(await getStaticDir(), file), "utf8");
- 229 |   setResponseHeader(event, "content-type", "text/html; charset=utf-8");
- 230 |   return applyTokens(html, extra);
  231 | }
  232 | 
  233 | export interface UiRouterOptions {
  ⋮
  246 | 
  247 |   router.get(
  248 |     "/",
- 249 |     defineEventHandler((event) => sendRedirect(event, "/ui", 302)),
  250 |   );
  251 | 
  252 |   // Expose the runtime server CA so clients can verify the mock's self-signed
  ⋮
  269 | 
  270 |   router.get(
  271 |     "/ui",
- 272 |     defineEventHandler((event) => renderPage(event, "marketing.html")),
  273 |   );
  274 | 
  275 |   router.get(
  276 |     "/ui/config",
- 277 |     defineEventHandler((event) => renderPage(event, "control-panel.html", controlPanelTokens(event))),
  278 |   );
  279 | 
  280 |   router.get(
  281 |     "/ui/enroll",
- 282 |     defineEventHandler((event) => renderPage(event, "enroll.html")),
  283 |   );
  284 | 
  285 |   router.get(
  286 |     "/ui/docs",
- 287 |     defineEventHandler((event) => renderPage(event, "docs.html")),
  288 |   );
  289 | 
  290 |   router.get(
  291 |     "/ui/static/**:file",
- 292 |     defineEventHandler(async (event) => {
- 293 |       const rel = getRouterParam(event, "file") ?? "";
- 294 |       const full = resolveStatic(await getStaticDir(), rel);
- 295 |       if (!full) {
- 296 |         setResponseStatus(event, 400);
- 297 |         return { error: "invalid_path" };
  298 |       }
- 299 |       try {
- 300 |         const data = await readFile(full);
- 301 |         setResponseHeader(event, "content-type", contentTypeFor(full));
- 302 |         setResponseHeader(event, "cache-control", "public, max-age=3600");
- 303 |         return data;
  304 |       } catch {
- 305 |         setResponseStatus(event, 404);
- 306 |         return { error: "not_found" };
  307 |       }
  308 |     }),
  309 |   );
  310 | 
  311 |   router.get(
  312 |     "/openapi.json",
- 313 |     defineEventHandler(() => getServedSpec()),
  314 |   );
  315 | 
  316 |   router.get(
  317 |     "/openapi.yaml",
- 318 |     defineEventHandler((event) => {
- 319 |       setResponseHeader(event, "content-type", "application/yaml; charset=utf-8");
- 320 |       return getOpenapiYaml();
  321 |     }),
  322 |   );
  323 | 
  324 |   router.get(
  325 |     "/openapi/official.json",
- 326 |     defineEventHandler(() => officialSpec),
  327 |   );
  328 | 
  329 |   router.get(
  330 |     "/openapi/official.yaml",
- 331 |     defineEventHandler((event) => {
- 332 |       setResponseHeader(event, "content-type", "application/yaml; charset=utf-8");
- 333 |       return officialYaml;
  334 |     }),
  335 |   );
  336 | 
  337 |   router.get(
  338 |     "/ui/config.json",
- 339 |     defineEventHandler((event) => {
- 340 |       const baseUrl = baseUrlFor(event);
- 341 |       const ncb = (process.env.PONTES_DEFAULT_NCB || "bdf").toLowerCase();
- 342 |       return {
  343 |         baseUrl,
! 344 |         externalUrl: process.env.PUBLIC_EXTERNAL_URL || baseUrl,
  345 |         ncb,
  346 |         version: mockVersion(),
  347 |         commit: mockCommit(),
  ⋮
  358 |           officialOpenapiYaml: `${baseUrl}/openapi/official.yaml`,
  359 |         },
  360 |         runtime: {
! 361 |           port: Number(process.env.PORT || 3001),
  362 |           redis: Boolean(process.env.REDIS_URL),
  363 |           publicHost: isPublicHost(event),
  364 |           adminTokenRequired: adminTokenConfigured(),
  ⋮
  375 | 
  376 |   router.post(
  377 |     "/ui/inspect",
- 378 |     defineEventHandler(async (event) => {
- 379 |       const body = (await readBody(event)) as { pem?: string } | undefined;
- 380 |       return inspectPem(body?.pem ?? "");
  381 |     }),
  382 |   );
  383 | 
  384 |   router.post(
  385 |     "/ui/p12",
- 386 |     defineEventHandler(async (event) => {
- 387 |       const body = (await readBody(event)) as
  388 |         | { keyPem?: string; certPem?: string; password?: string; name?: string }
  389 |         | undefined;
- 390 |       if (!body?.keyPem || !body?.certPem) {
- 391 |         setResponseStatus(event, 400);
- 392 |         return { error: "invalid_request", detail: "keyPem and certPem are required" };
  393 |       }
- 394 |       const name = (body.name || "certificate").replace(/[^A-Za-z0-9._-]/g, "_");
- 395 |       try {
- 396 |         const der = await buildP12(body.keyPem, body.certPem, body.password ?? "", name);
- 397 |         setResponseHeader(event, "content-type", "application/x-pkcs12");
- 398 |         setResponseHeader(event, "content-disposition", `attachment; filename="${name}.p12"`);
- 399 |         return der;
  400 |       } catch (e) {
- 401 |         setResponseStatus(event, 501);
- 402 |         return {
  403 |           error: "p12_failed",
  404 |           detail: `Could not build PKCS#12 (is openssl installed?): ${String(e).slice(0, 300)}`,
  405 |         };
```
