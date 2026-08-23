# CUSTOMER-MASTER-PHASE-02 — Details and Address Management UI

## 1. Executive summary

تم تنفيذ Phase 2 داخل نطاق Customer UI فقط. أصبح إنشاء العميل يدعم عنوانًا اختياريًا، وأصبحت صفحة تفاصيل العميل تدعم تعديل البيانات المسموحة وإدارة العناوين (إضافة/تعديل/تعيين Primary/حذف) مع حماية `expectedUpdatedAt` ورسالة تعارض عربية واضحة. جميع اختبارات الكتابة تمت على Disposable Clone مشتق من Acceptance ثم تم إسقاطه. Persistent وAcceptance ظلا Read-Only.

النتيجة: `CUSTOMER_MASTER_PHASE_02_DETAILS_AND_ADDRESS_MANAGEMENT_UI_GATE = PASS_OWNER_REVIEW_READY`.

## 2. Owner safety boundary

- `OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE`
- لم يتغير POS أو Invoice أو Accounting أو Treasury أو Inventory أو Gold أو Payment أو VAT.
- لم يتغير أي Backend business rule من Phase 1.
- لا Migration، لا package change، لا env change، لا deploy، لا Next dev start/restart.
- `UNRELATED_MODULE_CHANGE = NO`

## 3. Phase-01 precondition

- أُعيد تشغيل `backend/tests/customer-address-contract.test.cjs`: سبعة اختبارات من سبعة نجحت.
- `normalizeCustomerAddresses` و`resolvePrimaryAddress` و`sanitizeCustomerMutation` ما زالت السلطات الأساسية.
- الحقول الجديدة المجمدة ما زالت: `line1`, `city`, `country`, `line2`, `postalCode`, `isPrimary`.
- Legacy read fallback ما زال غير mutating.
- `PHASE_01_CONTRACT_REUSED = YES`
- `PHASE_01_BACKEND_BUSINESS_RULE_CHANGED = NO`

## 4. File allowlist

تم تثبيت allowlist قبل التعديل إلى صفحتي Customer، customer-specific component/helper، additive customer typing/repository interface، focused tests/harness، evidence، وهذا التقرير. لم يُلمس أي ملف خارجها بواسطة هذه الدفعة.

`PHASE_2_FILE_TOUCH_ALLOWLIST = COMPLETE`

## 5. Current UI gaps

قبل Phase 2 لم يكن Create يرسل عنوانًا اختياريًا بالشكل الجديد، ولم تكن صفحة التفاصيل توفر Profile Edit وإدارة عملية للعناوين أو conflict UX. لم يكن مطلوبًا أي Backend أو API أو schema جديد لإغلاق هذه الفجوات.

## 6. Customer Create Address UI

- أضيف block بعنوان `العنوان (اختياري)` داخل modal الحالي.
- الحقول: العنوان، المدينة، الدولة، تفاصيل إضافية، الرمز البريدي.
- يمكن إظهار/إخفاء block بدون إنشاء عنوان.
- Multiple addresses وقت Create مؤجل عمدًا إلى Details لتبقى النافذة compact وآمنة.
- `CUSTOMER_CREATE_ADDRESS_UI = PASS`
- `CUSTOMER_CREATE_MULTIPLE_ADDRESS_UX = DEFERRED_TO_DETAILS`

## 7. Create payload

- بدون Address: `POST /customers` أرسل `email,name,notes,phone,tier` فقط، status `201`، ولم يوجد `addresses`.
- بعنوان: أرسل نفس الحقول ومعها `addresses`، status `201`.
- لم تُرسل `companyId`, `balance`, `purchases`, `loyaltyPoints`, `availableCredit`, `status` أو audit fields.
- أول عنوان عاد من السيرفر بـ`isPrimary=true`; الـfrontend لم يفرض Primary authority.

## 8. Customer Details Edit action

أضيف زر `تعديل بيانات العميل` ويظهر فقط مع `customers.update`.

## 9. Profile Edit

الحقول القابلة للتعديل فقط: الاسم، الهاتف، البريد الإلكتروني، التصنيف، الملاحظات. لا status ولا balance ولا purchases ولا loyalty ولا available credit ولا companyId.

## 10. Address section

كل بطاقة تعرض line1 وline2 إن وجد وcity وcountry وpostalCode، وتدعم التفاف النص الطويل. الأفعال المصرح بها: إضافة، تعديل، جعله العنوان الأساسي، حذف.

## 11. Primary display

