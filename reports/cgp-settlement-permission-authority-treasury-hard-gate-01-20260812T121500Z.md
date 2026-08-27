# CGP-SETTLEMENT-PERMISSION-AUTHORITY-TREASURY-HARD-GATE-01

## 1. قرار المالك والسياسة السابقة

قرار المالك الجديد ألغى قاعدة `EVERY_CUSTOMER_PAYOUT_REQUIRES_APPROVAL`.
السلطة النهائية لصرف العميل هي `gold_purchase.cgp.settle` فقط. لا يوجد
Financial Approval أو Approval Request أو حد مالي للاعتماد.

تم إثبات مصدر الصف السابق قبل عكسه:

- Policy ID: `FAP-a7cb52dc-609e-444b-888a-59bce0732f0e`
- Company: `COMP-1384c23f-18ee-405f-8675-8e87746be72c`
- Operation: `CUSTOMER_PAYOUT`
- Branch: `NULL`
- Currency: `AED`
- Payment method: `NULL`
- `approval_required=true`
- Metadata batch: `CGP-SETTLEMENT-FINANCIAL-APPROVAL-POLICY-CONFIGURATION-01`
- Owner decision metadata: `EVERY_CUSTOMER_PAYOUT_REQUIRES_APPROVAL`
- Dependent settlements before reversal: `0`

## 2. Backup وطريقة العكس

تم أخذ نسخة Persistent قبل التعديل:

`backend/backups/darfus_erp_development_2026-08-12T12-06-32-849Z.dump`

`pg_restore --list` نجح، وSHA-256 هو:
`DB1340164CA664D66BDA5A9F12AD4F3E71B89CAC5F9F951B07A8D27FEEC62D70`.

تم استخدام `deactivateFinancialApprovalPolicy` داخل Transaction canonical.
لم يتم حذف الصف، ولم تتغير أي سياسة أخرى. أُنشئ سجل Audit
`FINANCIAL_APPROVAL_POLICY_DEACTIVATED`.

## 3. سلطة Settlement

تم فصل `CUSTOMER_PAYOUT` عن `evaluateFinancialApprovalPolicy` وعن
`approvals.manage` وعن `ApprovalRequest`. ما زال Generic Financial Approval
Subsystem موجودًا لباقي الاستخدامات.

Route يفرض `gold_purchase.cgp.settle` قبل قراءة المستند أو فحص الخزينة.
LOCAL ADMIN يحتفظ بصلاحيته الحالية، ولم تتغير permission metadata.

## 4. بوابة الخزينة

مصدر الرصيد هو الرصيد المحسوب من جلسة الخزينة المفتوحة عبر دفتر الأستاذ
canonical: `opening_counted_amount + reportable ledger movement since opened_at`.
يجب أن تكون الجلسة `OPEN` لنفس الشركة والفرع والحساب النقدي المعيّن.

تمت إضافة `calculateExpectedDecimal` واستخدام `Decimal` للمقارنة بدقة أربع
خانات. يتم قفل صف جلسة الخزينة داخل Transaction قبل حساب الرصيد، لذلك تتسلسل
الدفعات المتزامنة ولا يمكنها صرف الرصيد نفسه مرتين.

الخطأ عند عدم كفاية النقد:
`INSUFFICIENT_CASH_BALANCE` — `رصيد الخزنة غير كافٍ لإتمام عملية الصرف.`

الفحص يحدث قبل Journal وSettlement وTreasury وLiability update. فشل Cash leg
في MIXED يفشل العملية كلها؛ لا توجد صلاحية Bank balance جديدة أو مخترعة.

## 5. Clone acceptance

تم إنشاء Clone مؤقت من Persistent، والتحقق من قاعدة البيانات داخل نفس المسار،
ثم إسقاطه بعد الاختبار. نجحت الحالات التالية:

- صلاحية settlement: PASS
- بدون اعتماد مالي: PASS
- Cash بصفر وطلب `5182.4854`: رفض مع صفر آثار
- الرصيد `5182.4853`: رفض
- الرصيد المطابق `5182.4854`: نجاح
- رصيد أكبر: نجاح
- Partial Cash: نجاح وتقليل Liability بالمبلغ الدقيق
- Mixed مع Cash كافٍ: نجاح ذري
- Mixed مع Cash غير كافٍ: رفض ذري بلا Bank leg منفرد
- سباق دفعتين: نجاح واحد ورفض الآخر بسبب عدم كفاية النقد
- Bank settlement: PASS وفق المسار الحالي، دون اختراع Bank sufficiency model
- Journal integrity: متوازن، بلا orphan lines أو unlinked Treasury

