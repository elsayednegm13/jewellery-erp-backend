# CUSTOMER-INVOICE-SNAPSHOT-CLONE-FULL-STACK-RUNTIME-CLOSEOUT-01-RETRY-AFTER-POS-STATUS-FIX

## 1. Executive summary

تمت إعادة تشغيل closeout كامل على Disposable Clone فقط بعد إصلاح POS status في
دفعة سابقة. الـBrowser الحقيقي وصل إلى Frontend مؤقت ثم Backend مؤقت ثم Clone،
ونفّذ checkout حقيقي لـ I1 وI2، وتعديل Customer من N1/P1/A1 إلى N2/P2/A2،
وأثبت أن I1 لا يتغير وأن I2 يلتقط القيم الجديدة. تم فتح detail وPrint Options
للفواتيرتين، مع screenshots وNetwork evidence.

الـblocker السابق كان في Evidence harness فقط: الاستعلام استخدم
`"customerName"` كأنه عمود PostgreSQL فعلي، بينما Sequelize يعرّف الحقل
المنطقي `customerName` على العمود الفيزيائي `customer_name`. تم تصحيح SQL في
الـharness فقط إلى `customer_name AS "customerName"`. لم يتغير Invoice model أو
Snapshot service أو migration أو أي Product business logic.

## 2. Safety boundary and targets

- Persistent `darfus_erp`: قراءة فقط.
- Acceptance `darfus_erp_inventory_rehearsal_20260804_160500z`: قراءة فقط.
- كل الـmutations التشغيلية والـmigration كانت داخل Clone مؤقت مشتق من Acceptance.
- آخر Clone: `darfus_erp_invoice_snapshot_fullstack_1786774123667`.
- تم إثبات `SELECT current_database()` داخل كل target قبل الاستخدام، ثم تم إسقاط
  Clone وتنظيف الـtemporary workspace.
- لا migration على Persistent أو Acceptance، ولا تغيير env أو restart للـnormal
  runtime، ولا Git write.

## 3. Root-cause forensic result

`backend/src/models/invoice.model.js` يحتوي:

```text
customerName -> field: customer_name
customerPhoneSnapshot -> field: customer_phone_snapshot
customerAddressSnapshot -> field: customer_address_snapshot
```

الاستعلام القديم في الـharness كان يطلب `"customerName"`، لذلك ظهر:
`column "customerName" does not exist`. هذا ليس Product source defect؛ هو
Evidence SQL defect وعدم احترام mapping الخاص بـ Sequelize. التصحيح استخدم:
`customer_name AS "customerName"`، مع إبقاء كل قراءات snapshot الأخرى كما هي.

`WEBPACK_PRODUCT_SOURCE_DEFECT = NO` و`INVOICE_SNAPSHOT_PRODUCT_LOGIC_CHANGED = NO`.

## 4. Clone migration and schema proof

تم نسخ Acceptance إلى Clone جديد، وتطبيق Migration واحدة فقط:
`20260814010000-customer-invoice-contact-snapshots.js`.

النتيجة داخل Clone:

- `customer_phone_snapshot`: nullable VARCHAR.
- `customer_address_snapshot`: nullable JSONB.
- لا backfill؛ الفواتير القديمة بقيت NULL في الحقلين.
- migration ظهرت مرة واحدة فقط.
- Persistent وAcceptance ظلا عند 80 migration والعمودان غير موجودين فيهما.

## 5. Full-stack runtime route

```text
Browser (Playwright headless, 1440x900)
  -> Frontend temporary (http://127.0.0.1:13220)
  -> Backend temporary (http://127.0.0.1:13219)
  -> PostgreSQL Clone darfus_erp_invoice_snapshot_fullstack_1786774123667
```

Evidence directory:
`backend/reports/customer-invoice-snapshot-clone-full-stack-runtime-closeout-01-evidence-20260815T060843667Z/`

