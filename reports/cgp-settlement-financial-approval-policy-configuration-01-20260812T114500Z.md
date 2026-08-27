# CGP-SETTLEMENT-FINANCIAL-APPROVAL-POLICY-CONFIGURATION-01

## النطاق والقرار

هذه الدفعة نفذت قرار المالك الخاص بالسياسة فقط. لم يتم تنفيذ أي Settlement أو
ApprovalRequest أو دفع نقدي/بنكي أو تمويل خزينة. قاعدة `darfus_erp` استُخدمت
لترقية metadata للسياسة فقط، وكل فحوص القبول تمت على Clone مؤقت.

قرار المالك:

`EVERY CUSTOMER_PAYOUT REQUIRES FINANCIAL APPROVAL`

لا يوجد حد مالي يسمح بـ auto-approval.

## نموذج السياسة المطبق

تم استخدام `financial_approval_policy.service.js` و`FinancialApprovalPolicy`
بدون Migration 81 وبدون تعديل Schema.

الصف الوحيد الذي تمت ترقيته:

| الحقل | القيمة |
|---|---|
| Policy ID | `FAP-a7cb52dc-609e-444b-888a-59bce0732f0e` |
| Company | `COMP-1384c23f-18ee-405f-8675-8e87746be72c` |
| Operation | `CUSTOMER_PAYOUT` |
| Branch | `NULL` — نطاق كل فروع الشركة حسب matching الحالي |
| Currency | `AED` |
| Payment method | `NULL` — تغطية CASH وBANK_TRANSFER وMIXED |
| Minimum amount | `0.0000` |
| Maximum amount | `NULL` — بدون سقف مصطنع |
| Approval required | `true` |
| Priority | `0` |
| Version | `1` |
| Effective from | وقت الترقية |

تم حفظ Owner decision وBatch scope في `metadata`. السياسة لا تقبل عملة غير
`AED` ولا تنشئ synonym جديدًا لـ`CUSTOMER_PAYOUT`.

## العزل والنطاق

- الشركة canonical هي شركة واحدة متعددة الفروع.
- يوجد حاليًا فرع Active واحد فقط (`Main Branch`). الصف `branch_id=NULL`
  يغطي فروع الشركة طبقًا لسلوك `policyMatches` الحالي، ولا توجد فروع أخرى
  تحتاج صفًا منفصلًا الآن.
- السياسة مقيدة بالشركة وبعملة AED. اختلاف الشركة أو العملة يفشل مغلقًا.
- لا توجد global policy عابرة للشركات.

## حالة الاعتماد والـSegregation of Duties

خدمة الاعتماد المالية الموجودة تستخدم `approvals.manage` عند اعتماد طلب
`financial-operation`. هذا يثبت permission السلطة الحالية في الخدمة، لكنه لا
يحسم أي أدوار أعمال يجوز لها الاعتماد أو هل self-approval مسموح. لم يتم اختراع
دور جديد، ولم يتم منح أو تعديل أي permission.

مسار CGP Governance (`gold_purchase.cgp.*`) منفصل تمامًا عن اعتماد دفع العميل.
لا يجوز استخدام طلب CGPD-000006 كاعتماد تسوية.

الـorchestration الحالي ما زال ناقصًا: مسار Settlement لا يستدعي
`createFinancialApprovalRequest` تلقائيًا، بل ينتظر `approvalRequestId` معتمدًا
إذا كانت السياسة `APPROVAL_REQUIRED`.

## فحص ما قبل الترقية والـBackup

- `SELECT current_database()` أعاد `darfus_erp` قبل الترقية.
- فحص العمليات النشطة لم يجد أي business write query.
- Backup:
  `backend/backups/darfus_erp_cgp_policy_promotion_2026-08-12T11-37-17-650Z.dump`
- `pg_restore --list` نجح، والحجم `794536` bytes.
- لم يتم كشف credentials أو تعديل `.env`.

`PRE_POLICY_PROMOTION_BACKUP = PASS`

## Clone acceptance

تم إنشاء Clone مؤقت من Persistent، والتحقق من هوية قاعدة البيانات داخل نفس
المسار، ثم إسقاطه بعد الاختبار. لم يتم استخدام Acceptance للكتابة.

قبل السياسة في الـClone:

- تقييم CASH أعاد `POLICY_CONFIGURATION_MISSING`.
- Settlement = `0`.
- Treasury/CashTransaction = بدون أي زيادة.
- ApprovalRequest = `0`.

بعد إنشاء صف السياسة في الـClone، التقييم النقي أعاد:

| الحالة | النتيجة |
|---|---|
| CASH `5182.4854 AED` | `APPROVAL_REQUIRED` |
| BANK_TRANSFER `5182.4854 AED` | `APPROVAL_REQUIRED` |
| MIXED `5182.4854 AED` | `APPROVAL_REQUIRED` |
| مبلغ صغير موجب `0.0001` | `APPROVAL_REQUIRED` |
| مبلغ كبير موجب `999999.9999` | `APPROVAL_REQUIRED` |
| شركة مختلفة | `POLICY_CONFIGURATION_MISSING` |
| عملة USD | `POLICY_CONFIGURATION_MISSING` |
| صفر/سالب | رفض validation الحالي `FINANCIAL_SETTLEMENT_AMOUNT_INVALID` |

