/**
 * Spec-driven business-window rules (issue #81).
 *
 * Every official operation documents, in its description's **"Business Window:"**
 * section, the windows during which it is accessible (e.g. bridge payments are
 * "Open for all" only; transfer creation is "Start of day" only; most reads are
 * "Start of day / Open for all / End of day"). We parse those lists straight
 * from the vendored official spec so enforcement stays faithful to the spec
 * without a hand-maintained table.
 */

import officialSpec from "../ui/spec/pontes-official-v1.0.json";
import type { BusinessWindowName } from "../state/mock-store.js";
import { segmentsMatch } from "./not-implemented.js";

const METHODS = ["get", "post", "put", "delete", "patch"] as const;

const TEXT_TO_CODE: Record<string, BusinessWindowName> = {
  "start of day": "START_OF_DAY",
  "open for all": "OPEN_FOR_ALL",
  "end of day": "END_OF_DAY",
  closed: "CLOSED",
};

interface WindowRule {
  method: string;
  /** Path template split into segments, e.g. ["", "dlt", "{ncb}", ...]. */
  segs: string[];
  /** Windows during which the operation is accessible. */
  windows: Set<BusinessWindowName>;
}

/** Parse the "Business Window:" list out of an operation description. */
export function parseWindowList(description: string): Set<BusinessWindowName> | undefined {
  const m = description.match(
    /Business Window:?\s*((?:\s*[-*]?\s*(?:Start of day|Open for all|End of day|Closed)\s*)+)/i,
  );
  if (!m) return undefined;
  const set = new Set<BusinessWindowName>();
  for (const w of m[1].matchAll(/(Start of day|Open for all|End of day|Closed)/gi)) {
    set.add(TEXT_TO_CODE[w[1].toLowerCase()]);
  }
  return set.size ? set : undefined;
}

function buildRules(): WindowRule[] {
  const rules: WindowRule[] = [];
  const paths = (officialSpec as { paths?: Record<string, Record<string, unknown>> }).paths || {};
  for (const [template, item] of Object.entries(paths)) {
    for (const m of METHODS) {
      const op = item[m] as { description?: string; summary?: string } | undefined;
      if (!op) continue;
      const windows = parseWindowList(`${op.description || ""}\n${op.summary || ""}`);
      if (!windows) continue;
      rules.push({ method: m.toUpperCase(), segs: template.split("/"), windows });
    }
  }
  return rules;
}

const RULES = buildRules();

/**
 * The set of windows during which the given official request is accessible, or
 * `undefined` when the operation carries no window rule (e.g. health) — such
 * requests are never gated.
 */
export function allowedWindowsForRequest(
  method: string,
  path: string,
): Set<BusinessWindowName> | undefined {
  const reqSegs = (path.split("?")[0] || "").split("/");
  const m = method.toUpperCase();
  const rule = RULES.find((r) => r.method === m && segmentsMatch(reqSegs, r.segs));
  return rule?.windows;
}