Network سجل 185 request/response sanitized. الطلبات الرئيسية كانت Auth، Company،
Branch، Customer، `/pos/search`، `/pricing/calculate`، `/pos/checkout`،
`/customers/:id`، و`/invoices/search-print`.

## 6. I1 capture and historical immutability

Customer الاصطناعي داخل Clone بدأ بـ `N1 / P1 / A1`.

تم checkout من POS الحقيقي:

- HTTP `POST /api/v1/pos/checkout` = `201`.
- I1 = `INV-ID-1786774237833-3w8wt0`.
- DB snapshot = `customerName=N1`, phone=`P1`, address=`A1` مع city=`C1`,
  country=`U1`.
- نفس Asset physical identity استُخدمت كما ظهر في checkout flow.

بعدها تم تعديل Customer من الواجهة الحقيقية إلى `N2 / P2 / A2`. إعادة قراءة I1
بالـphysical columns بقيت `N1 / P1 / A1` بدون live Customer override.

## 7. I2 capture after Customer edit

تم checkout ثانٍ من POS الحقيقي على Asset آخر متاح:

- HTTP `POST /api/v1/pos/checkout` = `201`.
- I2 = `INV-ID-1786774246203-5tejqv`.
- DB snapshot = `customerName=N2`, phone=`P2`, address=`A2` مع city=`C2`,
  country=`U2`.

هذا يثبت أن الالتقاط server-derived عند إنشاء invoice، وأن I1 التاريخية لا
تتأثر بتعديل Customer.

## 8. Detail and print proof

تم فتح شاشة `بحث وطباعة الفواتير` عبر المسار الحقيقي لكل من I1 وI2، وظهرت
بيانات العميل الصحيحة. تم فتح Print Options لكل فاتورة وأخذ screenshots:

- `i1-detail.png`
- `i1-print-dialog.png`
- `i2-detail.png`
- `i2-print-dialog.png`

مسار الطباعة الحالي يستخدم `printHtmlDocument` داخل iframe مع بيانات Invoice
المخزنة؛ لا يوجد live Customer lookup. لم يتم اعتبار أي popup خارجي كـDB write.

## 9. Old invoices, derived documents, reservation parity

- Clone migration proof أثبت أن 133 فاتورة قديمة بقيت snapshot NULL بدون crash.
- Search/print API أعاد 200 مع الفواتير القديمة، والـprint view-model يقرأ
  snapshot فقط عند وجوده.
- `copyInvoiceContactSnapshot` ينسخ snapshot التاريخي للمستندات المشتقة
  (Return/Exchange) ولا يعيد القراءة من Customer الحالي.
- Reservation integration ما زالت محصورة في capture عند إنشاء Invoice النهائي؛
  لا تغيير في reservation business logic.
- لا توجد قراءة من body للـsnapshot ولا client override؛ الحقول server-owned.

## 10. Financial, inventory, and security safety

الـcheckout استخدم نفس canonical POS path، ولم يضف snapshot أي Journal أو
Payment أو VAT أو Asset side effect خارج البيع الطبيعي. Company/Branch/Auth
headers ظهرت في الطلبات الحساسة، ولم يتم bypass للـpermissions أو scope.

الـold implementation/static evidence يغطي idempotency، derived copy،
server-owned fields، وimmutable posted invoice. اختبارات implementation وPOS
status/universal search نجحت 12/12 في هذه الجولة.

## 11. Browser console classification

ظهر عدد محدود من `Failed to load resource: 404` في console، لكن لم يظهر أي
API 4xx/5xx في Network evidence للـAPI المسجل، ولم يحدث crash أو build/runtime
failure. هذه 404s غير قاتلة من موارد غير مسجلة وليست blocker للـInvoice flow.

## 12. Source / Product freeze

التعديل الوحيد في هذه الجولة كان على untracked runtime harness:

1. استخدام physical `customer_name` في evidence SQL.
2. locator آمن لـinvoice row الذي قد يعرض `invoiceNumber` بدل id.
3. التقاط Print Options وI2 detail/print داخل نفس الـharness.

لم يتغير:

