# LOCAL-RUNTIME-DASHBOARD-NUMERAL-DATE-FIX-01

## النتيجة العملية

تم تنفيذ إصلاحات عرض محلية فقط، مع إبقاء قواعد الأعمال، عقود API، التواريخ المخزنة، وقاعدة البيانات دون تعديل. أضيفت وصلة Redis المحلية إلى `backend/.env` بصيغة `redis://127.0.0.1:6379` (ملف محلي ignored)، لكن العملية الخلفية الموروثة PID 9336 لم تُعاد تشغيلها، لذلك لا يمكن إثبات أن runtime الحالي حمّل المتغير. لم تُلمس أي عملية موروثة.

بوابة القبول التشغيلي محجوبة: `/api/v1/health/redis` ما زال 503، و`/api/v1/health/gold` يعلن `isMockFallback=true`، وآخر quote في قاعدة البيانات أقدم من حد stale. كما أن تسجيل الدخول لم يُستكمل بعد محاولة سابقة واحدة مرفوضة؛ لم تتم إعادة المحاولة أو تجاوز المصادقة.

## الحماية والحدود

- Persistent target: `darfus_erp`، read-only في هذه الجولة.
- لم تُنفذ migration أو seed أو fixture أو POS/CGP/financial transaction.
- لم تُعد أي عملية موروثة التشغيل، ولم يُبدأ Next dev.
- لم تُحدّث `PROJECT_PROGRESS_HANDOFF.md` لأن البوابة ليست PASS_CONFIRMED.
- `next-env.d.ts` بقي دون لمس؛ SHA الحالي هو drift الموروث المعروف `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`، ولم يُصلح تلقائياً.

## التغييرات المنفذة

1. `hooks/use-core-erp-data.ts`: Dashboard Gold يستخدم `/gold/karat-prices?currency=AED` من خلال `apiClient` مع company/branch context، وrefresh كل 30 ثانية.
2. `features/dashboard/providers/local-provider.ts` و`features/dashboard/contracts/data-contracts.ts`: المصدر الحي canonical، وتغير النسبة غير المتاح أصبح `null` بدلاً من نسبة مصطنعة؛ لا تغيير في precision أو business rules.
3. `lib/types.ts` و`features/dashboard/components/gold-market-widget.tsx`: metadata للصحة/العمر/provider، وعرض وقت التحديث عبر helper مركزي.
4. `lib/dates/dates.ts` و`components/ui/date-input.tsx`: ثوابت وعروض `DD/MM/YYYY`، `DD/MM/YYYY HH:mm`، `HH:mm`، أرقام Latin، وتحويل آمن لمدخلات التاريخ دون تغيير قيمة API أو DB.
5. تم توحيد نقاط العرض في Gold Center، inventory detail، certificate/draft، receipt/history، settings users، suppliers، employees/payroll، notifications، reports، POS، وbarcode print إلى helpers المركزية حيث كانت نقاط العرض واضحة.
6. `scripts/verify-local-runtime-dashboard-numeral-date-fix.js`: verifier ساكن focused، بلا DB أو runtime mutation.
7. `backend/.env`: `REDIS_URL` محلي فقط، بلا credentials ولا تغيير في source.

## الاستراتيجية المركزية

- `UI_DATE_FORMAT=dd/MM/yyyy`، `UI_DATETIME_FORMAT=dd/MM/yyyy HH:mm`، `UI_TIME_FORMAT=HH:mm`.
- `formatDate` لا يطبق timezone shift على DATE-only؛ `formatDateTime` و`formatTime` يحافظان على `Asia/Dubai` semantics الحالية.
- `DateInput` يعرض `DD/MM/YYYY` ويدخل canonical `YYYY-MM-DD`؛ `DateTimeInput` يحافظ على boundary المحلية دون تحويل business date.
- `toEnglishDigits`/normalization الحالية تبقى presentation/input normalization فقط؛ لا تغيير في numeric precision أو backend types.

## الفحوصات الساكنة

- `node scripts/verify-local-runtime-dashboard-numeral-date-fix.js` = PASS.
- `npx tsc --noEmit` = PASS.
- `git diff --check` = PASS.
- لا توجد `toLocale*`/`Intl.DateTimeFormat` متبقية في نقاط العرض الأساسية التي عُدّلت؛ المتبقي في CSV/export وبعض numeric-only views لا يغير API/storage.
- لا توجد نسبة Gold static `1.2` أو trend `UP` في Dashboard provider؛ change percent غير المتاح `null`.

## Runtime / Redis / Gold

