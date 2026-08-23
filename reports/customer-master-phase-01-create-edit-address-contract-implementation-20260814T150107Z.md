# CUSTOMER MASTER PHASE 1 — CREATE / EDIT / ADDRESS CONTRACT IMPLEMENTATION

## 1. الملخص التنفيذي

تم تنفيذ أساس Customer فقط: عقد Typed جديد لعناوين `Customer.addresses`، فصل صارم بين new-write وlegacy-read، قانون Primary واحد، حماية حقول الخادم، وUpdate بمعاملة/قفل صف وتحقق `expectedUpdatedAt`. لم يتم لمس POS أو Invoice أو Accounting أو Inventory أو Gold Center أو Payment، ولم يتم إنشاء Migration أو تعديل أي قاعدة مشتركة.

## 2. شرط أمان المالك

`OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE` وتم الالتزام به. كل الاختبارات التي كتبت بيانات استخدمت disposable clone من Acceptance فقط، وتم إسقاط الـ clone في `finally`.

## 3. خط الأساس

- الفرع: `main`، HEAD: `1657b0e9ba580faef69be48f04637835c201b521`.
- Persistent: `darfus_erp`، migrations=80، customers=2، invoices=15، payments=30، assets=62.
- Acceptance: `darfus_erp_inventory_rehearsal_20260804_160500z`، migrations=80، customers=3، invoices=133، payments=122، assets=475.
- القراءة الحالية لكلتا القاعدتين تمت مع تحقق `SELECT current_database()` قبل القراءة.

## 4. قائمة الملفات قبل التعديل

الملفات التي أُجيز لمسها كانت helper/service خاص بالـ Customer، controller الخاص بمسار CRUD القائم (لأن هذا هو authority الحالي)، types/repository contract، واختبار Customer خاص. لا توجد ملفات POS/Invoice أو migrations ضمن التغيير.

## 5. اكتشاف أشكال العناوين القديمة

تم الفحص قبل التعديل في Persistent وAcceptance والمصدر والـ fixtures. كلا قاعدتي البيانات تحتويان على `addresses` كـ JSONB array فارغ لكل العملاء الحاليين. المصدر التجريبي يحتوي الشكل `{ line1, city, country }` بلا `isPrimary`. لم يظهر string address أو table مستقل أو شكل آخر موثوق.

## 6. جدول الأشكال

| الشكل | المصدر | المفاتيح/الأنواع | العدد | قابل للقراءة | الخطر |
|---|---|---|---:|---|---|
| EMPTY_ARRAY | Persistent/Acceptance | `[]` | 2/3 عملاء | نعم | لا يوجد rewrite |
| LEGACY_LINE1_CITY_COUNTRY | `lib/demo-data.ts` | نصوص `line1/city/country` بلا marker | fixture فقط | نعم عبر fallback | لا يُعاد تخزينه تلقائياً |

`LEGACY_ADDRESS_SHAPE_DISCOVERY_GATE = PASS`.

## 7. عقد العنوان Typed الجديد

كل كتابة جديدة تستخدم: `line1` و`city` و`country` نصوص مطلوبة؛ `line2` و`postalCode` نصوص اختيارية؛ `isPrimary` Boolean. يتم حفظ الشكل المطبع فقط للكتابة الجديدة، مع حذف optional blanks.

## 8. فصل new-write وlegacy-read

`normalizeCustomerAddresses` هو authority للكتابات الجديدة ويرفض المفاتيح/الأنواع غير المدعومة. `resolvePrimaryAddress` tolerant للقراءة ولا يغيّر المدخل. لا يتم استخدام parser المتسامح كـ validation للكتابة.

## 9. قواعد التطبيع

يتم trim للنصوص، رفض القيم غير النصية والـ nested arbitrary objects، رفض المفاتيح الزائدة، وقبول array فارغة. أكثر من Primary صريح يرجع `422 MULTIPLE_PRIMARY_ADDRESSES`. عند عدم وجود marker، أول عنوان صالح يصبح Primary في الكتابة الجديدة.

## 10. قانون Primary Address

