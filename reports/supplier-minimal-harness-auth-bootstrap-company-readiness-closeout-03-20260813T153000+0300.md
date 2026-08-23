# SUPPLIER-MINIMAL-HARNESS-AUTH-BOOTSTRAP-COMPANY-READINESS-CLOSEOUT-03

## 1. النطاق والنتيجة

هذه الجولة كانت Browser/bootstrap closeout على مصدر Acceptance للقراءة فقط، مع
قاعدة Clone disposable وحيدة للـreceipt. لم يتغير Product code أو قاعدة Persistent
أو مصدر Acceptance. النتيجة النهائية: `PASS_CONFIRMED`.

الدليل النهائي للمتصفح: `C:\WINDOWS\TEMP\supplier-minimal-harness-1786624037979.jsonl`.

## 2. الحالة السابقة والطلب الفاشل

قبل الإصلاح كان المتصفح يصل إلى صفحة Supplier ثم يعرض:
`Preparing workspace → Company readiness could not be loaded`.
تم تشغيل instrumentation قبل navigation. الطلب الفعلي كان:

| الترتيب | URL | Method | Target | Status | Error | النتيجة |
|---|---|---|---|---:|---|---|
| 1 | `http://localhost:8000/api/v1/auth/accessible-companies` | GET | localhost:8000 | 404 | `ROUTE_NOT_FOUND` — `The requested API route was not found.` | فشل bootstrap قبل الجاهزية |

الـfrontend كان يستخدم API base الصحيح `http://localhost:8000/api/v1`. الخطأ كان في
proxy الخاص بالـharness الذي مرر `/api/v1` إلى backend مع إضافة `/api/v1` ثانية، أي
`/api/v1/api/v1/...`. لذلك تم إعادة إثبات `TEST_HARNESS_DEFECT` من network evidence،
وليس تخميناً من timeout.

## 3. الإصلاح المسموح

تم تعديل `backend/scripts/supplier-post-fix-minimal-browser-harness-closeout-02.js`
فقط: إزالة double-prefix عند forwarding، وfulfill محدود لطلب `/events/stream` داخل
الـharness حتى لا يتحول SSE timeout غير المرتبط بالاختبار إلى Console error. لا يوجد
تعديل في `purchases/page.tsx` أو backend Product أو middleware أو `.env`.

حارس Company context بقي كما هو؛ `auth.middleware.js` ما زال يرفض Super Admin
بدون Company بـ`SUPER_ADMIN_COMPANY_CONTEXT_REQUIRED`.

## 4. دليل auth/company/branch

- session المتصفح: authenticated، المستخدم `super_admin`، بدون طباعة token أو cookie.
- Company context مطلوب وموجود من `/auth/accessible-companies` bootstrap، وليس ID
  hardcoded.
- Branch context مطلوب وموجود من `/branches` مع اختيار deterministic للفرع المالي
  `MAIN`; فرع `C10D` بقي `BLOCKED`. لم يتم استخدام first-active fallback.
- بعد الإصلاح: bootstrap/readiness HTTP 200، Supplier page وصل إلى marker وجود
  selector، وجميع طلبات `/settings`, `/branches`, `/inventory-v2/profiles`,
  `/suppliers`, `/products`, `/barcode-settings` نجحت.

## 5. نفس جلسة المتصفح

تم في نفس الصفحة بدون reload دورة:
`GOLD_BAR_24K → GOLD_BY_WEIGHT_JEWELLERY → GOLD_BY_PIECE → GOLD_BAR_24K`.
النهائي `GOLD_BAR_24K`, karat `24`, gross `10`, stone `0`, quantity `1`، ومعدل
الشراء الملتقط `500`.

## 6. Preview وUI parity

تم التقاط POST الفعلي إلى `/api/v1/inventory-v2/receive-preview` بالـprofile والعيار
والأوزان ومعدل الذهب. الرد HTTP 200 وread-only:

- `goodsTotal = 5106.25`
- `total = 5106.25`
- `remainingAmount = 5106.25`
- `netWeight = 10.00000000`
- `pureGold9999 = 10.00000000`
- `certificateCost = 100`
- `purchaseVat = 6.25`, `vatRate = 6.25`, source `SETTINGS_DEFAULT`

