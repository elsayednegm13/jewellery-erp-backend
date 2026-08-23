# CUSTOMER-MASTER-DATA-CREATE-EDIT-ADDRESS-IMPLEMENTATION-PLAN-01

## 1. الملخص التنفيذي

هذه خطة تنفيذ مقيدة مبنية على forensic السابق وقرارات Owner الجديدة. لا يوجد تنفيذ في هذه الدفعة: لا كود، لا migration، لا backfill، لا fixture، ولا كتابة على Persistent أو Acceptance. الخطة تغطي Customer Create/Edit، إدارة العناوين داخل JSONB، Primary Address، POS customer summary/card، وimmutable invoice customer snapshot.

## 2. خط أساس forensic

المثبت حاليًا: `Customer.addresses` JSONB array بلا جدول مستقل أو `isPrimary` قانون قائم؛ generic Customer create/update موجودان؛ صفحة التفاصيل بلا edit عملي؛ `Customer.balance` ليس available credit؛ available credit من customer credit ledger؛ `Customer.purchases` aggregate صافٍ مخزن؛ POS يقرأ `/customers` ويعرض name/phone/tier/points/balance/address؛ Invoice يحفظ `customerId` و`customerName` فقط؛ print view-model يمرر الاسم فقط؛ migrations الحالية 80؛ لا Migration 81 موجودة.

## 3. قرارات Owner المجمّدة

- الرصيد المعروض بعنوان «الرصيد المتاح» = `availableCredit` من canonical customer credit ledger.
- `Customer.balance` لا يسمى «الرصيد المتاح».
- العناوين تبقى JSONB في البداية.
- يسمح بأكثر من عنوان، لكن عنوانًا واحدًا Primary كحد أقصى.
- POS والفاتورة يستخدمان Primary Address؛ السجلات القديمة بلا marker تستخدم أول عنوان صالح كـ compatibility fallback فقط.
- إدارة العناوين تحت `customers.update`، ولا permission جديدة الآن.
- invoice customer contact data immutable sale-time snapshot؛ لا live lookup ولا backfill للفواتير القديمة.
- العنوان اختياري عند الإنشاء؛ أول عنوان مرسل يصبح Primary.
- POS card حقوله مقفلة: Name, Status, Tier, Phone, Primary Address, Points, Available Credit, Total Purchases.
- لا توسيع لصلاحيات البيانات المالية.

## 4. قانون Available Credit

الـ POS يستدعي server read-model يعيد `availableCredit` من خدمة/ledger الائتمان. لا formula في الواجهة، ولا استخدام `Customer.balance`، ولا إعادة حساب `creditLimit - balance`، ولا تغيير في صيغة `SUM(active credit_in) - SUM(active credit_out)`.

## 5. سياسة العناوين

العقد الأولي يحافظ على JSONB الحالي مع schema typed. لا جدول `CustomerAddress` الآن. كل تعديل يعيد array normalized داخل transaction، ويظل `Customer` هو authority. أي انتقال لجدول مستقل يحتاج evidence أداء/استعلام/تاريخ قبل migration منفصلة.

## 6. Primary Address

القواعد: أول عنوان عند إنشاء customer يصبح `isPrimary=true`؛ عنوان واحد فقط Primary؛ اختيار عنوان آخر ي demote السابق وي promote الجديد atomically؛ حذف Primary مع عناوين أخرى يعيّن أول عنوان صالح حسب ترتيب array كـ Primary؛ حذف آخر عنوان يترك array فارغة بلا Primary؛ سجل قديم بلا marker لا يعاد كتابته، ويستخدم read-time fallback فقط.

## 7. سياسة الفاتورة التاريخية

وقت إنشاء الفاتورة، الخادم يلتقط من Customer master: الاسم، الهاتف، وPrimary Address. بعد ذلك لا تتغير الفاتورة عند تعديل Customer. لا live Customer fallback للطباعة القديمة، ولا backfill للفواتير الموجودة.

## 8. مراحل التنفيذ

