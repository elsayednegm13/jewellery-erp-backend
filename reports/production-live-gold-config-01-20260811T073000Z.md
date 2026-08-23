# PRODUCTION-LIVE-GOLD-CONFIG-01 — توثيق تهيئة GoldAPI الإنتاجية

## النتيجة والحدود

- Owner authorization: explicit, narrow, target `darfus_erp` only.
- No migration, no migration 81, no CGP/Sales fixtures, no server/deploy, no Next dev.
- Canonical services only: `gold-pricing-policy.service`, `gold-market-admin.service`, `gold-market-test-connection.service`, `gold-market-refresh.service`.
- Persistent business counts before/after: Assets `53`, Products `3`, Customers `1`, CGP documents `2`, Journal entries `67`, Journal lines `176`, CashTransactions `50`.

## العملة والسر

- Company `DARFUS` is the canonical currency authority: `AED`; existing CGP documents also use `AED`.
- Secret name: `GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY`.
- Runtime source: `backend/.env` loaded by dotenv from the backend working directory.
- Presence was verified without displaying value, length, hash, prefix/suffix, header, or URL. No occurrence was found in source, frontend, reports, tests, or public assets.

## النسخ الاحتياطية

- Pre-config: `backend/backups/darfus_erp_pre_live_gold_config_01_20260811072502.dump`; SHA-256 `817758D84D1A9AE6E2723A60A22EF45C6F69E5CD96419D9AC871FF9ED808FDAB`; `pg_restore --list` readable (`1171` entries).
- Post-config: `backend/backups/darfus_erp_post_live_gold_config_01_20260811073037.dump`; SHA-256 `114851FA3F35A8D6CFE1079F0BCB38B70A2AD1CBA403D061FBA498A2B711BFDE`; `pg_restore --list` readable (`1171` entries).

## التهيئة الفعلية

- One company-scoped `gold_market_settings`: provider `GOLDAPI_IO`, mode `LIVE_PROVIDER`, currency `AED`, refresh `30`, stale `120`, enabled `true`.
- One active CGP DEFAULT policy: `LIVE_PROVIDER / BID / NONE / 0`, version `1`, no per-karat override.
- One bounded normalized real quote: `VALID`, `XAU`, `PER_GRAM`, fresh, currency `AED`, positive `BID/SPOT/ASK`, direct `18K/21K/22K/24K` values.
- Test Connection passed without persisting a quote. The activation readiness check also performed its canonical server-side reachability check; bounded real HTTP count was `3` (explicit Test Connection, activation readiness check, one refresh).
- Policy and settings changes produced canonical audit records. `gold.manage_pricing_policy` remains unassigned to roles/employees; the super-admin actor used the existing permission architecture and no new assignment was created.

## السلامة والقراءة اللاحقة

- `LIVE_PROVIDER` is active only after provider readiness and an active policy. No automatic provider failover or automatic manual fallback exists.
- `currentState` read-back: `HEALTHY`; configured provider, currency, intervals, quote and effective BID policy all match.
- No quote was synthesized; no historical CGP was repriced or status-changed; no Asset, Sale, Journal, Treasury, Gold Center, CRM, settlement, reversal, or Redis rows were created by this batch.
- Canonical financial integrity after configuration: unbalanced journals `0`, orphan journal lines `0`, unlinked treasury `0`, duplicate journal sources `0`, duplicate treasury journal links `0`; open cash sessions `1`.
- Canonical ledger summary (company/branch): cash `0.003`, bank `20416.405`; configuration writes did not alter financial rows.
- Inventory integrity: Assets `53`, duplicate/blank barcodes `0`; no quantity or product fallback authority was introduced.

## الاختبارات والحماية

- Gold Live Feed foundation `9/9`, pricing policy `6/6`, making-charge contract, CGP account resolver, CGP permission/legacy isolation/stage boundary, TypeScript, and `git diff --check`: PASS.
- Browser Gold Center acceptance was not run because no safe signed-in browser runtime was available; no runtime was started.
- Branch `main`, HEAD `1657b0e9ba580faef69be48f04637835c201b521`; no staging, commit, push, deploy, or server connection. Inherited worktree changes and stashes were preserved.
- `next-env.d.ts` remained inherited known-drift SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`; it was not generated or repaired.

## البوابات

`PRODUCTION_LIVE_GOLD_CONFIG_01_GATE = PASS_CONFIRMED`

`NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START`

`NEXT_RECOMMENDED_BATCH = LOCAL-PRODUCTION-SMOKE-01_IF_PASS_CONFIRMED`