- Existing Redis listener: port 6379 reachable (`Test-NetConnection 127.0.0.1:6379 = True`)، ولم يبدأ Redis ثانٍ ولم يُمس listener الموروث.
- Backend boundary: Windows host Node `src/server.js`, PID 9336, port 8000; existing process start time unchanged.
- `GET /api/v1/health/db` = 200 UP.
- `GET /api/v1/health/redis` = 503 (runtime not ready).
- `GET /api/v1/health/gold` = 200 but `isMockFallback=true` (not acceptable as live proof).
- Persistent `gold_market_settings`: `GOLDAPI_IO`, `LIVE_PROVIDER`, `AED`, stale 120s, enabled.
- Latest persistent quote: `GOLDAPI_IO/AED`, status `VALID`, quote timestamp `2026-08-11T09:15:32.000Z`; canonical age exceeded 120s at inspection, therefore effective state is stale.
- Normal recurring worker/30-second refresh could not be proven because the inherited backend was not restarted and Redis health remained 503.

## Browser / login

- Existing login surface is reachable at `http://localhost:3000/ar/login`.
- One prior local credential attempt was rejected; no brute-force/retry, password reset, account creation, or secret persistence occurred.
- Authenticated dashboard, Gold Center, RTL visual proof, DOM digit counts, network smoke, and Gold Center SPOT consistency remain unverified.

## Persistent read-only evidence

Fresh `SELECT current_database()` returned `darfus_erp`. Read-only counts: migrations 80, Assets 53, Products 3. Journal integrity: unbalanced 0, orphan journal lines 0. Prior verified baseline also had unlinked cash 0, duplicate journal sources 0, duplicate treasury links 0, duplicate barcodes 0, empty barcodes 0, orphan RFID/profile refs/movements 0. No mutation occurred in this batch.

## Gate

The implementation/static portion is ready, but local runtime acceptance is not safe to claim while Redis is unhealthy and no valid login session is available. The next safe action is an owner-provided valid login plus a controlled restart of the normal local backend so it loads the already configured Redis URL; do not restart inherited processes automatically in this batch.

