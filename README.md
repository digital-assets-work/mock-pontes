## Coverage Report

Generated from commit [`b4501c2`](https://github.com/digital-assets-work/mock-pontes/commit/b4501c2d75d0421325419720902fd1bbe746bfce).

🟩 **Overall**: Lines 76.87% (1995/2595) · Statements 76.17% (2126/2791) · Functions 76.31% (377/494) · Branches 63.52% (1085/1708)

<details><summary>Per-file coverage detail</summary>

| File | Lines | Statements | Functions | Branches |
| --- | ---: | ---: | ---: | ---: |
| [src/admin/business-window.ts](per-file/src/admin/business-window.ts.md) | 45.45% (10/22) 🟧 | 43.47% (10/23) 🟧 | 25% (1/4) 🟥 | 0% (0/6) 🟥 |
| [src/admin/reset.ts](per-file/src/admin/reset.ts.md) | 66.66% (6/9) 🟧 | 60% (6/10) 🟧 | 50% (1/2) 🟧 | 0% (0/2) 🟥 |
| src/app.ts | 100% (61/61) 🟩 | 98.41% (62/63) 🟩 | 100% (4/4) 🟩 | 66.66% (4/6) 🟧 |
| src/auth/admin-token.ts | 100% (21/21) 🟩 | 100% (26/26) 🟩 | 100% (5/5) 🟩 | 100% (14/14) 🟩 |
| [src/auth/csr-handler.ts](per-file/src/auth/csr-handler.ts.md) | 91.11% (41/45) 🟩 | 90% (45/50) 🟩 | 100% (6/6) 🟩 | 76.19% (16/21) 🟩 |
| [src/auth/enrollment-routes.ts](per-file/src/auth/enrollment-routes.ts.md) | 41.89% (62/148) 🟧 | 41.44% (63/152) 🟧 | 50% (6/12) 🟧 | 20% (19/95) 🟥 |
| src/auth/index.ts | 100% (8/8) 🟩 | 100% (14/14) 🟩 | 50% (4/8) 🟧 | 100% (0/0) 🟩 |
| [src/auth/jwt-middleware.ts](per-file/src/auth/jwt-middleware.ts.md) | 95% (38/40) 🟩 | 93.33% (42/45) 🟩 | 100% (7/7) 🟩 | 80.64% (25/31) 🟩 |
| [src/auth/middleware.ts](per-file/src/auth/middleware.ts.md) | 27.77% (5/18) 🟥 | 31.57% (6/19) 🟧 | 100% (2/2) 🟩 | 7.14% (1/14) 🟥 |
| src/auth/ncb-middleware.ts | 100% (19/19) 🟩 | 100% (23/23) 🟩 | 100% (7/7) 🟩 | 87.5% (7/8) 🟩 |
| [src/auth/nro-middleware.ts](per-file/src/auth/nro-middleware.ts.md) | 91.66% (121/132) 🟩 | 87.83% (130/148) 🟩 | 95.45% (21/22) 🟩 | 78.37% (87/111) 🟩 |
| src/auth/oidc.ts | 100% (8/8) 🟩 | 100% (8/8) 🟩 | 100% (2/2) 🟩 | 100% (0/0) 🟩 |
| [src/auth/profile-authorization-middleware.ts](per-file/src/auth/profile-authorization-middleware.ts.md) | 76.19% (16/21) 🟩 | 75% (18/24) 🟩 | 80% (4/5) 🟩 | 71.42% (10/14) 🟩 |
| src/auth/profile-enforcement.ts | 100% (22/22) 🟩 | 100% (22/22) 🟩 | 100% (2/2) 🟩 | 100% (10/10) 🟩 |
| [src/auth/runtime-pki.ts](per-file/src/auth/runtime-pki.ts.md) | 60.16% (71/118) 🟧 | 59.52% (75/126) 🟧 | 69.23% (18/26) 🟧 | 32.6% (15/46) 🟧 |
| src/auth/test-keys.ts | 100% (29/29) 🟩 | 100% (29/29) 🟩 | 100% (4/4) 🟩 | 100% (2/2) 🟩 |
| [src/auth/users-repository.ts](per-file/src/auth/users-repository.ts.md) | 59.77% (52/87) 🟧 | 59.55% (53/89) 🟧 | 71.42% (15/21) 🟩 | 64.51% (20/31) 🟧 |
| [src/cache/common.ts](per-file/src/cache/common.ts.md) | 33.33% (1/3) 🟧 | 33.33% (1/3) 🟧 | 0% (0/1) 🟥 | 100% (0/0) 🟩 |
| [src/cache/in-memory.ts](per-file/src/cache/in-memory.ts.md) | 41.93% (13/31) 🟧 | 40.62% (13/32) 🟧 | 40% (4/10) 🟧 | 50% (5/10) 🟧 |
| src/cache/index.ts | 100% (3/3) 🟩 | 100% (6/6) 🟩 | 66.66% (2/3) 🟧 | 100% (0/0) 🟩 |
| [src/cache/redis.ts](per-file/src/cache/redis.ts.md) | 74.54% (41/55) 🟩 | 68.85% (42/61) 🟧 | 43.47% (10/23) 🟧 | 53.84% (14/26) 🟧 |
| src/http/business-window-guard.ts | 100% (23/23) 🟩 | 93.1% (27/29) 🟩 | 80% (4/5) 🟩 | 83.33% (15/18) 🟩 |
| src/http/business-window-rules.ts | 100% (28/28) 🟩 | 100% (33/33) 🟩 | 100% (4/4) 🟩 | 75% (15/20) 🟩 |
| [src/http/error-response.ts](per-file/src/http/error-response.ts.md) | 95.12% (39/41) 🟩 | 91.3% (42/46) 🟩 | 100% (9/9) 🟩 | 68.83% (53/77) 🟧 |
| src/http/not-implemented.ts | 100% (37/37) 🟩 | 97.82% (45/46) 🟩 | 100% (7/7) 🟩 | 84.61% (22/26) 🟩 |
| [src/http/request-validation.ts](per-file/src/http/request-validation.ts.md) | 95.6% (87/91) 🟩 | 94.17% (97/103) 🟩 | 100% (14/14) 🟩 | 87.5% (63/72) 🟩 |
| [src/http/route-registry.ts](per-file/src/http/route-registry.ts.md) | 95.45% (21/22) 🟩 | 95.65% (22/23) 🟩 | 87.5% (7/8) 🟩 | 100% (7/7) 🟩 |
| [src/index.ts](per-file/src/index.ts.md) | 0% (0/76) 🟥 | 0% (0/80) 🟥 | 0% (0/9) 🟥 | 0% (0/42) 🟥 |
| [src/logger/middleware.ts](per-file/src/logger/middleware.ts.md) | 64% (16/25) 🟧 | 62.96% (17/27) 🟧 | 75% (3/4) 🟩 | 27.27% (6/22) 🟥 |
| [src/routes/bridge-payments.ts](per-file/src/routes/bridge-payments.ts.md) | 88.23% (30/34) 🟩 | 88.23% (30/34) 🟩 | 75% (3/4) 🟩 | 58.33% (7/12) 🟧 |
| [src/routes/business-window.ts](per-file/src/routes/business-window.ts.md) | 62.5% (10/16) 🟧 | 62.5% (10/16) 🟧 | 20% (1/5) 🟥 | 100% (0/0) 🟩 |
| [src/routes/direct-rtgs.ts](per-file/src/routes/direct-rtgs.ts.md) | 83.33% (65/78) 🟩 | 82.27% (65/79) 🟩 | 92.3% (12/13) 🟩 | 56.38% (53/94) 🟧 |
| [src/routes/funding.ts](per-file/src/routes/funding.ts.md) | 92.77% (77/83) 🟩 | 91.86% (79/86) 🟩 | 100% (14/14) 🟩 | 60.15% (77/128) 🟧 |
| [src/routes/grs-entities.ts](per-file/src/routes/grs-entities.ts.md) | 57.14% (8/14) 🟧 | 57.14% (8/14) 🟧 | 33.33% (1/3) 🟧 | 0% (0/2) 🟥 |
| [src/routes/health.ts](per-file/src/routes/health.ts.md) | 36.36% (8/22) 🟧 | 34.78% (8/23) 🟧 | 40% (2/5) 🟧 | 0% (0/12) 🟥 |
| [src/routes/pfod.ts](per-file/src/routes/pfod.ts.md) | 74.71% (65/87) 🟩 | 73.62% (67/91) 🟩 | 90% (9/10) 🟩 | 67.85% (38/56) 🟧 |
| [src/routes/transfers.ts](per-file/src/routes/transfers.ts.md) | 91.25% (73/80) 🟩 | 91.25% (73/80) 🟩 | 100% (13/13) 🟩 | 77.14% (54/70) 🟩 |
| [src/routes/wallets.ts](per-file/src/routes/wallets.ts.md) | 84.44% (76/90) 🟩 | 83.15% (79/95) 🟩 | 86.66% (13/15) 🟩 | 72.52% (66/91) 🟩 |
| [src/routes/xvp.ts](per-file/src/routes/xvp.ts.md) | 85.29% (58/68) 🟩 | 84.28% (59/70) 🟩 | 100% (7/7) 🟩 | 62.68% (42/67) 🟧 |
| [src/state/business-window.ts](per-file/src/state/business-window.ts.md) | 98.7% (76/77) 🟩 | 98.78% (81/82) 🟩 | 100% (11/11) 🟩 | 82.5% (33/40) 🟩 |
| src/state/dcw.ts | 100% (58/58) 🟩 | 97.1% (67/69) 🟩 | 100% (15/15) 🟩 | 87.69% (57/65) 🟩 |
| src/state/draft-id.ts | 100% (7/7) 🟩 | 100% (7/7) 🟩 | 100% (1/1) 🟩 | 100% (6/6) 🟩 |
| src/state/grs-entities.ts | 100% (6/6) 🟩 | 100% (8/8) 🟩 | 100% (4/4) 🟩 | 100% (2/2) 🟩 |
| src/state/issuance-wallet.ts | 100% (2/2) 🟩 | 100% (2/2) 🟩 | 100% (0/0) 🟩 | 100% (4/4) 🟩 |
| [src/state/memory-store.ts](per-file/src/state/memory-store.ts.md) | 93.27% (111/119) 🟩 | 92.64% (126/136) 🟩 | 92.68% (38/41) 🟩 | 85.96% (49/57) 🟩 |
| [src/ui/inspect.ts](per-file/src/ui/inspect.ts.md) | 9.09% (4/44) 🟥 | 8.33% (4/48) 🟥 | 0% (0/7) 🟥 | 0% (0/14) 🟥 |
| [src/ui/openapi.ts](per-file/src/ui/openapi.ts.md) | 95% (38/40) 🟩 | 92.68% (38/41) 🟩 | 66.66% (2/3) 🟧 | 70.58% (24/34) 🟩 |
| [src/ui/p12.ts](per-file/src/ui/p12.ts.md) | 98.59% (70/71) 🟩 | 98.66% (74/75) 🟩 | 100% (17/17) 🟩 | 75% (6/8) 🟩 |
| [src/ui/router.ts](per-file/src/ui/router.ts.md) | 38.46% (50/130) 🟧 | 39.13% (54/138) 🟧 | 13.79% (4/29) 🟥 | 36.11% (26/72) 🟧 |
| [src/version.ts](per-file/src/version.ts.md) | 75% (6/8) 🟩 | 77.77% (7/9) 🟩 | 50% (1/2) 🟧 | 54.54% (6/11) 🟧 |
| src/workflows/direct-rtgs.ts | 100% (7/7) 🟩 | 100% (7/7) 🟩 | 100% (1/1) 🟩 | 100% (0/0) 🟩 |
| src/workflows/funding.ts | 100% (16/16) 🟩 | 100% (17/17) 🟩 | 100% (3/3) 🟩 | 83.33% (5/6) 🟩 |
| src/workflows/payment.ts | 100% (6/6) 🟩 | 100% (6/6) 🟩 | 100% (1/1) 🟩 | 100% (0/0) 🟩 |
| src/workflows/pfod.ts | 100% (7/7) 🟩 | 100% (7/7) 🟩 | 100% (1/1) 🟩 | 100% (0/0) 🟩 |
| src/workflows/transfer.ts | 100% (21/21) 🟩 | 100% (22/22) 🟩 | 100% (3/3) 🟩 | 100% (25/25) 🟩 |
| [src/workflows/workflow.ts](per-file/src/workflows/workflow.ts.md) | 85.32% (93/109) 🟩 | 84.21% (96/114) 🟩 | 91.66% (22/24) 🟩 | 71.92% (41/57) 🟩 |
| [src/workflows/xvp.ts](per-file/src/workflows/xvp.ts.md) | 92.3% (48/52) 🟩 | 87.27% (48/55) 🟩 | 83.33% (5/6) 🟩 | 77.27% (34/44) 🟩 |

</details>

Click a file above for its annotated per-line breakdown (readable directly on GitHub), browse the full interactive HTML report at [https://digital-assets-work.github.io/mock-pontes/](https://digital-assets-work.github.io/mock-pontes/) (or open `html/index.html` from this branch), or download the raw `coverage-summary.json`/`lcov.info`. See [`HISTORY.md`](HISTORY.md) for coverage over time.