الواجهة عرضت نفس total والمتبقي، Submit كان disabled قبل اكتمال البيانات ثم enabled
بعد الرد الحالي. لا توجد حالة `unavailable` كاذبة.

## 7. Receipt 201 وClone DB proof

تم الضغط على زر `استلام وتسجيل الأصل` من نفس المتصفح والتقاط POST الفعلي إلى
`/api/v1/purchase-orders/receive`؛ body حافظ على Company/Branch/Supplier/profile/24K/
gross/stone/paid=0 وIdempotency-Key. الرد HTTP 201، PO total/payable/remaining كلها
`5106.25`، paid `0`.

قبل العملية وبعدها داخل Clone:

| الأثر | قبل | بعد | delta |
|---|---:|---:|---:|
| purchase_orders | 314 | 315 | +1 |
| assets | 475 | 476 | +1 |
| asset_purchase_cost_revisions | 442 | 443 | +1 |

الرد أعاد Asset `AST-PUR-1786624050252-1-1-xtnp` وBarcode `GODGOF24000046`.
الـJournal متوازن، inventory debit وsupplier payable credit موجودان، ولا Treasury
movement لاستلام غير مدفوع. لا orphan lineage أو duplicate barcode في Clone proof.

## 8. Idempotency وconsole

Replay بنفس body وIdempotency-Key أعاد HTTP 201 ونفس Asset/Barcode، مع counts ثابتة
`315/476/443`. لذلك `CLONE_BROWSER_RECEIPT_IDEMPOTENCY = PASS`.
بعد عزل SSE داخل الـharness فقط، `consoleErrors = []` ولا توجد page errors أو React
warnings في آخر run.

## 9. Fingerprints والحماية

قراءة SELECT-only الحالية:

| DB | migrations | assets | products | unbalanced | orphan journal lines | unlinked treasury | duplicate barcodes | blank barcodes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `darfus_erp` | 80 | 62 | 3 | 0 | 0 | 0 | 0 | 0 |
| `darfus_erp_inventory_rehearsal_20260804_160500z` | 80 | 475 | 3 | 0 | 0 | 0 | 0 | 0 |

تم أخذ source dump من Acceptance فقط وإنشاء Clone باسم
`darfus_erp_supplier_minimal_harness_1786624037982`، ثم إيقاف backend المؤقت
وإسقاط القاعدة والتحقق من عدم وجودها. لا Migration 81، لا `.env` change، ولا normal
runtime restart أو Next dev.

## 10. الاختبارات

- `npx tsc --noEmit`: PASS.
- focused ESLint على Supplier Receive page: PASS.
- focused Node tests: 19/19 PASS، وتشمل preview guard، profile switch، D01/D11
  contracts، clone guard، gold valuation، وidempotency contracts.
- Browser/network receipt run: PASS؛ readiness، preview، submit، receipt، DB delta،
  replay، console، cleanup كلها PASS.

## 11. Git وnext-env

