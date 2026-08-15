# CUSTOMER-INVOICE-SNAPSHOT-EPHEMERAL-FRONTEND-BUILD-BLOCKER-FORENSIC-AND-CORRECTION-01

## Executive summary

تم فحص فشل الـFrontend السابق وإعادة إنتاجه مرة واحدة قبل أي تصحيح. السبب لم يكن Invoice Snapshot ولا Product behavior. السبب كان في عزل الـruntime: استخدام junction لـ`node_modules` من داخل temp copy جعل Webpack يحاول حل Next internal modules من مسار المستودع الأصلي. محاولة clean install ثانية كشفت سببًا إضافيًا: تشغيل `npm ci` مع `NODE_ENV=production` أسقط devDependencies.

تم تصحيح الـharness فقط: source copy مؤقت، بدون `.next` أو `.env` أو `node_modules`، ثم `npm ci` مستقل مع `NODE_ENV=development`، ثم `npm run build -- --webpack`، ثم `next start` على منفذ بديل. نجح build، بدأ Frontend، ونجح Browser smoke read-only على `/ar/login` بدون console logs.

لم يتغير Product code أو package files أو أي قاعدة بيانات. البوابة أصبحت جاهزة لإعادة محاولة closeout السابق، لكن لا تبدأ إعادة المحاولة تلقائيًا.

## Previous closeout blocker

الدليل السابق:
`backend/reports/customer-invoice-snapshot-clone-full-stack-runtime-closeout-01-evidence-20260814T203515981Z`

الخطأ الأول المعاد إنتاجه:

```text
Module not found: Error: Can't resolve './H:/WORK/jewellery-erp-master/node_modules/next/dist/client/next.js'
in 'C:\Windows\Temp\darfus-invoice-build-forensic-EnCq5g\frontend'
```

## Safety boundary

- Persistent `darfus_erp`: read-only.
- Acceptance `darfus_erp_inventory_rehearsal_20260804_160500z`: read-only.
- لا Migration ولا business fixture ولا sale ولا Customer mutation.
- لا normal runtime restart أو kill.
- لا `.env` أو package file أو Git write.

## Worktree baseline

- Branch: `main`
- HEAD: `1657b0e9ba580faef69be48f04637835c201b521`
- staged: `0`
- inherited status: 300 status lines تقريبًا، مع تغييرات Product موروثة كثيرة؛ لم تُلمس.
- stashes: `11`
- `BROAD_GIT_CLEANUP = NO`

Hashes قبل/بعد:

| الملف | SHA-256 |
|---|---|
| `backend/package.json` | `231A19D0A81C2579F4D1B8E4D676A7085BA6811516630B811627B58A5CB3A86B` |
| `backend/package-lock.json` | `A2E65BF8D4EBBFF9CE559532130DC896433A931C5B6515102FC48149FE602551` |
| `package.json` | `F9DB91B73D622BD366D678F4A49863527AADF8AB8CDC52D858A6877A5157563A` |
| `package-lock.json` | `6F14A84A411014CD5F4B785592994E5B50E791925AF52C42EF7EEEDBFA08C6DC` |
| `next.config.ts` | `B31A7B6C8B35DC2FFFBAB53CD4FC1538E7F0914025777FC778D5ADB571D56213` |
| `tsconfig.json` | `7707C03B22160D1DDBA7A1E04C307A24590E77999352DA6B6BF328BE1AF91DB5` |
| `next-env.d.ts` | `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` |

## Toolchain versions

- OS: Windows `win32 x64`
- Node: `v22.22.0`
- npm: `10.9.4`
- Next: `16.2.9`
- React: `19.2.7`
- TypeScript: `5.7.2`
- Package manager: npm
- `npm ls --depth=0`: exit 0.
- `package-lock.json`: lockfileVersion 3، ونسخ Next/React/TypeScript تطابق package.json.

`WORKTREE_BASELINE_CAPTURED = YES`
`TOOLCHAIN_BASELINE_CAPTURED = YES`
`PACKAGE_LOCK_CONSISTENCY = PASS`
`DEPENDENCY_VERSION_CHANGE = NO`

## Previous build command

الاستدعاء السابق كان:

