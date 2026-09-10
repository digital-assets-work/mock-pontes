import { createRouter, defineEventHandler, getRouterParam, createError } from "h3";
import { track } from "../http/route-registry.js";
import { listGrsEntities, getGrsEntity } from "../state/grs-entities.js";

/**
 * GRS Market Participant Entity — read-only routes.
 *
 * Static-fixture backed (see `src/state/grs-entities.ts`); no MockStore
 * dependency, since these two GETs serve the attached dataset as-is. The
 * create/patch/draft-transition endpoints are out of scope (follow-up issue).
 */
export function createGrsEntitiesRouter() {
  const router = track(createRouter());

  // GET /dlt/:ncb/api/octopus/grs/entities — bare array (globalregistry.Entity[])
  router.get(
    "/dlt/:ncb/api/octopus/grs/entities",
    defineEventHandler(() => listGrsEntities()),
  );

  // GET /dlt/:ncb/api/octopus/grs/entities/:entityid — by BIC (or draft id)
  router.get(
    "/dlt/:ncb/api/octopus/grs/entities/:entityid",
    defineEventHandler((event) => {
      const entityid = getRouterParam(event, "entityid")!;
      const entity = getGrsEntity(entityid);
      if (!entity) {
        throw createError({
          statusCode: 404,
          data: { businessErrors: [{ errorDescription: `Entity ${entityid} not found` }] },
        });
      }
      return entity;
    }),
  );

  return router;
}
