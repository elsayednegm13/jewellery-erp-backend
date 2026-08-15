# SUPPLIER-MINIMAL-HARNESS-AUTH-BOOTSTRAP-COMPANY-READINESS-CLOSEOUT-03-REV02

## Executive summary

تم تنفيذ إغلاق Supplier على مصدر Acceptance للقراءة فقط، باستخدام Clone disposable
وحيد. Persistent بقي على 81 migration وAcceptance على 80. تم تطبيق Migration 81
المعتمدة داخل الـClone فقط، ثم تشغيل Backend وFrontend مؤقتين، وإثبات auth وCompany
context وBranch readiness ثم Preview وReceipt فعلي من Browser حقيقي. تم تنظيف كل
الموارد وإسقاط الـClone. لا يوجد تعديل Product business logic.

الـrun trace الكامل: `C:\Windows\Temp\supplier-minimal-harness-1786778232278.jsonl`.

## Current migration-state correction

| قاعدة | قبل | بعد | الملاحظة |
|---|---:|---:|---|
| `darfus_erp` | 81 | 81 | SELECT فقط؛ Migration 81 موجودة |
| `darfus_erp_inventory_rehearsal_20260804_160500z` | 80 | 80 | SELECT فقط؛ Migration 81 غير موجودة |
| Clone | 80 | 81 | Migration 81 المعتمدة فقط |

Migration 81 المطبقة داخل Clone فقط هي:
`20260814010000-customer-invoice-contact-snapshots.js`. هي إضافة أعمدة nullable
بدون backfill أو تعديل فواتير.

## Safety boundary

- Persistent `darfus_erp`: read-only، ولا توجد أي batch-owned writes.
- Acceptance: read-only، ولا توجد أي batch-owned writes.
- كل POST/PUT Supplier وReceipt تم توجيهه إلى Clone disposable فقط.
- لا Migration 82، لا تعديل Invoice Snapshot، لا تعديل POS/Customer/Accounting/
  Inventory/Payment/VAT/Gold، ولا normal runtime restart.
- لم يتم استخدام hardcoded Company ID أو first-active-branch fallback.

## Worktree and toolchain

`main`, HEAD `1657b0e9ba580faef69be48f04637835c201b521`. الـworktree كان متسخًا
بتغييرات موروثة؛ staged files = 0، stashes = 11، ولم يتم reset/restore/clean/stash/
add/commit/push. Node `v22.22.0`، npm `10.9.4`، Next `16.2.9`، package manager
`npm` على Windows x64. Hashes الحالية لـ`backend/package.json` و`backend/package-lock.json`
مطابقة للقيم الملتقطة قبل التنفيذ. `next-env.d.ts` بقي على inherited drift SHA
`7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` بدون تعديل.

## DB before fingerprints

SELECT-only قبل/بعد أثبت:

| DB | Assets | Products | Suppliers | POs | PO Items | Revisions | Journals | JournalLines | CashTransactions | Certificates |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Persistent | 62 | 3 | 1 | 6 | 2 | 61 | 83 | 219 | 60 | 2 |
| Acceptance | 475 | 3 | 1 | 314 | 418 | 442 | 497 | 1423 | 173 | 79 |

Integrity الحالية للقاعدتين: unbalanced journals = 0، orphan journal lines = 0،
unlinked treasury = 0، blank barcodes = 0، orphan assets = 0، orphan revisions = 0،
orphan certificates = 0. Persistent snapshot migration row موجودة مرة واحدة، وفي
Acceptance غير موجودة.

## Clone creation and schema alignment

تم إنشاء Clone باسم:
`darfus_erp_supplier_minimal_harness_1786778232281`.

أثبت الحارس `current_database()` أنه Clone وليس Persistent أو Acceptance. تم تنفيذ
Migration 81 المعتمدة مباشرة داخل Clone فقط، ثم أصبحت SequelizeMeta = 81 وأصبحت
snapshot columns موجودة. لم يحدث historical Invoice backfill.

## Clone financial readiness and runtimes

- Company تم حله من بيانات Clone الحالية.
- Branch المختار `MAIN` لأنه الوحيد READY؛ `C10D` بقي BLOCKED.
- `FIRST_ACTIVE_BRANCH_SELECTION_USED = NO`.
- Gold health HTTP 200، provider `GOLDAPI_IO`، mode `LIVE_PROVIDER`، بدون طباعة أو
  تخزين secret.
