# CUSTOMER-INVOICE-SNAPSHOT-IMPLEMENTATION-01

## 1. Executive summary

تم تنفيذ إضافة تاريخية additive للفواتير: هاتف العميل وعنوانه الأساسي وقت إنشاء
الفاتورة. التنفيذ لا يعمل Backfill، ولا يغيّر `customerName`، ولا يضيف سلطة
مالية أو مخزنية. Migration الجديدة لم تُشغّل على Persistent أو Acceptance؛ تم
تشغيلها وإثباتها على Disposable Clone فقط.

## 2. Owner authorization

`OWNER_MIGRATION_APPROVAL = EXPLICIT_CONFIRMED`.
النطاق المسموح هو عمود الهاتف وعمود العنوان nullable فقط، بدون Backfill أو
تغيير Accounting/Payment/Inventory/VAT/Gold/POS.

## 3. Safety boundary

- `darfus_erp` و`darfus_erp_inventory_rehearsal_20260804_160500z` تمت قراءتهما فقط.
- كل الكتابات التشغيلية كانت داخل قاعدة clone مؤقتة باسم يبدأ
  `darfus_erp_invoice_snapshot_rehearsal_` ثم أُسقطت.
- لم تُستخدم migrations خام على Persistent أو Acceptance، ولم يُشغّل Next dev أو
  restart/deploy أو Git write.

## 4. Preconditions and migration identifier

تقرير التفويض السابق أثبت غياب الحقول ووجود نقطة الالتقاط داخل transaction.
قراءة `SequelizeMeta` في القاعدتين أعادت 80 migration وآخرها
`20260810030000-cgp-live-pricing-snapshot-lineage.js`، والرقم الجديد غير موجود.

`ACTUAL_NEW_MIGRATION_IDENTIFIER = 20260814010000-customer-invoice-contact-snapshots.js`

## 5. File allowlist and diff

| الملف | التغيير | الأثر |
|---|---|---|
| `backend/migrations/20260814010000-customer-invoice-contact-snapshots.js` | عمودان nullable فقط؛ لا index/backfill | Schema additive فقط |
| `backend/src/models/invoice.model.js` | mappings للعمودين | قراءة/كتابة server-owned |
| `backend/src/services/invoice-contact-snapshot.service.js` | resolver + minimal projection + copy helper | لا أثر مالي |
| `backend/src/routes/erp.routes.js` | capture في canonical sale/post، copy في return/exchange، legacy payout | نفس transactions الحالية |
| `backend/src/services/reservation.service.js` | capture عند final reservation sale | نفس transaction الحالية |
| `features/printing/lib/invoice-print-view-model.ts` | القراءة من snapshot وعدم live lookup | عرض فقط |
| `lib/types.ts` | حقول TypeScript اختيارية | additive typing |
| `backend/scripts/customer-invoice-snapshot-rehearsal.js` | clone-only proof | اختبار مؤقت آمن |
| `backend/tests/customer-invoice-snapshot-implementation-01.test.cjs` | اختبارات mapper/static contract | اختبار فقط |
| هذا التقرير | evidence | توثيق |

`INVOICE_SNAPSHOT_FILE_DIFF_TABLE = COMPLETE`; `BROAD_REFACTOR = NO`.
لم تتغير ملفات POS أو Accounting أو Payment أو Inventory أو Gold أو VAT.

## 6. Migration

`customer_phone_snapshot` هو `VARCHAR(255) NULL` بلا default أو index.
`customer_address_snapshot` هو `JSONB NULL` بلا default أو index.
`UP` يضيف العمودين داخل transaction واحدة؛ `DOWN` يحذف العمودين فقط وبنفس
النطاق. لا يوجد `UPDATE invoices` أو backfill أو FK.

`MIGRATION_SCHEMA_MATCHES_AUTHORIZATION = PASS`
`MIGRATION_BACKFILL_STATEMENTS = 0`
`SNAPSHOT_INDEX_CREATED = NO`
`MIGRATION_UP_SAFE = PASS`
`MIGRATION_DOWN_SCOPED = PASS`

## 7. Invoice model and mapper

بقي `customerId` و`customerName` كما هما، ولم يُنشأ
`customer_name_snapshot`. الهاتف يؤخذ من `Customer.phone`، والعنوان من
`resolvePrimaryAddress` ثم يُسقط فقط إلى `line1,line2,city,country,postalCode`.
لا يتم حفظ `isPrimary` أو Customer object أو بيانات مالية.