1. Phase 1: Customer create/edit/address typed contract.
2. Phase 2: Customer Details and address-management UI.
3. Phase 3: POS summary read model and compact card.
4. Phase 4: invoice snapshot schema and Migration 81 authorization gate.
5. Phase 5: snapshot write plus print/detail wiring.
6. Phase 6: disposable-clone strict E2E closeout.

## 9. Phase 1 — Customer foundation

Create/update contracts تسمح فقط بـ name, phone, email?, tier?, notes?, addresses?. يمنع العميل من كتابة companyId, balance, purchases, loyaltyPoints, availableCredit. status يظل عبر deactivate/reactivate routes. Backend يطبع/يتحقق من الهاتف والعنوان، ويستمر في audit المركزي.

## 10. Address validation

`addresses` يجب أن يكون array. كل عنصر object typed فقط: `line1` و`city` و`country` نصوص مطلوبة إذا وُجد address، `line2` و`postalCode` اختياريان، `isPrimary` boolean اختياري يُطبع إلى false قبل resolution. ترفض العناصر malformed أو القيم غير النصية أو array غير صالحة، ويُرفض أكثر من Primary بعد normalization.

## 11. Address normalization

تُزال المسافات الزائدة، وتحوّل النص الفارغ إلى null/غياب، وتحافظ على Unicode، وتمنع المفاتيح غير المدعومة من أن تصبح business fields. resolver يعيد نسخة canonical بترتيب ثابت. لا يتم تعديل legacy rows تلقائيًا؛ fallback يتم في read-model فقط.

## 12. Primary mutation rules

الـ service يقرأ Customer داخل transaction وlock، يطبق normalization ثم يضمن Primary واحدًا. `setPrimary` ي demote كل العناصر ثم ي promote target. remove primary يختار أول valid remaining. إذا لم يوجد عنوان، `primaryAddress=null`. كل نتيجة تعاد من server ولا تعتمد على local state.

## 13. Legacy compatibility

السجلات القديمة التي تحتوي addresses بدون `isPrimary` لا تُعاد كتابتها. `resolvePrimaryAddress()` يختار أول عنوان صالح فقط عند القراءة ويضع `source=LEGACY_FALLBACK` في read-model إن احتاج التشخيص. أي تعديل لاحق يكتب contract normalized ويزيل ambiguity لهذا customer فقط.

## 14. Concurrency

قبل update يرسل العميل `expectedUpdatedAt`. الخادم ينفذ conditional update على `id + updatedAt` داخل transaction؛ mismatch يعيد `409 CUSTOMER_UPDATE_CONFLICT` بدون تغيير. عند Primary mutation يستخدم row lock داخل نفس transaction. لا يُضاف version column إلا إذا أثبت التطبيق أن updatedAt غير كافٍ.

## 15. Audit

تظل `auditService` هي السلطة الوحيدة. كل Customer/address mutation يسجل actor، company، branch/correlation، before، after، ونوع العملية (`CUSTOMER_UPDATE` أو `CUSTOMER_ADDRESS_UPDATE` metadata). لا audit store ثانٍ ولا تعديل على سجل تاريخي.

## 16. Customer Details plan

إضافة زر «تعديل بيانات العميل» ظاهر فقط مع `customers.update`. قسم العناوين يعرض Primary badge، Add، Edit، Set Primary، Remove حسب القواعد. لا يسمح النموذج بتغيير status؛ status actions تبقى dedicated routes. KYC والمرفقات تظل في تبويباتها الحالية.

## 17. Create UX

توسيع modal الحالي بإضافة optional address block typed، مع زر إضافة عنوان آخر، وPrimary badge تلقائي لأول عنوان. الهاتف يظل Required، balance/purchases/points لا تظهر كحقول إدخال. Submit يعرض validation server errors بلا optimistic local write.

## 18. Edit UX

نفس عقد الحقول الأساسية مع `expectedUpdatedAt`. صفحة details تحصل على edit action، والقائمة الحالية تستمر كاختصار. profile edit لا يغير lifecycle status ولا aggregates المالية.

## 19. Address UX

