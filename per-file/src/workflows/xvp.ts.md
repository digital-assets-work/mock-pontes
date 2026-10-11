# src/workflows/xvp.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 92.54% (62/67) | `█████████░` |
| Branches | 85.96% (49/57) | `█████████░` |
| Functions | 90.91% (10/11) | `█████████░` |
| Lines | 95.08% (58/61) | `██████████` |

**Uncovered lines:** 152-153, 159, 297

**Partial branches:** L158 (binary-expr), L213 (cond-expr), L268 (if), L296 (if), L342 (binary-expr), L370 (if), L371 (cond-expr)

**Never called:** `(anonymous_2)` (L152)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
  149 |   }
  150 | 
  151 |   // The base `apply()` is unused: XvP settles via execute() below.
- 152 |   protected apply(): void {
- 153 |     throw new WorkflowRejection(500, "HL-XVP-000", "XvP does not use the generic apply()");
  154 |   }
  155 | 
  156 |   /** Register the XvP and issue the hash-lock. No funds are moved. */
  157 |   init(params: XvpInitParams): XvpInitResult {
! 158 |     if (params.transactionType !== "DVP" && params.transactionType !== "PVP") {
- 159 |       throw new WorkflowRejection(400, "HL-XVP-001", `Invalid XvP transactionType '${params.transactionType}'`);
  160 |     }
  161 | 
  162 |     const { executionKey, executionHash, cancellationKey, cancellationHash } = generateXvpCommitments(
  ⋮
  210 |    * first-observation-settled status.
  211 |    */
  212 |   private shape(d: Draft): XvpRecord {
! 213 |     const meta = d.supplementaryData ? JSON.parse(d.supplementaryData) : {};
  214 |     return {
  215 |       id: d.id,
  216 |       status: d.status,
  ⋮
  265 |   async get(xvpTransactionId: string): Promise<XvpRecord | undefined> {
  266 |     return this.lock.withLock(xvpTransactionId, () => {
  267 |       const d = this.store.getDraft(xvpTransactionId);
! 268 |       if (!d || d.type !== "XVP") return undefined;
  269 |       return this.shape(this.maybeExpire(d));
  270 |     });
  271 |   }
  ⋮
  293 |   }> {
  294 |     return this.lock.withLock(xvpTransactionId, async () => {
  295 |       const d = this.store.getDraft(xvpTransactionId);
! 296 |       if (!d || d.type !== "XVP") {
- 297 |         throw new WorkflowRejection(404, "HL-XVP-002", `XvP transaction ${xvpTransactionId} not found`);
  298 |       }
  299 |       const rec = this.shape(this.maybeExpire(d));
  300 |       // Issue #144: a late payment is reported identically regardless of
  ⋮
  339 |       this.store.addTransaction({
  340 |         // Identify the settled cash movement by its payment id, and link it back
  341 |         // to the originating XvP via supplementaryData (as other payments do).
! 342 |         id: rec.paymentId ?? `TX-${rec.id}`,
  343 |         type: "XVP",
  344 |         status: "SETTLED",
  345 |         amount: rec.amount,
  ⋮
  367 |    */
  368 |   private markPaymentAttempted(id: string): void {
  369 |     const d = this.store.getDraft(id);
! 370 |     if (!d) return;
! 371 |     const meta = d.supplementaryData ? JSON.parse(d.supplementaryData) : {};
  372 |     if (meta.paymentAttempted) return;
  373 |     meta.paymentAttempted = true;
  374 |     this.store.updateDraft(id, { supplementaryData: JSON.stringify(meta) });
```
