/**
 * Draft id resolution (issue #32, revised for a HAR-capture delta against the official spec).
 *
 * The real Pontes backend does not let the caller set its own instruction id:
 * a client-supplied id is only ever used to detect a duplicate submission — a
 * non-duplicate value is acknowledged (checked for conflicts) but otherwise
 * ignored, and a fresh, well-formatted id is always minted server-side. A
 * duplicate client id is rejected with `409 HL-GER-004`.
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
    // Not a duplicate — the provided value is ignored; Pontes always mints its
    // own id rather than accepting a caller-chosen one.
  }
  return store.nextId(prefix);
}