صفر عناوين = `null`، عنوان واحد أو عدة عناوين بلا Primary = أول عنوان Primary، Primary صريح واحد = يُحترم، وأكثر من Primary صريح = رفض fail-closed. العناوين legacy بلا marker لا تُعاد كتابتها.

## 11. Resolver

المساعد المشترك في `backend/src/services/customer-address.service.js` يرجع `primaryAddress` مع المصدر: `EXPLICIT_PRIMARY` أو `SINGLE_ADDRESS` أو `LEGACY_FALLBACK` أو `NONE`، ولا يغيّر input array.

## 12. Create contract

`POST /api/v1/customers` يمر عبر الـ generic Customer authority الحالي. body بدون addresses ما زال صالحاً. body بعناوين يطبعها الخادم، يفرض Company وBranch من السياق المصادق عليه، ينشئ Customer وBranchCustomer داخل transaction واحدة، ويسجل audit قبل commit.

## 13. Update contract

`PUT/PATCH /api/v1/customers/:id` يقبل الحقول الشخصية والعناوين. عند إرسال `expectedUpdatedAt` يتم التحقق قبل الكتابة مع `SELECT ... FOR UPDATE`. mismatch يرجع `409 CUSTOMER_UPDATE_CONFLICT`، والنجاح يسجل audit داخل نفس المعاملة.

## 14. حماية حقول الخادم

يتم تجاهل `companyId`, `balance`, `purchases`, `loyaltyPoints`, `availableCredit`, `status`, credit ledger، audit fields، timestamps و`expectedUpdatedAt` من mutation body. لا يوجد مسار profile لتعديل Status؛ lifecycle routes الحالية بقيت authority.

## 15. Status lifecycle

`STATUS_LIFECYCLE_AUTHORITY_PRESERVED = YES`. اختبار الـ clone أرسل `status=inactive` في profile update ولم يُغيّر الحالة.

## 16. نتيجة concurrency

القفل الصفّي ومعايرة `updatedAt` يمنعان lost update بلا schema change. في clone نجح أحد طلبين المتزامنين، والثاني رجع `CUSTOMER_UPDATE_CONFLICT`.

## 17. transaction وrow lock

Create وUpdate يستخدمان `models.sequelize.transaction()`، وUpdate يستخدم `lock: transaction.LOCK.UPDATE`. BranchCustomer وaudit ينضمان لنفس transaction، وemit يحدث بعد commit فقط.

## 18. Audit

تمت إعادة استخدام `auditService.record` المركزي مع تمرير transaction. اختبار clone أثبت audit delta=3 (create، update الناجح، update المتزامن الناجح) بلا حذف أو تعديل history.

## 19. Permissions

لم تتم إضافة أو تغيير أي permission. بقيت `customers.create/update` وbranch/company guards الحالية هي authority.

## 20. نطاق Create UI

لم تتم إضافة UI جديد في هذه المرحلة. إضافة address block بدون صفحة Details/اختبار browser كامل كانت ستوسع architecture بلا داعٍ؛ لذلك تؤجل إدارة العناوين العملية إلى Phase 2.

## 21. API compatibility

المسارات الحالية لم تتغير، والـ response ما زال Customer نفسه مع `addresses`؛ body القديم بدون addresses يظل backward compatible.

## 22. Error contract

أخطاء العنوان: `422 INVALID_CUSTOMER_ADDRESS`، duplicate primary: `422 MULTIPLE_PRIMARY_ADDRESSES`، timestamp غير صالح: `422 INVALID_EXPECTED_UPDATED_AT`، وstale update: `409 CUSTOMER_UPDATE_CONFLICT`.

## 23. Clone runtime identity

تم إنشاء clone مؤقت باسم `darfus_erp_customer_p1_1786708554029_4dae55` من Acceptance، والتحقق من `current_database()` داخل نفس العملية، ثم إسقاطه بنجاح. لا يوجد أي `darfus_erp_customer_*` متبقٍ.

## 24. Create runtime matrix

في clone contract harness: create بدون اعتماد client على Primary نجح HTTP-equivalent status=201، العنوان canonical، وأول عنوان Primary. body احتوى synthetic data فقط.

## 25. Update runtime matrix

