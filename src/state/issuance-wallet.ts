/**
 * The ECB token-issuance wallet: the source of funds for FUNDING (and the
 * sink for DEFUNDING) — see `routes/funding.ts`. In this mock it is treated
 * as having an INFINITE balance, so it is never persisted as a real `Wallet`
 * record (see `routes/wallets.ts`'s `moveParty` fallback).
 *
 * Configurable via env vars since UTEST vs a future PROD environment may use
 * different values — confirmed live against real Pontes UTEST (workbench
 * issue #124): the mock's previously-assumed defaults (`ECBFDEFFXXX` /
 * `WEUEURECBFDEFFXXX-TOKEN_ISSUANCE_WALLET`) were wrong; real UTEST actually
 * uses `ECBFDEFFTPP` / `WEUEURECBFDEFFTPP-TOKEN_ISSUANCE_WALLET`.
 */
export const ISSUANCE_WALLET_BIC = process.env.PONTES_ISSUANCE_WALLET_BIC || "ECBFDEFFTPP";
export const ISSUANCE_WALLET_ALIAS =
  process.env.PONTES_ISSUANCE_WALLET_ALIAS || "WEUEURECBFDEFFTPP-TOKEN_ISSUANCE_WALLET";