```text
working directory = C:\WINDOWS\TEMP\darfus-invoice-snapshot-fullstack-IsHSSW\frontend
command = node.exe npm-cli.js run build -- --webpack
NODE_ENV = production
NEXT_PUBLIC_DATA_SOURCE = api
NEXT_PUBLIC_API_URL = http://127.0.0.1:<ephemeral>/api/v1
NEXT_PUBLIC_API_ORIGIN = http://127.0.0.1:<ephemeral>
BACKEND_ORIGIN = http://127.0.0.1:<ephemeral>
source = temporary copied workspace
node_modules = junction إلى repository node_modules
.next = مستبعد من النسخة
```

## Exact reproduced error

تمت الإعادة مرة واحدة بدون تعديل Product source.

- evidence: `backend/reports/customer-invoice-snapshot-ephemeral-build-forensic-20260814T205410272Z/`
- cwd: `C:\WINDOWS\TEMP\darfus-invoice-build-forensic-EnCq5g\frontend`
- command: `C:\Program Files\nodejs\node.exe C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run build -- --webpack`
- exit code: `1`
- first meaningful error: Webpack external junction path إلى `H:/WORK/jewellery-erp-master/node_modules/next/dist/client/*`.

`FRONTEND_BUILD_FAILURE_REPRODUCED = YES`
`BUILD_EXIT_CODE = 1`
`BUILD_BLOCKER_ROOT_CAUSE_PROVEN = YES`

## node_modules forensic

الـrepository يحتوي `node_modules` كdirectory عادي، وليس junction. `npm ls --depth=0` نجح. المشكلة كانت أن الـharness السابق أنشأ junction داخل temp. في المحاولة clean الأولى كان `NODE_ENV=production` أثناء `npm ci`، فتم حذف devDependencies. في المحاولة المصححة تم استخدام `NODE_ENV=development` أثناء `npm ci`، ثم نجح build.

`NODE_MODULES_INTEGRITY = PASS`
`PACKAGE_JSON_CHANGED = NO`
`PACKAGE_LOCK_CHANGED = NO`

## package-lock consistency

تم تشغيل `npm ci --no-audit --no-fund` في temp workspace مع نفس package.json/package-lock. خرج بـ`0`، ولم تُكتب أي ملفات Product. هذا يثبت أن lockfile قابل للتثبيت وأن النسخ المطلوبة متاحة.

## Webpack forensic

التصنيف الدقيق:

1. `WINDOWS_PATH_OR_SYMLINK_BEHAVIOR`: junction يحفظ target خارج temp.
2. `COPY_ISOLATION_STRATEGY_ERROR`: reuse parent node_modules لم يكن عزلًا آمنًا.
3. `DEPENDENCY_INSTALLATION_OR_NODE_MODULES`: production `npm ci` أسقط devDependencies.

بعد إزالة junction واستخدام clean npm ci مع devDependencies، اختفى خطأ Webpack ونجح build. لا يوجد import مكسور في Product source.

`WEBPACK_ROOT_CAUSE = junction-based node_modules path leakage plus production omission of devDependencies`
`WEBPACK_PRODUCT_SOURCE_DEFECT = NO`

## .next forensic

الـ`.next` الطبيعي موجود وموروث، وتمت معاينته ولم يُحذف. يحتوي `build`, `server`, `static`, `types`, و`dev` artifacts. لم يتم تنظيفه أو إعادة بنائه في مكانه.

الـclean temp workspace استبعد `.next`، وNext أنشأ `.next` جديدًا من الصفر. لذلك:

`NEXT_GENERATED_ARTIFACTS_PRESENT = YES`
`NEXT_ROUTE_TYPE_FAILURE_REPRODUCED = NO`
`NEXT_ROUTE_TYPE_FAILURE_CLASSIFICATION = STALE_GENERATED_ARTIFACT`
`INHERITED_NEXT_ROUTE_TYPE_FAILURE = RESOLVED_AS_GENERATED_ARTIFACT`
`TEMP_NEXT_REMOVED_ONLY = YES`
`PRODUCT_SOURCE_CHANGED_FOR_NEXT_TEST = NO`
`NEXT_REGENERATION_RESULT = PASS`

`tsconfig.json` لم يُضعف، ولم تتم إضافة `skipLibCheck` أو excludes جديدة.

