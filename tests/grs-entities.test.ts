/**
 * GRS Market Participant Entity — read-only static fixture.
 *
 * Only the two GET endpoints are in scope (per the issue's scope-narrowing
 * comment); the fixture (`src/data/grs-entities.json`, 113 HAR-captured
 * records) is served as-is, no derived/mutable state.
 */

import { describe, it, expect } from "@jest/globals";
import { listGrsEntities, getGrsEntity } from "../src/state/grs-entities.js";

describe("listGrsEntities", () => {
  it("returns the full fixture as a bare array", () => {
    const entities = listGrsEntities();
    expect(Array.isArray(entities)).toBe(true);
    expect(entities.length).toBe(113);
  });

  it("includes both settled (NORMAL/ACCEPTED) and in-flight draft entities", () => {
    const entities = listGrsEntities();
    expect(entities.some((e) => e.fourEyesType === "NORMAL" && e.status === "ACCEPTED")).toBe(true);
    expect(entities.some((e) => e.fourEyesType === "DRAFT")).toBe(true);
  });

  it("returns the same reference contents on repeated calls (static data)", () => {
    expect(listGrsEntities()).toEqual(listGrsEntities());
  });
});

describe("getGrsEntity", () => {
  it("finds a settled entity by its BIC (entityID)", () => {
    const entity = getGrsEntity("ABNANL2AXXX");
    expect(entity).toBeDefined();
    expect(entity?.name).toBe("ABN AMRO BANK N.V.");
    expect(entity?.fourEyesType).toBe("NORMAL");
  });

  it("finds a creation draft by its draft id (ENTITY_DRAFT_<uuid>)", () => {
    const draft = listGrsEntities().find((e) => e.fourEyesType === "DRAFT" && e.id.startsWith("ENTITY_DRAFT_"));
    expect(draft).toBeDefined();
    const found = getGrsEntity(draft!.id);
    expect(found).toBe(draft);
  });

  it("finds a creation draft (id === entityID) by its BIC too", () => {
    // A subset of drafts are brand-new entities not yet settled: their `id`
    // equals their `entityID` (no separate settled row exists for that BIC
    // yet), unlike amendment drafts which coexist with an already-ACCEPTED row.
    const draft = listGrsEntities().find((e) => e.fourEyesType === "DRAFT" && e.id === e.entityID);
    expect(draft).toBeDefined();
    const found = getGrsEntity(draft!.entityID);
    expect(found).toBe(draft);
  });

  it("prefers the settled entity over its pending amendment draft when both share a BIC", () => {
    // Some BICs have both an ACCEPTED row and a separate in-flight amendment
    // draft (distinct `id`, same `entityID`). Looking the entity up by BIC
    // must resolve to the current settled record, not the pending draft.
    const entities = listGrsEntities();
    const bic = entities.find(
      (e) => e.fourEyesType === "NORMAL" && entities.some((d) => d.fourEyesType === "DRAFT" && d.entityID === e.entityID),
    )!.entityID;
    const found = getGrsEntity(bic);
    expect(found?.fourEyesType).toBe("NORMAL");
    expect(found?.status).toBe("ACCEPTED");
  });

  it("returns undefined for an unknown identifier", () => {
    expect(getGrsEntity("NOSUCHBICXXX")).toBeUndefined();
  });
});
