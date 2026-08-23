# LOCAL-RUNTIME-POST-RESTART-ACCEPTANCE-01

## النتيجة

تم استخدام backend الذي أعاد Owner تشغيله، دون إعادة تشغيل أو إيقاف أي عملية. Redis أصبح متصلاً فعلياً، لكن GoldAPI worker يفشل في كل refresh متكرر بسبب `GOLDAPI_IO_AUTH_ERROR`. لذلك لم تتحقق freshness، ولم ينجح login/browser acceptance، ولم يتم تحديث handoff.

## Runtime / process proof

- Frontend: `localhost:3000`, existing PID 15356, not restarted.
- Backend: `localhost:8000`, PID 25980, nodemon parent PID 25432، start time 14:35:29 local، reused as-is.
- Redis container: `darfus-redis`, `redis:7-alpine`, `6379:6379`, healthy.
- PostgreSQL container: `darfus-postgres`, `postgres:16-alpine`, `5433:5432`, healthy.
- Existing runtime processes were not touched.
- `next-env.d.ts` was not changed; known drift SHA remained unchanged.

## Redis / worker

- `redis-cli PING` = `PONG`.
- Backend had four established TCP connections to `127.0.0.1:6379`.
- `/api/v1/health/redis` = HTTP 200, `Redis connected`.
- BullMQ queue `gold-market-refresh` exists and has one scheduler in `ZCARD bull:gold-market-refresh:repeat = 1`.
- Repeat job key is exactly `gold-market-refresh:COMP-1384c23f-18ee-405f-8675-8e87746be72c:GOLDAPI_IO:AED:XAU` with `every=30000`.
- Worker activity is proven by completed/failed job records, but all newly observed failures have `failedReason=GOLDAPI_IO_AUTH_ERROR`.

## Refresh / quote evidence

| Capture | Time (UTC) | Latest quote timestamp | Result |
|---|---|---|---|
| #1 | 2026-08-11T11:47:15.432Z | 2026-08-11T11:39:33Z | no new quote |
| #2 | 2026-08-11T11:47:56.881Z | 2026-08-11T11:39:33Z | no new quote |

The scheduled attempt cadence is 30 seconds, but it is not a successful refresh. At final inspection the quote age was 657 seconds, status `VALID` in storage but stale against the configured 120-second threshold.

`/api/v1/health/gold` returned HTTP 200 but still reported `isMockFallback=true`. Static inspection proves this is a legacy health source mismatch: `backend/src/routes/index.js` calls `goldService.getLivePrice()` and checks `GOLD_API_KEY`, while the canonical worker uses `GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY` and `gold_market_quotes`. No health edit was made because it would require another backend reload, which this batch forbids.

## Login / browser

- `http://localhost:3000/ar/login` loaded successfully.
- No password was persisted or exposed; no retry or reset was attempted because a usable Owner password was not available in the current execution context.
- Authenticated dashboard, Company/Branch shell, Gold Center, POS, CGP, accounting, inventory, CRM, and route-wide DOM audits could not be completed.
- Login surface itself contained 0 Arabic-Indic and 0 Eastern-Arabic digits; this is not authenticated acceptance evidence.

## Source-level dashboard/date evidence

- Dashboard Gold source is statically canonical `/gold/karat-prices?currency=AED` through `apiClient` with company/branch context.
- Dashboard provider no longer fabricates `UP/1.2`; unavailable percentage is `null`.
- Reference basis remains SPOT and direct-karat rates are not purity-multiplied twice.
- Central presentation helpers remain `DD/MM/YYYY`, `DD/MM/YYYY HH:mm`, `HH:mm`, Latin digits, and date-only no-timezone-shift.
- Remaining native controls before/after this batch: **31**. No control was changed in this batch because authenticated visual violation could not be proven and no workflow/API contract change is allowed.
- Remaining controls are in Accounting (8), Customers (6), POS (2), Reservations (6), Sales Search/Print (2), Supplier Purchases (2), Supplier Detail (4), and Gold Center pricing rules (2 datetime-local). Exact routes/lines were captured by source audit.

## Tests and safety

