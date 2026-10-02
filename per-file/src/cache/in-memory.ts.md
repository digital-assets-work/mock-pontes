# src/cache/in-memory.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 40.63% (13/32) | `████░░░░░░` |
| Branches | 50.00% (5/10) | `█████░░░░░` |
| Functions | 40.00% (4/10) | `████░░░░░░` |
| Lines | 41.94% (13/31) | `████░░░░░░` |

**Uncovered lines:** 10-12, 14-16, 18-20, 27-28, 30-33, 45, 49-54, 56

**Partial branches:** L26 (if)

**Never called:** `(anonymous_1)` (L10), `(anonymous_2)` (L14), `(anonymous_3)` (L18), `(anonymous_5)` (L30), `(anonymous_8)` (L45), `(anonymous_9)` (L49)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   7 |     this.mem = {};
   8 |     this.timers = {};
   9 |   }
- 10 |   async inc(key: string): Promise<number> {
- 11 |     this.mem[key] = this.mem[key] + 1;
- 12 |     return this.mem[key];
  13 |   }
- 14 |   async dec(key: string): Promise<number> {
- 15 |     this.mem[key] = this.mem[key] - 1;
- 16 |     return this.mem[key];
  17 |   }
- 18 |   async reset(key: string): Promise<number> {
- 19 |     this.mem[key] = 0;
- 20 |     return this.mem[key];
  21 |   }
  22 |   put(opaque: string, value: any, durationSec: number): Promise<boolean> {
  23 |     this.mem[opaque] = value;
  24 |     this.mem["X-" + opaque] = { durationSec, accessCount: 0 };
  25 | 
! 26 |     if (Number.isFinite(durationSec) && durationSec > 0) {
- 27 |       if (this.timers[opaque]) {
- 28 |         clearTimeout(this.timers[opaque]);
  29 |       }
- 30 |       this.timers[opaque] = setTimeout(() => {
- 31 |         delete this.mem[opaque];
- 32 |         delete this.mem["X-" + opaque];
- 33 |         delete this.timers[opaque];
  34 |       }, durationSec * 1000);
  35 |     }
  36 |     return Promise.resolve(true);
  ⋮
  42 |     return Promise.resolve(this.mem[opaque]);
  43 |   }
  44 |   close(): void {
- 45 |     Object.values(this.timers).forEach((timer) => clearTimeout(timer));
  46 |     this.timers = {};
  47 |     this.mem = {};
  48 |   }
- 49 |   del(key: string): Promise<boolean> {
- 50 |     delete this.mem[key];
- 51 |     delete this.mem["X-" + key];
- 52 |     if (this.timers[key]) {
- 53 |       clearTimeout(this.timers[key]);
- 54 |       delete this.timers[key];
  55 |     }
- 56 |     return Promise.resolve(true);
  57 |   }
  58 | }
  59 | 
```
