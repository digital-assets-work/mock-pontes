# src/cache/redis.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 68.85% (42/61) | `███████░░░` |
| Branches | 53.85% (14/26) | `█████░░░░░` |
| Functions | 43.48% (10/23) | `████░░░░░░` |
| Lines | 74.55% (41/55) | `███████░░░` |

**Uncovered lines:** 48-49, 55-56, 75-76, 116-117, 120-121, 124-127, 133, 155, 159-160, 163-165, 167

**Partial branches:** L70 (if), L71 (if), L109 (binary-expr), L132 (if), L152 (if)

**Never called:** `(anonymous_1)` (L48), `(anonymous_2)` (L55), `(anonymous_6)` (L75), `(anonymous_9)` (L116), `(anonymous_10)` (L117), `(anonymous_11)` (L120), `(anonymous_12)` (L121), `(anonymous_13)` (L124), `(anonymous_14)` (L125), `(anonymous_19)` (L159), `(anonymous_20)` (L160), `(anonymous_21)` (L163), `(anonymous_22)` (L167)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
   45 |     this.prefix = prefix;
   46 |     this.clientFactory =
   47 |       clientFactory ??
-  48 |       (() =>
-  49 |         createClient({
   50 |           url: this.url,
   51 |           socket: {
   52 |             // Bounded reconnection for transient blips; give up after a few
   53 |             // quick attempts so a genuinely-down Redis surfaces as an error
   54 |             // (and is then handled as fatal) rather than retrying forever.
-  55 |             reconnectStrategy: (retries) =>
-  56 |               retries > 5 ? false : Math.min(retries * 100, 1000),
   57 |           },
   58 |         }) as unknown as RedisClientLike);
   59 |   }
  ⋮
   67 |    * repeatedly; concurrent callers share the same in-flight attempt.
   68 |    */
   69 |   async connect(): Promise<void> {
!  70 |     if (this.client?.isReady) return;
!  71 |     if (this.connecting) return this.connecting;
   72 |     this.connecting = (async () => {
   73 |       const client = this.clientFactory();
   74 |       // Never let an 'error' event become an unhandled exception.
-  75 |       client.on("error", (err: unknown) =>
-  76 |         console.error("[mock-pontes] Redis client error:", (err as Error)?.message ?? err),
   77 |       );
   78 |       await client.connect();
   79 |       this.client = client;
  ⋮
  106 |       return await op(this.client!);
  107 |     } catch (err) {
  108 |       console.warn(
! 109 |         `[mock-pontes] Redis operation failed; reconnecting and retrying once: ${(err as Error)?.message ?? err}`,
  110 |       );
  111 |       await this.reconnect();
  112 |       return op(this.client!);
  113 |     }
  114 |   }
  115 | 
- 116 |   async inc(key: string): Promise<number> {
- 117 |     return this.withRetry((c) => c.INCR(this.pre(key)));
  118 |   }
  119 | 
- 120 |   async dec(key: string): Promise<number> {
- 121 |     return this.withRetry((c) => c.DECR(this.pre(key)));
  122 |   }
  123 | 
- 124 |   async reset(key: string): Promise<number> {
- 125 |     return this.withRetry(async (c) => {
- 126 |       await c.SET(this.pre(key), 0);
- 127 |       return 0;
  128 |     });
  129 |   }
  130 | 
  131 |   async put(key: string, value: any, durationSec: number): Promise<boolean> {
! 132 |     if (!value) {
- 133 |       return this.del(key);
  134 |     }
  135 |     return this.withRetry(async (c) => {
  136 |       const k = this.pre(key);
  ⋮
  149 |   async get(key: string): Promise<any> {
  150 |     return this.withRetry(async (c) => {
  151 |       const response = await c.get(this.pre(key));
! 152 |       if (response && typeof response === "string") {
  153 |         return JSON.parse(response);
  154 |       }
- 155 |       return response ?? undefined;
  156 |     });
  157 |   }
  158 | 
- 159 |   async del(key: string): Promise<boolean> {
- 160 |     return this.withRetry(async (c) => (await c.del(this.pre(key))) !== 0);
  161 |   }
  162 | 
- 163 |   close(): void {
- 164 |     const client = this.client;
- 165 |     this.client = null;
  166 |     // Best-effort; not awaited so the interface stays synchronous.
- 167 |     void client?.quit().catch(() => {
  168 |       /* already closing */
  169 |     });
  170 |   }
```
