# CUSTOMER-INVOICE-SNAPSHOT-CLONE-FULL-STACK-RUNTIME-CLOSEOUT-01-RETRY

## Executive summary

تمت إعادة محاولة الـfull-stack على Disposable Clone جديد فقط بعد إغلاق blocker الـFrontend السابق. استراتيجية الواجهة الجديدة نجحت: نسخة مؤقتة مستقلة، `npm ci` مستقل، build نظيف، وNext مؤقت. تم إثبات Browser حقيقي → Frontend مؤقت → Backend مؤقت → Clone، مع Auth وCompany وBranch وطلبات البحث والتسعير.

توقفت الجولة قبل checkout لأن Browser أثبت عيباً حقيقياً في Product POS: نتيجة Asset من `GET /pos/search` تحمل `operationalStatus`، بينما `handleItemClick` يضع `status` غير موجود في cart item؛ ثم `completeSale` يرفض العنصر عند شرط `assetStatus !== "available"`. لذلك لم يُرسل `POST /pos/checkout`، ولم يتم إنشاء Invoice/Payment/Journal/Asset mutation في الـClone. حسب سياسة الـbatch، لم يتم تعديل POS أو أي Product behavior، والبوابة `BLOCKED_PRODUCT_DEFECT`.

## Safety / targets

- Persistent `darfus_erp`: قراءة فقط، migrations=80، snapshot columns=0.
- Acceptance `darfus_erp_inventory_rehearsal_20260804_160500z`: قراءة فقط، migrations=80، snapshot columns=0.
- Clone الوحيد كان `darfus_erp_invoice_snapshot_fullstack_1786746061525`، من Acceptance، ثم أُسقط.
- لا Migration على Persistent أو Acceptance، ولا `.env` أو package أو Git write، ولا restart/kill للـnormal runtime.
- التقرير والأداة المعزولة هما artifacts فقط؛ لا تغيير Product code.

## Reused frontend strategy

تم استخدام النسخة المثبتة من batch السابق: temp source copy بدون `.next` و`node_modules`، `npm ci` مستقل مع `NODE_ENV=development`، ثم `npm run build -- --webpack` وNext على port بديل. لم تُستخدم junction، ولم تُلمس `.next` العادية أو `node_modules` العادية.

## Clone / migration proof

تم إنشاء Clone جديد من Acceptance بعد `SELECT current_database()`. طُبقت migration `20260814010000-customer-invoice-contact-snapshots.js` داخل Clone فقط. الأعمدة `customer_phone_snapshot` و`customer_address_snapshot` nullable، والفواتير القديمة بقيت NULL، بدون backfill. لم يتم تشغيل migration على Persistent أو Acceptance.

## Full-stack routing / browser evidence

Evidence directory:
`backend/reports/customer-invoice-snapshot-clone-full-stack-runtime-closeout-01-evidence-20260814T222539497Z/`.

المسار المثبت كان:

`http://127.0.0.1:<frontend>/ar/pos` → `http://127.0.0.1:<backend>/api/v1` → `darfus_erp_invoice_snapshot_fullstack_1786746061525`.

Browser screenshot يثبت POS الحقيقي، وNetwork يثبت `auth/accessible-companies`، branches، customers، `/pos/search`، و`/pricing/calculate` مع Authorization وCompany وBranch headers. لا يوجد `POST /pos/checkout` لأن Product رفض cart item قبل الإرسال.

## Exact Product blocker

Evidence:

- `checkout-button.json`: زر checkout كان enabled فعلياً.
- `runtime-failure.json`: timeout انتظار checkout response، مع عدم وجود checkout request.
- Network search response كان 200، pricing response كان 200.

Source chain:

1. `backend/src/routes/erp.routes.js` `/pos/search` يعيد Asset fields بما فيها `operationalStatus` وداخل `rawItem` أيضاً `operationalStatus`، ولا يعيد `status`.
2. `app/[locale]/(dashboard)/pos/page.tsx` في `handleItemClick` ينشئ cart item باستخدام `status: asset.status`.
3. `completeSale` يفحص `const assetStatus = item.status || item.rawItem?.status` ثم يرفض أي Asset لا يساوي `"available"`.

