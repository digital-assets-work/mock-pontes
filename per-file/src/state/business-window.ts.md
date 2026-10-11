# src/state/business-window.ts

| Metric | Coverage | |
| --- | --- | --- |
| Statements | 98.78% (81/82) | `██████████` |
| Branches | 82.50% (33/40) | `████████░░` |
| Functions | 100.00% (11/11) | `██████████` |
| Lines | 98.70% (76/77) | `██████████` |

**Uncovered lines:** 205

**Partial branches:** L118 (default-arg), L125 (binary-expr), L126 (binary-expr), L128 (cond-expr), L149 (default-arg), L185 (default-arg), L204 (if)

_Legend: `-` uncovered statement · `!` branch with an untaken path · `⋮` covered lines skipped · gutter: line number._

```diff
  115 | }
  116 | 
  117 | /** Current Frankfurt-local wall-clock time as a zero-padded `HH:mm` string. */
! 118 | export function frankfurtTimeHHmm(now: Date = new Date()): string {
  119 |   const parts = new Intl.DateTimeFormat("en-GB", {
  120 |     timeZone: FRANKFURT_TZ,
  121 |     hour: "2-digit",
  122 |     minute: "2-digit",
  123 |     hour12: false,
  124 |   }).formatToParts(now);
! 125 |   const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
! 126 |   const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  127 |   // Some ICU builds render midnight as "24"; normalise to "00".
! 128 |   return `${hh === "24" ? "00" : hh}:${mm}`;
  129 | }
  130 | 
  131 | export interface CurrentWindow {
  ⋮
  146 |  * half-open: a window runs `[start, end)`. Outside `[sodStart, eodEnd)` the day
  147 |  * is Closed (its bounds wrap: `eodEnd → sodStart`).
  148 |  */
! 149 | export function currentWindow(day: BusinessDay, now: Date = new Date()): CurrentWindow {
  150 |   const t = frankfurtTimeHHmm(now);
  151 |   let name: BusinessWindowName;
  152 |   let startTime: string;
  ⋮
  182 | }
  183 | 
  184 | /** Is the market open (any window other than Closed) at `now`? */
! 185 | export function isBusinessOpen(day: BusinessDay, now: Date = new Date()): boolean {
  186 |   return currentWindow(day, now).name !== "CLOSED";
  187 | }
  188 | 
  ⋮
  201 |   body: unknown,
  202 |   current: BusinessDay,
  203 | ): BusinessDayUpdateResult {
! 204 |   if (typeof body !== "object" || body === null || Array.isArray(body)) {
- 205 |     return { error: "Request body must be a JSON object." };
  206 |   }
  207 |   const input = body as Record<string, unknown>;
  208 |   const keys = Object.keys(input);
```