صف واحد لكل عنوان، labels للمدينة/الدولة/السطر، Primary badge، set-primary action، remove confirmation، وfallback واضح للسجلات legacy. لا تُعرض address IDs غير الموجودة ولا fields خارج العقد.

## 20. POS summary DTO

```ts
type PosCustomerSummary = {
  id: string;
  name: string;
  status: "active" | "inactive";
  tier: "VIP" | "Gold" | "Standard";
  phone: string;
  primaryAddress: CustomerAddress | null;
  loyaltyPoints: number;
  availableCredit: number;
  totalPurchases: number;
};
```

DTO read-only، ولا يملك accounting truth أو mutation fields.

## 21. POS authority map

| الحقل | السلطة |
|---|---|
| name | `Customer.name` |
| status | `Customer.status` |
| tier | `Customer.tier` |
| phone | `Customer.phone` |
| primaryAddress | canonical address resolver |
| loyaltyPoints | Customer/loyalty authority الحالية |
| availableCredit | customer-credit ledger/service |
| totalPurchases | stored `Customer.purchases` |

## 22. POS API strategy

يبقى `GET /customers` خفيفًا للبحث ولا يضم availableCredit لكل الصفوف. بعد اختيار customer، يقرأ POS endpoint واحدًا مثل `GET /customers/:id/pos-summary`، أو يوسع `GET /customers/:id` بعقد summary واضح. الاختيار المقترح: endpoint read-only منفصل لمنع N+1 والحفاظ على privacy contract.

## 23. POS API contract

`GET /customers/:id/pos-summary`، auth + `customers.view`، company server scope، branch context حسب POS scope، response `{data: PosCustomerSummary}`. لا body، لا client formula، و403/404 حسب scope. endpoint لا ينشئ أو يعدل أي سجل.

## 24. الأداء

availableCredit: قراءة canonical واحدة بعد selection، لا query لكل customer row. totalPurchases: استخدام `Customer.purchases` stored aggregate؛ لا scan للفواتير عند كل اختيار. يمكن لاحقًا cache summary قصير العمر بعد إثبات invalidation، دون إنشاء authority ثانية.

## 25. POS customer card

مستطيل واحد compact بالترتيب: الاسم، الحالة، Tier، الهاتف، Primary Address، النقاط، الرصيد المتاح، إجمالي المشتريات. العنوان سطران كحد أقصى مع ellipsis/title. لا edit controls ولا status mutation في POS.

## 26. POS permissions

لا توسيع permissions. يعاد استخدام `customers.view` وPOS permission الحالي. availableCredit لا يضاف له permission جديد في هذه الخطة؛ إذا أظهر الكود لاحقًا permission أدق، يحافظ التنفيذ عليه ولا يتجاوزه.

## 27. Invoice snapshot schema

Migration 81 المقترحة additive فقط: `customer_phone_snapshot` nullable string و`customer_address_snapshot` nullable JSONB. `customerName` الموجود يستمر. لا index أو FK مطلوبان. `customerCodeSnapshot` اختياري وغير مطلوب حاليًا.

## 28. Address snapshot format

التوصية `JSONB` snapshot، لأنه يحافظ على line1/line2/city/country/postalCode/isPrimary كما كانت وقت البيع، ويسمح للطباعة بتنسيق ثابت لاحقًا. لا يعتمد على live Customer. إذا فرضت الطباعة نصًا ثابتًا في المستقبل، يبنى text من snapshot داخل view-model دون فقد الأصل المنظم.

## 29. Server authority

في كل invoice create/post path، الخادم يقرأ Customer داخل company scope، يحل Primary Address، ويملأ snapshot columns. أي phone/address يرسل من frontend يُهمل كسلطة. customerName الحالي يستمر server-derived. walk-in لا يملك Customer master؛ snapshots تكون null.

## 30. No-address وWalk-in

غياب العنوان لا يمنع البيع. `customer_address_snapshot=null` والطباعة تعرض fallback صادقًا. customer بلا address لا يخترع عنوانًا. walk-in/anonymous يظل مسموحًا وفق القانون الحالي؛ `customerId`, phone, address snapshots تكون null، وcustomerName يبقى label الحالي مثل «عميل نقدي» إذا كان المسار يستعمله.