- `العنوان الأساسي` يظهر فقط للـexplicit canonical Primary.
- بعد كل mutation يتم refresh من السيرفر.
- اختبار تعيين العنوان الثاني Primary أثبت وجود Primary واحد بالضبط.

## 12. Legacy fallback

العنوان الأول القديم بلا `isPrimary` يظهر بعبارة `العنوان المستخدم حاليًا`، ولا يوصف كـPrimary صريح. العرض وحده لم ينفذ PUT أو أي DB write.

## 13. Add Address

Modal compact يعيد استخدام نفس fields وvalidation. `PUT /customers/:id` أرسل `addresses,expectedUpdatedAt` وعاد `200`، ثم refresh.

## 14. Edit Address

العنوان المختار يُعدل من أحدث Customer state، ويرسل full canonical Phase-01 array مع `expectedUpdatedAt`. Runtime status `200`.

## 15. Set Primary

الفعل يرسل array بها Primary واحد للـserver، والـserver response هو authority النهائي. Runtime status `200`.

## 16. Remove Address

- الحذف يتطلب browser confirmation.
- عند حذف Primary لم يختر الـfrontend replacement؛ أرسل العناوين الباقية، واختار السيرفر أول عنوان كـPrimary.
- حذف آخر عنوان أعاد array فارغة.

## 17. Empty state

تظهر `لا توجد عناوين مسجلة` وزر `إضافة عنوان` للمستخدم المصرح له.

## 18. Concurrency UX

- كل Profile/Address mutation يحمل `expectedUpdatedAt`.
- stale PUT عاد `409 CUSTOMER_UPDATE_CONFLICT`.
- ظهرت الرسالة: `تم تعديل بيانات العميل بواسطة مستخدم آخر. حدّث البيانات وراجع التغييرات قبل الحفظ.`
- لم يحدث retry صامت، وظل آخر server change محفوظًا.

## 19. Permissions

- `customers.view` فقط: العرض نجح، mutation من السيرفر عاد `403`، وأزرار Create/Edit/Address لم تظهر حسب capability.
- `customers.create`: زر Create ظهر، ولم يظهر Edit بدون `customers.update`.
- `customers.update`: حكم Profile/Address actions.
- wrong Company عاد `403` fail closed.
- لأن تعريف `branches.view` غير موجود في Acceptance source مع أن الـshell يحتاجه، أنشأ الـharness تعريفًا bootstrap صناعيًا داخل الـDisposable Clone فقط كي يصل المستخدم الصناعي للصفحة؛ لم يتغير Product permission catalog ولا Persistent ولا Acceptance.
- لا permission جديد ولا تغيير semantics.

## 20. API reuse

أعيد استخدام `POST /customers`, `PUT /customers/:id`, `GET /customers/:id`. `NEW_API_ENDPOINTS_THIS_BATCH = 0`.

## 21. RTL/long address

تم استخدام RTL الحالي مع `break-words` و`min-w-0`. العنوان العربي/الإنجليزي الطويل ظهر داخل البطاقة بدون قطع أو horizontal overflow.

## 22. Clone browser flows

الـfinal harness استخدم Clone `darfus_erp_customer_p2_1786713322422` من Acceptance، تحقق من `current_database()` قبل mutations، ثم أسقط الـClone. النتائج:

- Create without address: PASS.
- Create with address + first Primary: PASS.
- Profile Edit: PASS.
- Add/Edit/Set Primary/Remove/empty state: PASS.
- Concurrency 409: PASS.
- Permission and wrong-company: PASS.
- POS page read-only load: PASS.
- Sales page read-only load: PASS.
- `remaining_clones = 0`.

## 23. Network evidence

الدليل المنظف: `backend/reports/customer-master-phase-02-evidence-20260814T131522414Z/network-and-runtime-evidence.json`.

| Action | Method | URL | Status | Request keys |
|---|---|---|---:|---|
| Create no address | POST | `/customers` | 201 | email,name,notes,phone,tier |
| Create with address | POST | `/customers` | 201 | addresses,email,name,notes,phone,tier |
| Customer detail | GET | `/customers/CUS-0003` | 200 | none |
| Profile edit | PUT | `/customers/CUS-0003` | 200 | email,expectedUpdatedAt,name,notes,phone,tier |
| Add address | PUT | `/customers/CUS-0003` | 200 | addresses,expectedUpdatedAt |
| Set Primary | PUT | `/customers/CUS-0003` | 200 | addresses,expectedUpdatedAt |
| Edit address | PUT | `/customers/CUS-0003` | 200 | addresses,expectedUpdatedAt |
| Remove Primary | PUT | `/customers/CUS-0003` | 200 | addresses,expectedUpdatedAt |
| Remove last | PUT | `/customers/CUS-0003` | 200 | addresses,expectedUpdatedAt |
| stale update | PUT | `/customers/CUS-0003` | 409 | allowed profile fields + expectedUpdatedAt |

