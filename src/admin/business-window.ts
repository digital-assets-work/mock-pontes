import {
  createRouter,
  defineEventHandler,
  readBody,
} from "h3";
import type { MockStore } from "../state/mock-store.js";
import { enforceAdminToken, adminUnauthorizedBody } from "../auth/admin-token.js";

export function createAdminBusinessWindowRouter(store: MockStore) {
  const router = createRouter();

  // GET /admin/business-window — Get business window config (unauthenticated, #35)
  router.get(
    "/admin/business-window",
    defineEventHandler(() => {
      return store.getBusinessWindow();
    }),
  );

  // PUT /admin/business-window — Update business window config (admin-token gated, #35)
  router.put(
    "/admin/business-window",
    defineEventHandler(async (event) => {
      if (!enforceAdminToken(event)) return adminUnauthorizedBody();
      const body = await readBody(event);
      store.setBusinessWindow(body);
      return store.getBusinessWindow();
    }),
  );

  return router;
}