## 31. Historical immutability

اختبار مطلوب: أنشئ customer P1/address A1، أنشئ invoice I1، عدل phone/address إلى P2/A2، ثم اقرأ I1 وprint؛ يجب أن يظل I1 = P1/A1. أي live lookup أو تغيير old invoice يفشل الاختبار ويوقف الإغلاق.

## 32. Migration assessment

Migration 81 مطلوبة فقط لتنفيذ invoice snapshots لأن الأعمدة غير موجودة حاليًا، لكنها غير مصرح بها في هذه الدفعة. لا backfill. قبل أي apply: design review، disposable clone، exact migration rehearsal، zero-orphan check، ثم Owner authorization صريح.

## 33. Migration 81 authorization gate

`MIGRATION_81_AUTHORIZED_THIS_BATCH = NO`. لا تُنشأ migration الآن. لا يتم تطبيقها على Persistent أو Acceptance في هذه الخطة. authorization checkpoint مستقل ومسبق لـ Phase 5.

## 34. Additive migration design

التغيير المستقبلي: add nullable `customer_phone_snapshot` و`customer_address_snapshot JSONB` إلى invoices، دون حذف أو استبدال، ودون backfill. down migration لا تُنفذ في production تلقائيًا؛ rollback يكون عبر release boundary بعد إثبات عدم الاعتماد، وفق سياسة Owner.

## 35. Print/invoice detail

تعديل `buildInvoicePrintViewModel()` ليقرأ snapshot columns فقط، ويمرر customer phone/address إلى Invoice/Minimal/Compact/Thermal templates. `InvoiceReadOnlyDetail` يعرض snapshot fields مع empty fallback. لا يقرأ Customer master عند عرض old invoice.

## 36. Runtime plan

Phase 6 يستخدم disposable clone فقط: auth/company/branch، create customer + address، prove Primary، details edit، audit، POS select، summary/card، sale، checkout response، DB snapshot، invoice detail/print، تعديل customer بعد البيع، proof old invoice unchanged، malformed/duplicate primary/concurrency/permissions، ثم cleanup clone.

## 37. Runtime matrices

| المجال | حالات إلزامية |
|---|---|
| Create | no address، one address، multiple addresses، malformed object، missing phone |
| Edit | profile update، address add/edit/remove، expectedUpdatedAt stale |
| Primary | first primary، switch primary، duplicate primary rejected، remove primary |
| POS | zero/positive credit، zero/positive purchases، long address، inactive customer |
| Invoice | snapshot at sale، no address، walk-in، customer changed بعد البيع |
| Security | missing permission، wrong company/branch، no client financial authority |

## 38. API contracts

Create body: `{name, phone, email?, tier?, notes?, addresses?}`. Update body: same optional fields plus `expectedUpdatedAt?`. Server-owned: `companyId`, `balance`, `purchases`, `loyaltyPoints`, `availableCredit`, lifecycle `status`. Address validation and Primary resolution server-side only.

## 39. File touch map

المسارات الفعلية المرشحة بعد approval:

- Frontend: `app/[locale]/(dashboard)/customers/page.tsx`، `app/[locale]/(dashboard)/customers/[id]/page.tsx`، `app/[locale]/(dashboard)/pos/page.tsx`.
- Types/helpers: `lib/types.ts`، helper جديد مقترح تحت `lib/customers/` إذا احتاج العرض المشترك.
- Backend: `backend/src/models/customer.model.js` (typed contract metadata إن لزم)، `backend/src/routes/erp.routes.js`، service جديد تحت `backend/src/services/` للعناوين وPOS summary، `backend/src/models/invoice.model.js`، invoice creation paths داخل `backend/src/routes/erp.routes.js`.
- Printing: `features/printing/lib/invoice-print-view-model.ts` والقوالب Invoice/Minimal/Compact/Thermal الموجودة.
- Migration future only: ملف جديد تحت `backend/src/migrations/` بعد authorization.
- Tests: `backend/tests/` tests جديدة customer/address/summary/snapshot، مع الحفاظ على tests الحالية.
- Localization: ملفات الرسائل المستخدمة فعليًا في صفحات customers/pos/printing بعد فحصها وقت التنفيذ.

