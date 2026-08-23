# GOLDAPI-AUTH-FORENSIC-01

## 1. النتيجة والحدود

- هذه دفعة فحص مصادقة مركّز فقط. لم يتغير المفتاح، ولم يتغير Provider أو
  سياسة التسعير أو العملة أو إعدادات BID/NONE/0.
- لم يُشغّل Next dev، ولم تُجرَ Migration أو Seed أو Deployment أو اتصال Server.
- لم تُلمس قاعدة `darfus_redis`؛ استُخدمت حاوية Redis مؤقتة loopback فقط ثم
  أُوقفت وأُزيلت.
- لا توجد قيمة سر أو طول أو hash أو prefix/suffix أو header value في هذا التقرير.

## 2. سبب الفحص والسياق السابق

التشغيل السابق `GOLD-CENTER-REDIS-RUNTIME-01` أثبت أن Redis/BullMQ والجدولة
كل 30 ثانية يعملان، لكن كل دورة انتهت بالخطأ المعياري
`GOLDAPI_IO_AUTH_ERROR`. التقرير السابق حفظ الكود المعياري فقط، ولم يحفظ HTTP
status أو body الخام من GoldAPI؛ لذلك لا يمكن اختلاق status أو رسالة provider
تاريخية غير موجودة.

## 3. العقد الرسمي الحالي

المراجع الرسمية الحالية تؤكد:

- `GET https://www.goldapi.io/api/XAU/AED`
- المصادقة عبر header اسمه `x-access-token`.
- AED مسار عملة مدعوم، والطلب server-side هو النموذج الصحيح.

