# GOLD-LIVE-FEED-05 — Gold Center Frontend + Admin Controls

## Execution

- `AGENTS.md`, handoff, canonical CGP reference, prior GOLD-LIVE-FEED reports, and client source files were read before changes.
- Persistent `darfus_erp` remained read-only at migration 77, Assets 53, Products 3.
- Acceptance `darfus_erp_inventory_rehearsal_20260804_160500z` remained read-only at migration 80; migration 81 was not required and was not created.
- No Next dev, server, external provider request, real secret, commit, push, or deployment was used.

## Implemented

- Added company-scoped Gold Market admin service and routes for sanitized settings/status, Test Connection, and paginated quote history.
- Reused `gold.manage_pricing_policy` for privileged provider/policy mutations and `gold.view` for read-only views; company context remains server-derived.
- LIVE_PROVIDER activation fails closed unless provider configuration, fresh quote reachability, and an active CGP policy are present. No fallback or failover is introduced.
- Provider responses never include API secrets, secret values, or provider URLs. GOLDAPI_IO is represented as ERP-backend-only; METALS_API remains network-disabled and cannot be activated without a configured/healthy adapter.
- Added Gold Center surfaces: Live Prices, Pricing Rules, Price History, and Market Data Provider Settings. Market BID/SPOT/ASK is shown separately from CGP effective pricing; SPOT is never labelled as BID.
- Live Prices includes provider/health/freshness timestamps and age, 18K/21K/22K/24K market rows, and a server-returned four-decimal effective CGP rate when a policy resolves. Stale state explicitly blocks Live financial eligibility in the UI.
- Pricing Rules supports default and per-karat scope, BID/SPOT/ASK, NONE/FIXED_PER_GRAM/PERCENTAGE, signed adjustment values, effective windows, explicit activation confirmation, paginated immutable history, changed-by/changed-at display, and canonical conflict errors.
- Provider Settings shows refresh/stale thresholds, explicit mode/provider confirmation, configured/not-configured status, Test Connection results (reachability, currency, timestamp, freshness, BID/SPOT/ASK capabilities), and no arbitrary URL or secret input.
- Removed the legacy frontend pricing-mode selector to avoid a second business authority. Existing sale-fixing tools remain compatibility surfaces and are not used as CGP posting authority.
- Pricing history is paginated and immutable; conflicts remain visible through canonical API errors.

## Verification

- `npx tsc --noEmit` — PASS.
- `node tests/gold-live-feed-05-contract.test.cjs` — PASS.
- Migration guard verifier (7/7 cases) — PASS.
- Existing Gold Live Feed 01/03 and CGP contract regressions — PASS.
- Acceptance read-only API proof: mode `MANUAL_APPROVED`, health `NOT_CONFIGURED`, quote history total `0`, Test Connection `UNAVAILABLE/configured=false`, no secret field.
- Persistent read-only API proof: `GOLD_MARKET_FOUNDATION_NOT_AVAILABLE` (migration 77 intentionally has no Live Feed tables).
- Providers: `GOLDAPI_IO networkEnabled=true`; `METALS_API networkEnabled=false`.
- `next-env.d.ts` stayed at inherited known-drift SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`; no generation or repair was run.

## Scope boundary

No live provider activation, real GoldAPI connectivity, migration 81, Persistent promotion, CGP financial logic change, or production readiness claim was made. Those require the next controlled acceptance batch and a configured server secret.

`GOLD-LIVE-FEED-05 = PASS_CONFIRMED`
