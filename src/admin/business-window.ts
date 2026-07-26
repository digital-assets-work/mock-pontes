import {
  createRouter,
  defineEventHandler,
  readBody,
} from "h3";
import type { MockStore } from "../state/mock-store.js";

export function createAdminBusinessWindowRouter(store: MockStore) {
  const router = createRouter();

  // GET /admin/business-window — Get business window config
  router.get(
    "/admin/business-window",
    defineEventHandler(() => {
      return store.getBusinessWindow();
    }),
  );

  // PUT /admin/business-window — Update business window config
  router.put(
    "/admin/business-window",
    defineEventHandler(async (event) => {
      const body = await readBody(event);
      store.setBusinessWindow(body);
      return store.getBusinessWindow();
    }),
  );

  return router;
}