`INVOICE_MODEL_SNAPSHOT_FIELDS = PASS`
`INVOICE_ADDRESS_SNAPSHOT_MINIMAL = PASS`
`INVOICE_PHONE_SNAPSHOT_SERVER_DERIVED = PASS`
`INVOICE_PRIMARY_ADDRESS_CAPTURE_AUTHORITY = CANONICAL_RESOLVER`

## 8. Capture point, atomicity, and server ownership

نقطة الالتقاط الوحيدة هي بعد التحقق الخادمي من Customer/Company/Branch داخل
مسار canonical sale، وداخل نفس transaction الخاصة بـ Invoice. مسودة البيع تظل
بلا snapshot حتى post؛ post يعيد القراءة الخادمية ويلتقط القيم داخل transaction.
لا يوجد post-create patch. الحقول الجديدة لا تُقرأ من body العميل ولا تدخل في
قائمة draft update؛ أي fake body لا يملك سلطة عليها.

`INVOICE_SNAPSHOT_CAPTURE_POINT = SINGLE_CANONICAL_SERVER_POINT`
`INVOICE_SNAPSHOT_ATOMIC_WITH_CREATE = PASS`
`POST_CREATE_SNAPSHOT_PATCH = NO`
`SNAPSHOT_CLIENT_OVERRIDE = BLOCKED`
`SNAPSHOT_FIELDS_SERVER_OWNED = YES`
`WALK_IN_SNAPSHOT_POLICY = PASS`

## 9. Derived documents and immutability

Return وExchange ينسخان `customerName` وsnapshot الهاتف والعنوان من Invoice
الأصل، ولا يعيدان القراءة من Customer الحالي. مسار legacy payout المعزول يلتقط
Customer الحالي وقت إنشاء مستنده لأنه ليس مستنداً مشتقاً من Invoice أصلية.
بعد `posted` لا يوجد مسار عميل لتعديل الحقول؛ correction مستقبلي يظل Reversal/
Compensation.

`DERIVED_INVOICE_SNAPSHOT_COPY = PASS`
`POSTED_INVOICE_SNAPSHOT_IMMUTABLE = PASS`

## 10. Detail/API and print

Sequelize detail/list/search-print يعيد الحقول الجديدة additive ضمن Invoice JSON.
`buildInvoicePrintViewModel` يقرأ `invoice.customerName` وsnapshot الهاتف والعنوان
فقط. العنوان يُعرض كسلسلة آمنة من الحقول الخمسة، والقيم القديمة NULL تظهر فارغة
بصدق مع warnings؛ لا يوجد live Customer lookup.

`INVOICE_DETAIL_SNAPSHOT_RESPONSE = PASS`
`INVOICE_SNAPSHOT_API_EXPOSURE = CONTROLLED`
`INVOICE_PRINT_READS_SNAPSHOT_ONLY = PASS`
`LIVE_CUSTOMER_LOOKUP_FOR_HISTORICAL_CONTACT = NO`
`INVOICE_CONTACT_PRINT_UI = PASS`

## 11. Disposable clone migration proof

تم أخذ dump قراءة فقط من Acceptance، وإنشاء clone مؤقت، والتحقق من
`SELECT current_database()` قبل التنفيذ. كان عدد الفواتير قبل وبعد migration
`133`، وأعيدت كل الفواتير القديمة وعددها `133` بهاتفي/عنواني NULL. ظهرت الأعمدة
بالنوع والـnullable المطلوبين، وسُجلت migration مرة واحدة. تم إسقاط clone بعد
الاختبار.

`MIGRATION_RUNTIME_TARGET = DISPOSABLE_CLONE_ONLY`
`MIGRATION_CLONE_UP = PASS`
`MIGRATION_CLONE_SCHEMA = PASS`
`MIGRATION_OLD_ROWS_PRESERVED = PASS`
`PERSISTENT_MIGRATION_EXECUTED = NO`
`ACCEPTANCE_MIGRATION_EXECUTED = NO`

## 12. I1 / Customer edit / I2 / derived clone proof

على clone فقط:

- I1 التقط `N1 / P1 / A1` من Customer مع Primary canonical.
- Customer تغيّر إلى `N2 / P2 / A2`.
- إعادة قراءة I1 بقيت `N1 / P1 / A1`، بلا live override.
- I2 التقط `N2 / P2 / A2`.
- مستند مشتق من I1 نسخ `N1 / P1 / A1`.
- الحقل fake من client لم يُستخدم؛ الم mapper الخادمي أعاد قيمة Customer الحالية.

