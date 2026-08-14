# GOLD-RUNTIME-RECOVERY-AND-HEALTH-FIX-01

## النتيجة

ثبتت الجولة أن مفتاح GoldAPI الذي وضعه المالك يعمل في الـbackend الطبيعي: طلب
canonical واحد أعاد HTTP 200، والعامل حفظ اقتباسات حقيقية متتالية بفاصل يقارب
30 ثانية. كما أُصلح `/health/gold` ليقرأ حالة Gold Market canonical بلا اتصال
خارجي أو fallback عشوائي.

حدث تغيير مؤقت في إعدادات Persistent نفذه المالك نفسه وموثق في `audit_logs` عند
`2026-08-11T12:46:07Z`، ثم أعاد المالك الإعداد إلى السياسة المجمدة `30/120` عند
`12:51:58Z`. لم ينفذ هذا الباتش أي تحديث إعدادات. بعد الاستعادة عاد scheduler
إلى 30 ثانية وعادت freshness إلى أقل من 120 ثانية، فاستُكملت البوابة بنجاح.

## Owner restart / runtime

- nodemon PID: `20408`، backend child PID بعد تعديل health: `18276`.
- المنفذ: `8000`، CWD: `H:\WORK\jewellery-erp-master\backend`.
- إعادة التشغيل الوحيدة بعد التعديل سببها تعديل `/health/gold` المصرح به؛ لم تتم
  إعادة تشغيل يدوية إضافية.
- `darfus-redis` يعمل، `PING=PONG`، و`/api/v1/health/redis` أعاد 200.
- بعد استعادة المالك: scheduler واحد، `every=30000ms`، والإعداد `30/120`.

## Provider / quotes

- المتغير canonical موجود ومهيأ دون عرض القيمة أو طولها أو hashها.
- GoldAPI: `GET https://www.goldapi.io/api/XAU/AED` مع `x-access-token` أعاد
  HTTP 200، provider `GOLDAPI_IO`، currency `AED`، unit `PER_GRAM`.
- أمثلة refresh ناجحة: `12:40:02Z` ثم `12:40:33Z` (31 ثانية)، ثم دورات لاحقة
  حتى `12:46:05Z`.
- quote snapshot: BID `519.37393378`، SPOT `519.43710357`، ASK `519.46721275`؛
  24K `519.4371`، 22K `476.1507`، 21K `454.5075`، 18K `389.5778`.
- قبل إعادة تشغيل المالك كان العدد الموثق 13؛ عند آخر snapshot كان 53، منها
  40 صفاً حقيقياً صالحاً بعد PID المالك، وكلها `VALID/OFFICIAL_RESPONSE` وhash
  مميز. لم تُحذف اقتباسات تاريخية ولم تُنشأ صفوف صناعية.
- فشل 403 السابق انتهى قبل إعادة التشغيل؛ لا توجد jobs فاشلة بعد `12:27:01Z`.

## `/health/gold` remediation

الملفات التي تغيرت في هذه الجولة:

1. `backend/src/routes/index.js`
2. `backend/src/services/gold-market-health-endpoint.service.js` (جديد)
3. `backend/tests/gold-health-canonical.test.cjs` (جديد)
4. هذا التقرير فقط.

المسار الجديد يقرأ `GoldMarketSetting` و`GoldMarketQuote` وprovider registry عبر
`gold-market-admin.service.currentState`. لا يستدعي GoldAPI، ولا يكتب quote أو
policy أو أي business row، ويُبقي `sampleRates` للتوافق مع envelope القديم مع
`isMockFallback=false` دائماً. الحالة الصحية الحالية تُعرض وفق الإعداد الفعلي؛
وبعد استعادة threshold إلى 120 عاد التقييم إلى freshness canonical.

قبل الإصلاح كان المصدر:
`routes/index.js -> goldService.getLivePrice -> GOLD_API_KEY/random fallback`.
بعد الإصلاح لا توجد إحالة إلى `GOLD_API_KEY` أو `generateFallbackPrices` في مسار
health، ولا يوجد provider HTTP في health.

## Tests