المراجع: [GoldAPI XAU/AED cURL](https://www.goldapi.io/price/XAU/AED/curl)،
[GoldAPI API](https://www.goldapi.io/).

## 4. المسار البرمجي

- `backend/src/server.js` يستدعي `require("dotenv").config()` قبل تحميل
  التطبيق وRegistry وRuntime، عند تشغيله من `backend`.
- Registry ينشئ `GoldApiIoAdapter` واحدًا؛ قراءة السر lazy داخل
  `configuredSecret()` و`fetchQuote()`، وليست قيمة ملتقطة وقت import.
- Test Connection يستخدم `testConnection()` ثم نفس `getProvider()` وadapter.
- العامل يستخدم `refreshCurrentSettings()` ثم `refreshOnce()` ثم نفس
  `getProvider()` وadapter.
- adapter يرسل `GET` إلى مسار XAU/AED مع `x-access-token` و`Accept` فقط، مع
  timeout قدره 5000ms. لا يوجد Bearer أو URL credential أو encoding إضافي.
- اختبار import قبل dotenv ثم تحميل dotenv بعده أثبت أن adapter لا يلتقط
  السر مبكرًا؛ `isConfigured()` يصبح صحيحًا بعد التحميل.

## 5. مصدر البيئة والمصادقة المنظّفة

- المصدر canonical: `H:\WORK\jewellery-erp-master\backend\.env`.
- Server وTest Connection والعامل في العملية نفسها يرثون `process.env` بعد
  dotenv من هذا المسار.
- التشغيل الحالي من `H:\WORK\jewellery-erp-master\backend`.
- `GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY` موجود وغير فارغ.
- لا placeholder، ولا CR/LF داخل القيمة، ولا whitespace/quote contamination.
- المتغيرات البديلة `GOLD_API_KEY` و`GOLDAPI_API_KEY` و`GOLDAPI_IO_API_KEY`
  غير موجودة كسلطة موازية.
- لا يوجد `HTTP_PROXY` أو `HTTPS_PROXY` أو `ALL_PROXY` أو custom agent في
  مسار الاختبار؛ لا دليل على stripping من proxy.

## 6. إعادة الاختبار المباشر المقيّد

الاستدعاء canonical المباشر الحالي أعاد:

- method: `GET`
- endpoint: `https://www.goldapi.io/api/XAU/AED`
- header name: `x-access-token`
- configured: `true`
- HTTP result: `200`
- adapter result: `PASS`

لم يظهر خطأ provider في هذا الاستدعاء، لذلك لا يوجد body فشل حالي لتسريبه.
الـhistorical adapter stack trace أيضًا لم يُحفظ؛ `parseError()` السابق كان
يُسقط response body ويعيد Error معياريًا.
الـhistorical failure status/body = `UNKNOWN / NOT_RETAINED`؛ المتاح فقط هو
`GOLDAPI_IO_AUTH_ERROR` المعياري من التشغيل السابق.

## 7. Test Connection

`testConnection()` canonical أعاد:

- provider: `GOLDAPI_IO`
- configured: `true`
- reachable: `true`
- normalized: `true`
- status: `HEALTHY`
- currency: `AED`
- capabilities: BID/SPOT/ASK، per-gram، direct currency، direct karat.

## 8. العامل والجدولة

استُخدمت حاوية مؤقتة `redis:7-alpine` باسم
`darfus-gold-auth-forensic-01-redis` مربوطة على `127.0.0.1:6380` فقط.
تم تسجيل scheduler واحد، ثم رُصد تشغيلان حقيقيان:

- دورة أولى مباشرة بعد التسجيل: HTTP `200`.
- دورة ثانية بعد نحو 30 ثانية: HTTP `200`.

إجمالي GoldAPI HTTP في هذه الدفعة: `5` (مباشر، دورتان عامل، Test Connection،
وتحديث canonical واحد للتحقق الفوري من freshness). لم تُستخدم `FLUSHALL` أو
`FLUSHDB`، وتمت إزالة الحاوية بعد الاختبار.

## 9. الفرق عن التشغيل الفاشل السابق

لا يوجد اختلاف في endpoint أو header أو adapter أو worker path. سكربت 06A كان
يحمّل `backend/.env` بمسار صريح و`override: true`، بينما server يعتمد على
dotenv الافتراضي من CWD؛ وفي التشغيل الحالي لم يوجد متغير canonical مسبق في
process environment. الفرق المثبت هو أن `backend/.env` تغيّر خارجيًا بعد التشغيل السابق (التقرير السابق سجل
hash مختلفًا ووقت التشغيل السابق أسبق من وقت تعديل الملف الحالي). لا يمكن من
النسخة الحالية إعادة بناء أي assignment بعينه في الملف السابق، لذلك لا يُدّعى
أن قيمة محددة أو إعدادًا بعينه هو الذي تغيّر. القيمة الحالية مقبولة من GoldAPI.

الاستنتاج: blocker كان حالة بيئة/credential تاريخية خارج هذه الدفعة، وليس خللًا
في header أو import order أو worker wiring. لا يوجد دليل مستقل على IP/plan
restriction، ولا حاجة لاستبدال المفتاح في هذه الدفعة.

## 10. Freshness وCGP

بعد تشغيل العامل ثم تحديث canonical واحد، كان:

- provider: `GOLDAPI_IO`
- currency: `AED`
- quote: `VALID`
- health أثناء التحقق الفوري: `HEALTHY`
- Effective CGP rates أثناء التحقق الفوري: 18K/21K/22K/24K كلها موجودة.
- لا `NOT_CONFIGURED` حاليًا.
- stale quote ما زال يحجب CGP عند تجاوز 120 ثانية؛ لم تُخفف قاعدة fail-closed.
- CGP Posting لم ينفذ أي HTTP خارجي (`0`).

بعد إيقاف العامل، قد يصبح quote stale طبيعيًا بعد 120 ثانية؛ هذا لا ينفي
نجاح freshness المرصود لحظة التحديث.

## 11. قاعدة البيانات والحماية

Persistent `darfus_erp` بقي على migration `80`. قبل العامل كانت counts:
Assets `53`، Products `3`، Customers `1`، CGP `2`، Journals `67`، JournalLines
`176`، Treasury `50`، Quotes `1`. بعد الدفعة أصبحت Quotes `4` بسبب ثلاث quote
updates الحقيقية المسموح بها؛ بقية counts لم تتغير. لا Journals أو Treasury أو
Assets أو CGP أو Products جديدة، ولا synthetic quote.

بعد التحقق read-only:

- unbalanced journals: `0`
- orphan journal lines: `0`
- unlinked treasury: `0`
- blank/duplicate barcodes: `0`
- orphan RFID/profile/event links: `0`
- current quote `VALID`, provider `GOLDAPI_IO`, currency `AED`.

الحسابات SYS-CASH وSYS-BANK لم تُكتب؛ القيم الحالية المقروءة هي `0.003` و
`20416.405`، ولم يتغير أي أثر مالي من هذه الدفعة. `PERSISTENT_BUSINESS_DATA_PRESERVED=PASS`.

## 12. الاختبارات والحماية

- Gold Live Feed/provider/worker/CGP/making/POS contracts: `33/33 PASS`.
- `npx tsc --noEmit`: `PASS`.
- `git diff --check`: `PASS`؛ تحذيرات CRLF موروثة فقط.
- `next-env.d.ts` بقي على SHA المعروف الموروث
  `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`؛ لم
  يُصلح أو يُعاد توليده.
- لا code fix أو schema/migration أو policy change أو legacy Gold Center change.

## 13. قرار الخروج

المسار البرمجي سليم، المصادقة الحالية ناجحة، والـhistorical auth failure
مرتبط بحالة بيئة تغيّرت خارج الدفعة ولا يمكن تفصيل assignment السابق من دون
كشف أو استعادة سر. لا حاجة إلى Owner key replacement داخل هذه الدفعة.

`GOLDAPI_AUTH_FORENSIC_GATE = PASS_CONFIRMED`

`GOLD_CENTER_LIVE_RUNTIME_FIX_01_GATE = PASS_CONFIRMED`

لا يبدأ أي batch تلقائيًا. الإجراء التالي المقترح هو Local Production Smoke
بعد قرار Owner مستقل، مع إبقاء المفتاح server-only وعدم طباعته.

## 14. Required tokens

```text
CURRENT_BATCH = GOLDAPI-AUTH-FORENSIC-01
PERSISTENT_DATABASE = darfus_erp
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER_BATCH = 80
MIGRATION_81_CREATED = NO_NOT_REQUIRED
CANONICAL_GOLDAPI_SECRET_ENV_NAME = GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY
SERVER_SECRET_CONFIGURED = YES
WORKER_SECRET_CONFIGURED = YES
TEST_CONNECTION_SECRET_CONFIGURED = YES
SERVER_ENV_SOURCE = backend/.env via dotenv from backend cwd
WORKER_ENV_SOURCE = inherited process.env from server dotenv load
TEST_CONNECTION_ENV_SOURCE = backend/.env via canonical server process / bounded script
SERVER_CWD = H:\WORK\jewellery-erp-master\backend
WORKER_CWD = H:\WORK\jewellery-erp-master\backend
TEST_CONNECTION_CWD = H:\WORK\jewellery-erp-master\backend
ENV_INITIALIZATION_ORDER_BUG = NO
WORKER_CWD_ENV_SOURCE_MISMATCH = NO
ALTERNATE_SECRET_VARIABLE_CONFLICT = NO
GOLDAPI_AUTH_HEADER_NAME = x-access-token
GOLDAPI_AUTH_HEADER_CONSTRUCTION = PASS
SECRET_VALUE_NONEMPTY = YES
SECRET_VALUE_PLACEHOLDER = NO
SECRET_VALUE_HAS_EMBEDDED_NEWLINE = NO
SECRET_VALUE_HAS_WHITESPACE_CONTAMINATION = NO
SECRET_EXPOSED_THIS_BATCH = NO
AUTH_FAILURE_HTTP_STATUS = UNKNOWN_NOT_RETAINED
AUTH_FAILURE_PROVIDER_RESPONSE = GOLDAPI_IO_AUTH_ERROR_ONLY; BODY_NOT_RETAINED
PROVIDER_KEY_STATUS_CLASS = UNKNOWN_AUTH_REJECTION (historical); CURRENT_KEY_ACCEPTED
PROVIDER_NETWORK_RESTRICTION_PROVEN = NO
OUTBOUND_PROXY_IN_USE = NO
PROXY_AUTH_HEADER_STRIPPING_PROVEN = NO
TEST_CONNECTION_AND_WORKER_USE_SAME_AUTH_PATH = YES
DIRECT_CANONICAL_CALL_RESULT = PASS
WORKER_CANONICAL_CALL_RESULT = PASS
SUCCESS_VS_FAILURE_DIFFERENCE_IDENTIFIED = YES
ROOT_CAUSE_IDENTIFIED = YES
ROOT_CAUSE_CLASS = EXTERNAL_ENVIRONMENT_CREDENTIAL_STATE_CHANGE
ROOT_CAUSE_LOCATION = backend/.env state outside this batch
API_KEY_CHANGED_THIS_BATCH = NO
PRODUCTION_PRICING_POLICY_CHANGED = NO
REDIS_GLOBAL_MUTATION = NO
REAL_GOLDAPI_HTTP_REQUESTS_THIS_BATCH = 5
AUTH_RETEST_AFTER_FIX = NOT_APPLICABLE
REAL_RECURRING_REFRESH_AFTER_AUTH = PASS
LATEST_QUOTE_FRESH_AFTER_AUTH = PASS
EFFECTIVE_CGP_RATE_RECOVERS_AFTER_AUTH = PASS
NOT_CONFIGURED_PRESENT_AFTER_AUTH = NO
STALE_QUOTE_BLOCKS_CGP = YES
CGP_POSTING_EXTERNAL_HTTP_REQUESTS = 0
LEGACY_GOLD_CENTER_CHANGED_THIS_BATCH = NO
GOLD_CENTER_MAKING_REGRESSION = PASS
POS_MAKING_REGRESSION = PASS
LEGACY_POS_MISSING_SELLING_GOLD_RATE_REGRESSION = PASS
POS_CHECKOUT_REGRESSION = PASS
GOLD_LIVE_AUTH_REGRESSION = PASS
CGP_LIVE_PRICING_REGRESSION = PASS
PERSISTENT_ASSETS_BEFORE = 53
PERSISTENT_ASSETS_AFTER = 53
PERSISTENT_PRODUCTS_BEFORE = 3
PERSISTENT_PRODUCTS_AFTER = 3
PERSISTENT_CGPS_BEFORE = 2
PERSISTENT_CGPS_AFTER = 2
PERSISTENT_JOURNALS_BEFORE = 67
PERSISTENT_JOURNALS_AFTER = 67
PERSISTENT_TREASURY_BEFORE = 50
PERSISTENT_TREASURY_AFTER = 50
PERSISTENT_QUOTES_BEFORE = 1
PERSISTENT_QUOTES_AFTER = 4
SYNTHETIC_MARKET_QUOTES_CREATED = 0
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
NEW_JOURNALS_CREATED_THIS_BATCH = 0
NEW_TREASURY_ROWS_CREATED_THIS_BATCH = 0
UNBALANCED_JOURNALS_NEW = 0
ORPHAN_JOURNAL_LINES_NEW = 0
UNLINKED_TREASURY_NEW = 0
ASSET_COUNT_UNEXPECTED_DELTA = 0
DUPLICATE_BARCODES_NEW = 0
EMPTY_BARCODES_NEW = 0
TYPESCRIPT = PASS
GIT_DIFF_CHECK = PASS
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
GOLDAPI_AUTH_FORENSIC_GATE = PASS_CONFIRMED
GOLD_CENTER_LIVE_RUNTIME_FIX_01_GATE = PASS_CONFIRMED
LOCAL_PRODUCTION_SMOKE_STATUS = WAIT_FOR_REMAINING_GOLD_CENTER_REMEDIATION
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_ACTION = LOCAL-PRODUCTION-SMOKE-01 only after explicit Owner start
```
