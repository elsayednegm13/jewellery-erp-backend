# CUSTOMER-INVOICE-SNAPSHOT-MIGRATION-AUTHORIZATION-01

## 1. الملخص التنفيذي

هذه الجولة كانت قراءة وتحليلًا فقط لإعداد حزمة تفويض مستقبلية لإضافة Snapshot
للهاتف والعنوان على `Invoice`. لم يُنشأ Migration، ولم يتغير Product Code أو أي
صف في Persistent أو Acceptance. النتيجة الفنية آمنة للتفويض المشروط: الحقول
المقترحة additive/nullable، ونقطة الالتقاط يمكن أن تكون داخل نفس Transaction
الخاصة بالبيع/الترحيل. يلزم قرار Owner صريح جديد قبل أي تنفيذ.

## 2. هدف المالك

الفاتورة المستقبلية يجب أن تعرض بيانات العميل التي كانت موجودة وقت البيع، حتى
لو تغير العميل لاحقًا. يبقى `customerName` الحالي هو مصدر الاسم للفواتير
المرحّلة، ويُضاف هاتف وعنوان أساسي Snapshot فقط. لا Backfill للسجلات القديمة.

## 3. حدود الأمان والقراءة فقط

- `FORENSIC_MODE = READ_ONLY_STRICT`.
- لم تُستخدم أوامر migration/seed/fixture أو مسارات كتابة تطبيقية.
- كل فحوص DB كانت `SELECT`/catalog فقط، مع التحقق من `current_database()` داخل
  كل جلسة.
- لم يُعدل POS أو Checkout أو Accounting أو Inventory أو Gold أو Payment أو VAT.
- لم يتغير `PROJECT_PROGRESS_HANDOFF.md`.

## 4. الأدلة المقروءة

تمت إعادة قراءة `AGENTS.md` و`PROJECT_PROGRESS_HANDOFF.md`، وقراءة تقارير
Customer forensic/plan/Phase-01/Phase-02/Phase-02 correction/Phase-03/POS visual
correction وPersistent fingerprint reconciliation، ثم فحص المصدر الحالي:

- `backend/src/models/invoice.model.js`
- `backend/src/routes/erp.routes.js`
- `backend/src/services/reservation.service.js`
- `backend/src/services/customer-address.service.js`
- `backend/src/models/customer.model.js`
- `features/printing/lib/invoice-print-view-model.ts`
- قوالب `features/printing/components/*InvoicePrintTemplate.tsx`
- `features/printing/components/ReceiptPrintTemplate.tsx`
- `app/.../sales/search-print/page.tsx`

## 5. Current Invoice schema

النموذج/الجدول الحالي `invoices` يحتوي `customer_id` و`customer_name` فقط من
جهة بيانات جهة اتصال العميل. لا توجد أعمدة `customer_phone_snapshot` أو
`customer_address_snapshot` أو `billing_address` أو `shipping_address` أو
Customer snapshot JSON.

الأنواع الحالية المثبتة في النموذج/الجدول تشمل `sale`, `return`, `exchange`,
`deposit`, `installment` (مع قيمة legacy `giftVoucher` في enum DB). `customer_id`
و`customer_name` غير قابلين لـNULL في قاعدة البيانات الحالية.

## 6. سلوك customerName الحالي

في `/pos/checkout` (`executeCanonicalSale`) يتم أولًا تحميل Customer داخل
`companyId` الخادمي، ثم إنشاء Invoice بـ`customerName: customer.name` داخل
Transaction. مسار Draft ينشئ الاسم من Customer أيضًا، ومسار Reservation final
sale يستخدم `reservation.customerName` الذي التُقط عند إنشاء الحجز. Return و
Exchange ينسخان `originalInvoice.customerName`.

بعد أن تصبح الفاتورة `posted` لا يوجد مسار مشروع يغيّر `customerName`: generic
Invoice POST/PUT/PATCH محجوب بـ`GENERIC_INVOICE_MUTATION_FORBIDDEN`، ومسارات
return/exchange تعدّل الحالة/المبالغ فقط. توجد قابلية تعديل `customerName` داخل
مسودة غير مرحّلة عبر `/sales/invoices/:id`، وهي سلوك Draft متوقع لكنها تعني أن
الاسم يصبح Snapshot نهائيًا عند الترحيل وليس immutable أثناء مرحلة Draft.