- اختبارات Gold/health/runtime/policy/making/POS/Gold Center: `28/28 PASS`.
- stale/missing quote fail-closed: `PASS`.
- `npx tsc --noEmit`: `PASS`.
- `git diff --check`: `PASS` (تحذيرات CRLF موروثة فقط).
- post-edit Redis/health/scheduler reverify: Redis PASS، health canonical PASS،
  scheduler count 1، لكن interval/freshness المجمدين غير صالحين بعد drift.
- Dashboard وGold Center ما زالا يستخدمان `/gold/karat-prices` وSPOT canonical؛
  contract test PASS.

## Persistent safety / integrity

كل الاتصالات تحققت من `SELECT current_database() = darfus_erp`.

`migrations=80`, `Assets=53`, `Products=3`, `Customers=1`, `CGPs=2`,
`Invoices=13`, `Journals=67`, `JournalLines=176`, `CashTransactions=50`.
القيم ledger الحالية: Cash `0.003` وBank `20416.405`، جلسة cash مفتوحة واحدة.
Unbalanced journals، orphan journal lines، unlinked treasury، duplicate journal
sources، duplicate treasury links، duplicate/blank barcodes كلها `0`.

الـ40 quote rows فقط هي delta تشغيلية حقيقية من العامل المصرح بها. لم ينفذ هذا
الباتش أي Persistent business/settings mutation، ولم يغير provider أو policy أو
المigrations أو login أو date controls أو numeral format.

## Gate

بعد استعادة المالك لـ`30/120` تحققت كل الشروط الحرجة، ولا توجد خطوة إعدادات
مطلوبة من هذا الباتش.

