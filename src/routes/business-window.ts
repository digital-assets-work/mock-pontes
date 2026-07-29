import { createRouter, defineEventHandler } from "h3";
import { track } from "../http/route-registry.js";
import type { MockStore } from "../state/mock-store.js";
import { currentWindow, windowDisplayName } from "../state/business-window.js";

export function createBusinessWindowRouter(store: MockStore) {
  const router = track(createRouter());

  // GET /dlt/:ncb/api/bridge/current-business-window
  // Response schema: globalregistry.GetCurrentBusinessWindowBridge { windowName, startTime, endTime }
  // windowName + bounds are derived from the stored business day in Frankfurt
  // time (issues #59, #81).
  router.get(
    "/dlt/:ncb/api/bridge/current-business-window",
    defineEventHandler(() => {
      const cw = currentWindow(store.getBusinessDay());
      return {
        windowName: cw.displayName,
        startTime: cw.startTime,
        endTime: cw.endTime,
      };
    }),
  );

  // GET /dlt/:ncb/api/octopus/grs/current-business-window
  // Response schema: globalregistry.GetCurrentBusinessWindow { windowName, startTime, endTime, nextWindowName }
  router.get(
    "/dlt/:ncb/api/octopus/grs/current-business-window",
    defineEventHandler(() => {
      const cw = currentWindow(store.getBusinessDay());
      return {
        windowName: cw.displayName,
        startTime: cw.startTime,
        endTime: cw.endTime,
        nextWindowName: windowDisplayName(cw.nextName),
      };
    }),
  );

  // GET /dlt/:ncb/api/octopus/grs/businessdate
  // Response schema: globalregistry.BusinessDate { businessDate, updateBDStatus }
  router.get(
    "/dlt/:ncb/api/octopus/grs/businessdate",
    defineEventHandler(() => {
      return {
        businessDate: store.getBusinessDay().businessDate,
        updateBDStatus: "UPDATE_NOT_ALLOWED",
      };
    }),
  );

  return router;
}
