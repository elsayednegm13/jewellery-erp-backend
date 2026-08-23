# POS-CUSTOMER-SUMMARY-VISUAL-ROW-CARDS-CORRECTION-01

## 1. Executive summary

تم تصحيح عرض ملخص العميل في POS فقط. البطاقة أصبحت ستة صفوف مستقلة compact بالترتيب: الاسم، العنوان، الهاتف، التصنيف، النقاط، إجمالي المشتريات. الحالة والرصيد المتاح اختفيا بصرياً فقط. الـAPI والـread-model والـCustomer authorities لم تتغير.

المتصفح المصادق الموجود التقط الشكل على 1440×900 و1280×800 و768×800. لا يوجد horizontal overflow. الاختبارات الثابتة TypeScript وfocused lint نجحت. لا توجد كتابة Persistent أو Acceptance.

## 2. Owner visual decision

تم تطبيق القرار الحرفي: ستة حقول فقط، كل حقل في مستطيل مستقل، label والقيمة في نفس السطر قدر الإمكان، والعنوان فقط يسمح بالالتفاف.

## 3. Previous vs target layout

السابق كان container واحداً به grid وحقول إضافية. الهدف الحالي صفوف منفصلة بعرض عمود العميل، gaps صغيرة، وبدون nested cards أو status/credit.

## 4. Visible fields

1. الاسم
2. العنوان
3. الهاتف
4. التصنيف
5. النقاط
6. إجمالي المشتريات

## 5. Hidden fields

الحالة و`الرصيد المتاح` غير ظاهرين في Customer Summary. لم يتم حذف `status` أو `availableCredit` من DTO أو credit service.

## 6. Data authorities preserved

الاسم والهاتف والتصنيف من Customer، النقاط من `Customer.loyaltyPoints`، وإجمالي المشتريات من `Customer.purchases`. لم يتغير أي source authority.

## 7. Primary Address preserved

العنوان يستخدم `formatCustomerAddress(customerSummary.primaryAddress)` القادم من canonical resolver. لا يوجد `addresses[0]` business authority. عند الغياب يظهر «العنوان غير مسجل».

## 8. File allowlist

| الملف | السبب | نوع التغيير | Business logic؟ |
|---|---|---|---|
| `app/[locale]/(dashboard)/pos/page.tsx` | six row cards وإخفاء حقول العرض | UI فقط | لا |
| `backend/tests/customer-master-phase-03-pos-customer-summary.test.cjs` | تحديث اختبار العرض وإضافة count للصفوف | focused test | لا |
| `backend/tests/pos-redesign-phase-02-universal-search-customer.test.cjs` | تحديث توقعات العرض | focused test | لا |
| هذا التقرير | evidence | report | لا |

لم يتم لمس `customer-pos-summary.service.js` أو `erp.routes.js` أو customer-address service أو أي module مالي.

## 9. UI implementation

كل row يستخدم `flex min-h-9 w-full min-w-0 ... rounded-lg border`، مع label ثابت نسبياً وقيمة `min-w-0 break-words`. صف العنوان يستخدم `items-start` و`leading-4` للسماح بالالتفاف داخله فقط.

## 10. Null/zero states

العنوان المفقود: «العنوان غير مسجل». الهاتف المفقود: «غير مسجل». الاسم والتصنيف لهما fallback صادق. النقاط تعرض `0`، وإجمالي المشتريات يعرض zero money formatted. لا `undefined` أو `null` أو `NaN`.

## 11. Long address behavior

`min-w-0` و`break-words` داخل row العنوان يمنعان كسر عرض الصفحة، ولا يوجد `line-clamp` يخفي النص الأساسي.

## 12. Screenshots

تم الالتقاط من Chrome المصادق على نفس صفحة POS الحالية:

- 1440×900: six rows ظاهرة في عمود العميل.
- 1280×800: نفس الترتيب compact بدون overflow.
- 768×800: العمود يتكدس بأمان، والصفوف مستقلة.

DOM snapshot الفعلي أكد عدم وجود «الحالة» أو «الرصيد المتاح»، ووجود الحقول الستة بالترتيب المطلوب.

## 13. Overflow proof

| viewport | document/body width | overflow |
|---|---:|---|
| 1440×900 | 1440 / 1440 | لا |
| 1280×800 | 1280 / 1280 | لا |
| 768×800 | 768 / 760 | لا |

## 14. Phase-3 functional regression

اختبارات Phase 3 للـsummary endpoint، primary resolver، latest-request guard، permissions، وread-only card بقيت PASS. لا تغيير في request timing أو AbortController أو generation guard.

## 15. Universal Search regression

Focused universal search test نجح. لا تغيير في barcode/product/name/browse أو selection semantics.

## 16. Payment/Checkout regression

Payment panel وcheckout contracts لم تتغير. لم يتم submit لأي بيع أو دفع.

## 17. TypeScript/lint

`npx tsc --noEmit` = PASS. Focused ESLint = exit 0، مع 3 warnings موروثة فقط في POS (`common`, `currentSellingPriceForAsset`, `completeSale`) ولا errors.

## 18. File diff table

