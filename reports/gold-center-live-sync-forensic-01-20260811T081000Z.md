# GOLD-CENTER-LIVE-SYNC-FORENSIC-01

## Execution record

- Mode: strict read-only forensic analysis.
- Persistent database verified as `darfus_erp`; Acceptance was verified read-only as `darfus_erp_inventory_rehearsal_20260804_160500z`.
- No code, configuration, database, Redis, server, migration, fixture, provider, policy, or translation changes were made.
- Persistent current state at inspection: migration `80`, Assets `53`, Products `3`, `gold_market_quotes=1`, `gold_market_settings=1`, `gold_pricing_policies=1`.

## New Live section trace

`app/[locale]/(dashboard)/gold-center/page.tsx` renders `GoldMarketAdminPanels` above the legacy page. The component calls the canonical authenticated API client:

- `GET /gold-pricing/market/settings` → `gold-market-policy.routes.js` → `gold-market-admin.currentState(companyId)`.
- Mode/provider/currency/intervals/enabled/providerConfigured come from `gold_market_settings` plus server-side provider `isConfigured()`.
- Health/status, quote timestamp and received time come from the latest matching `gold_market_quotes` row and server freshness calculation.
- BID/SPOT/ASK and 18K/21K/22K/24K come from `latestQuote`.
- Effective CGP rates come from `currentState` resolving the active CGP policy and `calculateFromPolicy`; errors are caught per karat and returned as `null`, rendered as `—`.
- No frontend provider URL, secret, external provider call, or local financial calculation is present.

Current Persistent read-back:

- settings: `LIVE_PROVIDER`, `GOLDAPI_IO`, `AED`, enabled, `30/120`.
- quote timestamp: `2026-08-11T07:26:11.000Z`.
- receivedAt: `2026-08-11T07:26:13.521Z`.
- inspection time: `2026-08-11T08:08:03.610Z`; age `2513s`.
- health: `STALE`; effective rates `18/21/22/24 = null`.

## Status and effective-rate findings

`NOT_CONFIGURED` is not a local translation or enum issue. The backend emits it only when `pricingMode=LIVE_PROVIDER`, `enabled=true`, and `providerConfigured=false`; `providerConfigured` is computed from the selected server-side adapter's `isConfigured()` result. The settings card separately renders each provider's configured flag. Current Persistent `GOLDAPI_IO` is configured and therefore currently reports `STALE`, not `NOT_CONFIGURED`. The screenshot's exact historical response is not timestamped; its badge is therefore a stale/runtime snapshot or a period in which the process lacked the provider secret or `METALS_API` was selected. The audit log proves a temporary `METALS_API/providerConfigured=false` state at `07:48:30`, followed by a return to `GOLDAPI_IO`.

The effective CGP rate is blank because the current quote is older than the `120s` threshold. `currentState` resolves the active policy, calls `calculateFromPolicy`, and catches `GOLD_MARKET_QUOTE_STALE`, storing `null` for each rate. The policy is present and is `LIVE_PROVIDER / DEFAULT / BID / NONE / 0`.

## Refresh runtime and Redis

The `30s` value is configuration only. `gold-market-refresh.service.js` exposes `refreshOnce`, `enqueueRefresh`, and `createBullMqRefreshInfrastructure`, but repository search found no production startup registration, repeatable job creation, scheduler, or worker invocation for the `gold-market-refresh` queue. `server.js` starts only the reservation-expiry scheduler. `REDIS_URL` is absent from the local environment; the generic queue service consequently operates in-memory. No Gold Market repeat job, active worker, or scheduler is present in source/runtime evidence.

Diagnosis: the quote became stale because no recurring Gold Market refresh runtime is running. The previous quote is valid data, but no process refreshes it after the bounded manual refresh.

## Lower legacy Gold Center trace

`app/[locale]/(dashboard)/gold-center/page.tsx` calls `useGold`. The hook requests `GET /gold/karat-prices?currency=...`, which is handled in `backend/src/routes/erp.routes.js` by the legacy `goldService.getKaratPrices` path.

`backend/src/services/gold.service.js` uses a different secret (`GOLD_API_KEY`), a separate provider selector (`GOLD_API_PROVIDER`), approximate fixed FX (`AED=3.67`), and its own ounce conversion. When `GOLD_API_KEY` is absent it calls `generateFallbackPrices()` with `baseOunceUsd=2330`, random ±0.3% fluctuation, and sets `isFallback=true`. The frontend renders `t("simulatedFeed")`, translated as `تغذية محاكاة`, when that flag is true.