## 40. جدول API changes

| Endpoint | Current | Planned | Read/Write | Permission | Authority | Migration | Compatible |
|---|---|---|---|---|---|---|---|
| `GET /customers` | list/search | يبقى خفيفًا | Read | customers.view | Customer | No | Yes |
| `POST /customers` | basic fields | typed addresses optional | Write | customers.create | Customer service | No | Yes |
| `PUT /customers/:id` | generic LWW | typed addresses + expectedUpdatedAt | Write | customers.update | Customer/address service | No | Yes |
| `GET /customers/:id` | details | Primary-resolved read | Read | customers.view | Customer resolver | No | Yes |
| `GET /customers/:id/pos-summary` | Missing | DTO موحد | Read | customers.view | summary service | No | Yes |
| invoice create routes | name only | server snapshots | Write | existing sale permission | Invoice + Customer | 81 | Additive |

## 41. جدول authority

| Field | Authority | Client writable? | POS source | Invoice snapshot? | Print source |
|---|---|---|---|---|---|
| name | Customer | create/update only | summary | yes | invoice snapshot |
| status | lifecycle routes | no profile write | summary | no | no |
| tier | Customer | profile allowed | summary | no | no |
| phone | Customer | create/update | summary | yes | snapshot |
| primaryAddress | resolver | address contract | summary | yes | snapshot |
| points | loyalty authority | no direct aggregate | summary | no | no |
| availableCredit | credit ledger | no | summary | no | no |
| purchases | recalc service | no | summary | no | no |

## 42. جدول address contract

| Field | Type | Required | Validation | Normalization | Editable | Snapshot |
|---|---|---|---|---|---|---|
| line1 | string | yes if object | non-empty | trim | yes | yes |
| line2 | string | no | string | trim/null | yes | yes |
| city | string | yes if object | non-empty | trim | yes | yes |
| country | string | yes if object | non-empty | trim | yes | yes |
| postalCode | string | no | string | trim/null | yes | yes |
| isPrimary | boolean | derived/optional | bool only | one true max | controlled | yes |

## 43. جدول invoice snapshot

| Field | Current | Planned | Nullable | Server derived | Backfill | Historical rule |
|---|---|---|---|---|---|---|
| customerName | yes | keep | according current | yes | no | immutable |
| customerPhoneSnapshot | no | add string | yes | yes | no | immutable |
| customerAddressSnapshot | no | add JSONB | yes | yes | no | immutable |
| customerCodeSnapshot | no | not required | n/a | n/a | no | n/a |

## 44. جدول concurrency

| Operation | Current | Risk | Guard | Conflict response | Audit |
|---|---|---|---|---|---|
| profile update | LWW | lost update | id+updatedAt | 409 | before/after |
| address add/edit | generic JSONB | array overwrite | transaction+lock | 409 | before/after |
| set Primary | absent | duplicate primary | transaction+lock | 409/validation | before/after |
| invoice snapshot | no snapshot | live drift | same invoice transaction | rollback transaction | invoice audit |

## 45. Rollback plan

Phase 1/2/3: revert application release only after tests; لا SQL cleanup أو حذف بيانات تلقائي. Phase 4: Migration 81 لا تطبق إلا بعد backup/rehearsal؛ rollback boundary قبل اعتماد أي code يعتمد الأعمدة. Phase 5: disable new snapshot read path only if old columns remain nullable and historical behavior remains truthful. Phase 6: cleanup disposable clone فقط، ولا يمس Persistent.

## 46. Owner approval checkpoints

1. اعتماد هذه الخطة.
2. اعتماد بصري Create/Edit/Address.
3. اعتماد بصري POS card.
4. authorization صريح لـ Migration 81 قبل snapshot implementation.
5. اعتماد strict clone runtime closeout.