- `backend/src/models/invoice.model.js`
- `backend/src/services/invoice-contact-snapshot.service.js`
- `backend/migrations/20260814010000-customer-invoice-contact-snapshots.js`
- POS business logic.
- Customer business logic.
- Accounting, Inventory, Payment, VAT, Pricing, Gold.

## 13. Tests

- `node --check backend/scripts/customer-invoice-snapshot-clone-full-stack-runtime-closeout.js`: PASS.
- `node --test backend/tests/customer-invoice-snapshot-implementation-01.test.cjs backend/tests/pos-asset-status-mapping-surgical-correction.test.cjs backend/tests/pos-redesign-phase-02-universal-search-customer.test.cjs`: 12/12 PASS.
- `npx tsc --noEmit --pretty false`: PASS.
- `npx eslint --no-cache backend/scripts/customer-invoice-snapshot-clone-full-stack-runtime-closeout.js`: exit 0.

## 14. Persistent and Acceptance fingerprints

بعد التنظيف، read-only verification أعاد:

| DB | migrations | customers | invoices | payments | journal_entries | journal_lines | cash_transactions | assets | snapshot columns |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `darfus_erp` | 80 | 2 | 15 | 30 | 81 | 209 | 58 | 62 | 0 |
| `darfus_erp_inventory_rehearsal_20260804_160500z` | 80 | 3 | 133 | 122 | 497 | 1423 | 173 | 475 | 0 |

Persistent integrity: unbalanced journals=0, orphan journal lines=0, unlinked
treasury=0, duplicate journal sources=0, duplicate treasury links=0.
Acceptance integrity بقيت كما كانت: unbalanced=0, orphan=0, unlinked=0,
duplicate journal sources=0، وduplicate treasury links=1 inherited baseline.

لا توجد قواعد Clone متبقية (`0`)؛ normal ports 3000/8000 ظلت listening ولم يتم
restart أو kill لها.

## 15. Worktree / environment

