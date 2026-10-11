# src/http/request-validation.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 94.55% (104/110) | `█████████░` |
| Branches | 89.47% (68/76) | `█████████░` |
| Functions | 100.00% (16/16) | `██████████` |
| Lines | 95.83% (92/96) | `██████████` |

**Uncovered lines:** 112-113, 295-296

**Partial branches:** L106 (binary-expr), L140 (if), L142 (binary-expr), L160 (binary-expr), L184 (binary-expr), L195 (binary-expr), L218 (if), L287 (binary-expr)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
  103 | const validators = new Map<string, ValidateFunction | null>();
  104 | 
  105 | function validatorFor(schemaName: string): ValidateFunction | null {
! 106 |   if (validators.has(schemaName)) return validators.get(schemaName) ?? null;
  107 |   let validate: ValidateFunction | null = null;
  108 |   try {
  109 |     validate = ajv.compile({ $ref: `pontes#/components/schemas/${schemaName}` });
  110 |   } catch (err) {
  111 |     // Never let a schema quirk break a request path — fail open (skip) + log.
- 112 |     console.warn(`[mock-pontes] could not compile validator for ${schemaName}: ${(err as Error).message}`);
- 113 |     validate = null;
  114 |   }
  115 |   validators.set(schemaName, validate);
  116 |   return validate;
  ⋮
  137 |   body: unknown,
  138 | ): Array<{ errorCode: string; errorDescription: string }> {
  139 |   const validate = validatorFor(schemaName);
! 140 |   if (!validate) return [];
  141 |   if (validate(body)) return [];
! 142 |   return (validate.errors ?? []).map((e) => ({
  143 |     errorCode: "HL-VAL-001",
  144 |     errorDescription: describeError(e),
  145 |   }));
  ⋮
  157 | 
  158 | /** Look up the schema name for a request, if this endpoint is validated. */
  159 | export function schemaForRequest(method: string, path: string): string | undefined {
! 160 |   const segs = (path || "").split("?")[0].split("/");
  161 |   const m = method.toUpperCase();
  162 |   for (const t of ROUTE_TEMPLATES) {
  163 |     if (t.method !== m || t.segments.length !== segs.length) continue;
  ⋮
  181 | 
  182 | const schemasNode =
  183 |   (officialSpec as { components?: { schemas?: Record<string, { properties?: Record<string, { pattern?: string }> }> } })
! 184 |     .components?.schemas ?? {};
  185 | 
  186 | /**
  187 |  * The money fields a validated schema leaves **without** a numeric pattern. The
  ⋮
  192 |  * is uniform without producing duplicate errors for already-patterned fields.
  193 |  */
  194 | function unpatternedMoneyFields(schemaName: string): string[] {
! 195 |   const props = schemasNode[schemaName]?.properties ?? {};
  196 |   return MONEY_FIELD_NAMES.filter((f) => props[f] && !props[f].pattern);
  197 | }
  198 | 
  ⋮
  215 |   body: unknown,
  216 | ): Array<{ errorCode: string; errorDescription: string }> {
  217 |   const errors: Array<{ errorCode: string; errorDescription: string }> = [];
! 218 |   if (!body || typeof body !== "object") return errors;
  219 |   const b = body as Record<string, unknown>;
  220 |   for (const f of moneyFieldsFor(schemaName)) {
  221 |     const v = b[f];
  ⋮
  284 |  */
  285 | export function createRequestValidationMiddleware() {
  286 |   return defineEventHandler(async (event: H3Event) => {
! 287 |     const schemaName = schemaForRequest(getMethod(event), event.path || "");
  288 |     if (!schemaName) return;
  289 | 
  290 |     let body: unknown;
  ⋮
  292 |       body = (event.context.parsedBody as unknown) ?? (await readBody(event));
  293 |       event.context.parsedBody = body;
  294 |     } catch {
- 295 |       setResponseStatus(event, 400);
- 296 |       return {
  297 |         businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "Request body is not valid JSON" }],
  298 |       };
  299 |     }
```
