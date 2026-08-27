# CUSTOMER-MASTER-PHASE-02-CORRECTION-NATIONALITY-DOB-OPTIONAL-ADDRESS-PRIMARY-POS-SYNC-01

## 1. Executive summary

تم تنفيذ تصحيح UI/contract ضيق خاص بالعملاء فقط: الجنسية أصبحت جزءًا قابلًا للتعديل من الحقل الحقيقي `Customers.nationality`، والعنوان صار يسمح بأي جزء ذي معنى مع رفض العنوان الفارغ بالكامل، واختيار عنوان العميل في POS صار يعتمد على `isPrimary` الصريح وليس ترتيب المصفوفة. لم يتم تنفيذ DOB لأن المصدر لا يثبت عقد كتابة آمنًا له.

## 2. Owner safety boundary

`OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE`.

لم يتم تغيير POS business logic أو Invoice أو Accounting أو Treasury أو Inventory أو Gold أو Payment أو schema أو migrations. تعديل POS مقتصر على عرض عنوان العميل المختار بطريقة صحيحة باستخدام resolver مشترك فقط.

## 3. Precondition and source verification

تمت إعادة قراءة `AGENTS.md` و`PROJECT_PROGRESS_HANDOFF.md` وتقارير Customer forensic/plan/Phase-01/Phase-02. عقد Phase-01 بقي مستخدمًا: `POST /customers` و`PUT /customers/:id` و`GET /customers/:id`، والـserver هو صاحب primary/concurrency/audit authority.

## 4. File touch allowlist and actual diff

| File | Reason | UI/Type/Test | Business logic changed? | Unrelated impact? |
|---|---|---|---|---|
| `backend/src/services/customer-address.service.js` | تطبيع address اختياري وsafe allowlist للجنسية | Customer contract | نعم، داخل Customer فقط | لا |
| `lib/customers/address-ui.ts` | resolver/format/validation مشتركة للعنوان | UI helper | لا | لا |
| `lib/types.ts` | types إضافية للجنسية والعنوان الاختياري | Type | لا | لا |
| `app/[locale]/(dashboard)/customers/page.tsx` | Create Address اختياري | UI | لا | لا |
| `app/[locale]/(dashboard)/customers/[id]/page.tsx` | تعديل الجنسية وعرض العنوان الجزئي | UI | لا | لا |
| `app/[locale]/(dashboard)/pos/page.tsx` | اختيار explicit primary للعرض فقط | UI consumer | لا | لا |
| `backend/tests/customer-address-contract.test.cjs` | regression لعقد العنوان | Test | لا | لا |
| `backend/tests/customer-master-phase-02-ui.test.cjs` | Customer UI regression | Test | لا | لا |
| `backend/tests/pos-redesign-phase-02-universal-search-customer.test.cjs` | POS primary resolver regression | Test | لا | لا |
| `backend/tests/customer-master-phase-02-correction-nationality-optional-address-pos.test.cjs` | اختبارات التصحيح الجديدة | Test | لا | لا |
| `backend/tests/customer-master-phase-02-browser-runtime.cjs` | clone/browser evidence | Test helper | لا | لا |

`PHASE_2_FILE_TOUCH_ALLOWLIST = COMPLETE`; `BROAD_REFACTOR = NO`.

## 5. Nationality authority and edit

الموديل يثبت وجود `Customers.nationality` كحقل نصي nullable. كان العرض القديم يقرأ fallback من `kycDetails.nationality`؛ التصحيح يجعل قراءة/كتابة الحقل الأعلى canonical مع fallback للعرض القديم فقط. الطلب لا يرسل company/status/financial/audit/KYC fields غير المصرح بها.

## 6. DOB forensic result

`dateOfBirth` يظهر كقراءة ضمن JSON `kycDetails` فقط. endpoint KYC الحالي لا يتحقق منه ولا يكتبه، ولا يوجد field/route validated مخصص له. لذلك لم يُعرض أو يُكتب في Profile Edit.

`CUSTOMER_DOB_FIELD_AUTHORITY = NOT_SUPPORTED`، وهذه نتيجة سلامة وليست نقصًا تم تجاوزه.

## 7. Optional-address contract

حقول `line1`, `line2`, `city`, `country`, `postalCode` اختيارية individually. إذا لم يكتب المستخدم أي جزء فلا يرسل Create UI object جزئيًا. وأي طلب يحمل address كله blanks يرفض server بـ `422 EMPTY_CUSTOMER_ADDRESS`. أول عنوان meaningful يعيّنه server primary؛ UI لا يختار replacement عند الحذف ولا يغيّر primary authority.

## 8. Address matrix

| Scenario | Result |
|---|---|
| Create بدون address | PASS |
| Create `line1` فقط | PASS، primary server-side |
| Create `city` فقط | PASS، primary server-side |
| Create `country` فقط | PASS، primary server-side |
| Create `line1 + city` | PASS |
| Create `city + country` | PASS |
| Create address فارغ بالكامل | 422 `EMPTY_CUSTOMER_ADDRESS` |
| Edit `city` فقط | PASS |
| Edit `country` فقط | PASS |
| Edit `line1` فقط | PASS |
| Edit `postalCode` فقط | PASS |
| Edit address فارغ بالكامل | 422 `EMPTY_CUSTOMER_ADDRESS` |