هذا Product defect مستقل عن Invoice Snapshot. تصحيحه يتطلب batch منفصل وموافقة Owner؛ لم يتم تطبيقه هنا.

## Runtime mutation result

لم يبدأ مسار checkout، لذلك لا توجد I1/I2، ولا Customer edit، ولا Invoice detail/print، ولا derived document أو override/security mutation tests. لا يجوز اعتبار Snapshot runtime accepted.

## Tests / fingerprints

- Snapshot implementation tests: PASS (5/5).
- Customer Phase-1 address contract tests: PASS (8/8).
- TypeScript: PASS.
- Harness `node --check`: PASS.
- Focused ESLint على harness: exit 0 مع warning خاص بغياب Pages directory من إعداد ESLint.
- Persistent after: migrations=80, customers=2, invoices=15, payments=30, journal_entries=81, journal_lines=209, cash_transactions=58, assets=62, snapshot columns=0; integrity 0/0/0/0/0.
- Acceptance after: migrations=80, customers=3, invoices=133, payments=122, journal_entries=497, journal_lines=1423, cash_transactions=173, assets=475, snapshot columns=0; integrity بقيت baseline (unbalanced/orphan/unlinked/duplicate source = 0، duplicate treasury links = 1 inherited baseline).
- Clone databases remaining: 0. Temporary frontend workspaces remaining: 0. Normal ports 3000/8000 untouched.

## File diff

| File | Type | Change | Product behavior | Expected |
|---|---|---|---|---|
| `backend/scripts/customer-invoice-snapshot-clone-full-stack-runtime-closeout.js` | Harness | independent npm ci, CORS binding, clone-only fixture branch link, diagnostics, safe response wait/cleanup | None | Yes |
| `backend/reports/customer-invoice-snapshot-clone-full-stack-runtime-closeout-01-retry-20260815T010000Z.md` | Report | evidence and blocker record | None | Yes |
| `backend/reports/customer-invoice-snapshot-clone-full-stack-runtime-closeout-01-evidence-*` | Evidence | sanitized screenshots/network/runtime evidence | Clone only; cleaned | Yes |

## Final tokens