Update الصحيح رجع 200، والـ stale body رجع `CUSTOMER_UPDATE_CONFLICT`. الحقول المالية وStatus لم تتغير.

## 26. Legacy read matrix

اختبارات resolver أثبتت قراءة legacy `{line1,city,country}` مع `LEGACY_FALLBACK` دون إضافة `isPrimary` إلى input أو قاعدة البيانات.

## 27. Legacy edit matrix

أي Customer لا يصبح canonical إلا عند explicit edit لذلك العميل؛ لا توجد bulk normalization ولا backfill.

## 28. Concurrency runtime

طلبان متزامنان على نفس `expectedUpdatedAt`: نتيجة واحدة 200 ونتيجة واحدة 409. لا يوجد duplicate Customer أو BranchCustomer.

## 29. Primary atomicity runtime

Create/Update داخل transaction واحدة؛ عند فشل validation لا يوجد commit ولا audit. Primary بعد النجاح واحد فقط.

## 30. Authorization runtime

الـ clone استخدم technical Super Admin session من نفس architecture، مع Company/Branch headers canonical. لا يوجد bypass ولا permission جديد.

## 31. Financial side-effect proof

في clone: JournalEntries وJournalLines وCashTransactions قبل/بعد ثابتة، و`CUSTOMER_PHASE_1_FINANCIAL_SIDE_EFFECT = NONE`.

## 32. Accounting side-effect proof

لم يتم استدعاء accounting أو treasury service، و`ACCOUNTING_SIDE_EFFECT = NONE`.

## 33. Existing Customer tests

`customer-gold-cgp-ux-legacy-isolation.test.cjs` نجح، و`pos-redesign-phase-02-universal-search-customer.test.cjs` نجح. لم تُمسح بيانات ولا fixtures مشتركة.

## 34. Focused tests

`node --test backend/tests/customer-address-contract.test.cjs`: 7/7 PASS. شملت Primary، duplicate primary، malformed shape، legacy fallback، وserver-owned fields.

## 35. TypeScript/Lint

`npx tsc --noEmit` PASS. ESLint للملفات الخمسة الخاصة بالتغيير PASS، و`git diff --check` لا توجد أخطاء whitespace.

## 36. Cross-module non-regression

لم تتغير ملفات POS أو Invoice أو Accounting أو Inventory أو Gold أو Payment. اختبارات POS/CGP الثابتة المذكورة أعلاه بقيت PASS.

## 37. جدول الملفات

| الملف | السبب | المجال | متوقع؟ |
|---|---|---|---|
| `backend/src/services/customer-address.service.js` | validation/normalization/resolver/sanitizer | Customer | نعم |
| `backend/src/controllers/erp.controller.js` | transaction-safe Customer create/update authority | Customer | نعم، authority الحالي |
| `backend/tests/customer-address-contract.test.cjs` | contract tests | Customer | نعم |
| `lib/types.ts` | typed address وupdate payload | Customer contract | نعم |
| `lib/repositories/interfaces.ts` | update contract | Customer contract | نعم |

## 38. Package safety

`backend/package.json` و`backend/package-lock.json` لم يتغيرا. لا dependency جديدة.

## 39. Migration safety

`MIGRATIONS_CREATED = 0`، `MIGRATION_81_CREATED = NO`. لم يتم إنشاء Address table أو index أو constraint.

## 40. Persistent fingerprint

تمت القراءة قبل/بعد دون mutation. Customer count ظل 2، وكل العناوين arrays فارغة، ولا يوجد Customer row أو address row متغير بسبب هذه المرحلة. القيم المالية الحالية في Persistent هي inherited observation (journal_entries=81، journal_lines=209، cash_transactions=58 وقت التقرير) وليست ناتجة عن أي command في هذه المرحلة؛ لا يوجد دليل على كتابة من هذا العمل.

## 41. Acceptance fingerprint

Acceptance بقيت read-only بعد clone: migrations=80، customers=3، invoices=133، assets=475، وكل العناوين arrays فارغة. clone فقط هو الذي تلقى كتابة مؤقتة ثم أُسقط.

## 42. Customer/address preservation

