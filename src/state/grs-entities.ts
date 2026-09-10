/**
 * Market Participant Entity — read-only static fixture.
 *
 * Per the issue's scope-narrowing comment, only the two GET endpoints are
 * implemented, backed **as-is** by a static HAR-captured dataset
 * (`src/data/grs-entities.json`, 113 records) rather than any derived/mutable
 * state. The remaining editing endpoints (create draft, patch, draft
 * status-transition) are intentionally out of scope here and tracked in a
 * follow-up issue.
 *
 * The dataset already mixes settled entities (`fourEyesType: "NORMAL"`,
 * `status: "ACCEPTED"`) and in-flight drafts (`fourEyesType: "DRAFT"`,
 * `status` one of `PENDING_REVIEW` / `PENDING_APPROVAL` / `CANCELLED`), so it
 * is served verbatim — no additional filtering is applied.
 */

import grsEntitiesFixture from "../data/grs-entities.json";

export interface GrsEntityTimestamp {
  calendarDate: string;
  businessDate: string;
}

export interface GrsEntity {
  id: string;
  fourEyesType: string;
  status: string;
  historicStatus: string[];
  timestamps: Record<string, GrsEntityTimestamp>;
  initiatorUserUUID: string;
  initiatorUserName: string;
  approverUserUUID: string;
  approverUserName: string;
  validFrom: string;
  validTo: string;
  entityID: string;
  entityIDType: string;
  name: string;
  shortName: string;
  mspID: string;
  domain: string;
  networkDomain: string;
  networkEndpoints: string[];
  rolesTable: string[];
  countryCode: string;
  isPrivate: boolean;
  isBlocked: boolean;
  managerID: string;
  instructingPartyID: string;
  lastUpdated: number;
}

const ENTITIES = grsEntitiesFixture as unknown as GrsEntity[];

/** The full fixture, as a bare array (`globalregistry.Entity[]`). */
export function listGrsEntities(): GrsEntity[] {
  return ENTITIES;
}

/**
 * Look up one entity by its participant identifier. The spec's `entityid`
 * path parameter is described as "Participant BIC", but the same GET is also
 * used to fetch an in-flight draft — so this matches either the settled
 * `entityID` (BIC) or the draft-only `id` (`ENTITY_DRAFT_<uuid>`).
 */
export function getGrsEntity(entityid: string): GrsEntity | undefined {
  // `id` first: for settled entities and brand-new creation drafts `id` equals
  // `entityID`, so a BIC lookup already resolves correctly here without ever
  // needing the `entityID` fallback below. The fallback only kicks in for a
  // BIC that has *no* row with `id === entityID` — not expected in practice,
  // but kept for robustness against fixture shapes that omit it.
  return ENTITIES.find((e) => e.id === entityid) ?? ENTITIES.find((e) => e.entityID === entityid);
}