## isolated clean-generation test

الـworkspace المصحح:

```text
C:\WINDOWS\TEMP\darfus-invoice-frontend-clean-OeJrVQ\frontend
```

تم نسخ source فقط، واستبعاد `.git`, `.next`, `node_modules`, `backend`, `reports`, `test`, و`.env*`. بعد ذلك:

```text
NODE_ENV=development npm ci --no-audit --no-fund       -> 0
NODE_ENV=production npm run build -- --webpack         -> 0
next start -p 45740 -H 127.0.0.1                       -> HTTP 200
```

## isolation strategy comparison

- In-place source + alternate port: مرفوض لأنه يكتب `.next` الطبيعي.
- temp copy + parent junction: مرفوض، وثبت أنه سبب الخطأ.
- temp copy + `NODE_ENV=production npm ci`: مرفوض، أسقط devDependencies.
- temp copy + clean `npm ci` development + fresh `.next`: تم اختباره ونجح.

`SAFE_EPHEMERAL_FRONTEND_STRATEGY = temporary source copy excluding .next/node_modules/.env, fresh npm ci with NODE_ENV=development, webpack build, next start on discovered alternate port`
`SAFE_EPHEMERAL_FRONTEND_STRATEGY_PROVEN = YES`

## proven root cause

الـroot cause بيئي/harness فقط. لا توجد حاجة لتعديل Product source أو Invoice Snapshot أو POS أو Customer.

`PRODUCT_CODE_CHANGE_REQUIRED = NO`
`CORRECTION_SCOPE = HARNESS_OR_EPHEMERAL_ENV_ONLY`

## correction applied

تم إنشاء harnessين جديدين فقط:

1. `backend/scripts/customer-invoice-snapshot-ephemeral-build-forensic.js` لإعادة الإنتاج وجمع stdout/stderr/exit code.
2. `backend/scripts/customer-invoice-snapshot-ephemeral-frontend-clean-runtime.js` للاستراتيجية الآمنة مع clean install وbuild/start.

لا يوجد تعديل في Product code أو package/config files.

## build proof

الدليل:
`backend/reports/customer-invoice-snapshot-ephemeral-frontend-clean-runtime-20260814T210446624Z/`

- `npm-ci.json`: exit 0، `NODE_ENV=development`.
- `build.json`: exit 0.
- `build.stdout.log`: Next 16.2.9 routes generated، ومن ضمنها `/ar/login` و`/ar/pos`.
- `build.stderr.log`: فارغ.

`EPHEMERAL_FRONTEND_BUILD = PASS`
`FRONTEND_BUILD_EXIT_CODE = 0`

## TypeScript proof

`npm run typecheck` في repository خرج بـ`0`. والـclean build أيضًا مرّ بمرحلة TypeScript بدون error. لم يتغير tsconfig.

`TYPESCRIPT = PASS`
`TSC_CONFIG_WEAKENED = NO`

## ephemeral frontend startup

- Port مكتشف: `45740`
- Startup route: `http://127.0.0.1:45740/ar/login`
- HTTP status: `200`
- PID المؤقت: `24240`، وتم إيقافه بعد smoke.

`EPHEMERAL_FRONTEND_STARTED = YES`
`EPHEMERAL_FRONTEND_PORT = 45740`
`EPHEMERAL_FRONTEND_STARTUP = PASS`

## real-browser smoke

تم فتح Browser حقيقي على `/ar/login` فقط. ظهرت markers:

- `DARFUS`
- `JEWELLERY ERP`
- `تسجيل الدخول`
- `البريد الإلكتروني`
- `كلمة المرور`
- `دخول إلى النظام`

تم التقاط screenshot viewport وحفظه في `frontend-smoke.png`. `tab.dev.logs({})` رجع قائمة فارغة.

`REAL_BROWSER_FRONTEND_SMOKE = PASS`
`BROWSER_CONSOLE_BUILD_RUNTIME_ERRORS = 0`

## console evidence

الدليل:
`backend/reports/customer-invoice-snapshot-ephemeral-frontend-clean-runtime-20260814T210446624Z/browser-smoke.json`

لا توجد console errors أو runtime build errors في smoke. لم يتم فتح POS ولم تتم أي mutation.

