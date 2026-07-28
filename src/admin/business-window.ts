import {
  createRouter,
  defineEventHandler,
  readBody,
  setResponseStatus,
} from "h3";
import type { MockStore } from "../state/mock-store.js";
import { enforceAdminToken, adminUnauthorizedBody } from "../auth/admin-token.js";
import { validateBusinessWindowUpdate } from "../state/business-window.js";

export function createAdminBusinessWindowRouter(store: MockStore) {
  const router = createRouter();

  // GET /admin/business-window — Get business window config (unauthenticated, #35)
  router.get(
    "/admin/business-window",
    defineEventHandler(() => {
      return store.getBusinessWindow();
    }),
  );

  // PUT /admin/business-window — Update business window config (admin-token gated, #35).
  // Accepts a sub-list of the GET fields; rejects unknown fields and requires
  // closeTime > openTime (issue #59).
  router.put(
    "/admin/business-window",
    defineEventHandler(async (event) => {
      if (!enforceAdminToken(event)) return adminUnauthorizedBody();
      const body = await readBody(event);
      const { update, error } = validateBusinessWindowUpdate(body, store.getBusinessWindow());
      if (error || !update) {
        setResponseStatus(event, 400);
        return { businessErrors: [{ errorCode: "HL-VAL-001", errorDescription: error }] };
      }
      store.setBusinessWindow(update);
      return store.getBusinessWindow();
    }),
  );

  return router;
}