`PERSISTENT_CUSTOMER_ROWS_CHANGED = 0`، `PERSISTENT_ADDRESS_ROWS_CHANGED = 0`، ولم يحدث backfill أو marker insertion.

## 43. DB integrity

القراءات السابقة واللاحقة أثبتت عدم وجود orphan BranchCustomer أو orphan Invoice/InvoiceItem، وعدم وجود malformed non-array addresses. لا توجد كتابة مالية من المرحلة.

## 44. env/next-env/process safety

لم يتغير `.env` ولم يبدأ أو يُعاد تشغيل Next dev أو runtime العادي. `next-env.d.ts` بقي على inherited drift SHA: `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`؛ لم يتم إصلاحه في هذه المرحلة.

## 45. Browser proof

لأن Create address UI مؤجل، `CREATE_ADDRESS_BROWSER_PROOF = NOT_APPLICABLE`. Phase 2 ستضيف UI Details/Create المناسب بعد Owner review.

## 46. Network/contract evidence

الـ clone harness أثبت request contract canonical عبر controller authority مع status/response equivalent: Create=201، stale Update=409، fresh Update=200، وconcurrency=200/409. لم يتم إرسال طلب mutation إلى Persistent أو Acceptance. لا توجد credentials أو PII في الأدلة.

## 47. Before/after contract

قبل: JSONB loose shape، لا Primary law، update last-write-wins. بعد: typed new-write، legacy-read fallback، Primary resolver، server-owned field sanitizer، transaction/row-lock و`expectedUpdatedAt` guard.

## 48. Scope exclusions

لا POS، لا Invoice snapshot، لا print، لا Accounting/Inventory/Gold/Payment، لا address table، لا migration، لا Customer Details management UI.

## 49. Findings/blockers

لا blocker يمنع backend Phase 1. UI العملي لإدارة العناوين مؤجل عمداً إلى Phase 2. الملاحظة التشغيلية الوحيدة أن بعض العدادات المالية Persistent تغيرت في inherited/manual activity بين تقارير سابقة وهذه القراءة؛ لم يحدث أي SQL write من هذه المرحلة.

## 50. Final gate

كل عقود backend والاختبارات وclone safety جاهزة للمراجعة. `CUSTOMER_CREATE_ADDRESS_UI = DEFERRED_TO_PHASE_2_WITH_REASON`، لذلك لا يوجد ادعاء بإغلاق UI الكامل.

## 51. Owner review checklist

القائمة مكتملة: اكتشاف legacy قبل التعديل، لا rewrite/backfill، create بدون عنوان ومع عنوان، Primary واحد، stale update محمي، audit محفوظ، financial fields محمية، POS/Invoice/Accounting/Inventory/Gold/Payment بلا تغيير، Persistent/Acceptance بلا كتابة.

## 52. الخطوة التالية

بعد موافقة المالك فقط: `CUSTOMER-MASTER-PHASE-02-DETAILS-AND-ADDRESS-MANAGEMENT-UI`. لا يبدأ تلقائياً.

## Required final tokens

