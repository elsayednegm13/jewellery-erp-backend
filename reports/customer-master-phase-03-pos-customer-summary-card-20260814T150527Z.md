# CUSTOMER-MASTER-PHASE-03-POS-CUSTOMER-SUMMARY-CARD

## 1. الملخص التنفيذي

تم تنفيذ بطاقة عميل POS صغيرة للقراءة فقط، تعتمد على DTO خادم مخصص. البطاقة تعرض الاسم، الحالة، التصنيف، الهاتف، العنوان الأساسي، النقاط، الرصيد المتاح، وإجمالي المشتريات. لا توجد أي عملية بيع أو دفع أو تعديل عميل في مسار البطاقة.

تنبيه إجرائي: اختبارات المصدر والـClone نجحت. لكن لم يتم حفظ لقطة fingerprint مستقلة للـPersistent في بداية هذه المرحلة. كما أن الـPersistent يحتوي الآن ثلاثة عناصر عناوين بدلاً من لقطة تقرير Phase 2 السابقة (واحد). الـaudit الظاهر يسبق تشغيل الـClone النهائي عند `2026-08-14T15:01:32.374Z`، ولا توجد أي كتابة من هذا التنفيذ إلى الـPersistent، لكن لا يمكن إثبات delta المرحلة حرفياً من دون baseline بداية مستقل. لذلك الـGate النهائي **BLOCKED إجرائياً فقط**، وليس بسبب عيب في البطاقة.

## 2. حدود أمان المالك

`OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE`. التغيير محصور في قراءة ملخص العميل داخل POS، route/service قراءة فقط، type، واختبارات Customer/POS مركزة. لا تعديل في checkout أو تسعير أو دفع أو محاسبة أو مخزون أو ذهب أو فاتورة أو DOB أو schema.

## 3. الشروط السابقة

تمت مراجعة AGENTS.md وPROJECT_PROGRESS_HANDOFF.md وتقارير Customer Phase 1 وPhase 2 والتصحيح. عقد العناوين Phase 1 استُخدم كما هو؛ authority للعنوان الأساسي بقيت server-side، وDOB بقي `NOT_SUPPORTED_WITH_REASON`.

## 4. لوحة عميل POS السابقة

اللوحة السابقة كانت تعرض `Customer.balance` تحت تسمية الرصيد. هذا لا يطابق معنى «الرصيد المتاح». المسار الجديد لا يقرأ `balance` في البطاقة.

## 5. خريطة السلطات

| الحقل | السلطة |
|---|---|
| الاسم/الحالة/التصنيف/الهاتف | Customer fields |
| العنوان الأساسي | `resolvePrimaryAddress` server resolver |
| النقاط | `Customer.loyaltyPoints` |
| الرصيد المتاح | `customer-credit.service.getCustomerCreditSummary` / credit ledger |
| إجمالي المشتريات | `Customer.purchases` stored aggregate |

## 6. قرار معمارية API

تم اعتماد `GET /api/v1/customers/:id/pos-summary`. هو أكثر أماناً من إثراء `GET /customers`: طلب واحد فقط بعد اختيار العميل، لا N+1 في صفوف البحث، والـcredit يُحسب مرة واحدة في authority الخادم مع Company/Branch scope قائم.

## 7. DTO الملخص

الاستجابة ضمن envelope المشروع: `{ success: true, data: { id, name, status, tier, phone, primaryAddress, loyaltyPoints, availableCredit, totalPurchases, currency, meta } }`. `meta` يوضح مصادر العرض والـread-only، وليس حقول تعديل.

## 8. مصدر الرصيد المتاح

`customer-credit.service` هو المصدر. لا `Customer.balance`، ولا `creditLimit - balance`، ولا معادلة frontend. اختبار الـClone أثبت `availableCredit = 48.1250` من ledger مقابل قيمة عميل مستقلة.

## 9. مصدر إجمالي المشتريات