```text
CURRENT_BATCH = CUSTOMER-INVOICE-SNAPSHOT-CLONE-FULL-STACK-RUNTIME-CLOSEOUT-01-RETRY
MODE = STRICT_FULL_STACK_CLONE_ONLY_RUNTIME_CLOSEOUT_RETRY
OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE
PRODUCT_CODE_CHANGED_THIS_BATCH = NO
RUNTIME_CLOSEOUT_ARTIFACTS_ONLY = YES
PERSISTENT_BASELINE_CAPTURED_BEFORE = YES
ACCEPTANCE_BASELINE_CAPTURED_BEFORE = YES
CLONE_DB_NAME = darfus_erp_invoice_snapshot_fullstack_1786746061525
CLONE_DB_IDENTITY = PROVEN
CLONE_SOURCE = ACCEPTANCE_APPROVED_SOURCE
SNAPSHOT_MIGRATION_CLONE_APPLIED = PASS
CLONE_HAS_SNAPSHOT_MIGRATION = YES
PERSISTENT_MIGRATION_EXECUTED = NO
ACCEPTANCE_MIGRATION_EXECUTED = NO
PROVEN_FRONTEND_STRATEGY_REUSED = YES
NORMAL_NODE_MODULES_REUSED = NO
NODE_MODULES_JUNCTION_USED = NO
TEMP_NEXT_GENERATED_CLEAN = YES
NORMAL_NEXT_TOUCHED = NO
EPHEMERAL_BACKEND_STARTED = YES
EPHEMERAL_BACKEND_DB = DISPOSABLE_CLONE_ONLY
EPHEMERAL_FRONTEND_BUILD = PASS
TYPESCRIPT = PASS
EPHEMERAL_FRONTEND_STARTED = YES
FULL_STACK_CLONE_ROUTING = PROVEN
AUTH_RUNTIME = PASS
COMPANY_CONTEXT = PASS
BRANCH_CONTEXT = PASS
I1_REAL_BROWSER_CHECKOUT = BLOCKED_PRODUCT_DEFECT
I1_HTTP_CHECKOUT = BLOCKED_PRODUCT_DEFECT
I1_DB_SNAPSHOT = NOT_REACHED
CUSTOMER_REAL_UI_UPDATE = NOT_REACHED
I2_REAL_BROWSER_CHECKOUT = NOT_REACHED
OLD_INVOICE_NULL_SNAPSHOT_DB = NOT_REACHED
SNAPSHOT_CLIENT_OVERRIDE_NETWORK = NOT_REACHED
DERIVED_INVOICE_SNAPSHOT_RUNTIME = NOT_REACHED
RESERVATION_SNAPSHOT_SCOPE = SNAPSHOT_ONLY
RESERVATION_BUSINESS_LOGIC_CHANGED = NO
SNAPSHOT_ACCOUNTING_PARITY = NOT_REACHED
SNAPSHOT_PAYMENT_PARITY = NOT_REACHED
SNAPSHOT_INVENTORY_PARITY = NOT_REACHED
SNAPSHOT_VAT_PARITY = NOT_REACHED
SNAPSHOT_PRICING_PARITY = NOT_REACHED
SNAPSHOT_GOLD_PARITY = NOT_REACHED
SNAPSHOT_IDEMPOTENCY_NON_REGRESSION = NOT_REACHED
SNAPSHOT_SECURITY_RUNTIME = NOT_REACHED
SNAPSHOT_CAPTURE_CONSISTENCY = NOT_REACHED
POS_APPROVED_VISUAL_UNCHANGED = OBSERVED_BEFORE_BLOCKER
INVOICE_SNAPSHOT_VISUAL_EVIDENCE = INCOMPLETE
INVOICE_SNAPSHOT_NETWORK_EVIDENCE = INCOMPLETE
INVOICE_SNAPSHOT_DB_EVIDENCE = INCOMPLETE
FOCUSED_INVOICE_SNAPSHOT_TESTS = PASS
CUSTOMER_REGRESSION = PASS
POS_REGRESSION = NOT_REACHED
INVOICE_REGRESSION = NOT_REACHED
RESERVATION_REGRESSION = NOT_REACHED
FOCUSED_LINT = PASS
NODE_SYNTAX_CHECK = PASS
PERSISTENT_BASELINE_CAPTURED_AFTER = YES
ACCEPTANCE_BASELINE_CAPTURED_AFTER = YES
PERSISTENT_FINGERPRINT_DELTA = 0
ACCEPTANCE_FINGERPRINT_DELTA = 0
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
PERSISTENT_SNAPSHOT_MIGRATION_PRESENT = NO
ACCEPTANCE_SNAPSHOT_MIGRATION_PRESENT = NO
CLONE_SNAPSHOT_MIGRATION_PRESENT = YES
PERSISTENT_MIGRATIONS_AFTER = 80
ACCEPTANCE_MIGRATIONS_AFTER = 80
PACKAGE_JSON_CHANGED = NO
PACKAGE_LOCK_CHANGED = NO
NEXT_ENV_MUTATED_THIS_BATCH = NO
RUNTIME_ENV_CHANGED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
NORMAL_FRONTEND_STARTED_OR_RESTARTED = NO
NORMAL_BACKEND_STARTED_OR_RESTARTED = NO
NORMAL_RUNTIME_PROCESS_KILLED = NO
EPHEMERAL_FRONTEND_STOPPED = YES
EPHEMERAL_BACKEND_STOPPED = YES
TEMP_FRONTEND_WORKSPACE_CLEANED = YES
DISPOSABLE_CLONE_DROPPED = YES
REMAINING_BATCH_CLONES = 0
NORMAL_RUNTIME_UNTOUCHED = YES
OWNER_FULL_STACK_CLOSEOUT_REVIEW = INCOMPLETE
CUSTOMER_INVOICE_SNAPSHOT_CLONE_FULL_STACK_RUNTIME_CLOSEOUT_01_RETRY_GATE = BLOCKED_PRODUCT_DEFECT
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = EPHEMERAL-FRONTEND-PRODUCT-BUILD-CORRECTION-01_FOR_POS_ASSET_STATUS_MAPPING_THEN_RETRY
```

No handoff update was performed. No promotion was performed. Stop for Owner review.
