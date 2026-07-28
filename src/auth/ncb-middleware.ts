/**
 * NCB path-parameter validation (issue #36).
 *
 * The `{ncb}` segment of `/dlt/{ncb}/…` and `/igw/{ncb}/…` is constrained by the
 * official spec to an enum of 23 NCB short names. The mock validates it
 * (case-insensitively — lowercase/uppercase/mixed all accepted) and returns a
 * normalised `404` for an unknown NCB, catching a whole class of participant
 * mis-configuration.
 */

import { defineEventHandler, setResponseStatus, type H3Event } from "h3";
import type { MockStore } from "../state/mock-store.js";

/** The 23 official NCB short names (from the spec's `ncbPathParam` enum). */
export const OFFICIAL_NCBS = [
  "OENB",
  "NBB",
  "BNB",
  "CBC",
  "BBK",
  "EP",
  "BDE",
  "ECB",
  "BOF",
  "BDF",
  "BOG",
  "CNB",
  "CBI",
  "BDI",
  "BOL",
  "BCL",
  "LB",
  "CBM",
  "DNB",
  "BDP",
  "BSI",
  "NBS",
  "SPCB",
] as const;

const NCB_SET = new Set(OFFICIAL_NCBS.map((n) => n.toUpperCase()));

/** Case-insensitive membership check against the official NCB enum. */
export function isValidNcb(ncb: string): boolean {
  return NCB_SET.has(ncb.toUpperCase());
}

/** Case-insensitive membership check against a supplied NCB list. */
export function isNcbInList(ncb: string, validNcbs: readonly string[]): boolean {
  const upper = ncb.toUpperCase();
  return validNcbs.some((n) => n.toUpperCase() === upper);
}

/** Extract the `{ncb}` segment from an `/dlt/{ncb}/…` or `/igw/{ncb}/…` path. */
export function extractNcb(path: string): string | null {
  const m = path.match(/^\/(?:dlt|igw)\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * NCB path-parameter validation middleware. The accepted list is read from the
 * store (issue #57) so it can later become an updatable concept; it is seeded
 * from {@link OFFICIAL_NCBS}. Mounted before the health router so the health
 * route is validated consistently with every other `/dlt`/`/igw` endpoint
 * (issue #48). Non-NCB-scoped paths (`/`, `/check/*`, `/ui`, `/iam`) return
 * `null` from {@link extractNcb} and pass through untouched.
 */
export function createNcbValidationMiddleware(store: MockStore) {
  return defineEventHandler((event: H3Event) => {
    const ncb = extractNcb(event.path || "");
    if (ncb === null) return; // not ncb-scoped
    const validNcbs = store.getValidNcbs();
    if (isNcbInList(ncb, validNcbs)) return;
    setResponseStatus(event, 404);
    return {
      businessErrors: [
        {
          errorCode: "HL-GER-001",
          errorDescription: `Unknown NCB '${ncb}'. Expected one of: ${validNcbs.join(", ")}`,
        },
      ],
    };
  });
}