لم تُنشأ ApprovalRequest لهذا الاختبار.

## 6. Persistent post-check

تم التحقق أن قاعدة Persistent هي `darfus_erp`، migrations = `80`،
Assets = `59`، Products = `3`، والسياسة النشطة لـ`CUSTOMER_PAYOUT` = `0`.

`CGPD-000007` ما زال `POSTED`، Liability ما زالت `OPEN`، outstanding =
`5182.4854 AED`، settled = `0.0000`، وSettlements = `0`.

Persistent cash لم يُموّل، ولم تُنشأ Payment Journal أو Treasury movement.
الفحوص المالية: unbalanced journals = 0، orphan journal lines = 0،
unlinked Treasury = 0. فحوص Barcode الفارغ والمكرر = 0.

## 7. UI والأنظمة الأخرى

واجهة CGP تستخدم permission-derived `canSettle`، ولا تعرض حالة
`APPROVAL_REQUIRED` أو بطاقة Approval Center لصرف العميل. رسالة نقص النقد
الواردة من الخادم تظهر للمستخدم. لم تتغير واجهة Approval العامة أو نظام
الموافقات العام.

Gold runtime بقي `GOLDAPI_IO / LIVE_PROVIDER / 1500 / 2500`، والـwatermark
`2026-08-12T08:32:21.028Z`، والـGlobal Dispatcher ما زال OFF.

## 8. الاختبارات والحماية

- `backend/tests/cgp-settlement-permission-authority-treasury.test.cjs`: PASS
- Clone treasury/settlement proof: PASS
- `verify-cgp-imp-09a.js`: PASS، generic approval non-regression
- TypeScript: PASS
- Focused ESLint: PASS
- لا Migration 81
- لا تعديل `.env`
- لا restart يدوي، ولا Next dev، ولا deploy أو server connection
- next-env بقي على drift المعروف ولم يتغير:
  `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`

## 9. القرار النهائي

`CGP_SETTLEMENT_PERMISSION_AUTHORITY_TREASURY_HARD_GATE_01_GATE = PASS_CONFIRMED`

الدفعة التالية لا تبدأ تلقائيًا. قبل قبول دفع حقيقي يجب استخدام مسار تمويل
الخزينة canonical إن كان موجودًا، وإلا تبدأ دفعة forensic لمسار التمويل.

## Required tokens