- Backend المؤقت بدأ على `127.0.0.1:59120`، health HTTP 200، وDB identity للـClone
  مثبتة.
- Frontend المؤقت بدأ على `127.0.0.1:24148` بعد `npm ci` مستقل وbuild نظيف في
  workspace مؤقت خارج Product source. Normal `node_modules` وnormal `.next` لم يتم
  استخدامهما أو لمسهما.

## Browser bootstrap and readiness

تم تشغيل network instrumentation قبل navigation. الـFrontend API target كان:
`http://127.0.0.1:59120/api/v1`.

الطلب canonical لـCompany readiness هو:
`GET http://127.0.0.1:59120/api/v1/auth/accessible-companies`.

الدليل السابق قبل إصلاح الـharness (المعاد التحقق منه من التقرير والـtrace السابق)
كان HTTP `404`, error `ROUTE_NOT_FOUND`, message `The requested API route was not
found.` بسبب double `/api/v1` في forwarding (`/api/v1/api/v1/...`). هذا كان
Harness routing defect وليس Product defect.

في هذا الـrun بعد التصحيح: نفس endpoint وصل للـClone وأعاد HTTP 200، المستخدم
authenticated بدور `super_admin`، Company context جاء من canonical accessible-company
bootstrap، وBranch context من branch bootstrap مع اختيار MAIN. لا يوجد token أو cookie
أو secret في الأدلة.

Security fail-closed لم يتغير؛ Company context المفقود ما زال مرفوضًا من middleware.

## Supplier Browser flow

في نفس Browser وبدون reload تم إثبات:

`GOLD_BAR_24K → GOLD_BY_WEIGHT_JEWELLERY → GOLD_BY_PIECE → GOLD_BAR_24K`

النهائي: profile `GOLD_BAR_24K`, karat `24`, quantity `1`, gross `10`, stone `0`,
paid `0`, positive purchase rate `500`.

Preview الفعلي:

- POST `/api/v1/inventory-v2/receive-preview`
- HTTP 200
- `goodsTotal = 5106.25`
- `total = 5106.25`
- `remainingAmount = 5106.25`
- `netWeight = 10.00000000`
- `pureGold9999 = 10.00000000`
- UI total والمتبقي مطابقان للـresponse.
- لا توجد false unavailable.

قبل اكتمال البيانات كان Submit disabled؛ وبعد preview الحالي أصبح enabled، ثم تم الضغط
فعليًا على `استلام وتسجيل الأصل`.

Receipt الفعلي:

- POST `/api/v1/purchase-orders/receive`
- request body حافظ على profile/karat/supplier/company/branch/weights/paid/rate
- HTTP 201
- PO total = `5106.25`
- Supplier Payable = PO total؛ paid = `0`؛ remaining = `5106.25`
- one PO + one Asset + one unique Barcode + one purchase revision
- journal balanced، Inventory debit وSupplier Payable/AP credit موجودان
- لا Treasury movement لأن paid = 0
- لا orphan lineage أو duplicate barcode في Clone

Replay بنفس Idempotency-Key وbody أعاد HTTP 201 مع counts ثابتة:
PO `315`, Assets `476`, Revisions `443`. نفس Asset وBarcode رجعا بدون duplicate.

## Network and checkpoint evidence

الـtrace يحتوي checkpoints من إنشاء Clone إلى cleanup، بما فيها:

`01_CLONE_CREATED`, `02_CLONE_GUARD_VERIFIED`, `02A_CLONE_SNAPSHOT_MIGRATION_81`,
`03_CLONE_FINANCIAL_MAPPING_READY`, `04_CLONE_BACKEND_STARTED`, `05_BACKEND_HEALTH_200`,
`06_GOLD_HEALTH_200`, `06A_EPHEMERAL_FRONTEND_READY`, `07_BROWSER_LAUNCHED`,
`08_LOGIN_READY`, `09_SUPPLIER_PAGE_LOADED`, profile switching، preview POST/200،
Submit enabled/clicked، receipt POST/201، Clone DB proof، idempotency، ثم إغلاق Browser
وإيقاف runtimes وإسقاط Clone.

## Browser console

