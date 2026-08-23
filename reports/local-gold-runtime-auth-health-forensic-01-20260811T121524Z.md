# LOCAL-GOLD-RUNTIME-AUTH-HEALTH-FORENSIC-01

## النتيجة

الفحص أثبت أن مسار normal backend يستخدم المصدر canonical والـadapter والـheader
الصحيحين، لكن GoldAPI يرفض الطلب الحالي بـHTTP 403 بسبب تجاوز الحصة الشهرية.
لا يوجد اختلاف import-order أو header أو provider wiring، ولم يتم تغيير المفتاح.
كما أن `/health/gold` ما زال legacy ويعتمد `GOLD_API_KEY` و`goldService`، لذلك
يعرض `isMockFallback=true` رغم وجود إعداد LIVE_PROVIDER canonical. لم يتم تعديل
المسار لأن nodemon يراقب ملفات backend، وأي تعديل سيؤدي إلى إعادة تشغيل تلقائية
ممنوعة في هذه الدفعة.

## Backend / environment

- العملية الحالية: PID `25980`، parent nodemon PID `25432`، المنفذ `8000`.
- command: `node src/server.js` عبر `nodemon src/server.js`.
- CWD مثبت بالمسار النسبي: `H:\WORK\jewellery-erp-master\backend` (لا يوجد
  `src/server.js` في جذر المستودع).
- `server.js` ينفذ `require("dotenv").config()` قبل تحميل التطبيق والـregistry
  والـruntime؛ لا يوجد import-time capture للسر.
- المصدر الطبيعي: `backend/.env` عبر dotenv من CWD الـbackend.
- `GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY`: موجود، غير فارغ، غير placeholder،
  بلا CR/LF أو whitespace contamination. لم تتم طباعة القيمة أو طولها أو hashها.
- `REDIS_URL`: موجود في المصدر الطبيعي، وRedis متصل فعلياً.

## Successful مقابل failing auth context

المسار الناجح السابق في `gold-live-feed-06a-live-acceptance.js` حمّل
`backend/.env` صراحةً (`override: true`) من CWD الـbackend، ثم استخدم نفس
`GoldApiIoAdapter`، endpoint `https://www.goldapi.io/api/XAU/AED`، وheader
`x-access-token`؛ وسجل HTTP 200 ودورتين ناجحتين.

المسار الفاشل الحالي هو normal backend PID `25980`، بنفس CWD والمصدر والـadapter
والـendpoint والـheader. الاتصال المباشر الحالي عبر نفس الـadapter، ثم اتصال خام
واحد لغرض sanitised evidence، أعادا HTTP `403` برسالة provider:
`Monthly API quota exceeded. Upgrade to Unlimited reqs/month plan.`

الفرق المثبت هو حالة حساب/حصة GoldAPI الحالية، لا اختلاف runtime secret source.
التقرير السابق أثبت أن ملف البيئة تغيّر خارج الدفعة السابقة؛ لا يمكن إعادة بناء
القيمة القديمة دون كشف سر. هذا يصنف السبب كـ`PROVIDER_PLAN_ACCOUNT_RESTRICTION`.

## GoldAPI contract