- Gold runtime/provider/policy tests: 21/21 PASS.
- Making/POS contract test: PASS.
- Gold Center contract test: PASS.
- Dashboard/date/numeral static verifier: PASS.
- `npx tsc --noEmit`: PASS.
- `git diff --check`: PASS.
- No migration, seed, fixture, business write, POS/CGP write, or provider switch executed.
- Persistent `SELECT current_database()` = `darfus_erp`.
- Persistent counts: migrations 80, Assets 53, Products 3, Customers 1, CGP documents 2, Invoices 13, Journals 67, JournalLines 176, cash transactions 50, pricing policies 1, settings 1.
- Market quotes increased naturally from 4 before the Owner restart to 13 after worker attempts; no synthetic business transaction was created.
- Final integrity: unbalanced journals 0, orphan journal lines 0, duplicate/blank barcodes 0, orphan RFID 0.

## Tokens

```text
CURRENT_BATCH = LOCAL-RUNTIME-POST-RESTART-ACCEPTANCE-01
PERSISTENT_DATABASE = darfus_erp
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO_NOT_REQUIRED
OWNER_RESTARTED_BACKEND_REUSED = YES
BACKEND_PID = 25980
BACKEND_PORT = 8000
INHERITED_RUNTIME_PROCESSES_TOUCHED = NO
NEXT_DEV_STARTED_OR_RESTARTED = NO
REDIS_CONTAINER_RUNNING = YES
REDIS_CONTAINER_NAME = darfus-redis
REDIS_PING = PASS
BACKEND_REDISHOST_EFFECTIVE = 127.0.0.1:6379
BACKEND_REDIS_CONNECTION = PASS
REDIS_HEALTH_HTTP_STATUS = 200
REDIS_HEALTH = PASS
NORMAL_LOCAL_GOLD_WORKER_RUNNING = YES
GOLD_MARKET_REPEAT_JOB_REGISTERED = YES
LOGICAL_GOLD_REPEAT_JOB_COUNT = 1
NORMAL_LOCAL_RECURRING_REFRESH = FAIL
OBSERVED_REFRESH_INTERVAL_SECONDS = 30_attempts_but_auth_failed
LATEST_QUOTE_AGE_SECONDS = 657
LATEST_QUOTE_STATUS = STALE
LATEST_QUOTE_AGE_UNDER_120_SECONDS = FAIL
GOLD_HEALTH_HTTP_STATUS = 200
GOLD_HEALTH = FAIL
GOLD_HEALTH_IS_MOCK_FALLBACK = YES
API_KEY_CHANGED_THIS_BATCH = NO
SECRET_EXPOSED_THIS_BATCH = NO
LOGIN_SMOKE = FAIL
LOCAL_LOGIN_PASSWORD_PERSISTED = NO
LOCAL_LOGIN_PASSWORD_EXPOSED = NO
AUTHENTICATED_DASHBOARD_SMOKE = FAIL
COMPANY_BRANCH_CONTEXT_SMOKE = FAIL_LOGIN_BLOCKED
DASHBOARD_GOLD_WIDGET_CANONICAL_SOURCE = YES_STATIC
DASHBOARD_GOLD_REFERENCE_BASIS = SPOT
DASHBOARD_GOLD_NO_DOUBLE_PURITY = PASS_STATIC
DASHBOARD_GOLD_CENTER_SPOT_CONSISTENCY = NOT_VERIFIED
DASHBOARD_FRESH_STATE = FAIL
DASHBOARD_FAKE_PERCENT_VISIBLE = NO_STATIC
DASHBOARD_REVIEW_COMPLETE = NO_LOGIN_BLOCKED
UI_DIGIT_STANDARD = LATIN_0_9
VISIBLE_ARABIC_INDIC_DIGIT_MATCHES_AFTER = NOT_AUTHENTICATED
VISIBLE_EASTERN_ARABIC_DIGIT_MATCHES_AFTER = NOT_AUTHENTICATED
UI_DATE_FORMAT = DD/MM/YYYY
UI_DATETIME_FORMAT = DD/MM/YYYY HH:mm
UI_TIME_FORMAT = HH:mm
DATE_NUMERAL_CHANGE_SCOPE = PRESENTATION_ONLY
PERSISTED_DATE_VALUES_REWRITTEN = NO
API_DATE_PAYLOAD_FORMAT_CHANGED = NO
WORKFLOW_CHANGED = NO
BUSINESS_RULE_CHANGED = NO
TIMEZONE_CONFIGURATION_CHANGED = NO
POSTING_DATE_LOGIC_CHANGED = NO
DATE_ONLY_ROUNDTRIP = PASS_STATIC
REMAINING_NATIVE_DATE_CONTROL_COUNT_BEFORE = 31
REMAINING_NATIVE_DATE_CONTROL_COUNT_AFTER = 31
DATE_CONTROL_WORKFLOW_CHANGED = NO
DATE_INPUT_VISIBLE_FORMAT = DD/MM/YYYY
DATE_PLACEHOLDER_STANDARD = DD/MM/YYYY
DATE_INPUT_SUBMISSION_CONTRACT_CHANGED = NO
VISIBLE_NONSTANDARD_DATE_MATCHES_AFTER = NOT_AUTHENTICATED
GLOBAL_ARABIC_DIRECTION_CHANGED = NO
ARABIC_RTL_REGRESSION = NOT_BROWSER_VERIFIED
GOLD_CENTER_BROWSER_REGRESSION = FAIL_LOGIN_AND_STALE_QUOTE
CGP_14K_LEAK = NOT_VERIFIED
PERSISTENT_POS_UI_READ_ONLY = FAIL_LOGIN_BLOCKED
PERSISTENT_CGP_UI_READ_ONLY = FAIL_LOGIN_BLOCKED
READ_ONLY_BUSINESS_MODULE_UI_SMOKE = FAIL_LOGIN_BLOCKED
BROWSER_NETWORK_SMOKE = FAIL_LOGIN_BLOCKED
BROWSER_CONSOLE_CRITICAL_ERRORS = 0_ON_LOGIN_SURFACE
REAL_GOLDAPI_HTTP_REQUESTS_THIS_BATCH = WORKER_ATTEMPTS_FAILED_AUTH
PERSISTENT_SYNTHETIC_BUSINESS_TRANSACTIONS = 0
BUSINESS_WRITE_SMOKE_THIS_BATCH = NO
PERSISTENT_ASSETS_BEFORE = 53
PERSISTENT_ASSETS_AFTER = 53
PERSISTENT_PRODUCTS_BEFORE = 3
PERSISTENT_PRODUCTS_AFTER = 3
PERSISTENT_CUSTOMERS_BEFORE = 1
PERSISTENT_CUSTOMERS_AFTER = 1
PERSISTENT_CGPS_BEFORE = 2
PERSISTENT_CGPS_AFTER = 2
PERSISTENT_SALES_BEFORE = 13
PERSISTENT_SALES_AFTER = 13
PERSISTENT_JOURNALS_BEFORE = 67
PERSISTENT_JOURNALS_AFTER = 67
PERSISTENT_TREASURY_BEFORE = 50_cash_transactions
PERSISTENT_TREASURY_AFTER = 50_cash_transactions
PERSISTENT_MARKET_QUOTES_BEFORE = 4
PERSISTENT_MARKET_QUOTES_AFTER = 13_natural_worker_rows
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
NEW_PERSISTENT_JOURNALS_THIS_BATCH = 0
NEW_PERSISTENT_TREASURY_ROWS_THIS_BATCH = 0
PERSISTENT_ASSET_COUNT_UNEXPECTED_DELTA = 0
GOLD_LIVE_REGRESSION = FAIL_RUNTIME_AUTH
DASHBOARD_GOLD_TESTS = PASS_STATIC
DATE_FORMATTER_TESTS = PASS_STATIC
LATIN_DIGIT_FORMATTER_TESTS = PASS_STATIC
GOLD_CENTER_MAKING_REGRESSION = PASS
POS_MAKING_REGRESSION = PASS
LEGACY_POS_MISSING_SELLING_GOLD_RATE_REGRESSION = PASS_STATIC
POS_CHECKOUT_REGRESSION = PASS_STATIC_ONLY
CGP_LIVE_PRICING_REGRESSION = PASS_STATIC
TYPESCRIPT = PASS
GIT_DIFF_CHECK = PASS
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
LOCAL_RUNTIME_POST_RESTART_ACCEPTANCE_01_GATE = FAIL
LOCAL_RUNTIME_DASHBOARD_NUMERAL_DATE_FIX_01_GATE = STILL_BLOCKED
LOCAL_PRODUCTION_SMOKE_STATUS = READY_FOR_RETRY_IF_PASS
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_BATCH = LOCAL-PRODUCTION-SMOKE-01-RETRY
```

`PROJECT_PROGRESS_HANDOFF.md` was not updated because PASS_CONFIRMED conditions were not met.