النتيجة: `POSTED_CUSTOMER_NAME_SNAPSHOT_AUTHORITY = PROVEN`، مع ضرورة أن يحافظ
التنفيذ المستقبلي على server ownership عند Post وألا يسمح بأي override للحقول
الجديدة.

## 7. سلوك الهاتف الحالي

مصدر الهاتف القانوني هو `Customer.phone` (حقل `STRING`/VARCHAR في Customer
ومطلوب في العقد). لا يوجد `customerPhone` أو phone snapshot على Invoice. الهاتف
يُقرأ في POS/customer APIs، لكنه لا يُكتب إلى Invoice عند البيع.

## 8. سلوك العنوان الحالي

العنوان محفوظ داخل `Customer.addresses` كـ JSONB array. لا يوجد جدول
`CustomerAddress`. الـ resolver القانوني هو
`customer-address.service.resolvePrimaryAddress` ويطبق explicit `isPrimary` ثم
single-address ثم legacy meaningful fallback ثم null. لا يجوز استخدام
`addresses[0]` كسلطة مستقلة.

## 9. Live Customer lookup في detail/print

صفحة Search & Print و`InvoiceDocument` وView Model تستعمل بيانات Invoice التي
وصلت من API. `buildInvoicePrintViewModel` يضع `customer.name = invoice.customerName`
ويصدر تحذير `customer_phone_missing` و`customer_address_missing`؛ لا يعمل
Customer lookup لملء تاريخ قديم. بعض مسارات الخادم تستعلم Customer للتحقق من
الصلاحية أو العمليات المالية، لكن ليس كمصدر عرض تاريخي للطباعة/التفاصيل.

النتيجة: `CURRENT_INVOICE_LIVE_CUSTOMER_LOOKUP = NO` بالنسبة لعرض/طباعة
الفاتورة، مع بقاء lookups التشغيلية منفصلة.

## 10. نقطة إنشاء الفاتورة والذرية

نقاط `Invoice.create` الفعلية الحالية:

| المسار | المصدر | Transaction الحالية | سياسة مستقبلية |
|---|---|---:|---|
| `/pos/checkout` | Customer validated by company/branch | نعم | التقط phone + Primary Address قبل Invoice.create |
| `/sales/invoices/draft` compatibility | delegates to canonical sale | نعم | يغطيه مسار POS نفسه |
| `/sales/invoices/drafts` | Customer validated, Draft only | نعم | اترك snapshot NULL في Draft؛ التقط عند Post |
| `/sales/invoices/:id/post` | locks Draft ثم يعيد التحقق من Customer/Branch | نعم | التقط من Customer الحالي داخل نفس `t` قبل update إلى posted |
| `reservationService.completeSale` | Reservation + branch/customer validation | نعم | التقط من Customer canonical وقت final sale، لا من live print لاحقًا |
| `/sales/returns` | Original Invoice + selected lines | نعم | Copy original snapshot إلى credit note |
| `/sales/exchanges` | Original Invoice + replacement lines | نعم | Copy original snapshot إلى exchange invoice |
| `/customers/:id/gold/deposit` payout branch | legacy Customer Gold path، payout Invoice اختياري | نعم | ليس CGP canonical؛ إن بقي، capture current customer at document creation |
| legacy dead historical block in `/sales/invoices/draft` | unreachable after adapter return | لا يُعتمد | لا مسار جديد |

كل المسارات canonical التي تنشئ/ترحّل Invoice تملك Transaction واحدة تمتد إلى
الـInvoice والـitems والـposting/treasury/audit، لذلك يمكن إضافة الالتقاط ذريًا:
`INVOICE_SNAPSHOT_ATOMIC_WITH_CREATE = YES`.

## 11. مصفوفة أنواع/تدفقات Invoice