`console.error = 0`, page errors = 0، وReact runtime errors = 0. ظهرت رسائل CORS في
Backend log لأن Origin المؤقت ليس allowlisted؛ الـharness كان يمرر الطلبات داخليًا،
ولم تظهر كأخطاء Browser. صُنفت كـharness log noise غير مؤثر على Product.

## Focused tests

نجحت الاختبارات المركزة:

- Supplier all-profile preview/payable/pricing: 4/4.
- Gold Bar current pricing/POS UX: 4/4.
- Supplier receipt closeout/clone guard: 3/3.
- Async profile-switch/preview race: 5/5.
- `npx tsc --noEmit --pretty false`: PASS.
- focused ESLint على Supplier page وharness: PASS.

## Persistent read-only acceptance

تمت إعادة القراءة بعد الاختبار مع `SELECT current_database()`:

- Persistent = `darfus_erp`, migrations = 81، snapshot migration موجودة، integrity PASS.
- Acceptance = `darfus_erp_inventory_rehearsal_20260804_160500z`, migrations = 80،
  snapshot migration غائبة، integrity PASS.
- لا Supplier receipt أو PO أو Asset أو Journal أو Treasury row أُنشئت في أي منهما.

Invoice Snapshot phase لم تتراجع، وMigration 81 لم تُطبق على Acceptance.

## Cleanup and file diff

تم إغلاق Browser، إيقاف Frontend المؤقت، إيقاف Backend Clone، حذف temp frontend
workspace، إسقاط Clone، والتحقق من عدم وجود Clone متبقٍ. Normal frontend على 3000
وnormal backend على 8000 ظلّا يعملان دون restart أو kill.

| File | Reason | Type | Exact change | Persistent effect | Runtime effect | Business logic | Expected? |
|---|---|---|---|---|---|---|---|
| `backend/scripts/supplier-post-fix-minimal-browser-harness-closeout-02.js` | إعادة استخدام harness مع alignment للـ81 وtemp frontend | Harness | إضافة Clone-only migration guard، temp `npm ci`/clean build/start، وتوجيه Browser للـClone | 0 | Disposable only | لا تغيير | نعم |
| `backend/reports/supplier-minimal-harness-auth-bootstrap-company-readiness-closeout-03-rev02-20260815T102500+0300.md` | دليل الجولة | Report | هذا التقرير | 0 | لا شيء | لا شيء | نعم |

لا package.json أو package-lock أو `.env` أو Product business source تغيرت في هذه
الجولة. التقرير لا يعدّل handoff.

## Final tokens

