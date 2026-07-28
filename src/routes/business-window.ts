import { createRouter, defineEventHandler } from "h3";
import { track } from "../http/route-registry.js";
import type { MockStore } from "../state/mock-store.js";
import {
  effectiveWindowName,
  nextEffectiveWindowName,
} from "../state/business-window.js";

export function createBusinessWindowRouter(store: MockStore) {
  const router = track(createRouter());

  // GET /dlt/:ncb/api/bridge/current-business-window
  // Response schema: globalregistry.GetCurrentBusinessWindowBridge { windowName, startTime, endTime }
  // windowName is derived from the stored open/close times in Frankfurt time
  // ("Open for All" when inside the window, else "Closed") — issue #59.
  router.get(
    "/dlt/:ncb/api/bridge/current-business-window",
    defineEventHandler(() => {
      const bw = store.getBusinessWindow();
      return {
        windowName: effectiveWindowName(bw),
        startTime: bw.openTime,
        endTime: bw.closeTime,
      };
    }),
  );

  // GET /dlt/:ncb/api/octopus/grs/current-business-window
  // Response schema: globalregistry.GetCurrentBusinessWindow { windowName, startTime, endTime, nextWindowName }
  router.get(
    "/dlt/:ncb/api/octopus/grs/current-business-window",
    defineEventHandler(() => {
      const bw = store.getBusinessWindow();
      return {
        windowName: effectiveWindowName(bw),
        startTime: bw.openTime,
        endTime: bw.closeTime,
        nextWindowName: nextEffectiveWindowName(bw),
      };
    }),
  );

  // GET /dlt/:ncb/api/octopus/grs/businessdate
  // Response schema: globalregistry.BusinessDate { businessDate, updateBDStatus }
  router.get(
    "/dlt/:ncb/api/octopus/grs/businessdate",
    defineEventHandler(() => {
      const bw = store.getBusinessWindow();
      return {
        businessDate: bw.businessDate,
        updateBDStatus: "UPDATE_NOT_ALLOWED",
      };
    }),
  );

  return router;
}