| Flow | ينشئ Invoice؟ | customerId/Name | Snapshot مستقبلًا | ملاحظة |
|---|---:|---:|---:|---|
| POS sale | نعم | مطلوب في canonical | نعم | server-derived |
| POS installment | نعم | مطلوب | نعم | نفس sale transaction |
| POS deposit | نعم | مطلوب | نعم | ليس تغييرًا في deposit semantics |
| Sales Draft | نعم، Draft | مطلوب | عند Post فقط | Draft snapshot يبقى NULL |
| Reservation deposit/payment | لا | Reservation/Payment فقط | لا Invoice | Receipt model منفصل |
| Reservation final sale | نعم | من reservation حاليًا | نعم عند completion | الأفضل إعادة قراءة Customer داخل transaction |
| Return / credit note | نعم، type=return | من original | Copy original | historical consistency |
| Exchange | نعم، type=exchange | من original | Copy original | derived document |
| Reservation refund | لا | ReservationRefund مستقل | لا Invoice | لا يخلق Invoice حاليًا |
| Customer Gold legacy payout | Invoice اختياري type=return | Customer حالي | current/legacy isolated | ليس Customer Gold Purchase canonical |
| CGP canonical | لا يستخدم Invoice الحالي | CGP document | لا تخلطه بمبيعات Invoice | خارج نطاق هذه migration |
| Supplier Receive/PO | لا يستخدم Invoice sales table | Supplier/PO | لا | Supplier-side document منفصل |
| Walk-in compatibility sale | قد ينشئ عبر legacy adapter | `customerId=""`, اسم نقدي | NULL | canonical POS الحالي يطلب Customer |

## 12. Return/refund/credit-note policy

`DERIVED_INVOICE_SNAPSHOT_POLICY = COPY_ORIGINAL` للـReturn وExchange لأنهما
مستندان مشتقان من Invoice تاريخية، ونسخ بيانات الاتصال الأصلية يحافظ على
التسلسل التاريخي ولا يعيد تفسير مستند قديم ببيانات Customer الحالية. Refund
الحجز الحالي `ReservationRefund` ليس Invoice، لذلك لا يضيف Snapshot. Legacy
Customer Gold payout ليس مشتقًا من Invoice أصلية ويظل معزولًا عن CGP؛ إن شمله
تنفيذ لاحق فمصدره Customer الحالي وقت المستند.

## 13. Snapshot law

`INVOICE_CUSTOMER_SNAPSHOT_LAW = PROVEN_SAFE` بشرط تطبيقها على الفواتير
المرحّلة، مع الالتزام بالحواجز التالية:

1. الاسم الحالي يبقى كما هو ولا Backfill.
2. الهاتف والعنوان يُشتقان من Customer server-side فقط.
3. لا live lookup بعد الحفظ لملء قيمة ناقصة.
4. Customer edits لا تعدل Invoice.
5. Draft يمكن أن يبقى بلا snapshot، والـPost هو الحد النهائي.

## 14. التصميم المقترح (للتفويض فقط)

| الحقل | النوع المقترح | Nullable | مبرر |
|---|---|---:|---|
| `customer_phone_snapshot` | `VARCHAR(255)` / Sequelize `DataTypes.STRING` | نعم | يطابق Customer.phone بدون تغيير المصدر |
| `customer_address_snapshot` | `JSONB` | نعم | بنية display صغيرة ومحددة بدل نص غير قابل للتوسع |

يبقى `customerId` و`customerName` كما هما. لا duplicate name column، ولا FK أو
جدول عنوان جديد، ولا default يملأ التاريخ.

## 15. Address snapshot JSON shape

الشكل المثبت:

```json
{
  "line1": "...",
  "line2": "...",
  "city": "...",
  "country": "...",
  "postalCode": "..."
}
```

كل المفاتيح اختيارية داخل JSON لأن Phase-01 يسمح بعنوان ذي أي جزء meaningful؛
إذا لم يوجد أي جزء يُحفظ NULL. القيم الفارغة/المسافات تُحذف. لا يُحفظ كامل
Customer أو KYC أو audit metadata. `isPrimary` **يُستبعد**: هو قرار اختيار
وقت الالتقاط، وبعد نسخ العنوان إلى Invoice لا توجد عملية اختيار حية تحتاج هذا
العلم. لا تُستخدم `addresses[0]`؛ resolver هو الذي ينتج العنوان قبل الإسقاط إلى
المفاتيح الخمسة.

