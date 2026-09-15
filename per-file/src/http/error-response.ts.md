# src/http/error-response.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 91.30% (42/46) | `█████████░` |
| Branches | 68.83% (53/77) | `███████░░░` |
| Functions | 100.00% (9/9) | `██████████` |
| Lines | 95.12% (39/41) | `██████████` |

**Uncovered lines:** 65, 181

**Partial branches:** L52 (cond-expr), L64 (switch), L82 (binary-expr), L90 (binary-expr), L91 (cond-expr), L92 (cond-expr), L99 (binary-expr), L109 (cond-expr), L139 (binary-expr), L140 (binary-expr), L141 (binary-expr), L142 (binary-expr), L143 (binary-expr), L161 (if), L166 (if), L172 (binary-expr), L173 (binary-expr), L174 (binary-expr), L177 (if)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   49 | };
   50 | 
   51 | export function titleForStatus(status: number): string {
!  52 |   return TITLES[status] || (status >= 500 ? "Server Error" : "Error");
   53 | }
   54 | 
   55 | /**
  ⋮
   61 |   switch (status) {
   62 |     case 401:
   63 |       return "HL-ATH-001";
!  64 |     case 403:
-  65 |       return "HL-ATH-002";
   66 |     case 404:
   67 |       return "HL-GER-001";
   68 |     case 409:
  ⋮
   79 | ): BusinessError[] {
   80 |   if (Array.isArray(input) && input.length > 0) {
   81 |     return input.map((e) => {
!  82 |       const obj = (e ?? {}) as Record<string, unknown>;
   83 |       const errorCode =
   84 |         typeof obj.errorCode === "string" && obj.errorCode
   85 |           ? obj.errorCode
  ⋮
   87 |       const errorDescription =
   88 |         typeof obj.errorDescription === "string" && obj.errorDescription
   89 |           ? obj.errorDescription
!  90 |           : typeof obj.message === "string" && obj.message
!  91 |             ? (obj.message as string)
!  92 |             : titleForStatus(status);
   93 |       return { errorCode, errorDescription };
   94 |     });
   95 |   }
   96 |   return [
   97 |     {
   98 |       errorCode: fallbackErrorCode(status),
!  99 |       errorDescription: fallbackDescription || titleForStatus(status),
  100 |     },
  101 |   ];
  102 | }
  ⋮
  106 |   businessErrors?: unknown,
  107 |   fallbackDescription?: string,
  108 | ): ErrorResponse {
! 109 |   const s = Number.isFinite(status) && status >= 400 ? status : 500;
  110 |   return {
  111 |     status: s,
  112 |     title: titleForStatus(s),
  ⋮
  136 | function isSessionErrorShape(body: Record<string, unknown>): boolean {
  137 |   return (
  138 |     typeof body.status === "number" &&
! 139 |     typeof body.message === "string" &&
! 140 |     typeof body.code === "string" &&
! 141 |     !("title" in body) &&
! 142 |     !("businessErrors" in body) &&
! 143 |     !("error" in body)
  144 |   );
  145 | }
  146 | 
  ⋮
  158 |   body: unknown,
  159 | ): ErrorResponse | null {
  160 |   if (status < 400) return null;
! 161 |   if (!body || typeof body !== "object") return null;
  162 |   if (isErrorResponseShape(body)) return null;
  163 | 
  164 |   const b = body as Record<string, unknown>;
  165 | 
! 166 |   if (isSessionErrorShape(b)) return null; // keep the real-Pontes session-error shape (#118)
  167 | 
  168 |   if ("error" in b || "error_description" in b) {
  169 |     if (TOKEN_ENDPOINT.test(path)) return null; // keep OAuth on the IAM token endpoint
  170 |     const desc =
  171 |       (typeof b.error_description === "string" && b.error_description) ||
! 172 |       (typeof b.error === "string" && b.error) ||
! 173 |       undefined;
! 174 |     return toErrorResponse(status, undefined, desc || undefined);
  175 |   }
  176 | 
! 177 |   if ("businessErrors" in b) {
  178 |     return toErrorResponse(status, b.businessErrors);
  179 |   }
  180 | 
- 181 |   return null; // not an error-shaped body; leave it alone
  182 | }
  183 | 
  184 | /** Normalise a *thrown* error (H3Error / createError) to the official shape. */
```
