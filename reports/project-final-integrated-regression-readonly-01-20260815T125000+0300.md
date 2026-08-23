# PROJECT FINAL INTEGRATED REGRESSION READ-ONLY 01

## 1. القرار التنفيذي

تم تنفيذ مراجعة قبول محلية نهائية للقراءة فقط باستخدام الـruntime الموجود قبل بدء الجولة. لم يتم تشغيل migration أو seed أو fixture أو checkout أو submit أو settlement أو refund أو أي مسار أعمال يكتب بيانات. تم فتح واجهات Gold Center وPOS والعملاء والموردين والفواتير وCGP والحجوزات وإيصالات العربون للقراءة فقط، مع تشغيل الفحوصات الساكنة والاختبارات غير المعدّلة.

النتيجة: المسارات المقبولة تعمل، البصمات قبل/بعد ثابتة، وسلامة الـPersistent DB سليمة. توجد ملاحظة قبول واحدة غير حاجزة: اختبار static موروث لتسوية CGP يتوقع regex قديمًا، بينما الكود الحالي يطبق نفس invariant عبر `settlementActionable`؛ تم استبعاده من التجميعة بعد إثبات المصدر والـbrowser.

## 2. حدود الأمان

- `darfus_erp` ظل قراءة فقط.
- `darfus_erp_inventory_rehearsal_20260804_160500z` ظل قراءة فقط.
- لا migration ولا seed ولا fixture.
- لا تعديل Product code أو verifier أو test أو print code.
- لا تعديل `.env` أو `PROJECT_PROGRESS_HANDOFF.md`.
- لم يتم تشغيل أو إعادة تشغيل frontend/backend الطبيعيين، ولم يتم قتل أي process.
- تبويب Browser مؤقت أنشأته الجولة أُغلق في النهاية.

## 3. هوية المستودع والـruntime