```text
CURRENT_BATCH = CGP-SETTLEMENT-PERMISSION-AUTHORITY-TREASURY-HARD-GATE-01
OWNER_FINAL_CUSTOMER_PAYOUT_POLICY = PERMISSION_BASED_NO_FINANCIAL_APPROVAL
CUSTOMER_PAYOUT_AUTHORITY = gold_purchase.cgp.settle
APPROVALS_MANAGE_REQUIRED_FOR_PAYOUT = NO
LOCAL_ADMIN_DIRECT_PAYOUT_AUTHORITY = PASS
PERMISSION_METADATA_CHANGED = NO
CUSTOMER_PAYOUT_FINANCIAL_APPROVAL_GATE = REMOVED
GENERIC_FINANCIAL_APPROVAL_SUBSYSTEM_CHANGED = NO
SUPERSEDED_POLICY_PROVENANCE = PASS
SUPERSEDED_POLICY_REVERSAL_METHOD = canonical deactivateFinancialApprovalPolicy soft-retire with audit
PRE_POLICY_REVERSAL_BACKUP = PASS
PERSISTENT_POLICY_METADATA_WRITES = 1 exact policy deactivation
PERSISTENT_BUSINESS_TRANSACTION_WRITES = 0
CUSTOMER_PAYOUT_APPROVAL_REQUEST_FLOW = NONE
PERSISTENT_FINANCIAL_APPROVAL_REQUESTS_CREATED = 0
CASH_SUFFICIENCY_HARD_GATE = IMPLEMENTED
CASH_AVAILABLE_AUTHORITY = open cash session opening amount plus canonical reportable ledger movement
OPEN_CASH_SESSION_REQUIRED = YES
INSUFFICIENT_CASH_ERROR_LOCALIZED = PASS
ZERO_CASH_5182_4854_REJECTED = PASS
CASH_EXACT_BALANCE_ALLOWED = PASS
CASH_GREATER_BALANCE_ALLOWED = PASS
CASH_SUFFICIENCY_DECIMAL_PRECISION = PASS
MIXED_CASH_LEG_SUFFICIENCY = PASS
MIXED_INSUFFICIENT_CASH_ATOMIC_FAIL = PASS
BANK_SUFFICIENCY_AUTHORITY = NONE; existing bank path only
BANK_BALANCE_MODEL_INVENTED = NO
NO_SETTLE_PERMISSION_FAIL_CLOSED = PASS
LOCAL_ADMIN_PERMISSION_GATE = PASS
SETTLEMENT_AUTHORIZATION_VALIDATION_ORDER = auth/context -> settle permission -> document/liability -> idempotency/amount/method -> account/session -> cash sufficiency -> atomic settlement
CUSTOMER_PAYOUT_POLICY_CONFIGURATION_ERROR = NOT_APPLICABLE
SETTLEMENT_CANONICAL_TRANSACTION_REUSED = YES
CASH_SETTLEMENT_ACCOUNTING_NONREGRESSION = PASS
LIABILITY_REDUCTION_AFTER_TREASURY_VALIDATION_ONLY = PASS
INSUFFICIENT_CASH_RETRY_SAFE = PASS
INSUFFICIENT_CASH_ZERO_SIDE_EFFECTS = PASS
CLONE_CASH_SETTLEMENT_SUCCESS = PASS
CLONE_PARTIAL_CASH_SETTLEMENT = PASS
CLONE_INSUFFICIENT_CASH_REJECTION = PASS
CLONE_MIXED_SETTLEMENT = PASS
CLONE_BANK_SETTLEMENT_REGRESSION = PASS
CGPD_000007_UNPAID_PRESERVED = PASS
SETTLEMENT_UI_PERMISSION_AUTHORITY = PASS
CUSTOMER_PAYOUT_APPROVAL_CENTER_ENTRY = NONE
STALE_CUSTOMER_PAYOUT_APPROVAL_UX = REMOVED
SETTLEMENT_CLIENT_BYPASS = NONE
CASH_SESSION_SCOPE_ENFORCEMENT = PASS
CASH_SUFFICIENCY_CONCURRENCY_SAFE = PASS
CONCURRENT_CASH_PAYOUT_OVERDRAW_PREVENTED = PASS
CASH_NEGATIVE_BALANCE_PREVENTED = PASS
ACTIVE_CUSTOMER_PAYOUT_APPROVAL_POLICY_COUNT = 0
SETTLE_WITHOUT_APPROVALS_MANAGE_AUTHORIZATION = PASS
APPROVALS_MANAGE_WITHOUT_SETTLE_DENIED = PASS
GENERIC_FINANCIAL_APPROVAL_NONREGRESSION = PASS
TREASURY_UI_NONREGRESSION = PASS
PERSISTENT_CASH_FUNDING_THIS_BATCH = 0
PERSISTENT_DELTA_CLASSIFICATION = SUPERSEDED_POLICY_METADATA_REVERSAL_ONLY
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
GOLD_RUNTIME_1500_2500_PRESERVED = PASS
CGP_RUNTIME_DISPATCHER_NONREGRESSION = PASS
RUNTIME_WATERMARK_PRESERVED = PASS
GLOBAL_DISPATCHER_ENABLED = NO
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO
RUNTIME_ENV_CHANGED = NO
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
MANUAL_BACKEND_RESTART_THIS_BATCH = NO
NODEMON_AUTO_RELOAD = NO
FRONTEND_HOT_RELOAD = NOT_OBSERVED
NEXT_DEV_STARTED_OR_RESTARTED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
TARGETED_SETTLEMENT_TREASURY_TESTS = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
SETTLEMENT_AUTHORITY_TREASURY_STATIC_VERIFIER = PASS
HANDOFF_SETTLEMENT_AUTHORITY_ACCURATE = YES
CGP_SETTLEMENT_PERMISSION_AUTHORITY_TREASURY_HARD_GATE_01_GATE = PASS_CONFIRMED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = TREASURY-CASH-FUNDING-AND-CGP-PAYOUT-ACCEPTANCE-01_IF_EXISTING_CANONICAL_FUNDING
```