`Customer.purchases` فقط. لا يوجد scan أو aggregate لفواتير عند اختيار العميل.

## 10. مصدر العنوان الأساسي

يعاد استخدام `customer-address.service.resolvePrimaryAddress`: explicit `isPrimary` ثم canonical fallback ثم legacy meaningful fallback. لا تعتمد البطاقة على `addresses[0]`.

## 11. مصدر النقاط

`Customer.loyaltyPoints`، وهو authority المستخدم حالياً للعرض. لا يوجد mutation أو scan إضافي.

## 12. الصلاحيات والأمان

الroute تستخدم `authMiddleware` و`customers.view` ثم `requireBranchCustomerResource`. اختبار الـClone أثبت نجاح user المسموح، و`403` للمرفوض، و`403` عند Company غير صحيح. لا توسعة صلاحيات مالية.

## 13. واجهة البطاقة

في `pos/page.tsx` البطاقة مستطيل مدمج في عمود العميل: الاسم، الهاتف، الحالة، التصنيف، العنوان الأساسي، النقاط، الرصيد المتاح، وإجمالي المشتريات. العرض read-only بلا Edit أو Address أو Status أو Credit controls.

## 14. حالات البطاقة

مغطاة: لا عميل، loading، خطأ صادق، بلا عنوان، legacy fallback، نقاط/credit/purchases صفرية وموجبة، عنوان طويل، وعميل inactive قابل للقراءة حسب القانون الحالي.

## 15. التحميل والخطأ

عند تغيير العميل تُمسح بيانات الملخص السابقة ثم يظهر loading محدود. الخطأ لا يملأ بيانات العميل السابق ولا يمنع invoice الحالية.

## 16. حماية السباق

استُخدم `AbortController` مع generation/latest-selection guard، مع فحص أن `response.data.id` يطابق `customerId` الحالي. A ثم B سريعاً ينتهي بعرض B فقط.

## 17. الأداء وN+1

طلب summary واحد بعد اختيار العميل؛ لا طلب summary لكل صف بحث، `purchases` قراءة O(1)، وحل العنوان in-memory. `availableCredit` يطلب authority مرة واحدة للعميل المختار.

## 18. قائمة الملفات المسموح بها

| الملف | السبب | نوع | منطق أعمال تغير؟ | أثر غير متعلق؟ |
|---|---|---|---|---|
| `app/[locale]/(dashboard)/pos/page.tsx` | بطاقة وrace/loading | UI | لا | لا |
| `backend/src/routes/erp.routes.js` | GET read-only | route | لا | لا |
| `backend/src/services/customer-pos-summary.service.js` | DTO composition | read service | لا | لا |
| `lib/types.ts` | DTO type إضافي | type | لا | لا |
| `backend/tests/customer-master-phase-03-pos-customer-summary.test.cjs` | اختبارات مركزة | test | لا | لا |
| Customer/POS test helpers المحددة | توافق/runtime evidence | test | لا | لا |

ملفات tracked الثلاثة كانت ضمن worktree موروث واسع؛ لم تُنظّف أو تُستبدل أي تغييرات موروثة.

## 19. مصفوفة runtime

على Clone `darfus_erp_customer_p3_summary_1786719692374`: no address، explicit primary، two-address primary switch A→B→A، legacy fallback، صفر وموجب credit/purchases/points، long address، inactive، مع 13 screenshot و57 network calls sanitized.

## 20. دليل الرصيد المتاح runtime

الملخص أعاد `48.1250` المطابق لخدمة credit ledger للعميل الاصطناعي، وليس `Customer.balance`.

## 21. دليل إجمالي المشتريات runtime

الملخص أعاد `123.45` المطابق لقيمة `Customer.purchases` المخزنة، من دون invoice query ضمن summary path.

## 22. العنوان الأساسي runtime

اختبار A→B→A أثبت أن البطاقة تتبع primary الحالي ولا تتبع ترتيب المصفوفة.

## 23. سباق تبديل العميل runtime