Branch `main`, HEAD `1657b0e9ba580faef69be48f04637835c201b521`. worktree فيه تغييرات
موروثة كثيرة؛ لم يتم stage/commit/push/reset/restore/clean/stash. ملف هذه الجولة الوحيد
المقصود هو harness أعلاه، مع التقرير وتحديث handoff. next-env بقي على known inherited
drift SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` بدون
تعديل؛ لم يتم تشغيل Next dev.

## 12. القرار

`SUPPLIER_MINIMAL_HARNESS_AUTH_BOOTSTRAP_COMPANY_READINESS_CLOSEOUT_03_GATE = PASS_CONFIRMED`

الخطوة التالية المسموح بها فقط هي `LOCAL-PRODUCTION-SMOKE-01-RETRY-STRICT-RUNTIME`؛
لم تبدأ تلقائياً.

## 13. Required tokens

```text
CURRENT_BATCH = SUPPLIER-MINIMAL-HARNESS-AUTH-BOOTSTRAP-COMPANY-READINESS-CLOSEOUT-03
MODE = AUTH_BOOTSTRAP_COMPANY_READINESS_CLOSEOUT
STATIC_ONLY_PASS_ALLOWED = NO
PREVIOUS_TIMEOUT_CLASSIFICATION = YES
PRE_PAGE_NETWORK_CAPTURE = YES
FRONTEND_API_TARGET_CORRECT = PASS
BROWSER_AUTH_SESSION = PASS
COMPANY_CONTEXT_REQUIRED = YES
COMPANY_CONTEXT_PRESENT = YES
COMPANY_CONTEXT_SOURCE = /auth/accessible-companies bootstrap
HARDCODED_COMPANY_ID_USED = NO
BRANCH_CONTEXT_REQUIRED = YES
BRANCH_CONTEXT_PRESENT = YES
FIRST_ACTIVE_BRANCH_SELECTION_USED = NO
COMPANY_READINESS_ENDPOINT_IDENTIFIED = YES
PRE_FIX_COMPANY_READINESS_FAILURE_CAPTURED = YES
COMPANY_READINESS_HTTP_STATUS_PRE_FIX = 404
COMPANY_READINESS_ERROR_CODE_PRE_FIX = ROUTE_NOT_FOUND
COMPANY_READINESS_ERROR_MESSAGE_PRE_FIX = The requested API route was not found.
COMPANY_READINESS_ROOT_CAUSE = HARNESS_ROUTE_DOUBLE_PREFIX
FIX_SCOPE = HARNESS_ONLY
COMPANY_CONTEXT_SECURITY_FAIL_CLOSED = PASS
COMPANY_READINESS_HTTP_STATUS_POST_FIX = 200
COMPANY_READINESS_RUNTIME = PASS
SUPPLIER_PAGE_READY = PASS
SAME_BROWSER_MULTI_SWITCH = PASS
FINAL_BROWSER_PROFILE = GOLD_BAR_24K
FINAL_BROWSER_KARAT = 24
ACTUAL_PREVIEW_POST_CAPTURED = YES
ACTUAL_PREVIEW_RESPONSE_CAPTURED = YES
PREVIEW_HTTP_STATUS = 200
PREVIEW_UI_PARITY = PASS
FALSE_UNAVAILABLE_RUNTIME = NO
SUBMIT_ENABLEMENT_POST_FIX = PASS
ACTUAL_UI_SUBMIT_CLICKED = YES
ACTUAL_BROWSER_RECEIPT_POST_CAPTURED = YES
RECEIPT_POST_BODY_PARITY = PASS
ACTUAL_BROWSER_RECEIPT_RESPONSE_CAPTURED = YES
RECEIPT_HTTP_STATUS = 201
CLONE_BROWSER_RECEIPT_DB_PROOF = PASS
CLONE_BROWSER_RECEIPT_IDEMPOTENCY = PASS
PROFILE_SWITCH_REGRESSION = PASS
BROWSER_CONSOLE_RUNTIME = PASS
BOOTSTRAP_NETWORK_TABLE = COMPLETE
AUTH_CONTEXT_EVIDENCE_TABLE = COMPLETE
AUTH_BOOTSTRAP_CHECKPOINT_TABLE = COMPLETE
RECEIPT_RUNTIME_TABLE = COMPLETE
PERSISTENT_BROWSER_READONLY_ACCEPTANCE = PASS
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
ACCEPTANCE_SOURCE_PRESERVED = PASS
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
BROWSER_CLOSED = PASS
EPHEMERAL_CLONE_RUNTIME_STOPPED = PASS
DISPOSABLE_CLONE_DROPPED = PASS
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
ACCEPTANCE_MIGRATIONS = 80
MIGRATION_81_CREATED = NO
RUNTIME_ENV_CHANGED = NO
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
CGP_DISPATCHER_MUTATED_THIS_BATCH = NO
MANUAL_RUNTIME_RESTART_THIS_BATCH = NO
NEXT_DEV_STARTED_OR_RESTARTED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
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
HANDOFF_AUTH_BOOTSTRAP_CLOSEOUT_CLOSED = YES
SUPPLIER_MINIMAL_HARNESS_AUTH_BOOTSTRAP_COMPANY_READINESS_CLOSEOUT_03_GATE = PASS_CONFIRMED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = LOCAL-PRODUCTION-SMOKE-01-RETRY-STRICT-RUNTIME_IF_PASS
```