## 16. Immutability plan

- الحقول الجديدة server-owned ولا تُقبل في body من العميل.
- تُكتب فقط عند Invoice create/post داخل Transaction.
- Draft update يرفض أي محاولة لتعديلها.
- بعد `posted` لا يوجد generic Invoice mutation.
- Return/Exchange ينسخان snapshot من الأصل ولا يغيرانه.
- أي correction مستقبلي يكون Reversal/Compensation وفق قواعد الفواتير، لا DELETE
  أو direct edit.

## 17. Old invoice compatibility / no backfill

كل الفواتير الحالية ستبقى كما هي: `customerName` ثابت، والحقول الجديدة NULL.
القوالب المستقبلية تعرض Blank/غير متوفر بصدق عند NULL ولا تستدعي Customer
الحالي لتعويض تاريخ ناقص. لا يلزم Backfill ولا يُخطط له.

`HISTORICAL_BACKFILL_THIS_BATCH = NO`
`FUTURE_AUTOMATIC_BACKFILL_PLANNED = NO`

## 18. Print/detail read plan

بعد تنفيذ منفصل، يقرأ View Model:
`invoice.customerName`, `invoice.customerPhoneSnapshot`, و
`invoice.customerAddressSnapshot`. القوالب A4/compact/minimal/thermal وReceipt
تستخدم نفس View Model. يجب ألا يضاف Customer fetch في الطباعة. حقول NULL تُعرض
كقيمة فارغة/label صادق؛ لا fallback حي.

## 19. Migration numbering/design preflight

المستودع يحتوي 80 migration فعلية حتى
`20260810030000-cgp-live-pricing-snapshot-lineage.js`، وقاعدتا DB أظهرتا
`SequelizeMeta = 80`. لا يوجد Migration 81. المرشح الزمني غير المحجوز عند
التفويض هو:

`20260814010000-customer-invoice-contact-snapshots.js`

هذا **candidate فقط** وليس رقمًا محجوزًا ولا ملفًا منشأً.

`MIGRATION_DESIGN = SAFE_ADDITIVE_NULLABLE`

التصميم المستقبلي: `ALTER TABLE invoices ADD COLUMN ... NULL` داخل أسلوب
المigrations الحالي، بلا rename/drop/default/backfill/index/FK. Down migration
لا تُستخدم بعد كتابة بيانات snapshot إلا بقرار Owner ونسخة قابلة للاسترجاع؛
التفضيل forward-compatible.

## 20. Indexing / payload size

لا توجد query حالية تبحث داخل phone/address snapshot؛ العرض مرتبط بـInvoice ID
والقوائم تبحث بالاسم/الرقم. لذلك `SNAPSHOT_INDEX_REQUIREMENT = NONE`. JSONB
الخماسي صغير ومحدود، ولا يحتوي customer object أو nested arbitrary payload:
`SNAPSHOT_PAYLOAD_MINIMAL = YES`.

## 21. Company/Branch/security

الالتقاط المقترح يحدث بعد Customer lookup المقيد بـ`companyId` وبعد branch
authorization/validation الموجود في canonical command. العميل لا يرسل قيم
الهاتف/العنوان كسلطة. الحقول server-owned ولا يمكن mass assignment إليها.

`SNAPSHOT_CLIENT_SUPPLIED = NO`
`SNAPSHOT_SERVER_DERIVED = YES`
`SNAPSHOT_FIELDS_SERVER_OWNED = YES`
`INVOICE_SNAPSHOT_COMPANY_BRANCH_SECURITY = PASS`

## 22. Accounting / Inventory / Payment / VAT isolation

الإضافة metadata تاريخية فقط، ولا تدخل الحسابات أو totals أو posting roles أو
Asset transitions أو Payment/Treasury أو VAT. لا schema relation مطلوبة لهذه
المجالات.

`INVOICE_SNAPSHOT_ACCOUNTING_IMPACT = NONE`
`INVOICE_SNAPSHOT_INVENTORY_IMPACT = NONE`
`INVOICE_SNAPSHOT_PAYMENT_IMPACT = NONE`
`INVOICE_SNAPSHOT_VAT_IMPACT = NONE`