## 9. Primary authority and legacy display

`resolveCustomerPrimaryAddress` يختار `isPrimary === true` أولًا، ثم legacy meaningful fallback للعرض فقط. لا يوجد ترتيب مصفوفة باعتباره authority. العنوان legacy غير الصريح يعرض كـ"العنوان المستخدم حاليًا" ولا يُكتب عند فتح العميل.

## 10. POS root cause and correction

السبب المثبت: POS كان يستعمل أول address meaningful عبر `.find(...)`، لذا يمكن أن يعرض عنوانًا غير primary عند تغير ترتيب المصفوفة. الآن POS يستهلك resolver نفسه ويعرض primary الصريح. لا يوجد stale-cache cause: المسار القياسي يعيد GET عند remount/reload/reselect؛ الدليل runtime أظهر الطلبات الجديدة.

## 11. Disposable-clone real browser proof

تم استخدام Chrome/Playwright harness على clone disposable فقط:
`darfus_erp_customer_p2_correction_1786718160659`.

تسلسل مثبت:

1. إنشاء Customer synthetic ثم A (`العنوان أ، القاهرة`) وB (`العنوان ب، الجيزة`).
2. Set B primary ثم POS/reselect: ظهر B.
3. العودة للتفاصيل، Set A primary، reload/reselect POS: ظهر A.
4. Edit nationality إلى `مصري` وتحقق من استمراره في clone.
5. اختبار 409 stale update وعدم overwrite.

تم حذف clone في `finally`، وفحص PostgreSQL النهائي أعاد `remainingDisposableCorrectionClones: []`.

## 12. Browser/network/visual evidence

المجلد: `backend/reports/customer-master-phase-02-correction-evidence-20260814T143600655Z/`.

يحتوي 10 screenshots و`network-and-runtime-evidence.json` (46 network calls sanitized، 9 audit records). لقطات POS ذات العلاقة:

- `04-pos-b-primary-1280x800.png`
- `05-pos-a-primary-1280x800.png`

اختبارات desktop 1440x900 و1280x800 موجودة. لا توجد أخطاء browser غير خطأ 409 المقصود في اختبار concurrency. لا tokens/PII حقيقية في الدليل.

## 13. Network contract evidence

تمت تغطية GET customer، POST بلا address، POST بعنوان جزئي، PUT profile nationality، PUT add/edit/set-primary/remove، وPUT stale. payloads اقتصرت على profile/address fields المسموحة و`expectedUpdatedAt` عند التحديث. لا API جديد؛ server responses هي authority وتمت مراجعة audit في clone.

## 14. Concurrency, permissions, and protected fields

رسالة 409 العربية موجودة ولا يوجد retry صامت. صلاحيات `customers.view/create/update` كما هي؛ لا permission جديدة. لا status ولا balance/purchases/loyaltyPoints/availableCredit/companyId/credit ledger/audit fields قابلة للكتابة من UI.

## 15. Financial and cross-domain non-regression

قبل/بعد clone بقيت counts المالية وغير العملاء ثابتة داخل clone: credit 3، loyalty 103، invoices 133، payments 122، journals 497، journal_lines 1423، cash 173، assets 475. integrity clone: orphan journals 0، malformed addresses 0، unbalanced 0.

POS logic لم يتغير إلا address selector. لم تتغير Invoice/Accounting/Inventory/Gold/Payment files أو business semantics.

## 16. Focused validation

- `node --test backend/tests/customer-address-contract.test.cjs backend/tests/customer-master-phase-02-ui.test.cjs backend/tests/customer-master-phase-02-correction-nationality-optional-address-pos.test.cjs backend/tests/pos-redesign-phase-02-universal-search-customer.test.cjs` → 25/25 PASS.
- `node tests/customer-master-phase-02-browser-runtime.cjs` → PASS.
- `npx tsc --noEmit` → PASS.
- Focused ESLint → exit 0; صفر errors. التحذيرات القديمة فقط: `no-img-element` في Customer details وReact hooks deps في POS.
- `git diff --check` → PASS (تحذيرات CRLF inherited فقط).

## 17. Source DB fingerprints and integrity

كلها SELECT-only قبل/بعد. persistent وacceptance لم يستعملا في runtime mutation.

| DB | Migrations | Customers | Address items | Credit | Loyalty | Invoices | Payments | Journals | Lines | Cash | Assets | Orphan journal lines |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `darfus_erp` | 80 | 2 | 1 | 4 | 11 | 15 | 30 | 81 | 209 | 58 | 62 | 0 |
| `darfus_erp_inventory_rehearsal_20260804_160500z` | 80 | 3 | 0 | 3 | 103 | 133 | 122 | 497 | 1423 | 173 | 475 | 0 |

