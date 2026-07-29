import {
  createRouter,
  defineEventHandler,
  readBody,
  setResponseStatus,
} from "h3";
import type { MockStore } from "../state/mock-store.js";
import { enforceAdminToken, adminUnauthorizedBody } from "../auth/admin-token.js";
import {
  validateBusinessDayUpdate,
  currentWindow,
  windowDisplayName,
} from "../state/business-window.js";

/** Build the GET view: the stored day fields + the live, computed window. */
function businessWindowView(store: MockStore) {
  const day = store.getBusinessDay();
  const cw = currentWindow(day);
  return {
    ...day,
    // Live, derived-from-Frankfurt-time view (issue #81) — the panel and the
    // official API therefore always agree.
    currentWindow: cw.name,
    windowName: cw.displayName,
    windowStartTime: cw.startTime,
    windowEndTime: cw.endTime,
    nextWindowName: windowDisplayName(cw.nextName),
    isOpen: cw.name !== "CLOSED",
  };
}

export function createAdminBusinessWindowRouter(store: MockStore) {
  const router = createRouter();

  // GET /admin/business-window — Get business day + current window (unauthenticated, #35).
  router.get(
    "/admin/business-window",
    defineEventHandler(() => businessWindowView(store)),
  );

  // POST/PUT /admin/business-window — Update the business day (admin-token gated, #35).
  // Accepts a sub-list of the day fields (businessDate, sodStart, ofaStart,
  // ofaEnd, eodEnd); rejects unknown fields and requires the times to stay in
  // increasing order (issue #81).
  const update = defineEventHandler(async (event) => {
    if (!enforceAdminToken(event)) return adminUnauthorizedBody();
    const body = await readBody(event);
    const { update, error } = validateBusinessDayUpdate(body, store.getBusinessDay());
    if (error || !update) {
      setResponseStatus(event, 400);
      return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: error }] };
    }
    store.setBusinessDay(update);
    return businessWindowView(store);
  });
  router.post("/admin/business-window", update);
  router.put("/admin/business-window", update);

  return router;
}