## 47. Future batches

1. `CUSTOMER-MASTER-PHASE-01-CREATE-EDIT-ADDRESS-CONTRACT-IMPLEMENTATION`
2. `CUSTOMER-MASTER-PHASE-02-DETAILS-AND-ADDRESS-MANAGEMENT-UI`
3. `CUSTOMER-MASTER-PHASE-03-POS-CUSTOMER-SUMMARY-CARD`
4. `CUSTOMER-INVOICE-SNAPSHOT-MIGRATION-AUTHORIZATION-01`
5. `CUSTOMER-INVOICE-SNAPSHOT-IMPLEMENTATION-01`
6. `CUSTOMER-MASTER-POS-INVOICE-STRICT-RUNTIME-CLOSEOUT-01`

## 48. السلامة والبوابة

لم يتم تشغيل tests mutating أو migration. Persistent وAcceptance read-only. لا تغيير env/Git/deploy/restart. `next-env.d.ts` بقي بالـ inherited known drift SHA ولم يُلمس. الخطة جاهزة لأن قرارات Owner مكتملة، لكن Migration 81 غير مصرح بها وتظل checkpoint مستقلًا.

## 49. الخطوة التالية

بعد اعتماد Owner لهذه الخطة فقط، يبدأ Phase 1. لا يبدأ تلقائيًا. Migration 81 لا تنشأ ولا تطبق إلا بعد batch authorization مستقل.

## Required final tokens