```text
CURRENT_BATCH = SUPPLIER-MINIMAL-HARNESS-AUTH-BOOTSTRAP-COMPANY-READINESS-CLOSEOUT-03-REV02
PERSISTENT_MIGRATIONS_INITIAL = 81
ACCEPTANCE_MIGRATIONS_INITIAL = 80
DISPOSABLE_CLONE_NAME = darfus_erp_supplier_minimal_harness_1786778232281
CLONE_SOURCE_MIGRATIONS = 80
CLONE_SNAPSHOT_MIGRATION_APPLIED = PASS
CLONE_MIGRATIONS_AFTER_SCHEMA_ALIGNMENT = 81
PRE_PAGE_NETWORK_CAPTURE = YES
FRONTEND_API_TARGET_CORRECT = PASS
BROWSER_AUTH_SESSION = PASS
COMPANY_CONTEXT_REQUIRED = YES
COMPANY_CONTEXT_PRESENT = YES
COMPANY_CONTEXT_SOURCE = canonical /auth/accessible-companies bootstrap
HARDCODED_COMPANY_ID_USED = NO
BRANCH_CONTEXT_REQUIRED = YES
BRANCH_CONTEXT_PRESENT = YES
FIRST_ACTIVE_BRANCH_SELECTION_USED = NO
COMPANY_READINESS_ENDPOINT_IDENTIFIED = YES
PRE_FIX_COMPANY_READINESS_FAILURE_CAPTURED = YES
COMPANY_READINESS_HTTP_STATUS_PRE_FIX = 404
COMPANY_READINESS_ERROR_CODE_PRE_FIX = ROUTE_NOT_FOUND
COMPANY_READINESS_ERROR_MESSAGE_PRE_FIX = The requested API route was not found.
COMPANY_READINESS_ROOT_CAUSE = HARNESS_ONLY_DOUBLE_API_PREFIX
PREVIOUS_TIMEOUT_CLASSIFICATION_REVALIDATED = YES
FIX_SCOPE = HARNESS_ONLY
PRODUCT_CODE_CHANGED = NO
COMPANY_CONTEXT_SECURITY_FAIL_CLOSED = PASS
AUTH_SECURITY_WEAKENED = NO
COMPANY_READINESS_HTTP_STATUS_POST_FIX = 200
COMPANY_READINESS_RUNTIME = PASS
SUPPLIER_PAGE_READY = PASS
SAME_BROWSER_MULTI_SWITCH = PASS
FINAL_BROWSER_PROFILE = GOLD_BAR_24K
FINAL_BROWSER_KARAT = 24
ACTUAL_PREVIEW_POST_CAPTURE = YES
ACTUAL_PREVIEW_RESPONSE_CAPTURE = YES
PREVIEW_HTTP_STATUS = 200
PREVIEW_UI_PARITY = PASS
FALSE_UNAVAILABLE_RUNTIME = NO
SUBMIT_ENABLEMENT_POST_FIX = PASS
ACTUAL_UI_SUBMIT_CLICKED = YES
ACTUAL_BROWSER_RECEIPT_POST_CAPTURE = YES
RECEIPT_POST_BODY_PARITY = PASS
ACTUAL_BROWSER_RECEIPT_RESPONSE_CAPTURE = YES
RECEIPT_HTTP_STATUS = 201
CLONE_BROWSER_RECEIPT_DB_PROOF = PASS
CLONE_BROWSER_RECEIPT_IDEMPOTENCY = PASS
BROWSER_CONSOLE_RUNTIME = PASS
BOOTSTRAP_NETWORK_TABLE = COMPLETE
AUTH_CONTEXT_EVIDENCE_TABLE = COMPLETE
AUTH_BOOTSTRAP_CHECKPOINT_TABLE = COMPLETE
RECEIPT_RUNTIME_TABLE = COMPLETE
PERSISTENT_BROWSER_READONLY_ACCEPTANCE = PASS
INVOICE_SNAPSHOT_PHASE_REGRESSED = NO
PERSISTENT_SNAPSHOT_MIGRATION_STILL_PRESENT = YES
PERSISTENT_MIGRATIONS_AFTER = 81
ACCEPTANCE_MIGRATIONS_AFTER = 80
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
ACCEPTANCE_SOURCE_PRESERVED = PASS
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
TARGETED_AUTH_BOOTSTRAP_TESTS = PASS
TARGETED_COMPANY_CONTEXT_TESTS = PASS
TARGETED_READINESS_TESTS = PASS
TARGETED_API_TARGET_TESTS = PASS
TARGETED_SECURITY_FAIL_CLOSED_TESTS = PASS
TARGETED_SUPPLIER_PAGE_READY_TESTS = PASS
TARGETED_PREVIEW_GUARD_TESTS = PASS
TARGETED_BROWSER_RECEIPT_TESTS = PASS
TARGETED_IDEMPOTENCY_TESTS = PASS
TARGETED_DB_GUARD_TESTS = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
RUNTIME_ENV_CHANGED = NO
PACKAGE_JSON_CHANGED = NO
PACKAGE_LOCK_CHANGED = NO
CGP_DISPATCHER_MUTATED_THIS_BATCH = NO
NORMAL_FRONTEND_RESTARTED = NO
NORMAL_BACKEND_RESTARTED = NO
NORMAL_RUNTIME_PROCESS_KILLED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
GIT_PUSHES_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
BROWSER_CLOSED = PASS
EPHEMERAL_FRONTEND_STOPPED = PASS
EPHEMERAL_CLONE_RUNTIME_STOPPED = PASS
TEMP_FRONTEND_WORKSPACE_CLEANED = PASS
DISPOSABLE_CLONE_DROPPED = PASS
REMAINING_BATCH_CLONES = 0
NORMAL_RUNTIME_UNTOUCHED = YES
SUPPLIER_MINIMAL_HARNESS_AUTH_BOOTSTRAP_COMPANY_READINESS_CLOSEOUT_03_REV02_GATE = PASS_CONFIRMED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = LOCAL-PRODUCTION-SMOKE-01-RETRY-STRICT-RUNTIME_IF_PASS
```