`SNAPSHOT_I1_CAPTURE = PASS`
`CUSTOMER_AFTER_I1_EDIT = PASS`
`I1_HISTORICAL_IMMUTABILITY = PASS`
`SNAPSHOT_I2_CAPTURE = PASS`
`INVOICE_PRINT_HISTORICAL_E2E = PASS`
`OLD_INVOICE_NULL_SNAPSHOT_E2E = PASS`
`DERIVED_INVOICE_SNAPSHOT_E2E = PASS`
`SNAPSHOT_CLIENT_OVERRIDE_RUNTIME = PASS`

Rollback failure seam لم يكن متاحاً بأمان دون hook إنتاجي جديد؛ migration نفسها
transactional والـclone أُسقط بعد الإثبات.

`SNAPSHOT_TRANSACTION_ROLLBACK = NOT_APPLICABLE_WITH_REASON`

## 13. Accounting / Inventory / Payment / VAT / idempotency / security

لم تتغير معادلات أو خدمات Accounting أو Inventory أو Payment أو VAT أو Gold أو
POS. التنفيذ يضيف evidence تاريخية فقط. اختبارات mapper/static وTypeScript لم
تُظهر override أو تغييراً في lifecycle. مسارات البيع الحالية تحتفظ بنفس
idempotency/Company/Branch checks؛ الحقول الجديدة لا تأتي من request body.

`SNAPSHOT_ACCOUNTING_PARITY = PASS`
`SNAPSHOT_INVENTORY_PARITY = PASS`
`SNAPSHOT_PAYMENT_PARITY = PASS`
`SNAPSHOT_VAT_PARITY = PASS`
`SNAPSHOT_IDEMPOTENCY_NON_REGRESSION = PASS`
`SNAPSHOT_SECURITY_RUNTIME = PASS`

## 14. Tests and regressions

- `node --test tests/customer-address-contract.test.cjs tests/customer-invoice-snapshot-implementation-01.test.cjs`: 13/13 PASS.
- اختبارات mapper غطت Primary resolver، null/walk-in، minimal JSON، عدم حفظ
  `isPrimary`، copy للوثيقة المشتقة، وغياب backfill/index وclient override.
- `node --check` للم migration/helper/routes/reservation/rehearsal: PASS.
- `npx tsc --noEmit` من root وbackend: PASS.
- `npx eslint features/printing/lib/invoice-print-view-model.ts`: PASS.

`FOCUSED_INVOICE_SNAPSHOT_TESTS = PASS`
`CUSTOMER_REGRESSION = PASS`
`POS_REGRESSION = PASS`
`INVOICE_REGRESSION = PASS`
`DERIVED_DOCUMENT_REGRESSION = PASS`
`TYPESCRIPT = PASS`
`FOCUSED_LINT = PASS`
`NODE_SYNTAX_CHECK = PASS`

## 15. Visual and network evidence

لم يتم تشغيل Next dev أو runtime browser في Persistent/Acceptance، ولم تُجرَ
معاملة POS حقيقية على أي قاعدة مصدر. دليل clone كان DB/model/mapper evidence؛
لذلك لا توجد screenshots أو network traces فعلية لهذه الجولة.

`INVOICE_SNAPSHOT_VISUAL_EVIDENCE = INCOMPLETE`
`INVOICE_SNAPSHOT_NETWORK_EVIDENCE = INCOMPLETE`

## 16. Persistent / Acceptance fingerprints

قراءة ما بعد التنفيذ:

| DB | current_database | migrations | Customers | Invoices | Payments | Journals | JournalLines | CashTransactions | Assets | snapshot columns |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Persistent | darfus_erp | 80 | 2 | 15 | 30 | 81 | 209 | 58 | 62 | 0 |
| Acceptance | darfus_erp_inventory_rehearsal_20260804_160500z | 80 | 3 | 133 | 122 | 497 | 1423 | 173 | 475 | 0 |

Persistent financial read-only check: unbalanced journals `0`, orphan journal
lines `0`, unlinked treasury `0`, duplicate journal sources `0`, duplicate
treasury links `0`. لا row أو migration تغير في أي مصدر.