أثناء اختبار السياسة في الـClone:

- Settlement writes = `0`.
- Treasury writes = `0`.
- ApprovalRequest writes = `0`.
- لا يوجد payment execution.

## Persistent promotion والقراءة النقية

تمت الترقية عبر `createFinancialApprovalPolicy` داخل transaction canonical، مع
سجل Audit من نفس المسار (`FINANCIAL_APPROVAL_POLICY_CREATED`). عدد policy rows
المضافة = `1`، وتغيير Audit المصاحب هو metadata audit وليس business transaction.

بعد الترقية، التقييم النقي على Persistent أعاد:

- CASH = `APPROVAL_REQUIRED`.
- BANK_TRANSFER = `APPROVAL_REQUIRED`.
- MIXED = `APPROVAL_REQUIRED`.
- شركة مختلفة/عملة مختلفة = fail closed.

لا توجد أي محاولة دفع في هذا التقييم.

## CGPD-000007 بعد الترقية

`CGPD-000007` ما زال:

- `POSTED`.
- Liability = `OPEN`.
- Outstanding = `5182.4854 AED`.
- Settled = `0.0000`.
- Settlements = `0`.
- Settlement legs/allocations = `0 / 0`.
- Financial approval requests = `0`.
- Payment journal = `0`.
- Treasury/Cash movement = `0`.

لا يوجد ادعاء بأن العميل أصبح قابلًا للدفع. ما تم إثباته هو أن بوابة السياسة
أصبحت تعيد `APPROVAL_REQUIRED` بدل `POLICY_CONFIGURATION_MISSING`.

## Cash blocker

جلسة الخزينة الحالية ما زالت `OPEN`، لكن المتاح المحسوب للجلسة `0.0000 AED`.
لم يتم تمويلها ولم تتم إضافة hard gate لكفاية الرصيد في هذه الدفعة.

`SECONDARY_CASH_BLOCKER = INSUFFICIENT_CASH`

لذلك يلزم بعد Orchestration دفعة مستقلة لـCash sufficiency/Treasury hard gate.

## Integrity and non-regression

Persistent read-only verification after promotion:

- migrations = `80`.
- Assets = `59`.
- Products = `3`.
- policy rows = `1`.
- financial-operation ApprovalRequests = `0`.
- settlements/legs/allocations = `0/0/0`.
- unbalanced journals = `0`.
- orphan journal lines = `0`.
- unlinked Treasury = `0`.
- duplicate/blank barcodes = `0/0`.

Acceptance remained read-only; its pre-existing policy/test rows were not
changed. No permission, role, user, CGP, Liability, Asset, Journal, Treasury,
CashSession, Gold, or Inventory data was written.

Gold/runtime remained:

`GOLDAPI_IO / LIVE_PROVIDER / 1500 / 2500`

The CGP-scoped dispatcher watermark remained
`2026-08-12T08:32:21.028Z`; Global Dispatcher remains OFF.

## Tests and static verification

- Clone policy matrix: PASS.
- `node scripts/verify-cgp-imp-09a.js`: PASS (pure acceptance policy verifier).
- `node backend/tests/cgp-imp-11-contract.test.cjs`: PASS.
- `npx tsc --noEmit --pretty false`: PASS.
- Focused ESLint for policy and settlement services: PASS.
- No UI change.

## Protection and process