المسار الرسمي هو `GET https://www.goldapi.io/api/XAU/AED` مع server-only
`x-access-token`؛ صيغة endpoint واسم header مطابقان للمصدر الرسمي
([GoldAPI XAU/AED cURL](https://www.goldapi.io/price/XAU/AED/curl)).
الـ403 الحالي صادر من provider نفسه وبـbody sanitized أعلاه، وليس من التطبيق.

## Redis / scheduler / runtime

- container `darfus-redis`: `PING = PONG`.
- `/api/v1/health/redis`: HTTP 200.
- BullMQ scheduler count: `1`.
- repeat interval: `30000ms` (30 seconds).
- worker failures: latest failed jobs carry `failedReason=GOLDAPI_IO_AUTH_ERROR`
  with scope `GOLDAPI_IO/AED/XAU`; worker is running and retrying.
- no `FLUSHALL`, `FLUSHDB`, scheduler deletion, or Redis container recreation.

## Quote forensic: 4 → 13

قبل هذا التشغيل كانت 4 rows. الحالة الحالية 13 rows، أي 9 rows جديدة. الفحص
المباشر للصفوف المنشأة بين 11:35 و11:40 UTC أثبت: `n=9`، و`distinct_hashes=9`،
و`distinct_timestamps=9`، وجميعها `provider=GOLDAPI_IO`, `metal=XAU`,
`currency=AED`, `status=VALID`, `quality=OFFICIAL_RESPONSE`.

| row id | quote timestamp | classification |
|---|---|---|
| `f112d2df-cf4e-450c-b196-0973fcf91f0e` | 11:35:33Z | A VALID_REAL_PROVIDER_QUOTE |
| `e0418b04-849e-4214-b302-0eb7a46ae493` | 11:36:02Z | A VALID_REAL_PROVIDER_QUOTE |
| `89ae8782-f220-436e-b9f3-14dbc16dca24` | 11:36:32Z | A VALID_REAL_PROVIDER_QUOTE |
| `78c8b8ec-bb73-4f84-b388-f9654795a08a` | 11:37:03Z | A VALID_REAL_PROVIDER_QUOTE |
| `954cffdc-0be0-425a-8150-ff5701109fb3` | 11:37:33Z | A VALID_REAL_PROVIDER_QUOTE |
| `aedf5ec0-90e2-4d48-ba30-3d2a1075b292` | 11:38:02Z | A VALID_REAL_PROVIDER_QUOTE |
| `b940d01b-9c62-4927-8777-4db00e38bbb6` | 11:38:32Z | A VALID_REAL_PROVIDER_QUOTE |
| `6d8a05ff-8ab0-4f3a-8e7b-220407523d99` | 11:39:02Z | A VALID_REAL_PROVIDER_QUOTE |
| `0de5a62f-f3f6-4fc3-85a0-c80d84d88607` | 11:39:33Z | A VALID_REAL_PROVIDER_QUOTE |

الصفوف التسعة ليست placeholders أو mock أو copies. الصف الأخير هو أحدث quote،
وسجل `spot=517.69846836`, `bid=517.6228916`, `ask=517.7031913` و18K/21K/22K/24K
مباشرة من provider. محاولات 403 اللاحقة لم تنشئ rows. عند آخر قراءة
`2026-08-11T12:18:25Z` كان عمر أحدث quote نحو `2333` ثانية، أي `STALE`
بوضوح مقابل stale threshold البالغ 120 ثانية.

## Persistence / selector safety

ترتيب `refreshOnce` هو: provider HTTP success → normalize → validate →
`ingestNormalizedQuote` → repository insert. لذلك:

- `QUOTE_PERSISTED_BEFORE_PROVIDER_SUCCESS = NO`.
- `AUTH_FAILURE_CREATES_MARKET_QUOTE = NO`.
- لا توجد rows invalid/partial/mock في الدفعة الجديدة.
- selector يقيّد company/provider/metal/currency، وpricing policy ترفض status
  غير VALID أو quote stale قبل حساب السعر. في الحالة الحالية لا يمكن لrow غير صالح
  أن يصبح pricing authority.
- stale quote الحالي يحجب CGP كما هو مطلوب؛ لا يوجد provider HTTP داخل CGP Posting.

## `/health/gold`

المصدر الحالي قبل الإصلاح هو `backend/src/routes/index.js` ثم
`goldService.getLivePrice()` من `backend/src/services/gold.service.js`، مع
`GOLD_API_KEY` وfallback عشوائي legacy. لهذا السبب عاد endpoint HTTP 200 مع
`isMockFallback=true` وsample rates غير canonical.

الحد الأدنى الآمن لاحقاً: استبدال هذا المسار بقراءة provider-neutral من
`GoldMarketSetting` و`GoldMarketQuote`/freshness وprovider registry، مع الحفاظ على
الـresponse envelope للتوافق، ومن دون network write أو mock price. لم يتم تنفيذ
هذا التعديل في هذه الدفعة لأن العملية الحالية تحت nodemon ولا يُسمح بإعادة تشغيل
تلقائية؛ سيحتاج Owner إلى إعادة تشغيل backend بعد أي تعديل.

## Persistent read-only evidence

تم التحقق بـ`SELECT current_database()` من `darfus_erp` فقط. العدادات الحالية:

`migrations=80, Assets=53, Products=3, Customers=1, CGPs=2, Invoices=13,
Journals=67, JournalLines=176, CashTransactions=50, market_quotes=13,
market_settings=1, pricing_policies=1`.

الـcanonical signed-ledger الحالي: Cash `0.003`، Bank `20416.405`؛ وهو نفس
baseline الموثق قبل هذه الدفعة. integrity: unbalanced journals `0`، orphan
journal lines `0`، unlinked treasury `0`، duplicate journal sources `0`،
duplicate treasury links `0`، duplicate/blank barcodes `0`، orphan RFID `0`.
لم ينشأ Journal أو Treasury أو Asset أو Product أو Customer أو CGP أو Sale جديد.
الزيادة الوحيدة المسموح بها هي 9 market quote rows حقيقية من worker قبل ظهور
رفض الحصة؛ لم تُحذف أي row تاريخية.

## Validation

- provider/secret/header/refresh/quote selector/health-policy unit tests: `21/21 PASS`.
- Gold Center canonical reference contract: `PASS`.
- making-charge/POS contract: `PASS`.
- Gold live feed contract: `PASS`.
- `npx tsc --noEmit`: `PASS`.
- `git diff --check`: `PASS` (تحذيرات CRLF موروثة فقط).
- `NEXT_ENV_CURRENT_SHA` بقي `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`؛
  هذا drift موروث ولم يُمس.
- Login/date controls لم تُمس (`LOGIN_CHANGED_THIS_BATCH=NO`,
  `DATE_CONTROLS_CHANGED_THIS_BATCH=NO`).

## Safe next action

Owner must resolve GoldAPI account quota/plan (or explicitly replace the same
canonical secret outside this task), then manually restart the normal backend.
After that, rerun two 30-second successful refreshes, canonical health, and the
blocked local smoke gates. لا تبديل provider، ولا fallback، ولا migration، ولا
حذف quote rows.

## Tokens

```text
CURRENT_BATCH = LOCAL-GOLD-RUNTIME-AUTH-HEALTH-FORENSIC-01
PERSISTENT_DATABASE = darfus_erp
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO_NOT_REQUIRED
CURRENT_BACKEND_PID = 25980
CURRENT_BACKEND_PORT = 8000
CURRENT_BACKEND_CWD = H:\WORK\jewellery-erp-master\backend
CURRENT_BACKEND_START_COMMAND = nodemon src/server.js -> node src/server.js
NORMAL_BACKEND_ENV_SOURCE = backend/.env via dotenv from backend cwd
NORMAL_BACKEND_SECRET_CONFIGURED = YES
NORMAL_BACKEND_REDIS_CONFIGURED = YES
SUCCESSFUL_AUTH_CONTEXT = 06A explicit backend/.env override:true; same adapter; XAU/AED; x-access-token; HTTP 200
FAILING_AUTH_CONTEXT = PID 25980 normal backend; same source/adapter/endpoint/header; provider HTTP 403 quota exceeded
CONTEXT_DIFFERENCE_IDENTIFIED = YES
SECRET_VALUE_NONEMPTY = YES
SECRET_VALUE_PLACEHOLDER = NO
SECRET_VALUE_HAS_EMBEDDED_NEWLINE = NO
SECRET_VALUE_HAS_WHITESPACE_CONTAMINATION = NO
PROVIDER_IS_CONFIGURED_IN_NORMAL_RUNTIME = YES
NORMAL_RUNTIME_ENV_INITIALIZATION_ORDER = PASS
IMPORT_TIME_SECRET_CAPTURE = NO
NORMAL_RUNTIME_GOLDAPI_HEADER_NAME = x-access-token
NORMAL_RUNTIME_AUTH_HEADER_CONSTRUCTION = PASS
OFFICIAL_GOLDAPI_AUTH_CONTRACT = PASS
CURRENT_AUTH_FAILURE_HTTP_STATUS = 403
CURRENT_AUTH_FAILURE_PROVIDER_RESPONSE = Monthly API quota exceeded; upgrade to Unlimited reqs/month plan
CURRENT_AUTH_FAILURE_INTERNAL_CODE = GOLDAPI_IO_AUTH_ERROR
AUTH_ERROR_OBSERVABILITY = SUFFICIENT
NEW_QUOTE_ROWS_ANALYZED = 9
NEW_QUOTE_ROW_CLASSIFICATION_SUMMARY = 9 VALID_REAL_PROVIDER_QUOTE; 0 duplicate/copy/placeholder/partial/mock
QUOTE_PERSISTED_BEFORE_PROVIDER_SUCCESS = NO
AUTH_FAILURE_CREATES_MARKET_QUOTE = NO
INVALID_QUOTE_ROWS_FOUND = NO
INVALID_QUOTE_CAN_BECOME_PRICING_AUTHORITY = NO
HISTORICAL_QUOTE_ROWS_DELETED_THIS_BATCH = 0
GOLD_HEALTH_SOURCE_BEFORE = routes/index.js -> goldService.getLivePrice -> legacy GOLD_API_KEY/fallback
GOLD_HEALTH_CANONICAL_PROVIDER_SOURCE = NO
GOLD_HEALTH_LEGACY_GOLD_API_KEY_DEPENDENCY = YES
GOLD_HEALTH_SIDE_EFFECT_FREE = NO
GOLD_HEALTH_RANDOM_FALLBACK = ENABLED
AUTH_ROOT_CAUSE_CLASS = PROVIDER_PLAN_ACCOUNT_RESTRICTION
AUTH_ROOT_CAUSE_IDENTIFIED = YES
CANONICAL_GOLDAPI_SECRET_ENV_NAME = GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY
ALTERNATE_SECRET_VARIABLE_ADDED = NO
API_KEY_CHANGED_THIS_BATCH = NO
SECRET_EXPOSED_THIS_BATCH = NO
PROVIDER_CHANGED_THIS_BATCH = NO
PRODUCTION_PRICING_POLICY_CHANGED = NO
CGP_BASE_QUOTE_AFTER = BID
CGP_ADJUSTMENT_AFTER = NONE_0
FAILED_PROVIDER_REQUEST_PERSISTS_NEW_QUOTE_AFTER_FIX = NOT_APPLICABLE
BACKEND_RESTART_REQUIRED_FOR_FIX = YES
DIRECT_CANONICAL_AUTH_TEST = FAIL
DIRECT_CANONICAL_AUTH_REQUEST_COUNT = 2
REAL_RECURRING_REFRESH_AFTER_FIX = NOT_RUN
LATEST_QUOTE_STATUS_AFTER_FIX = STALE
LATEST_QUOTE_AGE_UNDER_120_AFTER_FIX = FAIL
EFFECTIVE_CGP_RATE_RECOVERS_AFTER_FIX = FAIL
REDIS_HEALTH_AFTER_FIX = PASS
GOLD_HEALTH_AFTER_FIX = NOT_RUN
GOLD_HEALTH_IS_MOCK_FALLBACK_AFTER_FIX = NOT_RUN
LOGIN_CHANGED_THIS_BATCH = NO
DATE_CONTROLS_CHANGED_THIS_BATCH = NO
STALE_QUOTE_BLOCKS_CGP = YES
CGP_POSTING_EXTERNAL_HTTP_REQUESTS = 0
POSTED_CGP_REPRICED = NO
GOLD_CENTER_CANONICAL_REFERENCE_REGRESSION = PASS
DASHBOARD_CANONICAL_REFERENCE_REGRESSION = PASS
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
NEW_PERSISTENT_JOURNALS_THIS_BATCH = 0
NEW_PERSISTENT_TREASURY_ROWS_THIS_BATCH = 0
UNBALANCED_JOURNALS_NEW = 0
ORPHAN_JOURNAL_LINES_NEW = 0
UNLINKED_TREASURY_NEW = 0
PERSISTENT_ASSET_COUNT_UNEXPECTED_DELTA = 0
DUPLICATE_BARCODES_NEW = 0
EMPTY_BARCODES_NEW = 0
REDIS_GLOBAL_MUTATION = NO
GOLD_AUTH_RUNTIME_TESTS = PASS
TYPESCRIPT = PASS
GIT_DIFF_CHECK = PASS
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
LOCAL_GOLD_RUNTIME_AUTH_HEALTH_FORENSIC_01_GATE = BLOCKED
LOCAL_PRODUCTION_SMOKE_STATUS = WAIT_FOR_GOLD_RUNTIME_AND_LOGIN_DATE_GATES
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_BATCH = LOCAL-PRODUCTION-SMOKE-01-RETRY_AFTER_OWNER_GOLDAPI_ACCOUNT_REMEDIATION_AND_MANUAL_BACKEND_RESTART
```