طُلب A وB بسرعة؛ أحدث اختيار B هو المعروض فقط. لا stale overwrite.

## 24. الصلاحيات runtime

`customers.view` المصرح يقرأ، المستخدم المرفوض يحصل على 403، وCompany غير الصحيح 403. لا تسريب credit عبر الشركة.

## 25. دليل الشبكة

المجلد النهائي: `backend/reports/customer-master-phase-03-pos-customer-summary-evidence-20260814T150132273Z`. يسجل method/URL/status/keys/counted calls بدون tokens أو credentials. يغطي list/selection/summary/A-B/primary/permission/wrong-company.

## 26. الدليل البصري

تمت مراجعة لقطات Playwright الفعلية: `03-pos-selected-positive-summary-1440x900.png` و`05-pos-long-address-tablet-768x800.png`. البطاقة compact، والقيم موجبة ظاهرة، والعنوان المختلط الطويل يلتف بأمان. 13 لقطة إجمالاً.

## 27. layout/overflow

فحص 1440×900 و768×800: `POS_PAGE_HORIZONTAL_OVERFLOW = NO` و`POS_CUSTOMER_CARD_OVERFLOW = NO`.

## 28. Universal Search

اختبار `pos-redesign-phase-02-universal-search-customer.test.cjs` ضمن المجموعة المركزة نجح؛ لم تتغير دلالات barcode/code/name/browse أو اختيار items.

## 29. الدفع

لم يتغير Payment panel أو method أو payload. فحص static/regression نجح.

## 30. عقد checkout

لم يتغير request أو sale creation؛ لا عملية sale أُرسلت إلى Persistent أو Acceptance.

## 31. دليل عدم الأثر المالي

Summary route لا تكتب. داخل الـClone، باستثناء fixture credit ledger القانونية المقصودة، بقيت invoices/payments/journals/lines/cash/assets ثابتة؛ integrity clone: orphan journals 0 وunbalanced 0. لا task-owned side effect في Persistent أو Acceptance.

## 32. الاختبارات المركزة

`node --test backend/tests/customer-master-phase-03-pos-customer-summary.test.cjs backend/tests/customer-address-contract.test.cjs backend/tests/customer-master-phase-02-ui.test.cjs backend/tests/customer-master-phase-02-correction-nationality-optional-address-pos.test.cjs backend/tests/pos-redesign-phase-02-universal-search-customer.test.cjs` → **28/28 PASS**.

## 33. Customer regressions

Phase 1 contract، Phase 2 UI، وPhase 2 correction كلها ضمن الأمر السابق وPASS.

## 34. TypeScript وlint

`npx tsc --noEmit` → PASS. Focused ESLint → exit 0؛ توجد 3 warnings موروثة في POS فقط، بلا error.

## 35. Cross-module regression

لا ملفات Invoice/Payment/Accounting/Inventory/Gold/customer-credit mutation/purchases recalc تغيرت بهذه المرحلة. فحوص التوافق المحدودة PASS.

## 36. محاسبة فرق الملفات

لا broad refactor. `git diff` يعرض فروقاً كبيرة موروثة في بعض tracked files بسبب worktree/line-ending history؛ هذه المرحلة أضافت فقط hunk summary route/card/type ضمنها، ولم تستخدم reset/restore/clean/stash.

## 37. package/migration

`PACKAGE_JSON_CHANGED = NO`، `PACKAGE_LOCK_CHANGED = NO`، `MIGRATIONS_CREATED = 0`، ولا Migration 81.

## 38. Persistent fingerprint

القراءة النهائية: migrations 80، customers 2، address items 3، credit 4، loyalty 11، invoices 15، payments 30، journals 81، lines 209، cash 58، assets 62، orphan journal lines 0.

