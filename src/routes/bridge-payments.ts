import {
  createRouter,
  defineEventHandler,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { randomUUID } from "node:crypto";
import type { MockStore } from "../state/mock-store.js";
import { track } from "../http/route-registry.js";
import type { AuthContext } from "../auth/jwt-middleware.js";
import { PaymentWorkflow } from "../workflows/payment.js";
import { isWorkflowRejection } from "../workflows/workflow.js";

/**
 * Bridge Cash Token Payments router.
 * 1-step payment endpoint — no draft/approve cycle.
 * POST /dlt/:ncb/api/bridge/payments
 *
 * Mirrors the official Pontes operation "Submit Cash Token Payment Request"
 * (bridge.PaymentRequest): required fields amount, currency, paymentID, and the
 * credited/debited wallet aliases + credited manager ID. On success it returns
 * HTTP 200 with the plain-text confirmation string used by the real API.
 *
 * `supplementaryData` (undocumented in the official spec, confirmed accepted
 * via direct correspondence with ECB support) is carried through to the
 * settled transaction, readable via GET .../ams/wallets/{walias}/transactions.
 */
export function createBridgePaymentsRouter(store: MockStore) {
  const router = track(createRouter());
  const workflow = new PaymentWorkflow(store);

  router.post(
    "/dlt/:ncb/api/bridge/payments",
    defineEventHandler(async (event) => {
      const body = await readBody(event);

      const {
        paymentID,
        debitedCashWalletAlias,
        debitedCashWalletManagerID,
        creditedCashWalletAlias,
        creditedCashWalletManagerID,
        amount,
        currency,
        supplementaryData,
      } = body;

      // Validate required fields per the official bridge.PaymentRequest schema.
      const missing = [
        ["amount", amount],
        ["currency", currency],
        ["paymentID", paymentID],
        ["creditedCashWalletAlias", creditedCashWalletAlias],
        ["creditedCashWalletManagerID", creditedCashWalletManagerID],
        ["debitedCashWalletAlias", debitedCashWalletAlias],
      ]
        .filter(([, v]) => !v)
        .map(([k]) => k);
      if (missing.length > 0) {
        setResponseStatus(event, 400);
        return {
          businessErrors: [
            { errorCode: "HL-VAL-001", errorDescription: `Missing required fields: ${missing.join(", ")}` },
          ],
        };
      }

      // Both the debit source and the credited wallet must already exist
      // (issue #93): an unknown wallet is rejected by the workflow (422
      // HL-WAL-002/003) pointing at POST .../ams/wallets/one-step, rather than
      // silently auto-created (which hid funds in an ownerless wallet).
      const auth = event.context.auth as AuthContext | undefined;
      const callerEntity = auth?.entityBIC;

      // Execute the 1-step payment via the shared workflow engine (checked debit).
      try {
        workflow.execute(
          {
            id: paymentID || randomUUID(),
            amount,
            currency: currency || "EUR",
            creditedWalletAlias: creditedCashWalletAlias,
            debitedWalletAlias: debitedCashWalletAlias,
            supplementaryData,
          },
          { caller: callerEntity ? { entityBIC: callerEntity } : undefined },
        );
      } catch (e) {
        if (isWorkflowRejection(e)) {
          setResponseStatus(event, e.statusCode);
          return { businessErrors: e.businessErrors };
        }
        throw e;
      }

      // The official 200 response is a JSON string (spec: application/json,
      // type: string). Emit it as JSON so `response.json()` works (issue #82).
      // NOTE: the ECB spec's own "Succesfully" spelling is intentional — do NOT
      // "correct" it (wire compatibility).
      setResponseStatus(event, 200);
      setResponseHeader(event, "content-type", "application/json");
      return JSON.stringify("Cash Token Payment Settled Succesfully");
    }),
  );

  return router;
}
