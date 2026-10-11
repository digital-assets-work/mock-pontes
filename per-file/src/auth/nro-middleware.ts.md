# src/auth/nro-middleware.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 87.84% (130/148) | `█████████░` |
| Branches | 78.38% (87/111) | `████████░░` |
| Functions | 95.45% (21/22) | `██████████` |
| Lines | 91.67% (121/132) | `█████████░` |

**Uncovered lines:** 83-84, 207, 298-299, 367-368, 370, 385, 438, 444-445

**Partial branches:** L41 (cond-expr), L62 (if), L68 (cond-expr), L78 (if), L95 (if), L121 (binary-expr), L195 (if), L200 (if), L203 (if), L275 (binary-expr), L297 (if), L343 (if), L344 (if), L351 (cond-expr), L366 (binary-expr), L378 (binary-expr), L379 (if), L381 (if), L396 (binary-expr), L405 (cond-expr), L443 (if)

**Never called:** `(anonymous_5)` (L83)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   38 | 
   39 | /** Normalize an amount to exactly 2 decimal places for NRO signing; null if not numeric. */
   40 | function amountFor2dpSigning(amount: unknown): string | null {
!  41 |   const n = typeof amount === "number" ? amount : Number(amount);
   42 |   return Number.isFinite(n) ? n.toFixed(2) : null;
   43 | }
   44 | 
  ⋮
   59 |     typeof (current as SpecNode).$ref === "string"
   60 |   ) {
   61 |     const ref = (current as SpecNode).$ref as string;
!  62 |     if (seen.has(ref)) return undefined;
   63 |     seen.add(ref);
   64 |     current = ref
   65 |       .split("/")
   66 |       .slice(1)
   67 |       .reduce<unknown>(
!  68 |         (acc, key) => (acc == null ? acc : (acc as SpecNode)[key]),
   69 |         officialSpec as unknown,
   70 |       );
   71 |   }
  ⋮
   75 | /** True if a request schema (following `$ref`/`allOf`/`oneOf`/`anyOf`) carries NRO fields. */
   76 | function schemaHasNroFields(schema: unknown, seen: Set<string>): boolean {
   77 |   const resolved = resolveRef(schema, seen) as SpecNode | undefined;
!  78 |   if (!resolved || typeof resolved !== "object") return false;
   79 |   const props = resolved.properties as SpecNode | undefined;
   80 |   if (props && (props.signature || props.signerPEM)) return true;
   81 |   for (const key of ["allOf", "oneOf", "anyOf"] as const) {
   82 |     const branch = resolved[key];
-  83 |     if (Array.isArray(branch) && branch.some((s) => schemaHasNroFields(s, seen)))
-  84 |       return true;
   85 |   }
   86 |   return false;
   87 | }
  ⋮
   92 |   if (!op) return false;
   93 |   const requestBody = resolveRef(op.requestBody, new Set()) as SpecNode | undefined;
   94 |   const content = requestBody?.content as SpecNode | undefined;