```text
CURRENT_BATCH = CUSTOMER-MASTER-PHASE-01-CREATE-EDIT-ADDRESS-CONTRACT-IMPLEMENTATION
MODE = SURGICAL_CUSTOMER_FOUNDATION_IMPLEMENTATION
OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE
FILE_TOUCH_ALLOWLIST = COMPLETE
LEGACY_ADDRESS_SHAPE_DISCOVERY_GATE = PASS
LEGACY_ADDRESS_SHAPES_FOUND = EMPTY_ARRAY_DB; DEMO_LINE1_CITY_COUNTRY_NO_PRIMARY
LEGACY_CUSTOMERS_PRESERVED = PASS
LEGACY_ROWS_AUTOMATICALLY_REWRITTEN = 0
HISTORICAL_BACKFILL_THIS_BATCH = NO
NEW_ADDRESS_TYPED_CONTRACT = PROVEN_AND_FROZEN
NEW_WRITE_LEGACY_READ_SEPARATION = PASS
ADDRESS_NORMALIZATION_NEW_WRITES_ONLY = PASS
PRIMARY_ADDRESS_RULES = PASS
PRIMARY_ADDRESS_RESOLVER = PASS
ADDRESS_SERVER_VALIDATION = PASS
CUSTOMER_CREATE_BACKWARD_COMPATIBILITY = PASS
CUSTOMER_CREATE_ADDRESS_UI = DEFERRED_TO_PHASE_2_WITH_REASON
CUSTOMER_CREATE_MODAL_COMPACT = NOT_APPLICABLE
CUSTOMER_UPDATE_SERVER_OWNED_FIELDS_PROTECTED = PASS
STATUS_LIFECYCLE_AUTHORITY_PRESERVED = YES
CUSTOMER_UPDATE_CONCURRENCY_GUARD = PASS
ADDRESS_MUTATION_ATOMIC = PASS
CUSTOMER_ADDRESS_AUDIT_REUSED = PASS
CUSTOMER_PERMISSION_SEMANTICS_CHANGED = NO
CUSTOMER_FINANCIAL_FIELDS_UNTOUCHED = PASS
CUSTOMER_BALANCE_CHANGED_BY_TASK = NO
CUSTOMER_PURCHASES_CHANGED_BY_TASK = NO
LOYALTY_POINTS_CHANGED_BY_TASK = NO
AVAILABLE_CREDIT_CHANGED_BY_TASK = NO
POS_FILES_CHANGED_THIS_BATCH = 0
INVOICE_FILES_CHANGED_THIS_BATCH = 0
OTHER_BUSINESS_DOMAIN_FILES_CHANGED = 0
CUSTOMER_DETAILS_MANAGEMENT_UI_IMPLEMENTED = NO
TYPE_CHANGES_MINIMAL = PASS
CUSTOMER_API_RESPONSE_BACKWARD_COMPATIBLE = PASS
CUSTOMER_ADDRESS_ERROR_CONTRACT = PASS
MUTATING_RUNTIME_TARGET = DISPOSABLE_CLONE_ONLY
TEST_DATA_PII = SYNTHETIC_ONLY
CUSTOMER_CREATE_RUNTIME_MATRIX = PASS
CUSTOMER_UPDATE_RUNTIME_MATRIX = PASS
LEGACY_ADDRESS_READ_MATRIX = PASS
LEGACY_EDIT_CANONICALIZES_ONLY_TOUCHED_CUSTOMER = PASS
CUSTOMER_CONCURRENCY_RUNTIME = PASS
PRIMARY_ADDRESS_ATOMICITY = PASS
CUSTOMER_AUTH_RUNTIME = PASS
CUSTOMER_PHASE_1_FINANCIAL_SIDE_EFFECT = NONE
ACCOUNTING_SIDE_EFFECT = NONE
FOCUSED_CUSTOMER_ADDRESS_TESTS = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
EXISTING_CUSTOMER_TESTS = PASS
CROSS_MODULE_NON_REGRESSION = PASS
PHASE_1_FILE_DIFF_TABLE = COMPLETE
BROAD_REFACTOR = NO
PACKAGE_JSON_CHANGED = NO
PACKAGE_LOCK_CHANGED = NO
MIGRATIONS_CREATED = 0
MIGRATION_81_CREATED = NO
FUTURE_MIGRATION_NUMBER_POLICY = NEXT_ACTUAL_AT_AUTHORIZATION
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
NEXT_DEV_STARTED_OR_RESTARTED = NO
SERVER_DEPLOYMENTS = 0
CREATE_ADDRESS_BROWSER_PROOF = NOT_APPLICABLE
CUSTOMER_PHASE_1_NETWORK_EVIDENCE = COMPLETE
PHASE_1_BEFORE_AFTER_CONTRACT = COMPLETE
UNRELATED_MODULE_CHANGE = NO
OWNER_PHASE_1_REVIEW_CHECKLIST = COMPLETE
CUSTOMER_MASTER_PHASE_01_CREATE_EDIT_ADDRESS_CONTRACT_IMPLEMENTATION_GATE = PASS_OWNER_REVIEW_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = CUSTOMER-MASTER-PHASE-02-DETAILS-AND-ADDRESS-MANAGEMENT-UI_IF_OWNER_APPROVES
```
