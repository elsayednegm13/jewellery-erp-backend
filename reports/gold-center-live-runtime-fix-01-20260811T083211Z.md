# GOLD-CENTER-LIVE-RUNTIME-FIX-01

## Execution status

- Mode: focused runtime remediation with fail-closed acceptance verification.
- The proven defect was implemented at the backend runtime boundary; no Next dev,
  deployment, server connection, migration, fixture, or Git history operation was used.
- The local environment has no `REDIS_URL` and no Redis service/process. Therefore
  the real BullMQ recurring-refresh gate is **BLOCKED_BY_REDIS_CONFIG** and no
  recurring provider call was started.

## Root cause and implementation

Before this batch, `gold-market-refresh.service.js` exposed one-shot refresh and
BullMQ primitives, but `backend/src/server.js` registered no Gold Market scheduler
or worker. The persisted 30-second value was configuration only.

Added `backend/src/services/gold-market-runtime.service.js`:

- reads enabled `LIVE_PROVIDER` settings from the canonical `GoldMarketSetting` model;
- registers one BullMQ Job Scheduler per stable
  `company:provider:currency:metal` scope via `upsertJobScheduler`;
- uses `gold-market-refresh` as queue and job name;
- uses `gold-market-refresh:<company>:<provider>:<currency>:<metal>` as scheduler ID;
- uses the existing `refreshOnce` path (no second provider/valuation engine);
- resolves current settings again in the worker callback, so stale job payloads do not
  become pricing authority;
- removes only stale schedulers with the Gold Market prefix;
- uses bounded `attempts=3` exponential backoff (1 second base), provider timeout
  remains the existing 5 seconds, and non-retryable provider errors are unrecoverable;
- keeps API startup alive when Redis is missing/unavailable and leaves Live CGP
  freshness fail-closed through the existing quote freshness authority;
- exposes graceful close/reconcile hooks for SIGTERM/SIGINT and settings updates;
- logs only non-sensitive job/scope/quote metadata.

`backend/src/server.js` now starts this runtime after database authentication and
closes it during graceful shutdown. `gold-market-admin.service.js` asks the active
runtime to reconcile schedules after a committed settings change. The lower legacy
Gold Center (`useGold`, `/gold/karat-prices`, `gold.service`) was not changed.

## Redis configuration

- Canonical source: `REDIS_URL`.
- `backend/.env` contains no `REDIS_URL`; no alternate Redis host/port/password
  configuration was present, and no URL was inferred or hardcoded.
- Required owner/environment action before real runtime acceptance: provide a
  server-side `REDIS_URL` in the local runtime environment without logging it.
- Redis-unavailable behavior: API remains available, recurring Gold Market work is
  disabled, and Live CGP remains blocked unless a fresh canonical quote exists.

## Static/unit verification

- `backend/tests/gold-market-runtime.test.cjs`: PASS (fail-closed missing Redis,
  deterministic/upserted scheduler, duplicate registration count 1, stale schedule
  removal, current-setting resolution, disabled setting skip, graceful close).
- Existing Gold Live Feed foundation/policy, Gold Center making, CGP contract, and
  Gold Live Feed 05 tests: 27/27 PASS.
- `npx tsc --noEmit`: PASS.
- `git diff --check`: PASS (only inherited CRLF materialization warnings).
- `next-env.d.ts` remained the inherited known drift SHA
  `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.

## Database/read-only evidence

Persistent `darfus_erp` was verified with `SELECT current_database()` before
read-only inspection:

- migration `80`, Assets `53`, Products `3`;
- CGP documents `2`, invoices `13`, Journal entries `67`, Journal lines `176`,
  cash transactions `50`;
- Gold settings `1`, policies `1`, market quotes `1`;
- latest quote is `VALID`, provider `GOLDAPI_IO`, currency `AED`, but was about
  `3917` seconds old at inspection (stale under 120 seconds).
- financial integrity: unbalanced journals `0`, orphan journal lines `0`,
  unlinked treasury `0`, duplicate journal sources `0`;
- inventory: blank barcodes `0`, duplicate barcodes `0`, orphan RFID assignments `0`.

Acceptance `darfus_erp_inventory_rehearsal_20260804_160500z` was independently
verified read-only at migration `80` with zero `gold_market_quotes` rows. No
acceptance or persistent rows were written by this batch.

## Runtime gate

Because Redis is not configured, the following could not be truthfully claimed:

- actual BullMQ worker running;
- repeat-job observation at approximately 30 seconds;
- real GoldAPI request count during recurring runtime;
- fresh quote/currentState recovery/provider HEALTHY after recurrence;
- Persistent quote-row delta from the authorized runtime.

No real GoldAPI HTTP request was made by this batch. No Redis mutation, business
fixture, Journal, Treasury, Asset, CGP, or pricing-policy write was made.

## Scope regressions and protection

- Legacy lower Gold Center changed this batch: **NO**.
- Gold Center/POS making and legacy POS missing-rate contracts: PASS (existing
  focused tests).
- CGP posting remains free of direct HTTP calls by static contract coverage.
- Migration 81: not created or required.
- Server/SSH/deployment connections: 0.
- Persistent business data preservation: read-only counts unchanged; no runtime
  execution occurred.

## Exit decision

`GOLD_CENTER_LIVE_RUNTIME_FIX_01_GATE = BLOCKED_BY_REDIS_CONFIG`

The implementation is ready for a bounded Redis-backed rehearsal once the owner
provides the canonical `REDIS_URL`. Do not update the handoff to PASS_CONFIRMED,
do not claim fresh quotes, and do not start the next Gold Center batch yet.