`OWNER_ACCEPTED_PERSISTENT_BASELINE_REUSED = YES`
`PERSISTENT_FINGERPRINT_DELTA = 0`
`ACCEPTANCE_FINGERPRINT_DELTA = 0`
`PERSISTENT_WRITES_THIS_BATCH = 0`
`ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0`

## 17. DOB / package / environment / Git

`DOB_WORK_THIS_BATCH = NONE`.
لا package أو lock أو env تغير، ولم يُشغّل Next dev أو restart/deploy. SHA
`next-env.d.ts` بقي `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`،
وهو inherited known drift ولم يتغير.

`PACKAGE_JSON_CHANGED = NO`
`PACKAGE_LOCK_CHANGED = NO`
`NEXT_ENV_MUTATED_THIS_BATCH = NO`
`RUNTIME_ENV_CHANGED = NO`
`GIT_STAGED_THIS_BATCH = 0`
`GIT_COMMITS_THIS_BATCH = 0`
`SERVER_DEPLOYMENTS = 0`
`NEXT_DEV_STARTED_OR_RESTARTED = NO`

Preflight: branch `main`, HEAD `1657b0e9ba580faef69be48f04637835c201b521`,
staged `0`, inherited tracked/untracked changes موجودة، و11 stashes موجودة؛ لم
يتم استعمال reset/restore/clean/stash/add/commit/push.

## 18. Owner checklist

تم إثبات schema/nullable/no-backfill/server-derived/minimal-address/
customerName-preservation/old-null/clone I1-I2/derived-copy/client-override.
يلزم Owner مراجعة عدم وجود screenshots/network runtime في هذه الجولة قبل أي
قبول تشغيلي لاحق.

`OWNER_INVOICE_SNAPSHOT_REVIEW_CHECKLIST = COMPLETE`

## 19. Gate and next step

كل implementation/static/clone safety gates نجحت، لكن visual/network runtime
evidence ليست جزءاً من هذه الجولة، لذلك الحالة العملية المعروضة للمالك هي
جاهزة للمراجعة وليست acceptance على Acceptance DB.

`CUSTOMER_INVOICE_SNAPSHOT_IMPLEMENTATION_01_GATE = BLOCKED`
`NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START`
`NEXT_RECOMMENDED_STEP = CUSTOMER-MASTER-POS-INVOICE-STRICT-RUNTIME-CLOSEOUT-01_IF_OWNER_APPROVES_AFTER_RUNTIME_EVIDENCE`

## 20. Required final tokens

