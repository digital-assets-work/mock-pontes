# src/workflows/xvp.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 87.27% (48/55) | `█████████░` |
| Branches | 77.27% (34/44) | `████████░░` |
| Functions | 83.33% (5/6) | `████████░░` |
| Lines | 92.31% (48/52) | `█████████░` |

**Uncovered lines:** 68-69, 75, 182, 185

**Partial branches:** L74 (binary-expr), L144 (if), L145 (cond-expr), L181 (if), L184 (if), L218 (binary-expr), L245 (if), L246 (cond-expr), L247 (if)

**Never called:** `(anonymous_1)` (L68)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   65 |   protected readonly notFoundLabel = "XvP transaction";
   66 | 
   67 |   // The base `apply()` is unused: XvP settles via execute() below.
-  68 |   protected apply(): void {
-  69 |     throw new WorkflowRejection(500, "HL-XVP-000", "XvP does not use the generic apply()");
   70 |   }
   71 | 
   72 |   /** Register the XvP and issue the hash-lock. No funds are moved. */
   73 |   init(params: XvpInitParams): XvpInitResult {
!  74 |     if (params.transactionType !== "DVP" && params.transactionType !== "PVP") {
-  75 |       throw new WorkflowRejection(400, "HL-XVP-001", `Invalid XvP transactionType '${params.transactionType}'`);
   76 |     }
   77 | 
   78 |     const executionKey = randomBytes(32).toString("hex");
  ⋮
  141 |     paymentAttempted?: boolean;
  142 |   } | undefined {
  143 |     const d = this.store.getDraft(xvpTransactionId);
! 144 |     if (!d || d.type !== "XVP") return undefined;
! 145 |     const meta = d.supplementaryData ? JSON.parse(d.supplementaryData) : {};
  146 |     return {
  147 |       id: d.id,
  148 |       status: d.status,
  ⋮
  178 |     paymentId?: string;
  179 |   } {
  180 |     const rec = this.get(xvpTransactionId);
! 181 |     if (!rec) {
- 182 |       throw new WorkflowRejection(404, "HL-XVP-002", `XvP transaction ${xvpTransactionId} not found`);
  183 |     }
! 184 |     if (rec.status !== "INITIALIZED") {
- 185 |       throw new WorkflowRejection(409, "HL-XVP-003", `XvP ${xvpTransactionId} is already ${rec.status}`);
  186 |     }
  187 |     if (rec.timeout && Date.parse(rec.timeout) < Date.now()) {
  188 |       this.store.updateDraft(rec.id, { status: "EXPIRED" });
  ⋮
  215 |     this.store.addTransaction({
  216 |       // Identify the settled cash movement by its payment id, and link it back
  217 |       // to the originating XvP via supplementaryData (as other payments do).
! 218 |       id: rec.paymentId ?? `TX-${rec.id}`,
  219 |       type: "XVP",
  220 |       status: "SETTLED",
  221 |       amount: rec.amount,
  ⋮
  242 |    */
  243 |   private markPaymentAttempted(id: string): void {
  244 |     const d = this.store.getDraft(id);
! 245 |     if (!d) return;
! 246 |     const meta = d.supplementaryData ? JSON.parse(d.supplementaryData) : {};
! 247 |     if (meta.paymentAttempted) return;
  248 |     meta.paymentAttempted = true;
  249 |     this.store.updateDraft(id, { supplementaryData: JSON.stringify(meta) });
  250 |   }
```