!  95 |   if (!content) return false;
   96 |   const media = (content["application/json"] ??
   97 |     content[Object.keys(content)[0]]) as SpecNode | undefined;
   98 |   return schemaHasNroFields(media?.schema, new Set());
  ⋮
  118 |  */
  119 | export function deriveNroRouteMatchers(): readonly NroRouteMatcher[] {
  120 |   const matchers: NroRouteMatcher[] = [];
! 121 |   const paths = ((officialSpec as SpecNode).paths ?? {}) as Record<string, SpecNode>;
  122 |   for (const [template, item] of Object.entries(paths)) {
  123 |     for (const method of ["post", "put"] as const) {
  124 |       if (operationRequiresNro(item[method])) {
  ⋮
  192 |   // Direct RTGS Payment: id + amount + payerBank + receiverBank
  193 |   if (body.payerBank != null) {
  194 |     const parts = [body.id, body.amount, body.payerBank, body.receiverBank];
! 195 |     if (parts.some((p) => p == null)) return null;
  196 |     return parts.join("");
  197 |   }
  198 | 
  199 |   // XvP: transform xvpTransactionId + amount + buyer.bic + seller.bic
! 200 |   if (body.xvpTransactionId != null) {
  201 |     const xvpId = "xvp" + String(body.xvpTransactionId).replace(/-/g, "");
  202 |     const parts = [xvpId, body.amount, body.buyer?.bic, body.seller?.bic];
! 203 |     if (parts.some((p) => p == null)) return null;
  204 |     return parts.join("");
  205 |   }
  206 | 
- 207 |   return null;
  208 | }
  209 | 
  210 | /**
  ⋮
  272 | 
  273 | export function createNroMiddleware(matchers: readonly NroRouteMatcher[]) {
  274 |   return defineEventHandler(async (event: H3Event) => {
! 275 |     const path = event.path || "";
  276 |     const method = getMethod(event);
  277 | 
  278 |     if (!requiresNRO(path, method, matchers)) return;
  ⋮
  294 |     }
  295 | 
  296 |     const signingData = buildSigningData(body);
! 297 |     if (!signingData) {
- 298 |       setResponseStatus(event, 400);
- 299 |       return {
  300 |         businessErrors: [
  301 |           {
  302 |             errorCode: "HL-NRO-002",
  ⋮
  340 | function decodeForwardedCertHeader(value: string): string | null {
  341 |   let v = value.trim();
  342 |   const xfccMatch = v.match(/(?:^|;)\s*(?:Cert|Chain)="?([^";]+)"?/i);
! 343 |   if (xfccMatch) v = xfccMatch[1];
! 344 |   if (!v.includes("BEGIN CERTIFICATE")) {
  345 |     try {
  346 |       v = decodeURIComponent(v);
  347 |     } catch {
  348 |       /* leave as-is */
  349 |     }
  350 |   }
! 351 |   return v.includes("BEGIN CERTIFICATE") ? v : null;
  352 | }
  353 | 
  354 | /**
  ⋮
  363 |  */
  364 | function resolveClientCert(event: H3Event): X509Certificate | null {
  365 |   const mtls = event.context.mtlsCert as { raw?: Buffer } | undefined;
! 366 |   if (mtls && mtls.raw) {
- 367 |     try {
- 368 |       return new X509Certificate(mtls.raw);
  369 |     } catch {
- 370 |       return null;
  371 |     }
  372 |   }
  373 | 
  ⋮
  375 |     const headers = event.node.req.headers;
  376 |     const raw =
  377 |       (headers["x-forwarded-client-cert"] as string | undefined) ||
! 378 |       (headers["ssl-client-cert"] as string | undefined);
! 379 |     if (raw) {
  380 |       const pem = decodeForwardedCertHeader(raw);
! 381 |       if (pem) {
  382 |         try {
  383 |           return new X509Certificate(pem);
  384 |         } catch {
- 385 |           return null;
  386 |         }
  387 |       }
  388 |     }
  ⋮
  393 | 
  394 | export function createNroCertCheckMiddleware(matchers: readonly NroRouteMatcher[]) {
  395 |   return defineEventHandler(async (event) => {
! 396 |     const path = event.path || "";
  397 |     const method = getMethod(event);
  398 | 
  399 |     if (!requiresNRO(path, method, matchers)) return;
  ⋮
  402 |       event.context?.parsedBody ||
  403 |       (event.node.req.method === "POST" || event.node.req.method === "PUT"
  404 |         ? await readBody(event)
! 405 |         : undefined);
  406 | 
  407 |     // No signer certificate on the request → nothing to bind here. Absence of
  408 |     // signerPEM on an NRO route is handled by the NRO signature middleware
  ⋮
  435 |       nroCert = new X509Certificate(signerPem);
  436 |     } catch {
  437 |       // Invalid signerPEM format is handled by the downstream NRO middleware.
- 438 |       return;
  439 |     }
  440 | 
  441 |     // Compare raw DER: the NRO signer must be the same certificate presented
  442 |     // for mTLS (self-signed origin binding).
! 443 |     if (Buffer.compare(nroCert.raw, clientCert.raw) !== 0) {
- 444 |       setResponseStatus(event, 400);
- 445 |       return {
  446 |         businessErrors: [
  447 |           {
  448 |             errorCode: "HL-NRO-004",
```
