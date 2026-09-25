# src/state/memory-store.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 92.65% (126/136) | `█████████░` |
| Branches | 85.96% (49/57) | `█████████░` |
| Functions | 92.68% (38/41) | `█████████░` |
| Lines | 93.28% (111/119) | `█████████░` |

**Uncovered lines:** 91, 115-116, 178-181, 184-187

**Partial branches:** L76 (if), L78 (if), L90 (if), L163 (default-arg), L190 (default-arg), L192 (if), L231 (cond-expr), L258 (if)

**Never called:** `(anonymous_13)` (L115), `(anonymous_23)` (L178), `(anonymous_24)` (L184)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   73 | 
   74 |   /** Load persisted state (call once at startup). */
   75 |   async hydrate(): Promise<void> {
!  76 |     if (!this.cache) return;
   77 |     const wallets = await this.cache.get<Wallet[]>(WALLETS_KEY);
!  78 |     if (Array.isArray(wallets)) {
   79 |       this.wallets = new Map(wallets.map((w) => [w.alias, w]));
   80 |     }
   81 |     const drafts = await this.cache.get<Draft[]>(DRAFTS_KEY);
  ⋮
   87 |       this.transactions = transactions;
   88 |     }
   89 |     const sequences = await this.cache.get<[string, number][]>(SEQUENCES_KEY);
!  90 |     if (Array.isArray(sequences)) {
-  91 |       this.sequences = new Map(sequences);
   92 |     }
   93 |   }
   94 | 
  ⋮
  112 |   }
  113 | 
  114 |   private persistSequences(): void {
- 115 |     this.persist(() =>
- 116 |       this.cache!.put(SEQUENCES_KEY, [...this.sequences.entries()], PERSIST_TTL_SEC),
  117 |     );
  118 |   }
  119 | 
  ⋮
  160 |     return next;
  161 |   }
  162 | 
! 163 |   debit(alias: string, amount: string, caller: DcwCaller = {}): Wallet {
  164 |     const wallet = this.requireWallet(alias);
  165 |     const permitted = canDebitDcw(wallet, caller);
  166 |     if (!permitted.ok) throw new Error(`DCW_DEBIT_DENIED:${permitted.reason}`);
  ⋮
  175 |     return next;
  176 |   }
  177 | 
- 178 |   release(alias: string, amount: string): Wallet {
- 179 |     const next = withRelease(this.requireWallet(alias), amount);
- 180 |     this.upsertWallet(next);
- 181 |     return next;
  182 |   }
  183 | 
- 184 |   settleLocked(alias: string, amount: string): Wallet {
- 185 |     const next = withSettleLocked(this.requireWallet(alias), amount);
- 186 |     this.upsertWallet(next);
- 187 |     return next;
  188 |   }
  189 | 
! 190 |   canDebit(alias: string, caller: DcwCaller = {}): CanDebitResult {
  191 |     const wallet = this.wallets.get(alias);
! 192 |     if (!wallet) return { ok: false, reason: "WALLET_NOT_FOUND" };
  193 |     return canDebitDcw(wallet, caller);
  194 |   }
  195 | 
  ⋮
  228 |    */
  229 |   private canReadDraft(draft: Draft, caller: DcwCaller): boolean {
  230 |     for (const alias of [draft.creditedWalletAlias, draft.debitedWalletAlias]) {
! 231 |       const wallet = alias ? this.wallets.get(alias) : undefined;
  232 |       if (wallet && canReadDcw(wallet, caller).ok) return true;
  233 |     }
  234 |     return false;
  ⋮
  255 | 
  256 |   updateDraft(id: string, update: Partial<Draft>): void {
  257 |     const existing = this.drafts.get(id);
! 258 |     if (existing) {
  259 |       this.drafts.set(id, { ...existing, ...update, updatedAt: new Date().toISOString() });
  260 |       this.persistDrafts();
  261 |     }
```
