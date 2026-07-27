import {
  createRouter,
  defineEventHandler,
  readBody,
  setResponseStatus,
} from "h3";
import { randomUUID } from "node:crypto";
import type { MockStore } from "../state/mock-store.js";
import { track } from "../http/route-registry.js";
import type { AuthContext } from "../auth/jwt-middleware.js";
import { PaymentWorkflow } from "../workflows/payment.js";
import { isWorkflowRejection } from "../workflows/workflow.js";

/** Auto-create a wallet, owned by `ownerEntityID` when known (for debit rights). */
function ensureWallet(store: MockStore, alias: string, managerNCB: string, ownerEntityID?: string): void {
  if (!alias || store.getWallet(alias)) return;
  store.ensureWallet(alias, { managerNCB, ownerEntityID, ownerBIC: ownerEntityID });
  console.log(`[mock-pontes] Auto-created wallet ${alias}`);
}

/**
 * Bridge Cash Token Payments router.
 * 1-step payment endpoint — no draft/approve cycle.
 * POST /dlt/:ncb/api/bridge/payments
 *
 * Mirrors the official Pontes operation "Submit Cash Token Payment Request"
 * (bridge.PaymentRequest): required fields amount, currency, paymentID, and the
 * credited/debited wallet aliases + credited manager ID. On success it returns
 * HTTP 200 with the plain-text confirmation string used by the real API.
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

      // Auto-create only the CREDIT-side wallet (issue #23). The debit-side
      // source must already exist; the workflow raises a condition error if not.
      const auth = event.context.auth as AuthContext | undefined;
      const callerEntity = auth?.entityBIC;
      ensureWallet(store, creditedCashWalletAlias, creditedCashWalletManagerID || "UNKNOWN");

      // Execute the 1-step payment via the shared workflow engine (checked debit).
      try {
        workflow.execute(
          {
            id: paymentID || randomUUID(),
            amount,
            currency: currency || "EUR",
            creditedWalletAlias: creditedCashWalletAlias,
            debitedWalletAlias: debitedCashWalletAlias,
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

      // The official endpoint returns HTTP 200 with a plain-text confirmation.
      setResponseStatus(event, 200);
      return "Cash Token Payment Settled Succesfully";
    }),
  );

  return router;
}