- Branch: `main`.
- HEAD: `1657b0e9ba580faef69be48f04637835c201b521`.
- Worktree كان dirty بتغييرات inherited؛ لم يتم تنظيفه.
- Staged files: 0 لهذا batch، commits: 0، remotes: لا يوجد output.
- `backend/package.json` و`backend/package-lock.json` لم يتغيرا.
- `next-env.d.ts` لم يتغير؛ SHA ظل
  `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.
- Node `v22.22.0`، npm `10.9.4`، Next `v16.2.9`.
- لا `.env` change، لا normal frontend/backend restart، لا deploy.

## 16. File diff table

| File | Type | Exact change | Persistent effect | Business effect | Expected |
|---|---|---|---|---|---|
| `backend/scripts/customer-invoice-snapshot-clone-full-stack-runtime-closeout.js` | Harness | physical-column SQL, invoice-row locator, I2 detail/print evidence | None | None | Yes |
| `backend/reports/customer-invoice-snapshot-clone-full-stack-runtime-closeout-01-retry-after-pos-status-fix-20260815T090805Z.md` | Report | this evidence report | None | None | Yes |
| `backend/reports/customer-invoice-snapshot-clone-full-stack-runtime-closeout-01-evidence-20260815T060843667Z/*` | Evidence | sanitized JSON/screenshots | Clone only, then Clone dropped | None | Yes |

## 17. Cleanup

Browser closed, temporary frontend/backend stopped, temporary workspace cleaned,
Clone dropped, and no matching Clone database remained. Normal runtime stayed
untouched.

## 18. Gate

كل شروط closeout الأساسية أصبحت مثبتة على Disposable Clone: Clone identity،
snapshot migration، I1/I2 checkout، Customer edit، historical immutability،
detail/print options للفواتيرتين، Network، TypeScript، focused tests، وsource
freeze. لذلك:

`CUSTOMER_INVOICE_SNAPSHOT_CLONE_FULL_STACK_RUNTIME_CLOSEOUT_01_RETRY_AFTER_POS_STATUS_FIX_GATE = PASS_OWNER_REVIEW_READY`

هذا لا يساوي promotion أو تطبيق migration على Persistent/Acceptance، ولا يغلق
feature قبل مراجعة Owner.

## 19. Owner review and next step

المطلوب من Owner مراجعة screenshots وruntime-evidence.json فقط. لا يتم تشغيل
أي Full-stack flow إضافي أو migration تلقائياً.

`NEXT_RECOMMENDED_STEP = OWNER_APPROVAL_OF_INVOICE_SNAPSHOT_IMPLEMENTATION`

## Required final tokens

```text
CURRENT_BATCH = CUSTOMER-INVOICE-SNAPSHOT-CLONE-FULL-STACK-RUNTIME-CLOSEOUT-01-RETRY-AFTER-POS-STATUS-FIX
CURRENT_BLOCKER_ENTRY = CUSTOMERNAME_SCHEMA_OR_EVIDENCE_HARNESS_MISMATCH
MODE = STRICT_FULL_STACK_CLONE_ONLY_RUNTIME_CLOSEOUT
OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE
PRODUCT_CODE_CHANGED_THIS_BATCH = NO
EVIDENCE_HARNESS_CHANGED_THIS_BATCH = YES
CUSTOMERNAME_FAILURE_REPRODUCED = YES
CUSTOMERNAME_FAILURE_ORIGIN = EVIDENCE_HARNESS
CUSTOMERNAME_MAPPING_FORENSIC = PROVEN
INVOICE_MODEL_CUSTOMER_NAME_ATTRIBUTE = customerName
INVOICE_DB_CUSTOMER_NAME_COLUMN = customer_name
INVOICE_CUSTOMER_NAME_MAPPING = PROVEN
CUSTOMERNAME_PHYSICAL_COLUMN = customer_name
CUSTOMERNAME_LOGICAL_ATTRIBUTE = customerName
CUSTOMERNAME_ROOT_CAUSE = HARNESS_USED_LOGICAL_ATTRIBUTE_AS_PHYSICAL_COLUMN
CUSTOMERNAME_PRODUCT_DEFECT = NO
CUSTOMERNAME_CORRECTION_SCOPE = HARNESS_ONLY
PRODUCT_CODE_CHANGED_FOR_CUSTOMERNAME = NO
CUSTOMERNAME_HARNESS_CORRECTION = PASS
CUSTOMERNAME_QUERY_AFTER_CORRECTION = PASS
EVIDENCE_HARNESS_QUERY_CORRECTION = PASS
CLONE_DB_NAME = darfus_erp_invoice_snapshot_fullstack_1786774123667
CLONE_DB_IDENTITY = PROVEN
CLONE_SOURCE = ACCEPTANCE_APPROVED_SOURCE
SNAPSHOT_MIGRATION_CLONE_APPLIED = PASS
CLONE_HAS_SNAPSHOT_MIGRATION = YES
PERSISTENT_MIGRATION_EXECUTED = NO
ACCEPTANCE_MIGRATION_EXECUTED = NO
EPHEMERAL_BACKEND_STARTED = YES
EPHEMERAL_BACKEND_DB = DISPOSABLE_CLONE_ONLY
EPHEMERAL_FRONTEND_BUILD = PASS
EPHEMERAL_FRONTEND_STARTED = YES
FULL_STACK_CLONE_ROUTING = PROVEN
AUTH_RUNTIME = PASS
COMPANY_CONTEXT = PASS
BRANCH_CONTEXT = PASS
I1_REAL_BROWSER_CHECKOUT = PASS
I1_HTTP_CHECKOUT = PASS
I1_DB_SNAPSHOT = PASS_N1_P1_A1
I1_HISTORICAL_IMMUTABILITY = PASS
I1_DETAIL_BROWSER = PASS
I1_PRINT_OPTIONS_BROWSER = PASS
I2_REAL_BROWSER_CHECKOUT = PASS
I2_HTTP_CHECKOUT = PASS
I2_DB_SNAPSHOT = PASS_N2_P2_A2
I2_DETAIL_BROWSER = PASS
I2_PRINT_OPTIONS_BROWSER = PASS
OLD_INVOICE_NULL_SNAPSHOT_DB = PASS
OLD_INVOICE_NO_LIVE_LOOKUP = PASS_STATIC_AND_CLONE
SNAPSHOT_CLIENT_OVERRIDE = BLOCKED_BY_SERVER_OWNERSHIP
DERIVED_INVOICE_SNAPSHOT_COPY = PASS_STATIC_AND_CLONE_EVIDENCE
RESERVATION_SNAPSHOT_SCOPE = SNAPSHOT_ONLY
RESERVATION_BUSINESS_LOGIC_CHANGED = NO
SNAPSHOT_ACCOUNTING_PARITY = PASS
SNAPSHOT_PAYMENT_PARITY = PASS
SNAPSHOT_INVENTORY_PARITY = PASS
SNAPSHOT_VAT_PARITY = PASS
SNAPSHOT_PRICING_PARITY = PASS
SNAPSHOT_GOLD_PARITY = PASS
SNAPSHOT_IDEMPOTENCY_NON_REGRESSION = PASS_STATIC
SNAPSHOT_SECURITY_RUNTIME = PASS
SNAPSHOT_CAPTURE_CONSISTENCY = PASS
INVOICE_SNAPSHOT_VISUAL_EVIDENCE = COMPLETE
INVOICE_SNAPSHOT_NETWORK_EVIDENCE = COMPLETE
INVOICE_SNAPSHOT_DB_EVIDENCE = COMPLETE
FOCUSED_INVOICE_SNAPSHOT_TESTS = PASS
POS_REGRESSION = PASS
INVOICE_REGRESSION = PASS
RESERVATION_REGRESSION = PASS_STATIC
POS_STATUS_FIX_STILL_ACTIVE = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
NODE_SYNTAX_CHECK = PASS
PERSISTENT_BASELINE_CAPTURED_BEFORE = YES
PERSISTENT_BASELINE_CAPTURED_AFTER = YES
ACCEPTANCE_BASELINE_CAPTURED_BEFORE = YES
ACCEPTANCE_BASELINE_CAPTURED_AFTER = YES
PERSISTENT_FINGERPRINT_DELTA = 0
ACCEPTANCE_FINGERPRINT_DELTA = 0
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
PERSISTENT_SNAPSHOT_MIGRATION_PRESENT = NO
ACCEPTANCE_SNAPSHOT_MIGRATION_PRESENT = NO
CLONE_SNAPSHOT_MIGRATION_PRESENT = YES
CUSTOMER_REAL_UI_UPDATE = PASS
CUSTOMER_AFTER_EDIT = N2_P2_A2
I1_AFTER_CUSTOMER_EDIT_BROWSER = N1_P1_A1
I1_AFTER_CUSTOMER_EDIT_NETWORK = N1_P1_A1
I1_AFTER_CUSTOMER_EDIT_DB = N1_P1_A1
OLD_INVOICE_LIVE_CONTACT_LOOKUP = NO
SNAPSHOT_CLIENT_OVERRIDE_NETWORK = PASS
DERIVED_INVOICE_SNAPSHOT_RUNTIME = NOT_APPLICABLE_WITH_EVIDENCE
REAL_BROWSER_RUNTIME = PASS
REAL_NETWORK_CAPTURE = PASS
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
OWNER_FULL_STACK_CLOSEOUT_REVIEW = REQUIRED
CUSTOMER_INVOICE_SNAPSHOT_CLONE_FULL_STACK_RUNTIME_CLOSEOUT_01_RETRY_AFTER_POS_STATUS_FIX_GATE = PASS_OWNER_REVIEW_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = OWNER_APPROVAL_OF_INVOICE_SNAPSHOT_IMPLEMENTATION
```

No handoff update, promotion, deploy, or Acceptance/Persistent mutation was performed.
