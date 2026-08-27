# POS-REDESIGN-IMPLEMENTATION-PHASE-02-UNIVERSAL-SEARCH-AND-CUSTOMER-01

## 1. Executive summary

تم تنفيذ Phase 2 على شاشة POS الحالية نفسها. أضيف مسار قراءة واحد ومحدود `GET /pos/search`، مع بحث موحد بالباركود، Product.productCode، المعرف الآمن، والاسم، وBrowse محدود على فرع المستخدم. أضيفت بطاقة العميل المختار لعرض الاسم والهاتف والعنوان وTier/Points/Balance للقراءة فقط. لم يتم تنفيذ Checkout أو إنشاء فاتورة أو تغيير تسعير/ضريبة/دفع.

## 2. Owner requirements

- بقي التخطيط: Customer يسار، Search أعلى الوسط، Invoice Items وسط، Payment/Totals يمين.
- بقيت شاشة واحدة ومسار بيع واحد.
- لا منطق بيع جديد ولا صلاحية عميل جديدة.

## 3. Search identifiers

| الأولوية | المعرّف | السلوك |
|---|---|---|
| 1 | `Asset.barcode` | تطابق دقيق، والنتيجة المتاحة قابلة للاختيار. |
| 2 | `Product.productCode` | تطابق دقيق، وProduct يفتح اختيار الكمية. |
| 3 | `Asset.id` / `Product.id` | تطابق دقيق ثانوي داخل نطاق الشركة/الفرع. |
| 4 | الاسم/الوصف | بحث جزئي خادمي محدود. |

## 4. Existing search limitations

كان POS يعتمد على مجموعات Products/Assets محمّلة بالكامل في API mode. هذا لم يكن مناسباً للـbrowse ولا يضمن سعراً ديناميكياً لكل Gold Asset. بقيت القوائم المحلية فقط للتوافق مع mock mode.

## 5. Backend strategy

تم اختيار `MINIMUM_SAFE_EXTENSION`: Route واحد read-only، auth + permission، branch resolver، حد أقصى 50، وفرز ثابت. لا توجد أربع نقاط بحث ولا preload كامل للمخزون.

## 6. Search endpoint/API changes

أضيف في `backend/src/routes/erp.routes.js`:

`GET /pos/search?query=&type=&limit=20&includeUnavailableExact=true`

الاستجابة Projection آمن يحوي `id`, `code`, `name`, `type/profile`, `karat`, `grossWeight`, `price`, `available`, `unavailable`, `availabilityReason`, وbranchId. لا يتم إسقاط `cost`, `unitCost`, acquisition أو purchase cost.

## 7. Exact barcode path

المتصفح اختبر `GODGOF21000001`. النتيجة الوحيدة ظهرت بسعر حالي خادمي `4,497.24`، ثم Enter أضاف الأصل إلى Invoice Items، مسح البحث وأعاد التركيز، بدون Checkout.

## 8. Product code path

المتصفح اختبر `GOLD-PES`. ظهرت نتيجة Product واحدة مع كمية 99، واختيارها فتح Quantity modal بدلاً من اختراع كمية أو بيع مباشر.

## 9. ID path

Asset/Product IDs تقبل exact lookup فقط داخل `companyId` و`branchId` المصرّحين. البحث الجزئي لا يستخدم Asset internal id؛ البحث الجزئي للعرض مخصص للباركود/الاسم/الوصف/profile.

## 10. Name search

`خواتم 1` أعاد 11 نتيجة من الخادم، مع debounce 250ms وlimit 20. المطابقة لا تعتمد على client-side full catalog.

## 11. Browse dropdown

فتح البحث بلا كتابة أعاد 20 نتيجة فقط، مرتبة بالاسم ثم id، متاحة في الفرع الحالي. لا يتم تحميل كل المخزون في API mode.

## 12. Result-row design

الصف المضغوط يعرض الاسم، code/barcode، profile/type عند توفره، الوزن/العيار، availability والسعر الحالي. الأرقام مع `numeric-token`/LTR isolation. لا يظهر acquisition cost.

## 13. Pricing authority

Products تستخدم `salePrice` الحالي من مصدر Product. Gold sale profiles تعيد حساب السعر في مسار البحث باستخدام `goldSalePricingService.resolveCanonicalSellingGoldRate` مع request cache ثم `calculateGoldSalePriceForAsset`. السعر المحفوظ القديم ليس authority للـGold display. لا توجد مكالمات GoldAPI لكل صف.

## 14. Unavailable/sold behavior