لقطة Phase 2 السابقة كانت address items 1. Audit rows للـPersistent الظاهرة عند `14:56Z` تسبق clone runtime النهائي `15:01:32Z`; clone تم حذفه، وكل mutations في runtime اتجهت للـClone. لكن لا توجد لقطة Phase 3 initial مستقلة؛ لذا `PERSISTENT_FINGERPRINT_DELTA = UNKNOWN`, لا `0` مثبتة.

## 39. Acceptance fingerprint

قراءة نهائية فقط: migrations 80، customers 3، address items 0، credit 3، loyalty 103، invoices 133، payments 122، journals 497، lines 1423، cash 173، assets 475، orphan journal lines 0. لا source writes؛ `ACCEPTANCE_FINGERPRINT_DELTA = 0` وفق قراءة source/clone isolation.

## 40. سلامة قاعدة البيانات

Persistent وAcceptance: orphan journal lines = 0. الـClone: orphan branch customer 0، malformed addresses 0، orphan journals 0، unbalanced 0. لا دليل عيب integrity ناتج عن البطاقة. شرط fingerprint Persistent الكامل يبقى غير مثبت إجرائياً فقط.

## 41. env/git/process

branch `main`، HEAD `1657b0e9ba580faef69be48f04637835c201b521`، staged 0، stashes 11، remotes none. لا commit/push/deploy/Next dev أو restart عادي. `next-env.d.ts` بقي SHA inherited `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`; لا mutation. لا env change.

## 42. قائمة مراجعة المالك

راجع compact card، مصادر الحقول، primary A→B→A، الأصفار والعنوان الطويل، تبديل عميل سريع، عدم وجود controls تعديل، وعدم تغيّر search/checkout/pricing/payment/invoice. راجع كذلك فرق Persistent address-item الظاهر قبل منح Gate نهائي.

## 43. Gate

`CUSTOMER_MASTER_PHASE_03_POS_CUSTOMER_SUMMARY_CARD_GATE = BLOCKED`.

سبب وحيد: `PERSISTENT_FINGERPRINT_DELTA = UNKNOWN` لأن baseline Phase 3 قبل التنفيذ لم يُحفظ، والـPersistent يحتوي address items=3 خلاف لقطة Phase 2=1. هذا ليس فشل product ولا يبرر أي كتابة/cleanup. كل gates الوظيفية والـClone PASS.

## 44. الخطوة التالية

`PERSISTENT_CUSTOMER_FINGERPRINT_RECONCILIATION_READ_ONLY` فقط: يحدد المالك/forensic baseline المعتمد للـPersistent. بعد توثيق أن الفرق خارجي سابق، يمكن للمالك اعتماد Phase 3 ثم فقط النظر في `CUSTOMER-INVOICE-SNAPSHOT-MIGRATION-AUTHORIZATION-01`. لا تبدأ أي migration تلقائياً.

## Tokens