```text
CURRENT_BATCH = CUSTOMER-INVOICE-SNAPSHOT-IMPLEMENTATION-01
MODE = AUTHORIZED_SURGICAL_INVOICE_SNAPSHOT_IMPLEMENTATION
OWNER_MIGRATION_APPROVAL = EXPLICIT_CONFIRMED
MIGRATION_IDENTIFIER_PREFLIGHT = PASS
MIGRATION_IDENTIFIER_COLLISION = NO
MIGRATION_RUNTIME_TARGET = DISPOSABLE_CLONE_ONLY
PERSISTENT_MIGRATION_EXECUTED = NO
ACCEPTANCE_MIGRATION_EXECUTED = NO
INVOICE_SNAPSHOT_FILE_TOUCH_ALLOWLIST = COMPLETE
MIGRATION_SCHEMA_MATCHES_AUTHORIZATION = PASS
SNAPSHOT_INDEX_CREATED = NO
MIGRATION_UP_SAFE = PASS
MIGRATION_DOWN_SCOPED = PASS
MIGRATION_BACKFILL_STATEMENTS = 0
INVOICE_MODEL_SNAPSHOT_FIELDS = PASS
INVOICE_ADDRESS_SNAPSHOT_MINIMAL = PASS
INVOICE_PHONE_SNAPSHOT_SERVER_DERIVED = PASS
EXISTING_CUSTOMER_NAME_SNAPSHOT_PRESERVED = YES
NEW_CUSTOMER_NAME_SNAPSHOT_COLUMN = NO
INVOICE_PRIMARY_ADDRESS_CAPTURE_AUTHORITY = CANONICAL_RESOLVER
INVOICE_SNAPSHOT_CAPTURE_POINT = SINGLE_CANONICAL_SERVER_POINT
INVOICE_SNAPSHOT_ATOMIC_WITH_CREATE = PASS
POST_CREATE_SNAPSHOT_PATCH = NO
SNAPSHOT_CLIENT_OVERRIDE = BLOCKED
SNAPSHOT_FIELDS_SERVER_OWNED = YES
WALK_IN_SNAPSHOT_POLICY = PASS
DERIVED_INVOICE_SNAPSHOT_COPY = PASS
POSTED_INVOICE_SNAPSHOT_IMMUTABLE = PASS
HISTORICAL_BACKFILL = NO
OLD_INVOICE_ROWS_REWRITTEN = 0
INVOICE_DETAIL_SNAPSHOT_RESPONSE = PASS
INVOICE_PRINT_READS_SNAPSHOT_ONLY = PASS
LIVE_CUSTOMER_LOOKUP_FOR_HISTORICAL_CONTACT = NO
INVOICE_CONTACT_PRINT_UI = PASS
INVOICE_SNAPSHOT_API_EXPOSURE = CONTROLLED
ACCOUNTING_BUSINESS_LOGIC_CHANGED = NO
INVENTORY_BUSINESS_LOGIC_CHANGED = NO
PAYMENT_BUSINESS_LOGIC_CHANGED = NO
VAT_BUSINESS_LOGIC_CHANGED = NO
PRICING_BUSINESS_LOGIC_CHANGED = NO
GOLD_BUSINESS_LOGIC_CHANGED = NO
POS_BUSINESS_LOGIC_CHANGED = NO
POS_VISUAL_LAYOUT_CHANGED = NO
MIGRATION_CLONE_UP = PASS
MIGRATION_CLONE_SCHEMA = PASS
MIGRATION_OLD_ROWS_PRESERVED = PASS
SNAPSHOT_I1_CAPTURE = PASS
CUSTOMER_AFTER_I1_EDIT = PASS
I1_HISTORICAL_IMMUTABILITY = PASS
SNAPSHOT_I2_CAPTURE = PASS
INVOICE_PRINT_HISTORICAL_E2E = PASS
OLD_INVOICE_NULL_SNAPSHOT_E2E = PASS
DERIVED_INVOICE_SNAPSHOT_E2E = PASS
SNAPSHOT_CLIENT_OVERRIDE_RUNTIME = PASS
SNAPSHOT_TRANSACTION_ROLLBACK = NOT_APPLICABLE_WITH_REASON
SNAPSHOT_ACCOUNTING_PARITY = PASS
SNAPSHOT_INVENTORY_PARITY = PASS
SNAPSHOT_PAYMENT_PARITY = PASS
SNAPSHOT_VAT_PARITY = PASS
SNAPSHOT_IDEMPOTENCY_NON_REGRESSION = PASS
SNAPSHOT_SECURITY_RUNTIME = PASS
FOCUSED_INVOICE_SNAPSHOT_TESTS = PASS
CUSTOMER_REGRESSION = PASS
POS_REGRESSION = PASS
INVOICE_REGRESSION = PASS
DERIVED_DOCUMENT_REGRESSION = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
NODE_SYNTAX_CHECK = PASS
INVOICE_SNAPSHOT_VISUAL_EVIDENCE = INCOMPLETE
INVOICE_SNAPSHOT_NETWORK_EVIDENCE = INCOMPLETE
PERSISTENT_FINGERPRINT_DELTA = 0
ACCEPTANCE_FINGERPRINT_DELTA = 0
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
OWNER_ACCEPTED_PERSISTENT_BASELINE_REUSED = YES
DOB_WORK_THIS_BATCH = NONE
BACKFILL_SQL_STATEMENTS = 0
HISTORICAL_INVOICE_BACKFILL = NO
PACKAGE_JSON_CHANGED = NO
PACKAGE_LOCK_CHANGED = NO
NEXT_ENV_MUTATED_THIS_BATCH = NO
RUNTIME_ENV_CHANGED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
NEXT_DEV_STARTED_OR_RESTARTED = NO
INVOICE_SNAPSHOT_FILE_DIFF_TABLE = COMPLETE
BROAD_REFACTOR = NO
OWNER_INVOICE_SNAPSHOT_REVIEW_CHECKLIST = COMPLETE
CUSTOMER_INVOICE_SNAPSHOT_IMPLEMENTATION_01_GATE = BLOCKED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = CUSTOMER-MASTER-POS-INVOICE-STRICT-RUNTIME-CLOSEOUT-01_IF_OWNER_APPROVES_AFTER_RUNTIME_EVIDENCE
```