لا يحتوي الدليل على tokens أو passwords أو PII حقيقية. كل البيانات Synthetic.

## 24. Financial/accounting side effects

Clone before/after: Customer rows زادت `3 -> 5` للعميلين الصناعيين المتوقعين فقط. بقيت بدون تغيير: CustomerCreditTransactions `3`, Loyalty `103`, Invoices `133`, Payments `122`, Journals `497`, JournalLines `1423`, CashTransactions `173`, Assets `475`. status/balance/purchases/loyalty للعميل المعدل بقيت كما هي.

`CUSTOMER_PHASE_2_FINANCIAL_SIDE_EFFECT = NONE`
`ACCOUNTING_SIDE_EFFECT = NONE`

## 25. POS/Invoice non-regression

- لم يتغير أي POS أو Invoice file بواسطة هذه الدفعة.
- POS browser smoke فتح canonical search shell على Clone.
- Sales browser smoke فتح الصفحة Read-Only.
- static test أثبت أن Invoice detail ما زال يستعمل `selected?.customerName` وأن الصف يعرض `invoice.customerName`.
- POS universal-search tests نجحت 4/4.

## 26. Focused tests

الـfinal combined run: `20/20 PASS`، منها 8 focused Phase-2 UI/contracts، 7 Phase-1 address contract، 4 POS، وCGP isolation verifier.

## 27. Phase-01 regression

`PHASE_01_CUSTOMER_CONTRACT_TESTS = PASS` (`7/7`). لم يتغير Backend service أو controller أو route business logic.

## 28. TypeScript/lint

- `npx tsc --noEmit`: PASS.
- focused ESLint على Customer files: PASS، صفر errors.
- `node --check` للـharness/tests: PASS.
- `git diff --check`: PASS؛ ظهرت warnings CRLF موروثة فقط وليست diff errors.

## 29. Cross-module regression

`customer-gold-cgp-ux-legacy-isolation` PASS و`pos-redesign-phase-02-universal-search-customer` 4/4 PASS. لا Product changes خارج Customer UI.

## 30. Visual evidence

المجلد النهائي: `backend/reports/customer-master-phase-02-evidence-20260814T131522414Z`.

1. `01-create-customer-address-1440x900.png`
2. `02-details-edit-primary-1440x900.png`
3. `03-multiple-addresses-primary-1280x800.png`
4. `04-long-mixed-address-1280x800.png`
5. `05-primary-replacement-1280x800.png`
6. `06-empty-address-tablet-768x800.png`
7. `07-conflict-message-1280x800.png`

## 31. Overflow evidence

القياسات الآلية كانت `scrollWidth == clientWidth` في الحالات السبع: 1440، 1280، و768. `horizontalOverflow=false` لكل حالة.

## 32. File diff table

| File | Reason | Type | Expected | Business logic changed | Unrelated impact |
|---|---|---|---|---|---|
| `app/[locale]/(dashboard)/customers/page.tsx` | Optional Create Address + safe payload | UI | Yes | Customer UI only | No |
| `app/[locale]/(dashboard)/customers/[id]/page.tsx` | Profile Edit + Address Management + conflict UX | UI | Yes | Customer UI only | No |
| `features/customers/components/CustomerAddressFields.tsx` | Shared customer-only fields | UI | Yes | No backend rule | No |
| `lib/customers/address-ui.ts` | Pure UI validation/array helpers | UI helper | Yes | No server authority | No |
| `hooks/use-customers.ts` | Typed create/update payloads | Type/hook | Yes | No | No |
| `lib/types.ts` | Additive Customer address/create typing | Type | Yes | No | No |
| `lib/repositories/interfaces.ts` | Additive create contract | Type | Yes | No | No |
| `lib/repositories/api-impl.ts` | Typed existing POST contract | Type | Yes | No API change | No |
| `lib/repositories/local-impl.ts` | Demo/local typing compatibility | UI repository | Yes | No server rule | No |
| `backend/tests/customer-master-phase-02-ui.test.cjs` | Focused static/UI contracts | Test | Yes | No | No |
| `backend/tests/customer-master-phase-02-browser-runtime.cjs` | Disposable-clone browser proof | Test harness | Yes | No Product runtime | No |
| final evidence directory | Screenshots + sanitized network/runtime proof | Evidence | Yes | No | No |
| هذا التقرير | Closure evidence | Report | Yes | No | No |

