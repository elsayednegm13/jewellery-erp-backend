# GOLD-LIVE-FEED-03 — CGP Pricing Policy Engine

## Execution record

- `CURRENT_BATCH = GOLD-LIVE-FEED-03`.
- Persistent `darfus_erp` was read-only: migration `77` before and after, no policy table, no policy permission, and no writes.
- Acceptance `darfus_erp_inventory_rehearsal_20260804_160500z` was verified at migration `78` before mutation and `79` after mutation.
- Migration `20260810020000-gold-cgp-pricing-policies.js` was applied exactly once through `node scripts/acceptance-migrate.js --gold-live-feed-03 --execute`; raw `sequelize-cli` was not used.
- Acceptance backup used for rehearsal: `backend/backups/gold_live_feed_03_acceptance_before_79_20260810T201500Z.dump`, SHA-256 `9495AD4066035038A272D08217B19DF3D82EBDC95FAEFE07E652A25018B8A79B`, size `1617469` bytes; `pg_restore --list` passed.

## Policy model and migration

`GoldPricingPolicy` / `gold_pricing_policies` is additive and company-scoped. It stores CGP context, mode, DEFAULT/KARAT scope, supported karat, BID/SPOT/ASK base type, NONE/FIXED_PER_GRAM/PERCENTAGE adjustment, version/status, effective window, creator, and supersession lineage. Database checks enforce the frozen value sets, valid karats, NONE=0, positive time windows, and a unique scope/version index. Resolution and supersession use a transaction plus a scoped PostgreSQL advisory lock; historical rows are immutable through the model hooks and controlled transitions only.

The migration creates only the policy table, indexes, constraints, and the unassigned `gold.manage_pricing_policy` permission. It does not touch Assets, Products, Customers, CGP documents, Journals, Treasury, Gold events, CRM, or reversal data.

## Pricing contract

- Modes: `MANUAL_APPROVED`, `LIVE_PROVIDER`.
- Context: `CGP` only.
- Scope: company-scoped; branch scope `NONE`.
- Supported karats: `18,21,22,24`.
- Quote types: `BID,SPOT,ASK`; a required unavailable quote type fails closed.
- Adjustments: `NONE`, signed `FIXED_PER_GRAM`, signed `PERCENTAGE`.
- Resolution: active per-karat override first, then active global default; no hardcoded fallback.
- Effective window: `effectiveFrom <= serverNow < effectiveUntil` (or no end).
- Raw market arithmetic uses Decimal precision up to 8 places; policy adjustment uses Decimal; final effective rate is rounded `HALF_UP` to 4 decimals and must be positive.
- Direct provider karat rates are consumed once; no second purity multiplication. Pure gold remains canonical `999.9`; 995 is not introduced.
- Result lineage includes policy mode/context/company/karat/currency/base quote/base rate/adjustment/effective rate/policy id/version/scope/calculation time and optional market quote/provider lineage.

## Service, API, permissions, and audit

`gold-pricing-policy.service.js` provides deterministic resolution, calculation, history, version creation, activation, overlap protection, company isolation, server-time checks, and audit records. Policy changes require `gold.manage_pricing_policy`; reads require `gold.view`. No role or user is assigned the new permission by migration. Routes are mounted under `/gold-pricing` for current resolution, history, version creation, and activation. No frontend UI was added and no final rate can be supplied as authority by a caller.

## Rehearsal and acceptance evidence

The disposable `darfus_erp_gold_live_feed_03_rehearsal_20260810T201500Z` database was restored from Acceptance 78, migrated with exactly Migration 79, and safely dropped after validation. Service rehearsal passed default policy, per-karat override precedence, fixed and percentage adjustments, direct-karat no-double-purity behavior, version supersession/history, future/expired fail-closed behavior, overlap rejection, company isolation, permission denial, and a concurrent same-scope creation race with one success and one overlap conflict.

Acceptance post-apply verification:

- `current_database() = darfus_erp_inventory_rehearsal_20260804_160500z`.
- `SequelizeMeta = 79`; Migration 79 appears exactly once; no unexpected migration ran.
- `gold_pricing_policies` exists with `0` rows.
- `gold.manage_pricing_policy` exists exactly once and has `0` role assignments.
- Business-count comparison against the pre-79 backup matched: Assets `475`, Products `3`, Customers `3`, CGP documents `82`, CGP items `92`, JournalLines `1423`, CashTransactions `173`, GoldCoreEvents `4`, OutboxEvents `59`, and CGP reversal compensations `2`.
- Acceptance synthetic pricing policies after the batch: `0`.

## Tests and regressions

- Pricing policy focused tests: `5/5` pass.
- Combined Gold Live Feed 01 + 03 tests: `14/14` pass.
- Approved-price authority verifier: all seven checks pass.
- CGP IMP-01/02/03/11 contract regression: `10/10` pass.
- `npx tsc --noEmit`: pass.
- `git diff --check`: exit `0` (only inherited CRLF normalization warnings).
- No external HTTP request, no GoldAPI secret, no Redis worker, no server connection, no deployment, and no Next dev.

## Unchanged boundaries

`CGP_LIVE_PRICE_INTEGRATION_ACTIVE = NO`; `CURRENT_CGP_PRICE_AUTHORITY = MANUAL_APPROVED`; the existing manual CGP path, Posting, reversal, settlement, accounting, inventory, Gold Center, CRM, and global dispatcher remain unchanged/off. No real production spread or provider secret was inserted. Migration 79 was not promoted to Persistent.

## Protection and gate

- Branch `main`; HEAD `1657b0e9ba580faef69be48f04637835c201b521`.
- Inherited worktree changes and 11 stashes were preserved; no staging, commit, push, or destructive Git command.
- `next-env.d.ts` was not touched and remains the inherited known drift SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.
- `PERSISTENT_DB_WRITES_THIS_BATCH = 0`; `PERSISTENT_MIGRATIONS_AFTER_BATCH = 77`; `SERVER_MUTATIONS = 0`.

`GOLD_LIVE_FEED_03_GATE = PASS_CONFIRMED`.

Next task, not started automatically: `GOLD-LIVE-FEED-04_CGP_POSTING_LIVE_PRICE_INTEGRATION`.