```text
CURRENT_BATCH = CUSTOMER-MASTER-DATA-CREATE-EDIT-ADDRESS-IMPLEMENTATION-PLAN-01
MODE = OWNER_DECISION_FREEZE_AND_IMPLEMENTATION_PLAN
OWNER_AVAILABLE_BALANCE_AUTHORITY = AVAILABLE_CREDIT_LEDGER
AVAILABLE_CREDIT_FORMULA_CHANGED = NO
OWNER_ADDRESS_STORAGE_DIRECTION = KEEP_JSONB_FOR_INITIAL_IMPLEMENTATION
OWNER_PRIMARY_ADDRESS_POLICY = ONE_PRIMARY_WITH_COMPATIBILITY_FALLBACK
ADDRESS_TYPED_CONTRACT_PLAN = COMPLETE
OWNER_ADDRESS_PERMISSION = customers.update
OWNER_HISTORICAL_INVOICE_POLICY = IMMUTABLE_SALE_TIME_CUSTOMER_SNAPSHOT
HISTORICAL_INVOICE_BACKFILL = NO
OWNER_CREATE_ADDRESS_REQUIRED = NO
OWNER_FIRST_CREATED_ADDRESS_PRIMARY = YES
OWNER_POS_CUSTOMER_CARD_FIELDS = LOCKED
POS_CUSTOMER_FINANCIAL_PERMISSION_EXPANSION = NO
CUSTOMER_IMPLEMENTATION_SEQUENCE = COMPLETE
PHASE_1_CUSTOMER_FOUNDATION_PLAN = COMPLETE
ADDRESS_SERVER_VALIDATION_PLAN = COMPLETE
ADDRESS_NORMALIZATION_PLAN = COMPLETE
PRIMARY_ADDRESS_MUTATION_RULES = COMPLETE
LEGACY_ADDRESS_COMPATIBILITY_PLAN = COMPLETE
CUSTOMER_UPDATE_CONCURRENCY_PLAN = COMPLETE
CUSTOMER_ADDRESS_AUDIT_PLAN = COMPLETE
PHASE_2_CUSTOMER_DETAILS_PLAN = COMPLETE
CUSTOMER_CREATE_UX_PLAN = COMPLETE
CUSTOMER_EDIT_UX_PLAN = COMPLETE
CUSTOMER_ADDRESS_UX_PLAN = COMPLETE
ADDRESS_DELETE_POLICY_PLAN = COMPLETE
STATUS_LIFECYCLE_AUTHORITY_PRESERVED = YES
POS_CUSTOMER_SUMMARY_DTO_PLAN = COMPLETE
POS_CUSTOMER_SUMMARY_AUTHORITY_MAP = COMPLETE
POS_CUSTOMER_SUMMARY_API_STRATEGY = COMPLETE
POS_CUSTOMER_SUMMARY_API_CONTRACT_PLAN = COMPLETE
POS_AVAILABLE_CREDIT_PERFORMANCE_PLAN = COMPLETE
POS_TOTAL_PURCHASES_PERFORMANCE_PLAN = COMPLETE
POS_CUSTOMER_CARD_VISUAL_PLAN = COMPLETE
POS_CUSTOMER_CARD_PERMISSION_PLAN = COMPLETE
INVOICE_CUSTOMER_SNAPSHOT_SCHEMA_PLAN = COMPLETE
INVOICE_ADDRESS_SNAPSHOT_FORMAT_PLAN = COMPLETE
INVOICE_SNAPSHOT_SERVER_AUTHORITY = YES
INVOICE_NO_ADDRESS_POLICY = COMPLETE
INVOICE_WALK_IN_SNAPSHOT_POLICY = COMPLETE
HISTORICAL_SNAPSHOT_RUNTIME_TEST_PLAN = COMPLETE
INVOICE_SNAPSHOT_MIGRATION_REQUIRED = YES
MIGRATION_81_AUTHORIZED_THIS_BATCH = NO
INVOICE_SNAPSHOT_ADDITIVE_MIGRATION_PLAN = COMPLETE
OLD_INVOICE_LIVE_LOOKUP_FALLBACK = NO
INVOICE_PRINT_VIEW_MODEL_PLAN = COMPLETE
INVOICE_DETAIL_CUSTOMER_SNAPSHOT_PLAN = COMPLETE
INVOICE_SNAPSHOT_IMPLEMENTATION_PRECONDITIONS = COMPLETE
CUSTOMER_MASTER_STRICT_RUNTIME_PLAN = COMPLETE
CUSTOMER_CREATE_RUNTIME_MATRIX_PLAN = COMPLETE
CUSTOMER_EDIT_RUNTIME_MATRIX_PLAN = COMPLETE
POS_CUSTOMER_CARD_RUNTIME_MATRIX_PLAN = COMPLETE
INVOICE_CUSTOMER_SNAPSHOT_RUNTIME_MATRIX_PLAN = COMPLETE
CUSTOMER_CREATE_API_CONTRACT_PLAN = COMPLETE
CUSTOMER_UPDATE_API_CONTRACT_PLAN = COMPLETE
CUSTOMER_PERMISSION_IMPLEMENTATION_PLAN = COMPLETE
CUSTOMER_IMPLEMENTATION_FILE_TOUCH_MAP = COMPLETE
CUSTOMER_IMPLEMENTATION_API_CHANGE_TABLE = COMPLETE
CUSTOMER_IMPLEMENTATION_AUTHORITY_TABLE = COMPLETE
CUSTOMER_ADDRESS_CONTRACT_TABLE = COMPLETE
INVOICE_SNAPSHOT_DESIGN_TABLE = COMPLETE
CUSTOMER_CONCURRENCY_PLAN_TABLE = COMPLETE
CUSTOMER_PHASE_ROLLBACK_PLAN = COMPLETE
OWNER_APPROVAL_CHECKPOINTS = COMPLETE
CUSTOMER_FUTURE_BATCH_SEQUENCE = COMPLETE
PRODUCT_CODE_FILES_CHANGED = 0
MIGRATIONS_CREATED = 0
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
ACCEPTANCE_MIGRATIONS = 80
MIGRATION_81_CREATED = NO
RUNTIME_ENV_CHANGED = NO
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
NEXT_DEV_STARTED_OR_RESTARTED = NO
CUSTOMER_MASTER_DATA_CREATE_EDIT_ADDRESS_IMPLEMENTATION_PLAN_01_GATE = PASS_PLAN_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = CUSTOMER-MASTER-PHASE-01-CREATE-EDIT-ADDRESS-CONTRACT-IMPLEMENTATION_IF_PASS
```