```text
CURRENT_BATCH = CUSTOMER-MASTER-PHASE-03-POS-CUSTOMER-SUMMARY-CARD
MODE = SURGICAL_POS_CUSTOMER_SUMMARY_IMPLEMENTATION
OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE
POS_CUSTOMER_SUMMARY_AUTHORITY_MAP = PASS
POS_AVAILABLE_CREDIT_AUTHORITY = CUSTOMER_CREDIT_LEDGER
POS_AVAILABLE_CREDIT_CLIENT_FORMULA = NO
POS_TOTAL_PURCHASES_AUTHORITY = CUSTOMER_PURCHASES_STORED_AGGREGATE
POS_TOTAL_PURCHASES_RUNTIME_AGGREGATE_QUERY = NO
POS_CUSTOMER_SUMMARY_API_DECISION = PROVEN
POS_CUSTOMER_SUMMARY_API = GET /api/v1/customers/:id/pos-summary
POS_CUSTOMER_SUMMARY_DTO = PASS
POS_CUSTOMER_SUMMARY_PERMISSION_POLICY = PASS
POS_FINANCIAL_PERMISSION_EXPANSION = NO
POS_CUSTOMER_SUMMARY_SECURITY = PASS
POS_PRIMARY_ADDRESS_AUTHORITY = CANONICAL_PRIMARY
POS_PRIMARY_ADDRESS_ARRAY_INDEX_AUTHORITY = NO
POS_CUSTOMER_CARD_COMPACT = PASS
POS_CUSTOMER_CARD_STATE_MATRIX = PASS
POS_CUSTOMER_CARD_LABELS = PASS
POS_CUSTOMER_SUMMARY_FORMATTING = PASS
POS_CUSTOMER_SUMMARY_LOADING_RACE = PASS
POS_CUSTOMER_SUMMARY_LATEST_REQUEST_WINS = PASS
POS_CUSTOMER_CARD_READ_ONLY = YES
POS_CHECKOUT_CHANGED = NO
POS_PRICING_CHANGED = NO
POS_PAYMENT_CHANGED = NO
POS_ACCOUNTING_CHANGED = NO
INVOICE_FILES_CHANGED_THIS_BATCH = 0
CUSTOMER_DOB_WORK_THIS_BATCH = NONE
POS_CUSTOMER_SUMMARY_N_PLUS_ONE = NO
POS_CUSTOMER_SUMMARY_SERVER_WRITES = 0
POS_CUSTOMER_SUMMARY_RESPONSE_CONTRACT = COMPLETE
POS_CUSTOMER_SUMMARY_ERROR_CONTRACT = PASS
PHASE_3_FILE_TOUCH_ALLOWLIST = COMPLETE
MUTATING_RUNTIME_TARGET = DISPOSABLE_CLONE_ONLY
POS_CUSTOMER_SUMMARY_RUNTIME_MATRIX = PASS
POS_AVAILABLE_CREDIT_RUNTIME = PASS
POS_TOTAL_PURCHASES_RUNTIME = PASS
POS_PRIMARY_ADDRESS_RUNTIME = PASS
POS_CUSTOMER_SUMMARY_RACE_RUNTIME = PASS
POS_CUSTOMER_SUMMARY_PERMISSION_RUNTIME = PASS
POS_CUSTOMER_SUMMARY_NETWORK_EVIDENCE = COMPLETE
POS_CUSTOMER_SUMMARY_VISUAL_EVIDENCE = COMPLETE
POS_PAGE_HORIZONTAL_OVERFLOW = NO
POS_CUSTOMER_CARD_OVERFLOW = NO
POS_UNIVERSAL_SEARCH_NON_REGRESSION = PASS
POS_PAYMENT_PANEL_NON_REGRESSION = PASS
POS_CHECKOUT_CONTRACT_NON_REGRESSION = PASS
POS_SUMMARY_FINANCIAL_SIDE_EFFECT = NONE
ACCOUNTING_SIDE_EFFECT = NONE
FOCUSED_POS_CUSTOMER_SUMMARY_TESTS = PASS
CUSTOMER_PHASE_01_REGRESSION = PASS
CUSTOMER_PHASE_02_REGRESSION = PASS
CUSTOMER_PHASE_02_CORRECTION_REGRESSION = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
CROSS_MODULE_NON_REGRESSION = PASS
BROAD_REFACTOR = NO
PACKAGE_JSON_CHANGED = NO
PACKAGE_LOCK_CHANGED = NO
MIGRATIONS_CREATED = 0
MIGRATION_81_CREATED = NO
PERSISTENT_FINGERPRINT_DELTA = UNKNOWN
PERSISTENT_CUSTOMER_ROWS_CHANGED = UNKNOWN
PERSISTENT_ADDRESS_ROWS_CHANGED = UNKNOWN
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_FINGERPRINT_DELTA = 0
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
OWNER_PHASE_3_REVIEW_CHECKLIST = COMPLETE
CUSTOMER_MASTER_PHASE_03_POS_CUSTOMER_SUMMARY_CARD_GATE = BLOCKED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = PERSISTENT_CUSTOMER_FINGERPRINT_RECONCILIATION_READ_ONLY
```
