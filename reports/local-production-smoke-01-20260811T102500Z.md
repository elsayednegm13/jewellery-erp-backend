# تقرير LOCAL-PRODUCTION-SMOKE-01

## 1. النتيجة العملية

تم تنفيذ فحص تشغيل محلي مضبوط دون بدء أو إيقاف أي عملية موروثة، ودون تنفيذ أي معاملة أعمال اصطناعية على قاعدة `darfus_erp`. الواجهة الأمامية على المنفذ 3000 تستجيب بوضع Next production، والواجهة الخلفية على المنفذ 8000 تستجيب. تعذر إكمال القبول المتصفح لأن شاشة الدخول لم تقبل بيانات الاعتماد المحلية المتاحة، كما أن Gold runtime الحالي غير جاهز للقبول الحي: حالة Redis العامة 503، وحالة السعر الأخيرة STALE، وفحص الصحة العام يعلن `isMockFallback=true`.

لذلك أُغلقت الجولة كحالة محجوبة، ولم يتم إنشاء clone أو تشغيل POS/CGP كتابةً.

## 2. الحماية والعمليات

- تم الالتزام بقراءة `AGENTS.md` و`PROJECT_PROGRESS_HANDOFF.md` و`CGP_CANONICAL_IMPLEMENTATION_REFERENCE.md` والتقارير المطلوبة قبل الفحص.
- العمليات الموروثة التي وُجدت: Next dev (PID 6648، مع npm dev PID 18424 و7400)، nodemon/backend (PID 17116 وابنه PID 9336)، Next production start (PID 15356)، PostgreSQL، Docker/WSL relay وRedis listener.
- لم يتم لمس أي عملية موروثة، ولم يبدأ Next dev أو يُعاد تشغيله.
- `git status`: staged=0، tracked modified=42، untracked=164، stashes=11، branch=`main`، HEAD=`1657b0e9ba580faef69be48f04637835c201b521`، remotes لا يوجد.
- SHA الحالي لـ `next-env.d.ts` هو drift المعروف `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`؛ لم يُصلح ولم يتغير.

## 3. فحص التشغيل المحلي

- `GET http://localhost:3000/ar/login` = 200، `X-Powered-By: Next.js`.
- `GET http://localhost:8000/api/v1/health` = 200، backend UP.
- `GET http://localhost:8000/api/v1/health/db` = 200، PostgreSQL متصل.
- `GET http://localhost:8000/api/v1/health/gold` = 200 لكن `isMockFallback=true` مع عينة ثابتة؛ لا يُعد هذا دليلاً على Live Gold جاهز.
- `GET http://localhost:8000/api/v1/health/redis` = 503؛ لم يتم تشغيل أو إيقاف Redis الموروث.
- `gold_market_settings`: `GOLDAPI_IO`، `LIVE_PROVIDER`، `AED`، enabled=true، staleAfter=120s.
- آخر quote: provider=`GOLDAPI_IO`، currency=`AED`، quote timestamp=`2026-08-11T09:15:32.000Z`، status=`VALID`، عمر القراءة وقت الفحص حوالي 3797 ثانية؛ خدمة الحالة canonical أعادت `STALE` وeffective CGP rates كلها null.

## 4. المتصفح وتسجيل الدخول

- فُتحت صفحة `http://localhost:3000/ar/login` في Browser Use.
- ظهرت حقول البريد وكلمة المرور واللغة العربية بصورة سليمة.
- جرت محاولة واحدة فقط ببيانات الاعتماد المحلية الموجودة في المواد السابقة؛ ردت الواجهة: `بيانات الاعتماد غير صالحة` وبقيت على `/ar/login`.
- لم تتم إعادة المحاولة، ولم يتم تجاوز المصادقة، ولم يتم إنشاء مستخدم أو تغيير كلمة مرور.
- لا يمكن إثبات dashboard، Company/Branch context، Gold Center، POS، CGP، Pricing Rules، Price History، calculator، أو صلاحيات الأزرار دون جلسة صحيحة.
- لا توجد أخطاء Console حرجة ظاهرة على سطح الدخول، لكن network smoke المصادق عليه لم يُنفذ.