التغيير الفعلي في `pos/page.tsx` محصور في JSX الخاص ببطاقة Customer Summary. اختبارات العرض فقط عدلت توقعاتها من status/credit إلى الستة حقول، وأضيف اختبار يتحقق من وجود ستة row cards.

## 19. Persistent/Acceptance safety

لا توجد أي mutation DB. المتصفح استخدم runtime محلياً للقراءة فقط؛ لم يتم إنشاء بيانات ولا Clone ولا API write.

## 20. Migration/package/env/git safety

لا migration أو package change أو env change أو restart أو deploy. `next-env.d.ts` لم يتغير. branch `main`، HEAD `1657b0e9ba580faef69be48f04637835c201b521`، staged=0. لم تُستخدم أوامر Git destructive.

## 21. Owner review checklist

راجع بصرياً: ستة مستطيلات بالترتيب، الحالة والرصيد غير ظاهرين، العنوان Primary الحالي، العنوان الطويل، zero states، وعدم تغير Search/Checkout/Pricing/Payment/API.

## 22. Gate

الـstatic والـbrowser evidence وregression كلها PASS. لا يوجد blocker تقني في الكود. الاعتماد النهائي يظل **Owner visual approval** حسب نطاق المهمة.

`POS_CUSTOMER_SUMMARY_VISUAL_ROW_CARDS_CORRECTION_01_GATE = PASS_OWNER_REVIEW_READY`

## 23. Next step

بعد موافقة المالك البصرية فقط:

`CUSTOMER-INVOICE-SNAPSHOT-MIGRATION-AUTHORIZATION-01`

لا يبدأ تلقائياً.

## Final tokens

```text
CURRENT_BATCH = POS-CUSTOMER-SUMMARY-VISUAL-ROW-CARDS-CORRECTION-01
MODE = SURGICAL_POS_CUSTOMER_VISUAL_CORRECTION
OWNER_VISIBLE_FIELDS = NAME_ADDRESS_PHONE_TIER_POINTS_TOTAL_PURCHASES_ONLY
POS_CUSTOMER_SUMMARY_ROW_CARDS = PASS
POS_CUSTOMER_NAME_VISIBLE = YES
POS_CUSTOMER_ADDRESS_VISIBLE = YES
POS_CUSTOMER_PHONE_VISIBLE = YES
POS_CUSTOMER_TIER_VISIBLE = YES
POS_CUSTOMER_POINTS_VISIBLE = YES
POS_CUSTOMER_TOTAL_PURCHASES_VISIBLE = YES
POS_CUSTOMER_STATUS_VISIBLE = NO
POS_CUSTOMER_AVAILABLE_CREDIT_VISIBLE = NO
BACKEND_SUMMARY_FIELDS_REMOVED = NO
POS_CUSTOMER_SUMMARY_DATA_AUTHORITIES_CHANGED = NO
POS_PRIMARY_ADDRESS_AUTHORITY = CANONICAL_PRIMARY
POS_PRIMARY_ADDRESS_ARRAY_INDEX_AUTHORITY = NO
VISUAL_CORRECTION_FILE_TOUCH_ALLOWLIST = COMPLETE
POS_CUSTOMER_SUMMARY_BUSINESS_LOGIC_CHANGED = NO
POS_CHECKOUT_CHANGED = NO
POS_PRICING_CHANGED = NO
POS_PAYMENT_CHANGED = NO
POS_CUSTOMER_ROW_LABEL_VALUE_STYLE = PASS
POS_CUSTOMER_NO_SELECTION_STATE = PASS
POS_CUSTOMER_ROW_NULL_ZERO_STATES = PASS
POS_CUSTOMER_LONG_ADDRESS_ROW = PASS
POS_CUSTOMER_ROW_CARDS_VISUAL_EVIDENCE = COMPLETE
POS_PAGE_HORIZONTAL_OVERFLOW = NO
POS_CUSTOMER_COLUMN_HORIZONTAL_OVERFLOW = NO
POS_CUSTOMER_ADDRESS_ROW_OVERFLOW = NO
PHASE_3_FUNCTIONAL_REGRESSION = PASS
POS_UNIVERSAL_SEARCH_NON_REGRESSION = PASS
POS_PAYMENT_PANEL_NON_REGRESSION = PASS
POS_CHECKOUT_CONTRACT_NON_REGRESSION = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
ACCOUNTING_SIDE_EFFECT = NONE
MIGRATIONS_CREATED = 0
MIGRATION_81_CREATED = NO
PACKAGE_JSON_CHANGED = NO
PACKAGE_LOCK_CHANGED = NO
RUNTIME_ENV_CHANGED = NO
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
NEXT_DEV_STARTED_OR_RESTARTED = NO
OWNER_POS_CUSTOMER_VISUAL_REVIEW_CHECKLIST = COMPLETE
POS_CUSTOMER_SUMMARY_VISUAL_ROW_CARDS_CORRECTION_01_GATE = PASS_OWNER_REVIEW_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = CUSTOMER-INVOICE-SNAPSHOT-MIGRATION-AUTHORIZATION-01_IF_OWNER_APPROVES
```
