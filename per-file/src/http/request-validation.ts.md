# src/http/request-validation.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 93.81% (91/97) | `█████████░` |
| Branches | 86.76% (59/68) | `█████████░` |
| Functions | 100.00% (13/13) | `██████████` |
| Lines | 95.29% (81/85) | `██████████` |

**Uncovered lines:** 95-96, 238-239

**Partial branches:** L89 (binary-expr), L123 (if), L125 (binary-expr), L133 (binary-expr), L138 (if), L156 (binary-expr), L167 (binary-expr), L190 (if), L230 (binary-expr)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   86 | const validators = new Map<string, ValidateFunction | null>();
   87 | 
   88 | function validatorFor(schemaName: string): ValidateFunction | null {
!  89 |   if (validators.has(schemaName)) return validators.get(schemaName) ?? null;
   90 |   let validate: ValidateFunction | null = null;
   91 |   try {
   92 |     validate = ajv.compile({ $ref: `pontes#/components/schemas/${schemaName}` });
   93 |   } catch (err) {
   94 |     // Never let a schema quirk break a request path — fail open (skip) + log.
-  95 |     console.warn(`[mock-pontes] could not compile validator for ${schemaName}: ${(err as Error).message}`);
-  96 |     validate = null;
   97 |   }
   98 |   validators.set(schemaName, validate);
   99 |   return validate;
  ⋮
  120 |   body: unknown,
  121 | ): Array<{ errorCode: string; errorDescription: string }> {
  122 |   const validate = validatorFor(schemaName);
! 123 |   if (!validate) return [];
  124 |   if (validate(body)) return [];
! 125 |   return (validate.errors ?? []).map((e) => ({
  126 |     errorCode: "HL-VAL-001",
  127 |     errorDescription: describeError(e),
  128 |   }));
  ⋮
  130 | 
  131 | /** Look up the schema name for a request, if this endpoint is validated. */
  132 | export function schemaForRequest(method: string, path: string): string | undefined {
! 133 |   const clean = (path || "").split("?")[0];
  134 |   // The mapped create endpoints have exactly one path parameter — the `{ncb}`
  135 |   // realm at segment 2 of `/dlt/{ncb}/…` or `/igw/{ncb}/…`. Collapse it to `{}`
  136 |   // so the concrete realm (e.g. `bdf`) matches the templated keys above.
  137 |   const segs = clean.split("/");
! 138 |   if (segs[1] === "dlt" || segs[1] === "igw") segs[2] = "{}";
  139 |   return ROUTE_SCHEMAS[`${method.toUpperCase()} ${segs.join("/")}`];
  140 | }
  141 | 
  ⋮
  153 | 
  154 | const schemasNode =
  155 |   (officialSpec as { components?: { schemas?: Record<string, { properties?: Record<string, { pattern?: string }> }> } })
! 156 |     .components?.schemas ?? {};
  157 | 
  158 | /**
  159 |  * The money fields a validated schema leaves **without** a numeric pattern. The
  ⋮
  164 |  * is uniform without producing duplicate errors for already-patterned fields.
  165 |  */
  166 | function unpatternedMoneyFields(schemaName: string): string[] {
! 167 |   const props = schemasNode[schemaName]?.properties ?? {};
  168 |   return MONEY_FIELD_NAMES.filter((f) => props[f] && !props[f].pattern);
  169 | }
  170 | 
  ⋮
  187 |   body: unknown,
  188 | ): Array<{ errorCode: string; errorDescription: string }> {
  189 |   const errors: Array<{ errorCode: string; errorDescription: string }> = [];
! 190 |   if (!body || typeof body !== "object") return errors;
  191 |   const b = body as Record<string, unknown>;
  192 |   for (const f of moneyFieldsFor(schemaName)) {
  193 |     const v = b[f];
  ⋮
  227 |  */
  228 | export function createRequestValidationMiddleware() {
  229 |   return defineEventHandler(async (event: H3Event) => {
! 230 |     const schemaName = schemaForRequest(getMethod(event), event.path || "");
  231 |     if (!schemaName) return;
  232 | 
  233 |     let body: unknown;
  ⋮
  235 |       body = (event.context.parsedBody as unknown) ?? (await readBody(event));
  236 |       event.context.parsedBody = body;
  237 |     } catch {
- 238 |       setResponseStatus(event, 400);
- 239 |       return {
  240 |         businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "Request body is not valid JSON" }],
  241 |       };
  242 |     }
```