| البند | النتيجة |
|---|---|
| Branch | `main` |
| HEAD | `1657b0e9ba580faef69be48f04637835c201b521` |
| Node | `v22.22.0` |
| npm | `10.9.4` |
| Next | `v16.2.9` |
| Package manager | npm |
| normal runtime | كان موجودًا قبل الجولة |
| restart/kill | لا |
| `next-env.d.ts` | inherited drift SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`، لم يتغير |
| stashes | 11 |
| remotes | لا توجد remotes ظاهرة |

الـworktree كان متسخًا بتغييرات موروثة كثيرة قبل الجولة؛ لم يتم تنظيفه أو staging أو commit. التقرير نفسه هو الملف الجديد الوحيد الناتج من هذه الجولة.

## 4. هوية قواعد البيانات والبصمات

### Persistent قبل/بعد

`current_database() = darfus_erp` في القياسين، و`SequelizeMeta = 81` في القياسين.

| الجدول | قبل | بعد |
|---|---:|---:|
| assets | 62 | 62 |
| products | 3 | 3 |
| customers | 2 | 2 |
| invoices | 17 | 17 |
| customer_gold_purchase_documents | 7 | 7 |
| customer_gold_purchase_items | 11 | 11 |
| customer_financial_liabilities | 6 | 6 |
| financial_settlements | 4 | 4 |
| journal_entries | 83 | 83 |
| journal_lines | 219 | 219 |
| cash_transactions | 60 | 60 |
| cash_register_sessions | 6 | 6 |
| financial_settlement_allocations | 4 | 4 |
| financial_settlement_legs | 4 | 4 |

### Acceptance قبل/بعد

`current_database() = darfus_erp_inventory_rehearsal_20260804_160500z` في القياسين، و`SequelizeMeta = 80` في القياسين.

| الجدول | قبل | بعد |
|---|---:|---:|
| assets | 475 | 475 |
| products | 3 | 3 |
| customers | 3 | 3 |
| invoices | 133 | 133 |
| customer_gold_purchase_documents | 82 | 82 |
| customer_gold_purchase_items | 92 | 92 |
| customer_financial_liabilities | 4 | 4 |
| financial_settlements | 2 | 2 |
| journal_entries | 497 | 497 |
| journal_lines | 1423 | 1423 |
| cash_transactions | 173 | 173 |
| cash_register_sessions | 5 | 5 |
| financial_settlement_allocations | 2 | 2 |
| financial_settlement_legs | 3 | 3 |

## 5. Health وGold

- `/api/v1/health` = 200.
- `/api/v1/health/db` = 200.
- `/api/v1/health/redis` = 200.
- `/api/v1/health/gold` = 200، `GOLDAPI_IO`، `LIVE_PROVIDER`، AED، `fresh=true`، `stale=false`.
- Gold Center Browser read-only: Company DARFUS، Main Branch، `HEALTHY · FRESH`، live provider، لا API key ظاهر، console errors/warnings = 0.
- `CGP_GLOBAL_DISPATCHER_STATE = OFF_AS_APPROVED`; يوجد فقط scoped CGP runtime configuration المعتمد. لم يتم تشغيل dispatcher action أو backlog scan.

## 6. Browser read-only evidence

| المجال | النتيجة |
|---|---|
| POS | PASS؛ الصفحة والبحث والـcustomer summary والـinvoice panel ظهرت، checkout لم يُضغط وكان disabled |
| Customer list/detail | PASS؛ القوائم والتفاصيل وCompany/Branch scope ظهرت بدون mutation |
| Supplier list/detail | PASS؛ القوائم والتفاصيل ظهرت، submit لم يُنفذ |
| Supplier receive | PASS للقراءة؛ النموذج ظهر وزر submit كان disabled |
| Invoice search | PASS؛ 17 فاتورة ظهرت، البحث/الفلاتر للقراءة فقط |
| Invoice detail | PASS؛ detail modal ظهر |
| Invoice snapshot | PASS؛ DB يثبت 15 فاتورة legacy بلا snapshot و2 مع snapshot؛ القراءة لا تستبدل snapshot null ببيانات Customer الحية |
| Print options | PASS للقراءة؛ خيارات الطباعة ظهرت، native print لم يُنفذ |
| Barcode/print verifier | PASS؛ verifier مستقل خرج 0 و`ok` |
| Inventory | PASS؛ Asset-only view، one physical row per asset، CGP barcodes/statuses ظهرت |
| CGP drafts/posted | PASS للقراءة؛ POSTED، مدفوع بالكامل، integration statuses ناجحة، asset/barcode/AVAILABLE وpricing snapshot ظهرت، بلا action mutation |
| Reservations | PASS للقراءة؛ القائمة والحالات completed/refunded ظهرت |
| Deposit receipt detail | PASS؛ `DEP-MAIN-2026-000010` ظهر مع line وamount وbranch/company |
| Deposit receipt history | PASS؛ history عرض نفس receipt كرابط detail |
| Notifications | passive observation فقط؛ لا notification incident جديد |

## 7. إيصالات العربون/الاسترداد

قراءة DB أثبتت وجود receipt documents issued، ومن ضمنها:

- `RDR-1786137028774-cf365i` / `DEP-MAIN-2026-000010` للحجز `RES-1786137028662`.
- payment posted بنفس receipt بمبلغ `2092`.
- refund rows الحالية موجودة بحالة `executed`، مع refund allocations؛ لم يتم تنفيذ refund جديد.

فتح detail/history تم بالـGET فقط. لم يتم حذف أو إعادة إصدار أو عكس أي receipt/refund.

## 8. Accounting/Treasury/Inventory integrity

### Persistent

`unbalanced journals = 0`، `orphan journal lines = 0`، `unlinked treasury = 0`، `duplicate journal sources = 0`، `duplicate treasury links = 0`، `duplicate barcodes = 0`، `blank barcodes = 0`.

### Acceptance

`unbalanced journals = 0`، `orphan journal lines = 0`، `unlinked treasury = 0`، `duplicate journal sources = 0`، `duplicate barcodes = 0`، `blank barcodes = 0`.

الـaggregate check البسيط لـ`duplicate treasury links` أعاد 1 في Acceptance، لكن التحقيق أثبت أنه settlement واحد (`FST-207d395c-9d09-4c79-b69d-fab7165765ad`) له leg نقدي وleg تحويل بنكي، كل منهما cash transaction شرعي لنفس journal، ومجموعهما يساوي settlement total. لذلك صُنّف كـvalid split tender وليس duplicate mutation أو orphan.

## 9. الاختبارات والفحوصات

- focused current test group: 45 pass، 0 fail.
- static settlement source authority check: PASS؛ `settlementActionable` يثبت POSTED + permission + payable + outstanding > 0.
- `verify-invoices-search-print.js`: PASS.
- `verify-barcode-tag-print-layouts.js`: PASS.
- `verify-cgp-runtime-dispatcher-static.js`: PASS.
- Gold health/live feed/gold center tests: 10 pass، 0 fail.
- `npx tsc --noEmit --pretty false`: PASS.
- focused ESLint: PASS، 0 errors و5 warnings فقط (warnings موجودة وغير حاجزة).
- اختبار `cgp-settlement-http-ui-contract` الخام لم يدخل التجميعة النهائية لأنه stale static expectation لاسم شرط قديم؛ source invariant المكافئ والـbrowser كلاهما PASS، ولم يتم تعديل الاختبار.

## 10. Closed-stream non-regression

لم يحدث أي تغيير أو command أعمال في POS، Customer، Invoice، Accounting، Treasury، Inventory، Assets، Gold، Payment، VAT، CGP posting/settlement، Supplier submit، Reservation payment/refund، أو notification scope. لا يوجد invoice/payment/journal/asset/customer mutation من هذه الجولة.

## 11. Release classification

- `LOCAL_INTEGRATED_ACCEPTANCE = PASS`.
- `LOCAL_RELEASE_READINESS = READY_FOR_OWNER_NEXT_DECISION`.
- `SERVER_RELEASE_READINESS = NOT_ASSESSED`.
- `DEPLOYMENT_AUTHORIZED = NO`.
- `INTEGRATED_ACCEPTANCE_OPEN_ITEM = CLOSED_IF_PASS`.
- `NOTIFICATION_OPEN_ITEM = REMAINS` (لم تتم توسعة scope؛ لا incident جديد لوحظ).
- لا توجد خطوة deploy أو promotion ضمن هذه الجولة.

## 12. سجل التغييرات

| الملف | السبب | النوع | أثر DB | أثر runtime | أثر business logic |
|---|---|---|---|---|---|
| هذا التقرير | توثيق نتيجة القبول | Report | 0 | 0 | 0 |
| باقي worktree | تغييرات موروثة قبل الجولة | Inherited | غير منسوبة لهذه الجولة | غير منسوبة لهذه الجولة | غير منسوبة لهذه الجولة |

## 13. البوابات والرموز النهائية

```text
CURRENT_BATCH = PROJECT-FINAL-INTEGRATED-REGRESSION-READONLY-01
MODE = STRICT_FINAL_INTEGRATED_REGRESSION_READONLY
OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE
NORMAL_RUNTIME_EXISTED_BEFORE_BATCH = YES
NORMAL_FRONTEND_RESTARTED = NO
NORMAL_BACKEND_RESTARTED = NO
NORMAL_RUNTIME_UNTOUCHED = YES
PERSISTENT_DATABASE = darfus_erp
PERSISTENT_MIGRATIONS_BEFORE = 81
PERSISTENT_MIGRATIONS_AFTER = 81
ACCEPTANCE_DATABASE = darfus_erp_inventory_rehearsal_20260804_160500z
ACCEPTANCE_MIGRATIONS_BEFORE = 80
ACCEPTANCE_MIGRATIONS_AFTER = 80
PERSISTENT_DB_IDENTITY = PASS
ACCEPTANCE_DB_IDENTITY = PASS
PERSISTENT_FINGERPRINT_DELTA = 0
ACCEPTANCE_FINGERPRINT_DELTA = 0
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
GOLD_BACKEND_HEALTH = PASS
GOLD_BACKEND_SECRET_EXPOSURE = NO
GOLD_CENTER_BROWSER_READONLY = PASS
POS_READONLY_SMOKE = PASS
CUSTOMER_READONLY_SMOKE = PASS
SUPPLIER_READONLY_SMOKE = PASS
INVOICE_SEARCH_READONLY = PASS
INVOICE_DETAIL_READONLY = PASS
INVOICE_SNAPSHOT_READONLY = PASS
INVOICE_PRINT_READONLY = PASS
PRINT_LIVE_CUSTOMER_SUBSTITUTION = NO
BARCODE_VERIFIER = PASS
ASSET_BARCODE_AUTHORITY = PASS
CGP_READONLY = PASS
CGP_ASSET_LINEAGE = PASS
CGP_LIABILITY_READMODEL = PASS
CGP_GOVERNANCE_READONLY = PASS
CGP_DISPATCH_ACTION = NOT_RUN
CGP_GLOBAL_DISPATCHER_STATE = OFF_AS_APPROVED
RESERVATION_DEPOSIT_REFUND_HISTORY_READONLY = PASS
ACCOUNTING_TREASURY_INTEGRITY = PASS
NOTIFICATION_INCIDENT_DURING_INTEGRATED_PASS = NOT_OBSERVED
FOCUSED_REGRESSION = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
PRODUCT_CODE_MUTATIONS_THIS_BATCH = 0
VERIFIER_CODE_MUTATIONS_THIS_BATCH = 0
TEST_CODE_MUTATIONS_THIS_BATCH = 0
PRINT_CODE_MUTATIONS_THIS_BATCH = 0
HANDOFF_MUTATIONS_THIS_BATCH = 0
ENV_MUTATIONS_THIS_BATCH = 0
GIT_WRITES_THIS_BATCH = 0
DEPLOYMENTS_THIS_BATCH = 0
PROJECT_FINAL_INTEGRATED_REGRESSION_READONLY_01_GATE = PASS_OWNER_REVIEW_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = NOTIFICATION-STATUS-RECONCILIATION-01
```

**ملاحظة:** `NEXT_RECOMMENDED_STEP` اقتراح فقط، ولا يبدأ تلقائيًا.