```text
CURRENT_BATCH = LOCAL-RUNTIME-DASHBOARD-NUMERAL-DATE-FIX-01
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO_NOT_REQUIRED
EXISTING_REDIS_CONTAINER = LISTENER_PRESENT_PORT_6379
CANONICAL_LOCAL_REDIS_URL_SHAPE = redis://127.0.0.1:6379
REDIS_URL_RESOLVES_FROM_CANONICAL_RUNTIME = NO_CURRENT_PROCESS_NOT_RELOADED
DUPLICATE_TEMP_REDIS_STARTED = NO
REDIS_GLOBAL_MUTATION = NO
NORMAL_LOCAL_GOLD_WORKER_RUNNING = NO_UNPROVEN
NORMAL_LOCAL_RECURRING_REFRESH = FAIL
REDIS_HEALTH = FAIL
GOLD_HEALTH = FAIL
GOLD_HEALTH_IS_MOCK_FALLBACK = YES
LATEST_QUOTE_STATUS = STALE
LOGIN_SMOKE = FAIL
LOCAL_LOGIN_PASSWORD_PERSISTED = NO
LOCAL_LOGIN_PASSWORD_EXPOSED = NO
AUTHENTICATED_DASHBOARD_SMOKE = FAIL
UI_DATE_FORMAT = DD/MM/YYYY
UI_DATETIME_FORMAT = DD/MM/YYYY HH:mm
UI_TIME_FORMAT = HH:mm
UI_DATE_DIGITS = LATIN_0_9
INTERNAL_DATE_STORAGE_FORMAT_CHANGED = NO
DATE_ONLY_TIMEZONE_SHIFT = NO
DATE_INPUT_IMPLEMENTATION_INVENTORY = components/ui/date-input.tsx; GoldPurchaseDraftWorkspace; CertificatePanel; remaining legacy native date controls inventoried for follow-up
DATE_INPUT_VISIBLE_FORMAT = DD/MM/YYYY
DATE_INPUT_SUBMISSION_CONTRACT_CHANGED = NO
DATE_PLACEHOLDER_STANDARD = DD/MM/YYYY
DATE_FORMATTING_ENTRYPOINTS = lib/dates/dates.ts; formatDate; formatDateTime; formatTime; formatBranchDateTime
DATE_FORMAT_STRATEGY = CENTRALIZED_PRESENTATION_HELPERS
INVALID_DATE_UI_REGRESSION = PASS_STATIC
DATE_RANGE_FILTER_SEMANTICS_CHANGED = NO
DOCUMENT_DATE_VALUES_CHANGED = NO
POSTING_DATE_LOGIC_CHANGED = NO
TIMESTAMP_SORTING_CHANGED = NO
DATE_SORT_USES_RAW_VALUE = YES
EXPORT_DATE_CONTRACT_CHANGED = NO
LATIN_DIGIT_STRATEGY = toEnglishDigits_plus_latin_locale_and_ltr_date_inputs
DISPLAY_DIGIT_NORMALIZATION = SAFE_PRESENTATION_ONLY
NUMERIC_INPUT_ARABIC_DIGITS_NORMALIZED = YES
BUSINESS_NUMERIC_PRECISION_CHANGED = NO
VISIBLE_ARABIC_INDIC_DIGIT_MATCHES_AFTER = NOT_BROWSER_COUNTED_LOGIN_BLOCKED
VISIBLE_EASTERN_ARABIC_DIGIT_MATCHES_AFTER = NOT_BROWSER_COUNTED_LOGIN_BLOCKED
VISIBLE_NONSTANDARD_DATE_MATCHES_AFTER = NOT_BROWSER_COUNTED_LOGIN_BLOCKED
DATE_INPUT_VALIDATION_TESTS = PASS_STATIC
DATE_ONLY_ROUNDTRIP = PASS_STATIC
DATETIME_PRESENTATION_TEST = PASS_STATIC
DATE_SORT_REGRESSION = PASS_STATIC
DASHBOARD_GOLD_WIDGET_SOURCE_BEFORE = LOCAL_PROVIDER_SNAPSHOT_STATIC_PERCENT
DASHBOARD_GOLD_WIDGET_SOURCE_AFTER = CANONICAL_API_GOLD_KARAT_PRICES
DASHBOARD_GOLD_WIDGET_CANONICAL_SOURCE = YES_STATIC
DASHBOARD_GOLD_REFERENCE_BASIS = SPOT
DASHBOARD_GOLD_NO_DOUBLE_PURITY = PASS_STATIC
DASHBOARD_RANDOM_GOLD_FALLBACK = DISABLED_FOR_WIDGET
DASHBOARD_REFRESH_DOES_NOT_BYPASS_CANONICAL_RUNTIME = PASS_STATIC
DASHBOARD_GOLD_PERCENT_CHANGE_SOURCE = NONE_UNAVAILABLE
DASHBOARD_GOLD_PERCENT_CHANGE_IS_REAL = NO_REMOVED_OR_HIDDEN
DASHBOARD_REVIEW_COMPLETE = NO_LOGIN_BLOCKED
DASHBOARD_GOLD_BROWSER = FAIL_BLOCKED
DASHBOARD_GOLD_CENTER_SPOT_CONSISTENCY = NOT_VERIFIED
DASHBOARD_DATE_FORMAT = PASS_STATIC
GOLD_CENTER_DATE_FORMAT = PASS_STATIC
POS_DATE_FORMAT = PASS_STATIC
SALES_CGP_DATE_FORMAT = PASS_STATIC
ACCOUNTING_DATE_FORMAT = NOT_FULLY_VERIFIED
INVENTORY_DATE_FORMAT = PASS_STATIC
CRM_SUPPLIER_SETTINGS_DATE_FORMAT = PASS_STATIC
DASHBOARD_LATIN_DIGITS = PASS_STATIC
GOLD_CENTER_LATIN_DIGITS = PASS_STATIC
POS_LATIN_DIGITS = PASS_STATIC
SALES_CGP_LATIN_DIGITS = PASS_STATIC
ACCOUNTING_LATIN_DIGITS = PASS_STATIC
INVENTORY_LATIN_DIGITS = PASS_STATIC
CRM_SUPPLIER_SETTINGS_LATIN_DIGITS = PASS_STATIC
ARABIC_RTL_REGRESSION = NOT_BROWSER_VERIFIED
GLOBAL_ARABIC_DIRECTION_CHANGED = NO
BACKEND_NUMERIC_TYPES_DEGRADED_TO_STRINGS = NO
BACKEND_DATE_TYPES_DEGRADED_FOR_PRESENTATION = NO
PERSISTENT_SYNTHETIC_BUSINESS_TRANSACTIONS = 0
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
NEW_PERSISTENT_JOURNALS_THIS_BATCH = 0
NEW_PERSISTENT_TREASURY_ROWS_THIS_BATCH = 0
PERSISTENT_ASSET_COUNT_UNEXPECTED_DELTA = 0
GOLD_CENTER_MAKING_REGRESSION = BLOCKED
POS_MAKING_REGRESSION = BLOCKED
LEGACY_POS_MISSING_SELLING_GOLD_RATE_REGRESSION = BLOCKED
POS_CHECKOUT_REGRESSION = BLOCKED
CGP_LIVE_PRICING_REGRESSION = BLOCKED
BROWSER_NETWORK_SMOKE = FAIL
BROWSER_CONSOLE_CRITICAL_ERRORS = 0_OBSERVED_ON_LOGIN_SURFACE
DATE_FORMATTER_TESTS = PASS
LATIN_DIGIT_FORMATTER_TESTS = PASS
DASHBOARD_GOLD_TESTS = PASS_STATIC
GOLD_LIVE_REGRESSION = BLOCKED
TYPESCRIPT = PASS
GIT_DIFF_CHECK = PASS
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
LOCAL_RUNTIME_DASHBOARD_NUMERAL_DATE_FIX_01_GATE = BLOCKED_BY_SAFE_FRONTEND_RUNTIME
LOCAL_PRODUCTION_SMOKE_STATUS = READY_FOR_RETRY_IF_PASS
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_BATCH = LOCAL-PRODUCTION-SMOKE-01-RETRY
```