بعض الملفات المشتركة (`details`, `types`, `interfaces`) كانت تحتوي inherited changes قبل الدفعة؛ تم الحفاظ عليها. `BROAD_REFACTOR = NO`.

## 33. Package/migration safety

`backend/package.json` و`backend/package-lock.json` كانا modified موروثًا ولم تلمسهما هذه الدفعة. لم تُنشأ أو تُشغل Migration، وMigration 81 غير موجودة من هذه الدفعة.

## 34. Persistent/Acceptance fingerprints

### Persistent `darfus_erp` — before/after identical

Migrations `80`, Customers `2`, address items `0`, CustomerCreditTransactions `4`, Loyalty `11`, purchases sum `5249512.7500`, Invoices `15`, Payments `30`, Journals `81`, JournalLines `209`, CashTransactions `58`, Assets `62`.

### Acceptance source — before/after identical

Migrations `80`, Customers `3`, address items `0`, CustomerCreditTransactions `3`, Loyalty `103`, purchases sum `52408.6900`, Invoices `133`, Payments `122`, Journals `497`, JournalLines `1423`, CashTransactions `173`, Assets `475`.

كل Customer `updated_at` على Persistent/Acceptance يسبق mutation window لهذه الدفعة. `PERSISTENT_FINGERPRINT_DELTA=0` و`ACCEPTANCE_FINGERPRINT_DELTA=0`.

## 35. DB integrity

في Persistent وAcceptance: orphan customers `0`, malformed address arrays `0`, orphan JournalLines `0`, unbalanced posted Journals `0`, unlinked Treasury `0`, duplicate barcodes `0`, blank barcodes `0`. Clone النهائي: orphan customers `0`, malformed addresses `0`, orphan JournalLines `0`, unbalanced Journals `0`.

## 36. env/git/process safety

