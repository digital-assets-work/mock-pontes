# src/workflows/workflow.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 84.21% (96/114) | `████████░░` |
| Branches | 71.93% (41/57) | `███████░░░` |
| Functions | 91.67% (22/24) | `█████████░` |
| Lines | 85.32% (93/109) | `█████████░` |

**Uncovered lines:** 390-392, 394-395, 397, 399, 419-422, 424-426, 437, 446, 451, 456

**Partial branches:** L234 (default-arg), L373 (if), L435 (cond-expr), L436 (if), L440 (binary-expr), L445 (if), L448 (if), L455 (if)

**Never called:** `(anonymous_19)` (L390), `(anonymous_21)` (L419)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
  231 |   }
  232 | 
  233 |   /** One-step settlement: apply the effect and record a transaction, no draft persisted. */
! 234 |   execute(init: WorkflowInit, actor: WorkflowActor = {}): Draft {
  235 |     const record = this.buildRecord(init, "SETTLED");
  236 |     this.conditions("create", record, actor.caller);
  237 |     this.assertDebitWalletExists(record);
  ⋮
  370 |    */
  371 |   protected rawCredit(alias: string, amount: string): void {
  372 |     const w = this.store.getWallet(alias);
! 373 |     if (!w) throw new WorkflowRejection(422, "HL-WAL-003", unknownWalletMessage("Credit", alias));
  374 |     let a: number;
  375 |     try {
  376 |       a = parseAmount(amount);
  ⋮
  387 |    * Unchecked debit that preserves current mock behaviour (may drive the balance
  388 |    * negative; no-op if the wallet is missing).
  389 |    */
- 390 |   protected rawDebit(alias: string, amount: string): void {
- 391 |     const w = this.store.getWallet(alias);
- 392 |     if (!w) return;
  393 |     let a: number;
- 394 |     try {
- 395 |       a = parseAmount(amount);
  396 |     } catch (e) {
- 397 |       throw this.mapDcwError(e, alias);
  398 |     }
- 399 |     this.store.upsertWallet({
  400 |       ...w,
  401 |       balance: (parseFloat(w.balance) - a).toFixed(2),
  402 |     });
  ⋮
  416 |   }
  417 | 
  418 |   /** Assert the source can be debited now (rights + availability) without mutating. */
- 419 |   protected assertCanDebit(alias: string, amount: string, caller?: DcwCaller): void {
- 420 |     const permitted = this.store.canDebit(alias, caller);
- 421 |     if (!permitted.ok) {
- 422 |       throw this.rejectionFor(permitted.reason ?? "NOT_AUTHORISED_TO_DEBIT", alias);
  423 |     }
- 424 |     const w = this.store.getWallet(alias)!;
- 425 |     if (parseFloat(w.balance) < parseFloat(amount)) {
- 426 |       throw new WorkflowRejection(
  427 |         422,
  428 |         "HL-BAL-001",
  429 |         `Insufficient available balance on ${alias}`,
  ⋮
  432 |   }
  433 | 
  434 |   private mapDcwError(e: unknown, alias: string): WorkflowRejection {
! 435 |     const msg = e instanceof Error ? e.message : String(e);
! 436 |     if (msg.startsWith("WALLET_NOT_FOUND")) {
- 437 |       return new WorkflowRejection(404, "HL-WAL-001", `Wallet ${alias} not found`);
  438 |     }
  439 |     if (msg.startsWith("DCW_DEBIT_DENIED")) {
! 440 |       return this.rejectionFor(msg.split(":")[1] || "NOT_AUTHORISED_TO_DEBIT", alias);
  441 |     }
  442 |     if (msg === "DCW_INSUFFICIENT_AVAILABLE") {
  443 |       return new WorkflowRejection(422, "HL-BAL-001", `Insufficient available balance on ${alias}`);
  444 |     }
! 445 |     if (msg === "DCW_NEGATIVE_AMOUNT") {
- 446 |       return new WorkflowRejection(400, "HL-VAL-002", "Amount must not be negative");
  447 |     }
! 448 |     if (msg.startsWith("DCW_INVALID_AMOUNT")) {
  449 |       return new WorkflowRejection(400, "HL-VAL-003", "Amount is not a valid number");
  450 |     }
- 451 |     return new WorkflowRejection(422, "HL-GER-000", msg);
  452 |   }
  453 | 
  454 |   protected rejectionFor(reason: string, alias: string): WorkflowRejection {
! 455 |     if (reason === "WALLET_NOT_FOUND") {
- 456 |       return new WorkflowRejection(404, "HL-WAL-001", `Wallet ${alias} not found`);
  457 |     }
  458 |     return new WorkflowRejection(403, "HL-AUT-001", `Debit of ${alias} not authorised (${reason})`);
  459 |   }
```
