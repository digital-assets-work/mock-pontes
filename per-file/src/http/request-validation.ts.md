# src/http/request-validation.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 94.17% (97/103) | `█████████░` |
| Branches | 87.50% (63/72) | `█████████░` |
| Functions | 100.00% (14/14) | `██████████` |
| Lines | 95.60% (87/91) | `██████████` |

**Uncovered lines:** 102-103, 274-275

**Partial branches:** L96 (binary-expr), L130 (if), L132 (binary-expr), L140 (binary-expr), L145 (if), L163 (binary-expr), L174 (binary-expr), L197 (if), L266 (binary-expr)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   93 | const validators = new Map<string, ValidateFunction | null>();
   94 | 
   95 | function validatorFor(schemaName: string): ValidateFunction | null {
!  96 |   if (validators.has(schemaName)) return validators.get(schemaName) ?? null;
   97 |   let validate: ValidateFunction | null = null;
   98 |   try {
   99 |     validate = ajv.compile({ $ref: `pontes#/components/schemas/${schemaName}` });
  100 |   } catch (err) {
  101 |     // Never let a schema quirk break a request path — fail open (skip) + log.
- 102 |     console.warn(`[mock-pontes] could not compile validator for ${schemaName}: ${(err as Error).message}`);
- 103 |     validate = null;
  104 |   }
  105 |   validators.set(schemaName, validate);
  106 |   return validate;
  ⋮
  127 |   body: unknown,
  128 | ): Array<{ errorCode: string; errorDescription: string }> {
  129 |   const validate = validatorFor(schemaName);
! 130 |   if (!validate) return [];
  131 |   if (validate(body)) return [];
! 132 |   return (validate.errors ?? []).map((e) => ({
  133 |     errorCode: "HL-VAL-001",
  134 |     errorDescription: describeError(e),
  135 |   }));
  ⋮
  137 | 
  138 | /** Look up the schema name for a request, if this endpoint is validated. */
  139 | export function schemaForRequest(method: string, path: string): string | undefined {
! 140 |   const clean = (path || "").split("?")[0];
  141 |   // The mapped create endpoints have exactly one path parameter — the `{ncb}`
  142 |   // realm at segment 2 of `/dlt/{ncb}/…` or `/igw/{ncb}/…`. Collapse it to `{}`
  143 |   // so the concrete realm (e.g. `bdf`) matches the templated keys above.
  144 |   const segs = clean.split("/");
! 145 |   if (segs[1] === "dlt" || segs[1] === "igw") segs[2] = "{}";
  146 |   return ROUTE_SCHEMAS[`${method.toUpperCase()} ${segs.join("/")}`];
  147 | }
  148 | 
  ⋮
  160 | 
  161 | const schemasNode =
  162 |   (officialSpec as { components?: { schemas?: Record<string, { properties?: Record<string, { pattern?: string }> }> } })
! 163 |     .components?.schemas ?? {};
  164 | 
  165 | /**
  166 |  * The money fields a validated schema leaves **without** a numeric pattern. The
  ⋮
  171 |  * is uniform without producing duplicate errors for already-patterned fields.
  172 |  */
  173 | function unpatternedMoneyFields(schemaName: string): string[] {
! 174 |   const props = schemasNode[schemaName]?.properties ?? {};
  175 |   return MONEY_FIELD_NAMES.filter((f) => props[f] && !props[f].pattern);
  176 | }
  177 | 
  ⋮
  194 |   body: unknown,
  195 | ): Array<{ errorCode: string; errorDescription: string }> {
  196 |   const errors: Array<{ errorCode: string; errorDescription: string }> = [];
! 197 |   if (!body || typeof body !== "object") return errors;
  198 |   const b = body as Record<string, unknown>;
  199 |   for (const f of moneyFieldsFor(schemaName)) {
  200 |     const v = b[f];
  ⋮
  263 |  */
  264 | export function createRequestValidationMiddleware() {
  265 |   return defineEventHandler(async (event: H3Event) => {
! 266 |     const schemaName = schemaForRequest(getMethod(event), event.path || "");
  267 |     if (!schemaName) return;
  268 | 
  269 |     let body: unknown;
  ⋮
  271 |       body = (event.context.parsedBody as unknown) ?? (await readBody(event));
  272 |       event.context.parsedBody = body;
  273 |     } catch {
- 274 |       setResponseStatus(event, 400);
- 275 |       return {
  276 |         businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: "Request body is not valid JSON" }],
  277 |       };
  278 |     }
```