The current environment has the new `GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY` but no legacy `GOLD_API_KEY` or `GOLD_API_PROVIDER`. `gold_prices` currently has zero rows, so no manual override is supplying the screenshot values. The visible values near 275/252/241/206/160 are therefore the legacy simulated fallback, not the normalized GoldAPI quote.

Semantics: legacy Gold Center reference/calculator/fixing rate; it is not canonical CGP BID/SPOT/ASK authority and is currently simulation-only. The lower component also uses the same legacy rate for item quotes and fixings.

## 14K

The legacy service and page explicitly default to `[24,22,21,18,14]` and define `KARAT_PURITY[14]=0.5833`. The new Live Feed contract intentionally supports only `[18,21,22,24]` for CGP pricing. This is a legacy Gold Center/Sales calculator scope difference, not evidence that Live CGP should accept 14K. No removal decision is made in this forensic batch.

## GoldAPI normalization and external comparison

`goldapi-io.adapter.js` maps provider ounce `price`, `bid`, and `ask` to per-gram values using `31.1034768`, preserves AED as the requested provider currency, parses provider Unix seconds into timestamps, and maps direct `price_gram_18k/21k/22k/24k` once. Contract tests and source inspection pass. No double purity, double division, or BID/SPOT/ASK relabeling was found.

The external UAE site URL and timestamp cannot be reliably identified from the supplied screenshot/context. No comparison request was made and no new GoldAPI request was made. Timestamp, quote type, site methodology, retail premium, VAT, and provider are not aligned; therefore the screenshot difference cannot prove GoldAPI is wrong. Classification is `DIFFERENT_TIMESTAMP + DIFFERENT_QUOTE_TYPE_OR_SITE_METHODOLOGY + UNKNOWN_REQUIRES_MORE_SOURCE_DATA`, not a conversion bug.

## Provider switching and security

- `GOLDAPI_IO`: registered, implemented, network-enabled, server secret `GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY`, Test Connection and bounded refresh available, production-ready subject to freshness/runtime.
- `METALS_API`: registered stub only, network disabled, no implemented adapter, not production-ready. It is selectable in the current UI but fails closed for live readiness.
- Provider IDs are stable internal IDs; the UI currently displays the IDs directly. A configurable display name requires design to preserve registry IDs, audit, historical quotes, and snapshot lineage.
- Arbitrary provider URL input is not present.
- Secrets remain server-side and provider-specific; no secret is stored in the database or sent to the frontend.
- Provider switching does not reprice Posted CGP or mutate historical snapshots; lineage stores provider/quote/policy facts at posting.

## Remediation plan (not executed)

1. `GOLD-CENTER-LIVE-RUNTIME-FIX-01`: design and deploy a bounded Gold Market scheduler/worker with Redis/operational observability, keeping `refreshOnce` canonical and fail-closed.
2. `GOLD-CENTER-STATUS-RATE-FIX-01`: align UI status wording with configured/healthy/stale states and expose a deterministic reason for `NOT_CONFIGURED`; preserve stale blocking and show policy/quote eligibility for effective CGP rates.
3. `GOLD-CENTER-LEGACY-PRICE-SYNC-01`: decide whether the legacy simulated/reference section is retired, explicitly isolated, or connected to a separately approved authority. Do not merge market and retail/economic semantics blindly.
4. `GOLD-PROVIDER-SWITCHING-01`: implement safe provider activation workflow only after a real adapter, provider-specific secret, Test Connection, fresh quote, audit, and historical lineage checks exist.

`LOCAL-PRODUCTION-SMOKE-01` should wait for the runtime/status/legacy-price decision; it was not started.

## Protection evidence

- Branch `main`; HEAD `1657b0e9ba580faef69be48f04637835c201b521`; staged files `0`; inherited tracked/untracked changes and `11` stashes preserved; no remotes configured.
- `next-env.d.ts` SHA remained `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`; no mutation.
- Persistent/Acceptance DB writes `0`; migrations `0`; Redis mutations `0`; GoldAPI HTTP requests `0`; server connections/mutations/deployments `0`.

## Exit gate

`GOLD_CENTER_LIVE_SYNC_FORENSIC_01_GATE = COMPLETE_DIAGNOSIS`

`NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START`

`NEXT_RECOMMENDED_BATCH = GOLD-CENTER-LIVE-RUNTIME-FIX-01`

