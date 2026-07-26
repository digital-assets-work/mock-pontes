import { createRouter, defineEventHandler } from "h3";
import type { MockStore, BusinessWindow } from "../state/mock-store.js";

/** Map internal window state name to a human-readable window name per Pontes spec */
function windowName(bw: BusinessWindow): string {
  switch (bw.currentWindow) {
    case "OPEN_FOR_ALL": return "Open for All";
    case "START_OF_DAY": return "Start of Day";
    case "END_OF_DAY": return "End of Day";
    case "CLOSED": return "Closed";
    default: return bw.currentWindow;
  }
}

/** Determine the next window name in the cycle */
function nextWindowName(bw: BusinessWindow): string {
  switch (bw.currentWindow) {
    case "CLOSED": return "Start of Day";
    case "START_OF_DAY": return "Open for All";
    case "OPEN_FOR_ALL": return "End of Day";
    case "END_OF_DAY": return "Closed";
    default: return "Closed";
  }
}

export function createBusinessWindowRouter(store: MockStore) {
  const router = createRouter();

  // GET /dlt/:ncb/api/bridge/current-business-window
  // Response schema: globalregistry.GetCurrentBusinessWindowBridge { windowName, startTime, endTime }
  router.get(
    "/dlt/:ncb/api/bridge/current-business-window",
    defineEventHandler(() => {
      const bw = store.getBusinessWindow();
      return {
        windowName: windowName(bw),
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
        windowName: windowName(bw),
        startTime: bw.openTime,
        endTime: bw.closeTime,
        nextWindowName: nextWindowName(bw),
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