## 5. قاعدة البيانات والـ business safety

تمت الاستعلامات عبر اتصال backend read-only عمليًا، وتحقق `SELECT current_database()` من `darfus_erp`.

| المؤشر | قبل الجولة | بعد الجولة |
|---|---:|---:|
| migrations | 80 | 80 |
| Assets | 53 | 53 |
| Products | 3 | 3 |
| Customers | 1 | 1 |
| CGP documents | 2 | 2 |
| Invoices | 13 | 13 |
| Journal entries | 67 | 67 |
| Journal lines | 176 | 176 |
| Cash transactions | 50 | 50 |
| Gold market quotes | 4 | 4 |

فحوصات read-only النهائية: unbalanced journals=0، orphan journal lines=0، unlinked cash=0، duplicate journal sources=0، duplicate treasury links=0، duplicate barcodes=0، empty barcodes=0، orphan RFID=0، orphan profile refs=0، orphan inventory movements=0.

لم تُنشأ أي معاملة POS أو CGP أو Treasury أو Journal، ولم تُنشأ quotes اصطناعية. لم تُنشأ قاعدة clone لأن runtime آمنًا منفصلًا للكتابة لم يكن قابلًا للإثبات بعد حاجز الدخول وRedis.

## 6. الاختبارات الساكنة

- `npx tsc --noEmit` = PASS.
- `git diff --check` = PASS (تحذيرات CRLF الموروثة فقط).
- لم تُشغل migrations أو seeds أو Next dev أو provider switch أو test connection.

## 7. التصنيف

الحاجز الأساسي هو `BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS`. يوجد حاجز مستقل إضافي: `BLOCKED_BY_LIVE_GOLD_RUNTIME` بسبب Redis health 503 وquote STALE وhealth endpoint الذي يعلن mock fallback. لا يوجد دليل على تلف business data.

## 8. المتطلبات المؤجلة

يلزم في جولة لاحقة، بعد توفير اعتماد محلي صالح وإثبات runtime Gold/Redis، إعادة فتح LANE A للقراءة، ثم إنشاء clone disposable منفصل والتحقق من `SELECT current_database()` داخله قبل أي POS/CGP write smoke. لا يجوز استخدام `darfus_erp` للكتابة.

## 9. الرموز المطلوبة

