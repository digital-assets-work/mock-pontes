/**
 * Draft id resolution (issue #32).
 *
 * The official request schemas carry a client-supplied instruction id for some
 * operations (RVS transfer `instructionID`, direct-RTGS `id` — the latter is
 * also part of the NRO-signed payload). Where the client provides one we MUST
 * honour it (reconciliation keys off it); otherwise we mint a deterministic
 * daily-sequence id. A duplicate client id is rejected with `409 HL-GER-004`.
 */

import type { MockStore } from "./mock-store.js";
import { WorkflowRejection } from "../workflows/workflow.js";

export function resolveDraftId(
  store: MockStore,
  prefix: string,
  clientId?: string | null,
): string {
  if (clientId != null && String(clientId).trim() !== "") {
    const id = String(clientId).trim();
    if (store.getDraft(id)) {
      throw new WorkflowRejection(
        409,
        "HL-GER-004",
        `Instruction id '${id}' already exists`,
      );
    }
    return id;
  }
  return store.nextId(prefix);
}