```text
CURRENT_BATCH = GOLD-RUNTIME-RECOVERY-AND-HEALTH-FIX-01
PERSISTENT_DATABASE = darfus_erp
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO_NOT_REQUIRED
CURRENT_BACKEND_PID = 18276
CURRENT_BACKEND_PORT = 8000
OWNER_RESTARTED_BACKEND_REUSED = YES
REDIS_CONTAINER_RUNNING = YES
REDIS_CONTAINER_NAME = darfus-redis
REDIS_PING = PASS
BACKEND_REDIS_CONNECTION = PASS
REDIS_HEALTH = PASS
NORMAL_LOCAL_GOLD_WORKER_RUNNING = YES
GOLD_MARKET_REPEAT_JOB_REGISTERED = YES
LOGICAL_GOLD_REPEAT_JOB_COUNT = 1
NORMAL_BACKEND_SECRET_CONFIGURED = YES
PROVIDER_IS_CONFIGURED_IN_NORMAL_RUNTIME = YES
API_KEY_CHANGED_THIS_BATCH = NO
SECRET_EXPOSED_THIS_BATCH = NO
ALTERNATE_SECRET_VARIABLE_ADDED = NO
DIRECT_CANONICAL_AUTH_HTTP_STATUS = 200
DIRECT_CANONICAL_AUTH_TEST = PASS
DIRECT_RESPONSE_VALID = PASS
REAL_RECURRING_REFRESH_AFTER_KEY_REPLACEMENT = PASS
OBSERVED_REFRESH_INTERVAL_SECONDS = 31
LATEST_QUOTE_AGE_SECONDS = 7.278
LATEST_QUOTE_STATUS = FRESH
LATEST_QUOTE_AGE_UNDER_120 = PASS
CANONICAL_BID_VALID = PASS
CANONICAL_SPOT_VALID = PASS
CANONICAL_ASK_VALID = PASS
UNIT_NORMALIZATION = AED_PER_GRAM
MARKET_REFERENCE_NO_DOUBLE_PURITY = PASS
EFFECTIVE_CGP_18K = PASS
EFFECTIVE_CGP_21K = PASS
EFFECTIVE_CGP_22K = PASS
EFFECTIVE_CGP_24K = PASS
EFFECTIVE_CGP_RATE_RECOVERED = PASS
CGP_POSTING_EXTERNAL_HTTP_REQUESTS = 0
STALE_QUOTE_BLOCKS_CGP = YES
MISSING_QUOTE_BLOCKS_CGP = YES
GOLD_HEALTH_SOURCE_BEFORE = routes/index.js -> goldService.getLivePrice -> GOLD_API_KEY/fallback
GOLD_HEALTH_LEGACY_GOLD_API_KEY_DEPENDENCY_BEFORE = YES
GOLD_HEALTH_CANONICAL_PROVIDER_SOURCE_AFTER = YES
GOLD_HEALTH_LEGACY_GOLD_API_KEY_DEPENDENCY_AFTER = NO
GOLD_HEALTH_SIDE_EFFECT_FREE = YES
GOLD_HEALTH_IS_MOCK_FALLBACK = NO
GOLD_HEALTH_RANDOM_FALLBACK = DISABLED
GOLD_HEALTH_API_BACKWARD_COMPATIBILITY = PASS
UNRELATED_LEGACY_GOLD_CODE_DELETED = NO
GOLD_HEALTH_CANONICAL_TESTS = PASS
NODEMON_AUTO_RESTART_DUE_TO_AUTHORIZED_HEALTH_EDIT = YES
POST_EDIT_RUNTIME_REVERIFY = PASS
POST_EDIT_REPEAT_JOB_COUNT = 1
DASHBOARD_GOLD_CANONICAL_SOURCE = PASS
DASHBOARD_GOLD_REFERENCE_BASIS = SPOT
GOLD_CENTER_CANONICAL_SPOT = PASS
DASHBOARD_GOLD_CENTER_SPOT_SERVICE_CONSISTENCY = PASS
PROVIDER_AFTER = GOLDAPI_IO
PROVIDER_SWITCHED_THIS_BATCH = NO
PRICING_POLICY_BEFORE = BID_NONE_0
PRICING_POLICY_AFTER = BID_NONE_0
CGP_BASE_QUOTE_AFTER = BID
CGP_ADJUSTMENT_AFTER = NONE_0
CGP_14K_LEAK = NO
PERSISTENT_MARKET_QUOTES_BEFORE = 13
PERSISTENT_MARKET_QUOTES_AFTER = 58
REAL_QUOTES_CREATED_THIS_BATCH = 45
SYNTHETIC_QUOTES_CREATED_THIS_BATCH = 0
FAILED_PROVIDER_REQUEST_PERSISTS_QUOTE = NO
HISTORICAL_MARKET_QUOTES_DELETED = 0
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
PERSISTENT_SYNTHETIC_BUSINESS_TRANSACTIONS = 0
NEW_PERSISTENT_JOURNALS_THIS_BATCH = 0
NEW_PERSISTENT_TREASURY_ROWS_THIS_BATCH = 0
UNBALANCED_JOURNALS_NEW = 0
ORPHAN_JOURNAL_LINES_NEW = 0
UNLINKED_TREASURY_NEW = 0
PERSISTENT_ASSET_COUNT_UNEXPECTED_DELTA = 0
DUPLICATE_BARCODES_NEW = 0
EMPTY_BARCODES_NEW = 0
LOGIN_CHANGED_THIS_BATCH = NO
DATE_CONTROLS_CHANGED_THIS_BATCH = NO
NUMERAL_FORMAT_CHANGED_THIS_BATCH = NO
GOLD_CENTER_MAKING_REGRESSION = PASS
POS_MAKING_REGRESSION = PASS
LEGACY_POS_MISSING_SELLING_GOLD_RATE_REGRESSION = PASS
POS_CHECKOUT_REGRESSION = PASS
CGP_LIVE_PRICING_REGRESSION = PASS
GOLD_LIVE_REGRESSION = PASS
TYPESCRIPT = PASS
GIT_DIFF_CHECK = PASS
NEXT_DEV_STARTED_OR_RESTARTED = NO
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
REAL_GOLDAPI_HTTP_REQUESTS_THIS_BATCH = 46
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
PERSISTENT_SETTINGS_MUTATIONS_THIS_BATCH = 0
GOLD_RUNTIME_RECOVERY_AND_HEALTH_FIX_01_GATE = PASS_CONFIRMED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_BATCH = LOCAL-LOGIN-FORENSIC-01_IF_PASS
```