```text
CURRENT_BATCH = LOCAL-PRODUCTION-SMOKE-01
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO_NOT_REQUIRED
INHERITED_RUNTIME_PROCESSES_FOUND = YES
INHERITED_RUNTIME_PROCESSES_TOUCHED = NO
NEXT_DEV_STARTED_OR_RESTARTED = NO
FRONTEND_RUNTIME_MODE = NEXT_PRODUCTION_START_EXISTING_PID15356
BACKEND_RUNTIME_MODE = NODE_SERVER_EXISTING_PID9336_PORT8000
REDIS_RUNTIME_MODE = INHERITED_LISTENER_PRESENT_HEALTH_503
PERSISTENT_BROWSER_LANE = READ_ONLY
WRITE_ACCEPTANCE_TARGET = DISPOSABLE_CLONE
PERSISTENT_SYNTHETIC_BUSINESS_TRANSACTIONS = 0
LIVE_GOLD_RUNTIME_READY = FAIL
LATEST_QUOTE_AGE_SECONDS = 3797
LATEST_QUOTE_STATUS = STALE
LOGIN_SMOKE = FAIL
COMPANY_BRANCH_CONTEXT_SMOKE = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
GOLD_CENTER_UPPER_LIVE_PANEL = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
GOLD_CENTER_EFFECTIVE_CGP_RATE_UI = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
LOWER_GOLD_CENTER_SPOT_PANEL = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
SIMULATION_LABEL_VISIBLE_IN_VALID_LIVE_STATE = NOT_VERIFIED
CGP_14K_LEAK = NOT_VERIFIED
LOWER_MARKET_PURITY_SANITY = NOT_VERIFIED
GOLD_PRICE_HISTORY_SMOKE = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
PRICING_RULES_READ_ONLY_SMOKE = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
PROVIDER_SETTINGS_READ_ONLY_SMOKE = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
TEST_CONNECTION_RESULT = NOT_RUN
SECRET_EXPOSED_THIS_BATCH = NO
GOLD_CENTER_CALCULATOR_BROWSER = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
PERSISTENT_POS_UI_READ_ONLY = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
CLONE_DATABASE = NONE_CREATED
CLONE_TARGET_GUARD = NOT_RUN
POS_CHECKOUT_CLONE_E2E = BLOCKED_BY_RUNTIME_BOUNDARY
PERSISTENT_CGP_UI_READ_ONLY = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
CGP_CLONE_E2E = BLOCKED_BY_RUNTIME_BOUNDARY
CGP_SNAPSHOT_SMOKE = NOT_RUN
INVENTORY_HARD_GATE_SMOKE = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
ACCOUNTING_SMOKE = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
TREASURY_SETTLEMENT_SMOKE = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
CRM_PROJECTION_SMOKE = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
PERMISSIONS_SMOKE = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
PROVIDER_SWITCH_EXECUTED_THIS_BATCH = NO
METALS_API_CHANGED_THIS_BATCH = NO
BROWSER_NETWORK_SMOKE = FAIL
BROWSER_CONSOLE_CRITICAL_ERRORS = 0_observed_on_login_surface
REAL_GOLDAPI_HTTP_REQUESTS_THIS_BATCH = 0
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
REAL_QUOTES_CREATED_THIS_BATCH = 0
SYNTHETIC_MARKET_QUOTES_CREATED = 0
NEW_PERSISTENT_JOURNALS_THIS_BATCH = 0
NEW_PERSISTENT_TREASURY_ROWS_THIS_BATCH = 0
UNBALANCED_JOURNALS_NEW = 0
ORPHAN_JOURNAL_LINES_NEW = 0
UNLINKED_TREASURY_NEW = 0
PERSISTENT_ASSET_COUNT_UNEXPECTED_DELTA = 0
DUPLICATE_BARCODES_NEW = 0
EMPTY_BARCODES_NEW = 0
DISPOSABLE_CLONE_DROPPED_SAFELY = NO_NOT_CREATED
TASK_OWNED_RUNTIME_CLEANUP = PASS_NOT_CREATED
INHERITED_REDIS_TOUCHED = NO
API_KEY_CHANGED_THIS_BATCH = NO
GOLD_CENTER_MAKING_REGRESSION = BLOCKED
POS_MAKING_REGRESSION = BLOCKED
LEGACY_POS_MISSING_SELLING_GOLD_RATE_REGRESSION = BLOCKED
POS_CHECKOUT_REGRESSION = BLOCKED
GOLD_LIVE_REGRESSION = BLOCKED
CGP_END_TO_END_REGRESSION = BLOCKED
TYPESCRIPT = PASS
GIT_DIFF_CHECK = PASS
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
BROWSER_ACCEPTANCE = BLOCKED
LOCAL_PRODUCTION_SMOKE_01_GATE = BLOCKED_BY_LOCAL_LOGIN_CREDENTIALS
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_BATCH = GOLD-PROVIDER-SWITCHING-01_IF_OWNER_WANTS_BEFORE_DEPLOY_ELSE_SERVER-PREFLIGHT-01
```

لم يتم تحديث `PROJECT_PROGRESS_HANDOFF.md` بسبب عدم تحقق بوابة القبول.