- Branch `main`; HEAD `1657b0e9ba580faef69be48f04637835c201b521`.
- Worktree كان dirty موروثًا: tracked modified `81`, untracked `207`, stashes `11`, remotes `0`.
- staged by task `0`, commits `0`, pushes/deployments `0`.
- `next-env.d.ts` ظل على الـinherited SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` بلا تغيير.
- لا `.env` change، لا Next dev start/restart، ولا normal backend restart. الـephemeral backend كان Clone-only harness وتم إغلاقه.

## 37. Owner review checklist

تم تجهيز الـ25 بندًا: optional Address، create بالحالتين، first Primary، Profile Edit fields، Add/Edit/Primary/Remove، server replacement، legacy truth، 409، permissions، عدم تغيير POS/Invoice وباقي الدومينات، Clone-only، صفر writes للمصدرين، صفر migration، visual fit، وصفر overflow.

`OWNER_PHASE_2_REVIEW_CHECKLIST = COMPLETE`

## 38. Gate

`CUSTOMER_MASTER_PHASE_02_DETAILS_AND_ADDRESS_MANAGEMENT_UI_GATE = PASS_OWNER_REVIEW_READY`

## 39. Next step

لا يبدأ تلقائيًا. بعد مراجعة المالك فقط:

`NEXT_RECOMMENDED_STEP = CUSTOMER-MASTER-PHASE-03-POS-CUSTOMER-SUMMARY-CARD_IF_OWNER_APPROVES`

## Final tokens

```text
CURRENT_BATCH = CUSTOMER-MASTER-PHASE-02-DETAILS-AND-ADDRESS-MANAGEMENT-UI
MODE = SURGICAL_CUSTOMER_UI_IMPLEMENTATION
OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE
PHASE_2_FILE_TOUCH_ALLOWLIST = COMPLETE
PHASE_01_CONTRACT_REUSED = YES
PHASE_01_BACKEND_BUSINESS_RULE_CHANGED = NO
CUSTOMER_CREATE_ADDRESS_UI = PASS
CUSTOMER_CREATE_ADDRESS_OPTIONAL = YES
CUSTOMER_CREATE_WITHOUT_ADDRESS = PASS
CUSTOMER_CREATE_WITH_ADDRESS = PASS
CUSTOMER_CREATE_MULTIPLE_ADDRESS_UX = DEFERRED_TO_DETAILS
CUSTOMER_CREATE_FIRST_ADDRESS_PRIMARY = PASS
CUSTOMER_CREATE_FINANCIAL_FIELDS_EXPOSED = NO
CUSTOMER_CREATE_ADDRESS_VALIDATION_UX = PASS
CUSTOMER_DETAILS_EDIT_ACTION = PASS
CUSTOMER_PROFILE_EDIT_UI = PASS
STATUS_FIELD_IN_PROFILE_EDIT = NO
CUSTOMER_FINANCIAL_FIELDS_EDITABLE = NO
CUSTOMER_CONCURRENCY_CONFLICT_UX = PASS
CUSTOMER_ADDRESS_SECTION_UI = PASS
LEGACY_PRIMARY_DISPLAY_TRUTHFUL = PASS
CUSTOMER_ADD_ADDRESS_UI = PASS
CUSTOMER_EDIT_ADDRESS_UI = PASS
CUSTOMER_SET_PRIMARY_UI = PASS
CUSTOMER_REMOVE_ADDRESS_UI = PASS
CUSTOMER_ADDRESS_EMPTY_STATE = PASS
CUSTOMER_ADDRESS_RTL_LAYOUT = PASS
CUSTOMER_DETAILS_BROAD_REDESIGN = NO
STATUS_LIFECYCLE_AUTHORITY_PRESERVED = YES
CUSTOMER_FINANCIAL_DISPLAY_SEMANTICS_CHANGED = NO
CUSTOMER_PERMISSION_SEMANTICS_CHANGED = NO
NEW_API_ENDPOINTS_THIS_BATCH = 0
UI_SERVER_OWNED_FIELDS_SENT = NO
LEGACY_CUSTOMER_UI_READ = PASS
LEGACY_VIEW_CAUSES_WRITE = NO
MUTATING_RUNTIME_TARGET = DISPOSABLE_CLONE_ONLY
TEST_DATA_PII = SYNTHETIC_ONLY
CUSTOMER_CREATE_ADDRESS_BROWSER_FLOW = PASS
CUSTOMER_PROFILE_EDIT_BROWSER_FLOW = PASS
CUSTOMER_ADDRESS_MANAGEMENT_BROWSER_FLOW = PASS
CUSTOMER_CONCURRENCY_UI_RUNTIME = PASS
CUSTOMER_UI_PERMISSION_RUNTIME = PASS
CUSTOMER_PHASE_2_NETWORK_EVIDENCE = COMPLETE
CUSTOMER_PHASE_2_FINANCIAL_SIDE_EFFECT = NONE
ACCOUNTING_SIDE_EFFECT = NONE
POS_NON_REGRESSION = PASS
INVOICE_NON_REGRESSION = PASS
POS_FILES_CHANGED_THIS_BATCH = 0
INVOICE_FILES_CHANGED_THIS_BATCH = 0
OTHER_BUSINESS_DOMAIN_FILES_CHANGED = 0
FOCUSED_CUSTOMER_UI_TESTS = PASS
PHASE_01_CUSTOMER_CONTRACT_TESTS = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
CROSS_MODULE_NON_REGRESSION = PASS
CUSTOMER_PHASE_2_VISUAL_EVIDENCE = COMPLETE
CUSTOMER_PAGE_HORIZONTAL_OVERFLOW = NO
CUSTOMER_DETAILS_HORIZONTAL_OVERFLOW = NO
PHASE_2_FILE_DIFF_TABLE = COMPLETE
BROAD_REFACTOR = NO
PACKAGE_JSON_CHANGED = NO
PACKAGE_LOCK_CHANGED = NO
MIGRATIONS_CREATED = 0
MIGRATION_81_CREATED = NO
PERSISTENT_FINGERPRINT_DELTA = 0
ACCEPTANCE_FINGERPRINT_DELTA = 0
PERSISTENT_CUSTOMER_ROWS_CHANGED = 0
PERSISTENT_ADDRESS_ROWS_CHANGED = 0
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
ACCEPTANCE_MIGRATIONS = 80
DB_INTEGRITY_NON_REGRESSION = PASS
NEXT_ENV_MUTATED_THIS_BATCH = NO
RUNTIME_ENV_CHANGED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
NEXT_DEV_STARTED_OR_RESTARTED = NO
UNRELATED_MODULE_CHANGE = NO
OWNER_PHASE_2_REVIEW_CHECKLIST = COMPLETE
CUSTOMER_MASTER_PHASE_02_DETAILS_AND_ADDRESS_MANAGEMENT_UI_GATE = PASS_OWNER_REVIEW_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = CUSTOMER-MASTER-PHASE-03-POS-CUSTOMER-SUMMARY-CARD_IF_OWNER_APPROVES
```