## 23. Reporting/export/API compatibility

المسار الحالي يعيد Invoice rows/JSON في search-print وGETs، وبعض responses تنشر
row JSON مباشرة. الأعمدة nullable الجديدة ستظهر كحقول إضافية عند تحديث model،
لكنها لا تكسر clients التي تتجاهل unknown keys. يجب في التنفيذ لاحقًا تحديث
`lib/types.ts` بإضافية اختيارية فقط، وعدم إظهار الحقول في lists إن لم تكن شاشة
contact/print بحاجة إليها.

`INVOICE_SNAPSHOT_REPORTING_IMPACT = PROVEN`
`INVOICE_API_BACKWARD_COMPATIBILITY = PASS`

## 24. Risk matrix

| الخطر | الاحتمال | الأثر | التخفيف |
|---|---|---|---|
| Old invoices NULL | متوقع | متوسط عرضي | null-safe UI بلا live lookup |
| Print يفترض non-null | متوسط | متوسط | tests لكل القوالب وNULL fixtures |
| Client override | متوسط | عالٍ تاريخيًا | ignore/reject fields server-side |
| Draft customerName override | موجود قبل Post | متوسط | keep snapshot boundary at Post؛ future hardening |
| Derived doc يستخدم Customer الحالي | متوسط | عالٍ | Copy original snapshot |
| Live lookup يعيد drift | متوسط | عالٍ | View Model يقرأ Invoice فقط |
| JSON payload كبير | منخفض | متوسط | خمسة مفاتيح فقط، no arbitrary object |
| Transaction mismatch | منخفض | عالٍ | capture inside existing `t` |
| Permission leak | منخفض | عالٍ | نفس Invoice/Sales scope، no new permission |
| Rollback بعد استعمال الأعمدة | منخفض | عالٍ | backup + forward-compatible policy، لا down عشوائي |
| Backend/frontend partial deploy | متوسط | متوسط | additive migration أولًا ثم backend ثم UI |

## 25. Deployment/order plan (future only)

1. Owner approval صريح.
2. Disposable rehearsal exact migration + schema inspection.
3. Add nullable columns migration إلى Acceptance فقط حسب guard.
4. Backend server-derived capture في POS/Draft Post/Reservation/derived docs.
5. Read API/View Model/print null-safe.
6. Frontend type/UI tests.
7. Clone E2E: P1/A1 ثم customer edit إلى P2/A2، I1 يبقى P1/A1 وI2 يأخذ P2/A2.
8. Financial/inventory/payment parity checks.
9. Owner review ثم أي promotion منفصل بتفويض مستقل.

`INVOICE_SNAPSHOT_DEPLOYMENT_ORDER = PROVEN_SAFE`.

## 26. Static/runtime test plans

الاختبارات المستقبلية تشمل mapper، phone authority، canonical Primary resolver،
partial/no address، no Customer/walk-in، no client override، Draft→Post،
immutability بعد Customer update، Return/Exchange copy، old NULL compatibility،
API additive response، وكل print templates.

Runtime mutating proof يكون على Disposable Clone فقط: إنشاء Customer C1 (P1/A1)،
إنشاء/ترحيل I1، تغيير العميل إلى P2/A2، إعادة فتح I1، إنشاء I2، ثم مقارنة
الحساب/الدفع/المخزون وعدم وجود duplicate posting.

## 27. Current DB fingerprint (read-only)

| DB | current_database | migrations | Customers | address items | Invoices | Payments | Journals | Lines | Cash rows | Assets | Products |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Persistent | `darfus_erp` | 80 | 2 | 3 | 15 | 30 | 81 | 209 | 58 | 62 | 3 |
| Acceptance | `darfus_erp_inventory_rehearsal_20260804_160500z` | 80 | 3 | 0 | 133 | 122 | 497 | 1423 | 173 | 475 | 3 |

Invoice distributions: Persistent sale=10, return=1, installment=4؛
Acceptance sale=101, return=23, exchange=5, installment=4. في القاعدتين
`customer_id` و`customer_name` non-null لكل الصفوف الحالية، ولا توجد أعمدة
snapshot مرشحة.