`PERSISTENT_FINGERPRINT_DELTA = 0`; `ACCEPTANCE_FINGERPRINT_DELTA = 0`; `DB_INTEGRITY_NON_REGRESSION = PASS`.

## 18. Environment, Git, process safety

لا migration ولا package change ولا `.env` change ولا commit/push/deploy ولا normal server restart ولا Next dev. `next-env.d.ts` بقي على inherited SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` بلا تعديل. Git final: main، HEAD `1657b0e9ba580faef69be48f04637835c201b521`، staged 0، tracked inherited 81، untracked inherited/current 208، stashes 11.

## 19. Owner review checklist

راجع: ظهور nationality فقط كحقل مثبت، عدم وجود DOB غير معتمد، Create بلا address وبأي address جزئي، رفض address الفارغ، A→B→A في POS، message 409، وعدم وجود status/financial editable fields. لا مراجعة مالية أو migration مطلوبة.

## 20. Gate and next step

`CUSTOMER_MASTER_PHASE_02_CORRECTION_NATIONALITY_DOB_OPTIONAL_ADDRESS_PRIMARY_POS_SYNC_01_GATE = PASS_OWNER_REVIEW_READY`.

الخطوة التالية فقط بعد موافقة Owner: `CUSTOMER-MASTER-PHASE-03-POS-CUSTOMER-SUMMARY-CARD`.

## Final tokens

```text
CURRENT_BATCH = CUSTOMER-MASTER-PHASE-02-CORRECTION-NATIONALITY-DOB-OPTIONAL-ADDRESS-PRIMARY-POS-SYNC-01
MODE = SURGICAL_CUSTOMER_UI_CORRECTION
OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE
UNRELATED_MODULE_CHANGE = NO
CUSTOMER_NATIONALITY_FIELD_AUTHORITY = PROVEN
CUSTOMER_DOB_FIELD_AUTHORITY = NOT_SUPPORTED
CUSTOMER_NATIONALITY_EDIT = PASS
CUSTOMER_DOB_EDIT = NOT_SUPPORTED_WITH_REASON
CUSTOMER_ADDRESS_ALL_FIELDS_OPTIONAL = PASS
CUSTOMER_ADDRESS_ALL_BLANK_REJECTED = PASS
CUSTOMER_ADDRESS_PARTIAL_CREATE = PASS
CUSTOMER_ADDRESS_PARTIAL_EDIT = PASS
CUSTOMER_ADDRESS_PRIMARY_SERVER_AUTHORITY = PASS
POS_SELECTED_CUSTOMER_ADDRESS_PRIMARY_CORRECT = PASS
POS_PRIMARY_ADDRESS_A_TO_B = PASS
POS_PRIMARY_ADDRESS_B_TO_A = PASS
POS_CUSTOMER_ADDRESS_STALE_STATE_CAUSE = NOT_PRESENT
PHASE_01_CONTRACT_REUSED = YES
PHASE_01_BACKEND_BUSINESS_RULE_CHANGED = NO
CUSTOMER_FINANCIAL_FIELDS_EDITABLE = NO
STATUS_LIFECYCLE_AUTHORITY_PRESERVED = YES
NEW_API_ENDPOINTS_THIS_BATCH = 0
UI_SERVER_OWNED_FIELDS_SENT = NO
MUTATING_RUNTIME_TARGET = DISPOSABLE_CLONE_ONLY
TEST_DATA_PII = SYNTHETIC_ONLY
CUSTOMER_CORRECTION_BROWSER_RUNTIME = PASS
CUSTOMER_CORRECTION_NETWORK_EVIDENCE = COMPLETE
CUSTOMER_CORRECTION_VISUAL_EVIDENCE = COMPLETE
CUSTOMER_CORRECTION_FINANCIAL_SIDE_EFFECT = NONE
ACCOUNTING_SIDE_EFFECT = NONE
POS_NON_REGRESSION = PASS
INVOICE_NON_REGRESSION = PASS
FOCUSED_CUSTOMER_CORRECTION_TESTS = PASS
PHASE_01_CUSTOMER_CONTRACT_TESTS = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
CROSS_MODULE_NON_REGRESSION = PASS
CUSTOMER_PAGE_HORIZONTAL_OVERFLOW = NO
CUSTOMER_DETAILS_HORIZONTAL_OVERFLOW = NO
PACKAGE_JSON_CHANGED = NO
PACKAGE_LOCK_CHANGED = NO
MIGRATIONS_CREATED = 0
PERSISTENT_FINGERPRINT_DELTA = 0
ACCEPTANCE_FINGERPRINT_DELTA = 0
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
OWNER_PHASE_2_CORRECTION_REVIEW_CHECKLIST = COMPLETE
CUSTOMER_MASTER_PHASE_02_CORRECTION_NATIONALITY_DOB_OPTIONAL_ADDRESS_PRIMARY_POS_SYNC_01_GATE = PASS_OWNER_REVIEW_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = CUSTOMER-MASTER-PHASE-03-POS-CUSTOMER-SUMMARY-CARD_IF_OWNER_APPROVES
```