## package/env/git safety

`package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, و`next-env.d.ts` hashes لم تتغير. `next-env.d.ts` ظل على drift المعروف `7AD303...` دون تعديل. لا Git writes، ولا deploy، ولا normal restart.

## DB non-mutation proof

لا تم إنشاء clone في هذه الجولة، ولا تم الاتصال بقاعدة أعمال mutable. تمت القراءة السابقة فقط للتأكد من الحدود. Persistent وAcceptance ظلا عند:

| DB | migrations | Customers | Invoices | Payments | Journals | JournalLines | CashTransactions | Assets | snapshot columns |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `darfus_erp` | 80 | 2 | 15 | 30 | 81 | 209 | 58 | 62 | 0 |
| Acceptance | 80 | 3 | 133 | 122 | 497 | 1423 | 173 | 475 | 0 |

`PERSISTENT_WRITES_THIS_BATCH = 0`
`ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0`

## Invoice Snapshot freeze proof

لم تتغير Migration أو Invoice model أو `invoice-contact-snapshot.service.js` أو sale/return/exchange/reservation/print logic. هذه الجولة أثبتت build/runtime boot فقط ولم تنفذ Invoice Snapshot business flow.

`INVOICE_SNAPSHOT_PRODUCT_LOGIC_CHANGED = NO`

## POS/Customer freeze proof

لم يتغير POS layout أو search أو checkout أو Customer business logic أو primary-address authority.

`POS_VISUAL_LAYOUT_CHANGED = NO`
`POS_BUSINESS_LOGIC_CHANGED = NO`
`CUSTOMER_BUSINESS_LOGIC_CHANGED = NO`

## Accounting/Inventory/Payment/VAT/Gold freeze

لم تتغير أي من هذه المجالات.

## cleanup

تم إغلاق Browser، وإيقاف PID المؤقت، وإزالة temp workspace الذي أنشأته الجولة. تم الحفاظ على temp artifact قديم موروث من الجولة السابقة (`darfus-invoice-snapshot-fullstack-NidoR8`) ولم يتم تنظيفه لأنه ليس من إنشاء هذه الجولة.

`EPHEMERAL_FRONTEND_STOPPED = YES`
`TEMP_RUNTIME_WORKSPACE_CLEANED = YES`
`NORMAL_RUNTIME_UNTOUCHED = YES`

## file diff

| File | Reason | Type | Exact change | Persistent effect | Runtime effect | Business logic effect | Expected? | Unrelated impact |
|---|---|---|---|---|---|---|---|---|
| `backend/scripts/customer-invoice-snapshot-ephemeral-build-forensic.js` | reproduce prior build | Harness | temp junction copy + logs | none | forensic only | none | yes | none |
| `backend/scripts/customer-invoice-snapshot-ephemeral-frontend-clean-runtime.js` | corrected isolation | Harness | clean npm ci/build/start | none | ephemeral only | none | yes | none |
| `...evidence-20260814T205410272Z/*` | reproduction logs | Temp/Evidence | stdout/stderr/metadata | none | none | none | yes | none |
| `...clean-runtime-20260814T210446624Z/*` | successful proof | Temp/Evidence | npm/build/start/browser evidence | none | ephemeral only | none | yes | none |
| this report | closeout record | Report | forensic result and tokens | none | none | none | yes | none |

`BLOCKER_FILE_DIFF_TABLE = COMPLETE`

## Gate

`CUSTOMER_INVOICE_SNAPSHOT_EPHEMERAL_FRONTEND_BUILD_BLOCKER_FORENSIC_AND_CORRECTION_01_GATE = PASS_FRONTEND_RUNTIME_READY`

## Next step

تم إصلاح blocker في الـharness فقط. لا تبدأ Full-stack business flow الآن. بعد Owner review فقط، الخطوة المقترحة:

`CUSTOMER-INVOICE-SNAPSHOT-CLONE-FULL-STACK-RUNTIME-CLOSEOUT-01-RETRY`

`NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START`

## Final tokens

```text
CURRENT_BATCH = CUSTOMER-INVOICE-SNAPSHOT-EPHEMERAL-FRONTEND-BUILD-BLOCKER-FORENSIC-AND-CORRECTION-01
MODE = STRICT_FRONTEND_BUILD_RUNTIME_BLOCKER_FORENSIC
OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE
WORKTREE_BASELINE_CAPTURED = YES
NODE_VERSION = v22.22.0
NPM_VERSION = 10.9.4
NEXT_VERSION = 16.2.9
PREVIOUS_FRONTEND_BUILD_COMMAND = node.exe npm-cli.js run build -- --webpack
FRONTEND_BUILD_FAILURE_REPRODUCED = YES
FIRST_MEANINGFUL_BUILD_ERROR = Webpack external junction path leakage to repository node_modules/next/dist/client
BUILD_BLOCKER_CLASSIFICATION = WINDOWS_PATH_OR_SYMLINK_BEHAVIOR + COPY_ISOLATION_STRATEGY_ERROR + DEPENDENCY_INSTALLATION_OR_NODE_MODULES
BUILD_BLOCKER_ROOT_CAUSE_PROVEN = YES
NODE_MODULES_INTEGRITY = PASS
PACKAGE_LOCK_CONSISTENCY = PASS
WEBPACK_ROOT_CAUSE = junction-based path leakage plus production npm ci omitted devDependencies
WEBPACK_PRODUCT_SOURCE_DEFECT = NO
NEXT_GENERATED_ARTIFACTS_PRESENT = YES
NEXT_ROUTE_TYPE_FAILURE_REPRODUCED = NO
NEXT_ROUTE_TYPE_FAILURE_CLASSIFICATION = STALE_GENERATED_ARTIFACT
SAFE_EPHEMERAL_FRONTEND_STRATEGY = TEMP_SOURCE_COPY_CLEAN_NPM_CI_DEV_FRESH_NEXT_ALTERNATE_PORT
SAFE_EPHEMERAL_FRONTEND_STRATEGY_PROVEN = YES
PRODUCT_CODE_CHANGE_REQUIRED = NO
CORRECTION_SCOPE = HARNESS_OR_EPHEMERAL_ENV_ONLY
EPHEMERAL_FRONTEND_BUILD = PASS
FRONTEND_BUILD_EXIT_CODE = 0
TYPESCRIPT = PASS
INHERITED_NEXT_ROUTE_TYPE_FAILURE = RESOLVED_AS_GENERATED_ARTIFACT
TSC_CONFIG_WEAKENED = NO
EPHEMERAL_FRONTEND_STARTED = YES
EPHEMERAL_FRONTEND_PORT = 45740
EPHEMERAL_FRONTEND_STARTUP = PASS
REAL_BROWSER_FRONTEND_SMOKE = PASS
BROWSER_CONSOLE_BUILD_RUNTIME_ERRORS = 0
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
INVOICE_SNAPSHOT_PRODUCT_LOGIC_CHANGED = NO
POS_VISUAL_LAYOUT_CHANGED = NO
POS_BUSINESS_LOGIC_CHANGED = NO
CUSTOMER_BUSINESS_LOGIC_CHANGED = NO
ACCOUNTING_BUSINESS_LOGIC_CHANGED = NO
INVENTORY_BUSINESS_LOGIC_CHANGED = NO
PAYMENT_BUSINESS_LOGIC_CHANGED = NO
VAT_BUSINESS_LOGIC_CHANGED = NO
PRICING_BUSINESS_LOGIC_CHANGED = NO
GOLD_BUSINESS_LOGIC_CHANGED = NO
PACKAGE_JSON_CHANGED = NO
PACKAGE_LOCK_CHANGED = NO
RUNTIME_ENV_FILES_CHANGED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
EPHEMERAL_FRONTEND_STOPPED = YES
TEMP_RUNTIME_WORKSPACE_CLEANED = YES
NORMAL_RUNTIME_UNTOUCHED = YES
BLOCKER_FILE_DIFF_TABLE = COMPLETE
CUSTOMER_INVOICE_SNAPSHOT_EPHEMERAL_FRONTEND_BUILD_BLOCKER_FORENSIC_AND_CORRECTION_01_GATE = PASS_FRONTEND_RUNTIME_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = CUSTOMER-INVOICE-SNAPSHOT-CLONE-FULL-STACK-RUNTIME-CLOSEOUT-01-RETRY_IF_PASS
```