الـbrowse يستبعد غير المتاح. Exact unavailable يعاد disabled مع سبب مثل `ASSET_SOLD` أو `PRODUCT_UNAVAILABLE`. صفر السعر أو سعر غير صالح يظهر disabled ولا يمكن إضافته.

## 15. Async/race safety

كل طلب يستخدم AbortController، generation token، latest-request-wins، وcleanup للـtimer. الخطأ/النجاح القديم لا يكتب فوق الحالة الجديدة.

## 16. Keyboard flow

ArrowUp/ArrowDown يتحركان في النتائج، Enter يختار highlighted، Escape يغلق ويمسح، وF2 الموجود في شاشة POS يظل focus affordance. بعد الإضافة: query فارغ، dropdown مغلق، focus عاد إلى نفس input.

## 17. Add-to-invoice behavior

Asset صالح يضاف بسطر واحد وquantity=1 بعد فحص السعر/التوافر المحلي، بينما checkout الحالي يظل authority النهائي. Product يمر عبر Quantity modal. لا يوجد duplicate Asset line جديد ولا sale submission.

## 18. Asset vs Product quantity

Asset serialized يحافظ على quantity=1. Product يظل quantity-based وفق stock المتاح. لم يتغير قانون المخزون أو checkout.

## 19. Customer data forensic

`usePos` يقرأ `GET /customers` الحالي. Generic customer response يحمل name/phone/addresses/tier/loyaltyPoints/balance، ولا احتجنا API أو schema change.

## 20. Customer phone source

المصدر canonical هو `Customer.phone` من `/customers`، read-only، مع LTR/numeric-token.

## 21. Customer address source

المصدر canonical هو أول `Customer.addresses[]` غير فارغ، ويُجمع من `line1`, `line2`, `city`, `country`, `postalCode` وفق البنية الموجودة، دون تخمين حقل جديد.

## 22. Customer points/balance handling

Tier و`loyaltyPoints` و`balance` معروضة للقراءة فقط. لا تم تغيير accrual/redemption أو receivable authority.

## 23. Customer panel visual result

البطاقة اليسرى تعرض الاسم، الهاتف، العنوان (سطرين كحد أقصى مع title)، Tier، Points، Balance داخل نفس panel المضغوط.

## 24. Security/company/branch

المسار يستخدم `authMiddleware`, `requireAnyBusinessPermission(["pos.view", "pos.sell"])`, و`resolveAuthorizedBranchId`. كل Product/Asset query مقيدة بالشركة والفرع. لا يوجد Company fallback أو client authority.

## 25. Gold-call economy

تم استخدام cache على مستوى الطلب لمعدلات Gold Center. لا استدعاء GoldAPI per result، ولا gold prefetch في `useCoreErpData` عندما يعمل POS في API mode.

## 26. Browser runtime flow

تمت إعادة تحميل `http://localhost:3000/ar/pos` الموجود مسبقاً، واختبار customer selection، blank browse، partial name، exact Product code، exact barcode، Enter، keyboard arrows، وfocus return. لم يتم تشغيل Next dev أو restart.

## 27. Search network table

| الطلب | المصدر | النتيجة المشاهدة |
|---|---|---|
| `GET /pos/search?query=GODGOF21000001...` | effect debounce | نتيجة واحدة متاحة، ثم line بعد Enter. |
| `GET /pos/search?query=GOLD-PES...` | نفس input | Product واحدة وQuantity modal. |
| `GET /pos/search?query=خواتم%201...` | نفس input | 11 نتيجة محدودة. |
| `GET /pos/search?query=&limit=20...` | focus/blank browse | 20 نتيجة فقط. |

Tooling أتاح إثبات URL والسلوك من الواجهة والـDOM، ولم يعرض response headers الخام؛ لذلك status code موثق كاستجابة ناجحة مستنتجة من DOM وليس كسرّ أو token مكشوف.

## 28. Customer network evidence

`GET /customers` الحالي ظل المصدر الوحيد للعميل. بعد تحميله ظهر العميل المختار بالاسم والهاتف و`العنوان غير مسجل` وTier/Points/Balance. لا request كتابة ولا endpoint جديد.

## 29. Search runtime matrix

| السيناريو | النتيجة |
|---|---|
| barcode متاح | PASS، line واحد، focus رجع |
| barcode غير متاح/سعر صفر | PASS، disabled |
| Product code | PASS، Quantity modal |
| partial name | PASS، 11 نتيجة |
| blank browse | PASS، 20 نتيجة |
| stale request | PASS static contract + Abort/generation |

## 30. Customer display runtime matrix

| الحقل | النتيجة |
|---|---|
| الاسم | PASS |
| الهاتف | PASS (`0000000000` في fixture الحالي) |
| العنوان | PASS، fallback صادق عند غيابه |
| Tier | PASS |
| Points | PASS |
| Balance | PASS |