- No Migration 81.
- No backend/manual restart; no nodemon reload caused by this batch.
- No Next dev start/restart.
- No Git staging, commit, push, reset, restore, clean, or stash.
- `next-env.d.ts` remains the inherited known drift SHA and was not changed:
  `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.
- Handoff was updated only with this policy state and next-task record.

## Final gate

`CGP_SETTLEMENT_FINANCIAL_APPROVAL_POLICY_CONFIGURATION_01_GATE = PASS_POLICY_PROMOTED_APPROVAL_REQUIRED_NOT_ORCHESTRATED`

The next batch is strictly:

`CGP-SETTLEMENT-FINANCIAL-APPROVAL-REQUEST-ORCHESTRATION-01`

It must connect Settlement request → Financial Approval Request → Approval
Center → approved authorization, without permitting payment until the later
cash sufficiency hard gate is also complete.

## Required evidence tokens

```text
CURRENT_BATCH = CGP-SETTLEMENT-FINANCIAL-APPROVAL-POLICY-CONFIGURATION-01
OWNER_FINANCIAL_POLICY = EVERY_CUSTOMER_PAYOUT_REQUIRES_APPROVAL
PERSISTENT_DATABASE_CONFIRMED = darfus_erp
PERSISTENT_MIGRATIONS_INITIAL = 80
CUSTOMER_PAYOUT_AUTO_APPROVAL_THRESHOLD = NONE
FINANCIAL_POLICY_TRANSACTION_TYPE = CUSTOMER_PAYOUT
FINANCIAL_POLICY_COMPANY_SCOPE = COMP-1384c23f-18ee-405f-8675-8e87746be72c
FINANCIAL_POLICY_BRANCH_SCOPE = branch_id NULL / all company branches
OTHER_BRANCH_POLICY_COVERAGE = no other active branches; company-wide row covers them
FINANCIAL_POLICY_CURRENCY_SCOPE = AED
CGP_AED_POLICY_MATCH = PASS
CASH_CUSTOMER_PAYOUT_REQUIRES_APPROVAL = YES
BANK_CUSTOMER_PAYOUT_REQUIRES_APPROVAL = YES
MIXED_CUSTOMER_PAYOUT_REQUIRES_APPROVAL = YES
CUSTOMER_PAYOUT_APPROVAL_AMOUNT_RANGE = ALL_POSITIVE_AMOUNTS
CUSTOMER_PAYOUT_POLICY_DECISION = APPROVAL_REQUIRED
FINANCIAL_APPROVER_AUTHORITY = approvals.manage is current service permission; OWNER_DECISION_REQUIRED for business role authority
SELF_APPROVAL_ALLOWED = OWNER_DECISION_REQUIRED
FINANCIAL_APPROVAL_SOD_MODEL = pending financial-operation + approvals.manage; self-approval not explicitly blocked
CGP_GOVERNANCE_EQUALS_PAYOUT_APPROVAL = NO
PERSISTENT_POLICY_METADATA_WRITES = 1
PERSISTENT_BUSINESS_TRANSACTION_WRITES = 0
PRE_POLICY_PROMOTION_BACKUP = PASS
FINANCIAL_POLICY_COUNT_BEFORE = 0
POLICY_CONFLICT_CHECK = PASS
POLICY_PROMOTION_METHOD = canonical createFinancialApprovalPolicy transaction
FINANCIAL_POLICY_AUDIT = PASS
POLICY_ACCEPTANCE_DATABASE = DISPOSABLE_CLONE
CLONE_CASH_POLICY_MATCH = PASS
CLONE_BANK_POLICY_MATCH = PASS
CLONE_MIXED_POLICY_MATCH = PASS
CLONE_SMALL_AMOUNT_REQUIRES_APPROVAL = PASS
CLONE_LARGE_AMOUNT_REQUIRES_APPROVAL = PASS
CLONE_INVALID_AMOUNT_FAIL_CLOSED = PASS
CLONE_CROSS_COMPANY_FAIL_CLOSED = PASS
CLONE_WRONG_CURRENCY_FAIL_CLOSED = PASS
CLONE_SETTLEMENT_WRITES_FOR_POLICY_TEST = 0
CLONE_TREASURY_WRITES_FOR_POLICY_TEST = 0
SETTLEMENT_POLICY_GATE = APPROVAL_REQUIRED_NOT_EXECUTED
PERSISTENT_FINANCIAL_APPROVAL_REQUESTS_CREATED = 0
CGPD_000007_LIABILITY_UNCHANGED = PASS
SECONDARY_CASH_BLOCKER = INSUFFICIENT_CASH
CASH_SUFFICIENCY_HARD_GATE_IMPLEMENTED_THIS_BATCH = NO
CUSTOMER_PAYOUT_PRODUCTION_READY_AFTER_THIS_BATCH = NO
PERSISTENT_POLICY_PROMOTION = PASS
PERSISTENT_POLICY_EVALUATION = PASS
PERSISTENT_CUSTOMER_PAYOUT_METHOD_COVERAGE = PASS
SETTLEMENT_UI_CHANGED_THIS_BATCH = NO
APPROVAL_CENTER_DATA_MUTATED = NO
PERMISSION_METADATA_CHANGED = NO
CLIENT_POLICY_BYPASS = NONE
GOLD_RUNTIME_1500_2500_PRESERVED = PASS
CGP_RUNTIME_DISPATCHER_NONREGRESSION = PASS
RUNTIME_WATERMARK_PRESERVED = PASS
GLOBAL_DISPATCHER_ENABLED = NO
PERSISTENT_DELTA_CLASSIFICATION = POLICY_METADATA_ONLY
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO
RUNTIME_ENV_CHANGED = NO
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
MANUAL_BACKEND_RESTART_THIS_BATCH = NO
NODEMON_AUTO_RELOAD = NO
NEXT_DEV_STARTED_OR_RESTARTED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
TARGETED_FINANCIAL_POLICY_TESTS = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
FINANCIAL_POLICY_STATIC_VERIFIER = PASS
HANDOFF_FINANCIAL_POLICY_STATE_ACCURATE = YES
CGP_SETTLEMENT_FINANCIAL_APPROVAL_POLICY_CONFIGURATION_01_GATE = PASS_POLICY_PROMOTED_APPROVAL_REQUIRED_NOT_ORCHESTRATED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = CGP-SETTLEMENT-FINANCIAL-APPROVAL-REQUEST-ORCHESTRATION-01
```
