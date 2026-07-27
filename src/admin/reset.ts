import { createRouter, defineEventHandler } from "h3";
import type { MockStore } from "../state/mock-store.js";
import { enforceAdminToken, adminUnauthorizedBody } from "../auth/admin-token.js";

export function createAdminResetRouter(store: MockStore) {
  const router = createRouter();

  // POST /admin/reset — Reset mock state (admin-token gated, #35)
  router.post(
    "/admin/reset",
    defineEventHandler((event) => {
      if (!enforceAdminToken(event)) return adminUnauthorizedBody();
      store.reset();
      return { ok: true, message: "Mock state has been reset" };
    }),
  );

  return router;
}