## 31. Visual evidence paths

- `backend/reports/pos-redesign-phase-02-final-server-price-1440x900.png`
- `backend/reports/pos-redesign-phase-02-name-search-1440x900.png`
- `backend/reports/pos-redesign-phase-02-bounded-browse-1440x900.png`
- `backend/reports/pos-redesign-phase-02-customer-1280x800.png`
- `backend/reports/pos-redesign-phase-02-responsive-768x800.png`

## 32. Browser console

`tab.dev.logs({levels:["error","warn"]})` أعاد قائمة فارغة بعد الاختبارات.

## 33. Type/lint/tests

- `npx tsc --noEmit`: PASS.
- Focused ESLint على POS وDataToolbar: 0 errors، 3 warnings legacy hook dependency (لا تخص route الجديد).
- `node --check backend/src/routes/erp.routes.js`: PASS.
- focused combined suite: 11/11 PASS.

## 34. API change table

| الملف | التغيير | كتابة DB |
|---|---|---|
| `backend/src/routes/erp.routes.js` | Route `/pos/search` bounded projection + dynamic read pricing | لا |
| `app/[locale]/(dashboard)/pos/page.tsx` | search state/effect/UI/customer card | لا |
| `components/ui/data-toolbar.tsx` | ref/focus/key handlers وcombobox semantics | لا |

## 35. Customer field map

| UI | المصدر |
|---|---|
| name | `Customer.name` |
| phone | `Customer.phone` |
| address | `Customer.addresses[0]` structured fields |
| tier | `Customer.tier` |
| points | `Customer.loyaltyPoints` |
| balance | `Customer.balance` |

## 36. Search field map

| DTO | Product | Asset |
|---|---|---|
| code | productCode | barcode أو id |
| name | productName | name |
| type/profile | stockType | type/inventoryProfile |
| availability | quantityAvailable > 0 | operationalStatus AVAILABLE |
| price | salePrice | canonical gold sale resolver أو price لغير Gold |

## 37. Business-rule non-regression table

| القاعدة | النتيجة |
|---|---|
| checkout authority | لم تتغير |
| VAT/payment/accounting | لم تتغير |
| Company/Branch scope | محفوظة |
| one physical Asset line | محفوظ |
| Product quantity | محفوظ |
| zero-price fail-closed | محفوظ |
| Gold Center authority | قراءة/cache فقط |

## 38. Persistent safety

`darfus_erp` ظل read-only. لا SQL mutation، لا fixture، لا Checkout. `PERSISTENT_WRITES_THIS_BATCH=0`.

## 39. DB integrity

آخر baseline read-only الموروث: persistent migrations=80, Assets=62, Products=3، Cash GL=`5008829.8130`، Bank GL=`199085.3241`، open cash session=1، unbalanced journals=0، orphan journal lines=0، unlinked treasury=0، duplicate/blank primary barcodes=0. Acceptance read-only: migrations=80 وAssets=475 وProducts=3. لم تتغير هذه القيم في Phase 2.

## 40. migration/env/git safety

لا Migration، لا env change، لا Next dev. `next-env.d.ts` ظل على inherited known drift SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` ولم يتم إصلاحه أو تغييره في هذه الجولة.

## 41. Owner review checklist

تم تغطية: سرعة barcode، Product Code، name، bounded dropdown، إضافة line، focus return، customer name/phone/address، compact panel، وعدم Checkout. القرار المتبقي للمالك: هل Invoice Items الحالي كافٍ أم تبدأ Phase 3.

## 42. Gate

`POS_REDESIGN_IMPLEMENTATION_PHASE_02_UNIVERSAL_SEARCH_AND_CUSTOMER_01_GATE = PASS_OWNER_REVIEW_READY`

## 43. Next step

لا يبدأ أي Batch تلقائياً. الخطوة الموصى بها فقط بعد موافقة المالك:

`POS-REDESIGN-IMPLEMENTATION-PHASE-03-INVOICE-ITEMS-TABLE-AND-LINE-DETAILS_IF_OWNER_APPROVES_PHASE_2`

## Execution record

Branch `main`; HEAD `1657b0e9ba580faef69be48f04637835c201b521`; staged files at start/end `0`; inherited dirty worktree preserved. Files changed by this batch فقط: `app/[locale]/(dashboard)/pos/page.tsx`, `components/ui/data-toolbar.tsx`, `backend/src/routes/erp.routes.js`, this report, focused test، وصور الدليل. لم يتم تحديث `PROJECT_PROGRESS_HANDOFF.md`.
