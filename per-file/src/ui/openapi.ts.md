# src/ui/openapi.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 92.11% (35/38) | `█████████░` |
| Branches | 66.67% (20/30) | `███████░░░` |
| Functions | 66.67% (2/3) | `███████░░░` |
| Lines | 94.59% (35/37) | `█████████░` |

**Uncovered lines:** 476-478

**Partial branches:** L424 (binary-expr), L426 (if), L432 (binary-expr), L436 (binary-expr), L437 (if), L452 (binary-expr), L454 (binary-expr), L458 (binary-expr), L461 (binary-expr), L466 (cond-expr)

**Never called:** `buildServedSpec` (L476)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
  421 | ): AnyObj {
  422 |   const hasErrorResponse = Boolean(spec.components?.schemas?.ErrorResponse);
  423 | 
! 424 |   for (const [path, item] of Object.entries<AnyObj>(spec.paths || {})) {
  425 |     for (const method of Object.keys(item)) {
! 426 |       if (!HTTP_METHODS.includes(method)) continue;
  427 |       const op = item[method] as AnyObj;
  428 |       const key = `${method.toUpperCase()} ${normalizePath(path)}`;
  429 |       const implemented = implementedKeys.has(key);
  430 |       op["x-mock-implemented"] = implemented;
  431 |       if (!implemented) {
! 432 |         op.tags = ["NotImplemented", ...(op.tags || [])];
  433 |         op.description =
  434 |           "**⚠ Not implemented by this mock.**\n\n" + (op.description || "");
  435 |       }
! 436 |       op.responses = op.responses || {};
! 437 |       if (!op.responses.default && hasErrorResponse) {
  438 |         op.responses.default = {
  439 |           description: "Error",
  440 |           content: {
  ⋮
  449 | 
  450 |   // Merge mock-only helpers.
  451 |   spec.paths = { ...spec.paths, ...mockExtras.paths };
! 452 |   spec.components = spec.components || {};
  453 |   spec.components.schemas = {
! 454 |     ...(spec.components.schemas || {}),
  455 |     ...mockExtras.components.schemas,
  456 |   };
  457 |   annotateSupplementaryData(spec.components.schemas);
! 458 |   spec.tags = [...(spec.tags || []), ...mockExtras.tags];
  459 | 
  460 |   spec.info = {
! 461 |     ...(spec.info || {}),
  462 |     title: "Mock Pontes API (official EII spec, annotated)",
  463 |     version,
  464 |     description: spec.info?.description
  465 |       ? `${MOCK_INFO_DESCRIPTION}\n\n---\n\n${spec.info.description}`
! 466 |       : MOCK_INFO_DESCRIPTION,
  467 |   };
  468 |   spec.servers = [{ url: "/", description: "This mock instance" }];
  469 |   return spec;
  ⋮
  473 |  * Build the served OpenAPI document from the official spec + the current route
  474 |  * registry. Call after all routes are registered (e.g. lazily on first request).
  475 |  */
- 476 | export function buildServedSpec(version: string): AnyObj {
- 477 |   const clone = structuredClone(officialSpec) as AnyObj;
- 478 |   return annotateSpec(clone, registeredKeySet(), version);
  479 | }
  480 | 
```
