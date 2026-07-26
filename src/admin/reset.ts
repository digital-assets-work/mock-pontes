import { createRouter, defineEventHandler } from "h3";
import type { MockStore } from "../state/mock-store.js";

export function createAdminResetRouter(store: MockStore) {
  const router = createRouter();

  // POST /admin/reset — Reset mock state
  router.post(
    "/admin/reset",
    defineEventHandler(() => {
      store.reset();
      return { ok: true, message: "Mock state has been reset" };
    }),
  );

  return router;
}