Financial read-only check: Persistent unbalanced journals=0، orphan journal
lines=0، unlinked posted treasury=0، duplicate journal sources=0، duplicate
treasury links=0. Acceptance حافظت على 0 في كل الفحوص عدا duplicate treasury links
الحالي = 1 في fixture موجود مسبقًا؛ لم تُنشئه هذه الجولة ولم يتم تغييره.

## 28. Owner-accepted baseline / DOB

تم إعادة استخدام baseline المعتمد دون إعادة فتح التحقيق: Persistent migrations=80,
Customers=2، والعناوين الحالية=3؛ Acceptance migrations=80. اختلاف address count
عن تقارير قديمة موثق كسياق سابق ولا يمثل كتابة هذه الجولة.

`DOB_WORK_THIS_BATCH = NONE`.

## 29. Git/env/process safety

- Branch: `main`
- HEAD: `1657b0e9ba580faef69be48f04637835c201b521`
- staged files: 0
- inherited tracked modified files: 79
- inherited untracked files: 445
- stashes: 11
- لا Git write/commit/push/reset/restore/clean/stash.
- `next-env.d.ts` SHA الحالي: `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`
  (inherited known drift؛ لم يتغير).
- لا env change، restart، Next dev، deploy.

## 30. Owner authorization package

- Proposed fields: `customer_phone_snapshot` و`customer_address_snapshot`.
- Exact types: nullable `VARCHAR(255)` وnullable `JSONB`.
- Candidate migration: `20260814010000-customer-invoice-contact-snapshots.js` (غير منشأ).
- `customerName` يظل snapshot authority للفواتير posted، مع Draft mutable قبل Post.
- Phone: `Customer.phone` بعد company/branch validation.
- Address: `resolvePrimaryAddress(Customer.addresses)` ثم إسقاط المفاتيح الخمسة.
- Derived docs: Return/Exchange copy original snapshot.
- Old invoices: fields NULL، name unchanged، no live fallback.
- Backfill: NO.
- Accounting/Inventory/Payment/VAT: NONE.
- Future files: one migration، Invoice model، canonical sale/draft-post/reservation/return/exchange capture helper، print View Model/templates، additive frontend types، focused tests. لا POS business redesign.
- Runtime proof: Disposable Clone only.
- Rollback: no destructive down after snapshot writes; controlled backup/forward policy.
- Fresh explicit approval required.

النص المطلوب من Owner:

> أوافق على إنشاء الـmigration الفعلي التالي لإضافة حقول Snapshot nullable للهاتف والعنوان على Invoice، بدون Backfill، مع الاحتفاظ بـcustomerName الحالي، وحفظ البيانات من السيرفر وقت إنشاء الفاتورة.

## 31. Gate

كل شروط الـpreflight الفنية والسلامة متحققة، لكن هذا **ليس** تنفيذًا ولا تفويضًا
ضمنيًا. الحزمة جاهزة لقرار Owner صريح:

`CUSTOMER_INVOICE_SNAPSHOT_MIGRATION_AUTHORIZATION_01_GATE = PASS_AUTHORIZATION_READY`

الخطوة التالية لا تبدأ تلقائيًا؛ تنتظر رد Owner بالنص الصريح ثم Batch تنفيذ
منفصل.

## 32. Final tokens

