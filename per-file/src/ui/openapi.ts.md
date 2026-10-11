# src/ui/openapi.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 92.68% (38/41) | `█████████░` |
| Branches | 70.59% (24/34) | `███████░░░` |
| Functions | 66.67% (2/3) | `███████░░░` |
| Lines | 95.00% (38/40) | `██████████` |

**Uncovered lines:** 511-513

**Partial branches:** L459 (binary-expr), L461 (if), L467 (binary-expr), L471 (binary-expr), L472 (if), L487 (binary-expr), L489 (binary-expr), L493 (binary-expr), L496 (binary-expr), L501 (cond-expr)

**Never called:** `buildServedSpec` (L511)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
  456 | ): AnyObj {
  457 |   const hasErrorResponse = Boolean(spec.components?.schemas?.ErrorResponse);
  458 | 
! 459 |   for (const [path, item] of Object.entries<AnyObj>(spec.paths || {})) {
  460 |     for (const method of Object.keys(item)) {
! 461 |       if (!HTTP_METHODS.includes(method)) continue;
  462 |       const op = item[method] as AnyObj;
  463 |       const key = `${method.toUpperCase()} ${normalizePath(path)}`;
  464 |       const implemented = implementedKeys.has(key);
  465 |       op["x-mock-implemented"] = implemented;
  466 |       if (!implemented) {
! 467 |         op.tags = ["NotImplemented", ...(op.tags || [])];
  468 |         op.description =
  469 |           "**⚠ Not implemented by this mock.**\n\n" + (op.description || "");
  470 |       }
! 471 |       op.responses = op.responses || {};
! 472 |       if (!op.responses.default && hasErrorResponse) {
  473 |         op.responses.default = {
  474 |           description: "Error",
  475 |           content: {
  ⋮
  484 | 
  485 |   // Merge mock-only helpers.
  486 |   spec.paths = { ...spec.paths, ...mockExtras.paths };
! 487 |   spec.components = spec.components || {};
  488 |   spec.components.schemas = {
! 489 |     ...(spec.components.schemas || {}),
  490 |     ...mockExtras.components.schemas,
  491 |   };
  492 |   annotateSupplementaryData(spec.components.schemas);
! 493 |   spec.tags = [...(spec.tags || []), ...mockExtras.tags];
  494 | 
  495 |   spec.info = {
! 496 |     ...(spec.info || {}),
  497 |     title: "Mock Pontes API (official EII spec, annotated)",
  498 |     version,
  499 |     description: spec.info?.description
  500 |       ? `${MOCK_INFO_DESCRIPTION}\n\n---\n\n${spec.info.description}`
! 501 |       : MOCK_INFO_DESCRIPTION,
  502 |   };
  503 |   spec.servers = [{ url: "/", description: "This mock instance" }];
  504 |   return spec;
  ⋮
  508 |  * Build the served OpenAPI document from the official spec + the current route
  509 |  * registry. Call after all routes are registered (e.g. lazily on first request).
  510 |  */
- 511 | export function buildServedSpec(version: string): AnyObj {
- 512 |   const clone = structuredClone(officialSpec) as AnyObj;
- 513 |   return annotateSpec(clone, registeredKeySet(), version);
  514 | }
  515 | 
```