```text
CURRENT_BATCH = CUSTOMER-INVOICE-SNAPSHOT-MIGRATION-AUTHORIZATION-01
MODE = STRICT_READ_ONLY_MIGRATION_AUTHORIZATION_PREFLIGHT
OWNER_POS_VISUAL_APPROVAL = YES
FORENSIC_MODE = READ_ONLY_STRICT
PRODUCT_CODE_CHANGED = NO
CURRENT_INVOICE_SCHEMA_FORENSIC = COMPLETE
EXISTING_CUSTOMER_NAME_SNAPSHOT_AUTHORITY = PROVEN
CURRENT_INVOICE_PHONE_SNAPSHOT = ABSENT
CURRENT_INVOICE_ADDRESS_SNAPSHOT = ABSENT
CURRENT_INVOICE_LIVE_CUSTOMER_LOOKUP = NO
INVOICE_CUSTOMER_SNAPSHOT_LAW = PROVEN_SAFE
INVOICE_SNAPSHOT_PRIMARY_ADDRESS_AUTHORITY = CANONICAL_PRIMARY_RESOLVER
INVOICE_SNAPSHOT_PHONE_AUTHORITY = PROVEN
PROPOSED_CUSTOMER_PHONE_SNAPSHOT_COLUMN = customer_phone_snapshot
PROPOSED_CUSTOMER_PHONE_SNAPSHOT_TYPE = VARCHAR(255) NULL
PROPOSED_CUSTOMER_ADDRESS_SNAPSHOT_COLUMN = customer_address_snapshot
PROPOSED_CUSTOMER_ADDRESS_SNAPSHOT_TYPE = JSONB NULL
INVOICE_ADDRESS_SNAPSHOT_SHAPE = PROVEN
INVOICE_SNAPSHOT_IMMUTABILITY_PLAN = COMPLETE
INVOICE_SNAPSHOT_CAPTURE_POINT = PROVEN
INVOICE_SNAPSHOT_ATOMIC_WITH_CREATE = YES
INVOICE_SNAPSHOT_FLOW_MATRIX = COMPLETE
DERIVED_INVOICE_SNAPSHOT_POLICY = COPY_ORIGINAL
INVOICE_SNAPSHOT_FUTURE_E2E_PLAN = COMPLETE
OLD_INVOICE_NULL_SNAPSHOT_COMPATIBILITY = PROVEN
INVOICE_PRINT_SNAPSHOT_READ_PLAN = COMPLETE
HISTORICAL_BACKFILL_THIS_BATCH = NO
FUTURE_AUTOMATIC_BACKFILL_PLANNED = NO
NEXT_ACTUAL_MIGRATION_IDENTIFIER = 20260814010000-customer-invoice-contact-snapshots.js (candidate only)
MIGRATION_NUMBER_PREFLIGHT = PROVEN
MIGRATION_DESIGN = SAFE_ADDITIVE_NULLABLE
SNAPSHOT_INDEX_REQUIREMENT = NONE
SNAPSHOT_PAYLOAD_MINIMAL = YES
SNAPSHOT_CLIENT_SUPPLIED = NO
SNAPSHOT_SERVER_DERIVED = YES
SNAPSHOT_FIELDS_SERVER_OWNED = YES
INVOICE_SNAPSHOT_COMPANY_BRANCH_SECURITY = PASS
INVOICE_SNAPSHOT_ACCOUNTING_IMPACT = NONE
INVOICE_SNAPSHOT_INVENTORY_IMPACT = NONE
INVOICE_SNAPSHOT_PAYMENT_IMPACT = NONE
INVOICE_SNAPSHOT_VAT_IMPACT = NONE
INVOICE_SNAPSHOT_REPORTING_IMPACT = PROVEN
INVOICE_API_BACKWARD_COMPATIBILITY = PASS
INVOICE_SNAPSHOT_RISK_MATRIX = COMPLETE
INVOICE_SNAPSHOT_DEPLOYMENT_ORDER = PROVEN_SAFE
INVOICE_SNAPSHOT_TEST_PLAN = COMPLETE
INVOICE_SNAPSHOT_RUNTIME_TEST_PLAN = COMPLETE
OWNER_ACCEPTED_PERSISTENT_BASELINE_REUSED = YES
DOB_WORK_THIS_BATCH = NONE
PRODUCT_FILES_CHANGED = 0
MIGRATIONS_CREATED = 0
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
NEXT_ENV_MUTATED_THIS_BATCH = NO
RUNTIME_ENV_CHANGED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
NEXT_DEV_STARTED_OR_RESTARTED = NO
OWNER_MIGRATION_AUTHORIZATION_PACKAGE = COMPLETE
EXPLICIT_MIGRATION_APPROVAL_REQUIRED = YES
```

**توقف:** لا Migration ولا إصلاح أو اختبار mutating يبدأ قبل موافقة Owner صريحة.
