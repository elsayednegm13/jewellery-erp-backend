# POS-REDESIGN-UNIVERSAL-PRODUCT-SEARCH-UX-REVISION-01

## 1. Owner revised requirement

اعتمد المالك تعديل نموذج التفاعل قبل Phase 1: منطقة الوسط ليست Cart/Basket، بل `Universal Product / Asset Search` يضيف النتائج الصحيحة إلى `Invoice Items Table`. المسارات المطلوبة تخطيطيًا هي ID وBarcode وName وdropdown browse. لا manual/free-price authority جديدة، ولا تغيير في التسعير أو الدفع أو المحاسبة أو المخزون.

### POS_CART_TERMINOLOGY_REMOVED_FROM_TARGET_UX = YES

المصطلحات المرئية: `أصناف الفاتورة`، `عناصر الفاتورة`، `بنود الفاتورة`، `القطع المختارة`. يمكن إبقاء متغير `cart` داخليًا مؤقتًا لتقليل refactor risk، لكن لا يظهر في UI أو أسماء المكونات المستهدفة.

## 2. Current search authority forensic

### Current path

`DataToolbar input` → `query state` → `filterData(posItems, query, selectors)` → بطاقات products/assets الموجودة محليًا → add handler → state → `/pricing/calculate` → `/pos/checkout`.

`posItems` في `app/[locale]/(dashboard)/pos/page.tsx` مبني من `useCoreErpData()`:

- `GET /assets` و`GET /products` عبر `hooks/use-core-erp-data.ts`.
- `GET /gold/karat-prices?currency=AED` للعرض الديناميكي.
- `filterData` يطابق `name`, `id`, `code`, `type` محليًا مع normalization عربية/إنجليزية.

`ErpController.list` يملك `page/pageSize/search/sort/filters`؛ الافتراضي `page=1`, `pageSize=25`, و`search` هو `ILIKE` على configured search fields. POS يستعمل `normalizeItems` فقط، فيسقط `total/totalPages` ولا ينفذ pagination.

### API gap table

| Capability | Current support | Evidence/current behavior | Safe plan |
|---|---|---|---|
| exact barcode | جزئي | `/assets?search=` و`/inventory-v2/assets?search=` partial ILIKE؛ POS local first-page match | unified exact shortcut server-side |
| Asset ID | جزئي | V2 search يشمل `a.id`، generic `/assets` لا؛ POS local `item.id` | unified ID predicate |
| Product ID | جزئي | generic product search fields لا تشمل id؛ POS local first-page id | unified product ID predicate |
| name partial | جزئي | backend ILIKE موجود، لكن POS لا يرسل search ويبحث أول صفحة محليًا | debounced server query |
| SKU/code | جزئي | Product `productCode`, Asset barcode؛ لا contract موحد | unified `businessCode` |
| dropdown browse | جزئي | أول صفحة فقط، بلا page/total في POS | bounded page + load-more |
| branch availability | نعم | company/branch read scope، ثم client available filter، ثم checkout validation | preserve server scope |
| unavailable exact result | جزئي | POS يستبعد assets غير المتاحة بلا reason | disabled exact result optional |
| current price | جزئي | persisted price أو local Gold quote؛ `/pricing/calculate` خادمي | metadata + batch quote/preview |
| profile | جزئي | UI `type`؛ V2 يدعم `profile` filter | expose canonical profile |
| karat/weight | نعم للحقول | models/results تحملها، لكن لا result contract موحد | normalized result fields |

### POS_UNIFIED_SEARCH_FORENSIC = COMPLETE

المشكلة الحالية implementation gap للـUX فقط: search ممكن على أول صفحة من الذاكرة، وليس unified paginated server search. لا يوجد business-rule defect مثبت.

## 3. ID semantics

### POS_SEARCH_ID_SEMANTICS = COMPLETE

- `Asset.id`: primary technical/business key للأصل، قد يكون طويلًا.
- `Product.id`: primary product key.
- `Asset.barcode`: operational identity للقطعة المادية ولا يتغير.
- `Product.productCode`: SKU/business code الأنسب للمنتج ذي الكمية.
- `inventoryCode`/legacy codes ليست authority موحدة مثبتة في POS.

توصية label: `ID / كود الصنف`. الأولوية للـbarcode ثم Asset ID أو Product code حسب النوع؛ لا نعرض UUID الطويل كأنه رقم فاتورة.

## 4. Barcode and name plans

### POS_BARCODE_SEARCH_PLAN = COMPLETE

F2 يركز الحقل، Enter مع exact barcode يضيف مباشرة عند نتيجة واحدة، ويعود focus بعد النجاح. duplicate Asset وsold وwrong branch وzero/unavailable price لا تُضاف للسطر. الخادم يظل authority، والـbarcode immutable.

### POS_NAME_SEARCH_PLAN = COMPLETE

يبدأ البحث العام بعد حرفين، debounce 250–300ms، AbortController وlatest-request-wins، normalization عربية/إنجليزية، cap 20–50، pagination/load-more، وbranch/company/availability server-side. لا full inventory preload.

## 5. Dropdown and unified control

### POS_DROPDOWN_BROWSE_PLAN = COMPLETE

فتح بلا query يعرض صفحة bounded من المنتجات/الأصول المتاحة في الفرع، مع limit وnext/total، وفرز deterministic. لا giant dropdown، وتكون unavailable exact results منفصلة عن browse الافتراضي.

### POS_UNIFIED_SEARCH_CONTROL = APPROVED_PLAN

Placeholder: `ابحث بالـ ID أو الباركود أو اسم المنتج...`. exact barcode/ID مع Enter يذهب لمسار مباشر، النص يفتح dropdown، والأسهم تتحرك بين النتائج، وEscape يغلق ثم يمسح query قبل أي cancel أعلى.

### POS_SEARCH_INTENT_STRATEGY = COMPLETE

التوصية Hybrid: shortcut خفيف للـexact barcode في الواجهة، لكن كل resolve وeligibility وscope في endpoint خادمي موحد. الاسم والـambiguous query server search؛ لا أربعة endpoints مكررة.

## 6. Result, unavailable, pricing, add behavior

### POS_SEARCH_RESULT_BLUEPRINT = COMPLETE

يعرض result: الاسم، barcode، business code/ID، profile، karat، weight، availability، وcurrent quote إن كان آمنًا. لا acquisition cost ولا client total.

### POS_UNAVAILABLE_RESULT_POLICY = COMPLETE

broad search/dropdown available-only. exact barcode/ID قد يظهر disabled مع `تم البيع`، `غير متاح في هذا الفرع`، `السعر غير متاح`، أو `غير صالح للبيع`. لا add ولا quantity fallback.

### POS_SEARCH_RESULT_PRICING_PLAN = COMPLETE

لا نستخدم `Asset.price` كـuniversal authority. Gold Bar/Gold By Weight/CGP تحتاج Gold Center + profile calculator، Gold By Piece تحتاج current valuation + policy، والمنتج غير الذهبي يستخدم authority الموجودة مع server final validation. quote pending يعرض `جاري تحميل السعر...`، ولا نعرض zero كسعر صالح.

### POS_ADD_TO_INVOICE_PLAN = COMPLETE

الاختيار يتحقق من eligibility والquote؛ ثم يضيف line قانونية واحدة. Asset duplicate ممنوع، Product quantity يحافظ على law الحالي، focus يعود للبحث، و`/pricing/calculate` ثم `/pos/checkout` يعيدان التسعير الخادمي.

## 7. Invoice items table

### POS_INVOICE_ITEMS_COMPONENT_PLAN = COMPLETE

الاسم المستهدف `InvoiceItemsTable` أو `PosInvoiceLines`، وليس CartTable في UI. يمكن إبقاء state variable `cart` مؤقتًا داخليًا.

### POS_INVOICE_ITEMS_COLUMNS = COMPLETE

Visible: `#`, الاسم، Barcode/code، Profile/type، Qty، Price، Line total، Remove. Conditional row details: ID/business code، Karat، Weight، Making/Certificate، VAT. الأصول serialized quantity=1؛ المنتجات فقط قد تزيد الكمية.

### MULTI_ITEM_INVOICE_PRESERVED = YES

الفاتورة تظل متعددة البنود كما يسمح `body.items` و`validatedItems`.

### POS_ASSET_VS_PRODUCT_QUANTITY_PLAN = COMPLETE

Unique Asset = قطعة واحدة وbarcode واحد وqty=1. Product = stock item وqty>1 وفق `quantityAvailable` وقانون الخادم. لا quantity editor للأصل.

## 8. Scope, Gold economy, async and states

### POS_SEARCH_SCOPE_SECURITY = COMPLETE

النتيجة القابلة للاختيار تحمل company/branch context من `apiClient` وcontexts. generic routes تطبق read scope، وcheckout يعيد branch/company/status validation. لا company fallback ولا branch guessed ولا cross-branch selectable result.

### POS_SEARCH_GOLD_PROVIDER_ECONOMY_PLAN = COMPLETE

نحافظ على `GOLDAPI_IO`, `LIVE_PROVIDER`, `AED`, `refresh1500`, `stale2500` حيث يثبت runtime. لا external GoldAPI call لكل dropdown row؛ Gold Center/cache أو batch quote ثم `/pricing/calculate`.

### POS_SEARCH_ASYNC_RACE_PLAN = COMPLETE

debounce، AbortController، generation/latest-request-wins، reset highlight عند query change، bounded cache keyed by company/branch/query/page، وعدم السماح لرد قديم بكتابة نتائج query جديد.

### POS_SEARCH_STATE_UX = COMPLETE

الحالات: `جاري البحث...`، `جاري تحميل السعر...`، `لا توجد نتائج`، `المنتج غير متاح`، `تم البيع`، `السعر غير متاح`. pending ليس failure، وerror لا يمسح invoice lines.

## 9. Keyboard and revised wireframes

### POS_UNIFIED_SEARCH_KEYBOARD_PLAN = COMPLETE

F2 بحث موحد، barcode+Enter add، ID+Enter exact resolve، name dropdown، Arrow Up/Down highlight، Enter select، Escape close ثم clear، وبعد الإضافة يعود focus للبحث. F4/F6/F8/F12 تبقى من الخطة السابقة بعد فحص browser conflicts.

### POS_CENTER_BLUEPRINT_REVISED = COMPLETE

```text
┌──────────────────────────────────────────────────────┐
│ البحث عن منتج / أصل                                 │
│ [ ID / Barcode / Name                         ▼ ]   │
│ Name | Barcode | ID | Profile | Karat | Weight      │
├──────────────────────────────────────────────────────┤
│ أصناف الفاتورة                                      │
│ # | اسم | Barcode | ID | عيار | وزن | سعر | إجمالي │
│ عدد القطع                         إجمالي الوزن      │
└──────────────────────────────────────────────────────┘
```

### POS_TEXT_WIREFRAME_REVISED = COMPLETE

```text
┌──────────────────────────────────────────────────────────────────────┐
│ DARFUS POS | فاتورة بيع جديدة | MAIN | الكاشير | التاريخ/الوقت       │
├─────────────────┬────────────────────────────────┬───────────────────┤
│ بيانات العميل   │ البحث عن المنتج / الأصل        │ تفاصيل الدفع      │
│ الاسم/الهاتف    │ [ ID / Barcode / Name       ▼ ]│ قبل الضريبة/VAT   │
│ Tier/Points      │ نتائج البحث                    │ الإجمالي          │
│ الرصيد           │ أصناف الفاتورة                 │ Cash/Card/Split    │
│ بحث/تغيير        │ Name | Barcode | ID | Profile  │ المدفوع/المتبقي   │
│                 │ Karat | Weight | Price | Total │ [ إتمام البيع ]   │
├─────────────────┴────────────────────────────────┴───────────────────┤
│ F2 بحث المنتج | F4 العميل | F6 الدفع | F12 الإتمام | Esc            │
└──────────────────────────────────────────────────────────────────────┘
```

## 10. Customer and payment directions

### POS_CUSTOMER_COLUMN_DIRECTION = PRESERVED

customer search، selected customer، name، mobile، Tier، balance إن رجع، وpoints read-only إن رجعت؛ فقط ينتقل العمود يسارًا.

### POS_PAYMENT_COLUMN_DIRECTION = PRESERVED

subtotal، VAT، total، paid، remaining/change، Cash/Card/Transfer/Split/Installment/Deposit، Complete Sale وCancel تبقى كما هي، مع sticky desktop إن كان آمنًا.

## 11. Business logic freeze

### POS_BUSINESS_LOGIC_FROZEN = YES

لا تغيير في pricing، Gold Center، Making Charge، VAT، posting، payments، Split، accounting، inventory، points accrual، returns، idempotency، permissions، أو company/branch scope.

## 12. API change plan

### POS_SEARCH_API_GAP_TABLE = COMPLETE

| Capability | Current endpoint/support | Gap | New API? |
|---|---|---|---|
| Barcode exact | `/assets?search` وV2 search partial | exact unified shortcut ناقص | extension محتمل |
| Asset ID | V2 search يدعم id، generic POS لا | first-page local فقط | extension |
| Product ID | generic search لا يشمل id | local first-page فقط | extension |
| Name partial | backend ILIKE موجود | POS لا يرسل search ولا pagination | extend safely |
| Dropdown browse | أول صفحة فقط | لا total/page integration | extend safely |
| Branch availability | server scope موجود | result contract موحد ناقص | preserve |
| Unavailable exact | لا reason في POS | disabled exact UX ناقص | response mode |
| Current price | preview endpoint موجود، search result لا | Gold quote async/N+1 risk | batch quote/metadata |
| Profile/Karat/Weight | حقول موجودة | normalization result ناقص | result mapping |

### POS_SEARCH_API_CHANGE_PLAN = COMPLETE

الأقل خطرًا endpoint read-only موحد واحد، أو تمديد آمن لأحد existing search services، يقبل `query`, `page/limit`, `profile`, `availableOnly`, `includeUnavailableExact` ويعيد result metadata. إذا ثبت أن تمديد `/assets` و`/products` يحقق نفس العقد بلا duplication فهو الأفضل؛ وإلا endpoint واحد، لا أربعة endpoints. لا migration.

## 13. Revised component and state map

### POS_COMPONENT_IMPLEMENTATION_MAP_REVISED = COMPLETE

| Component | Responsibility | State/authority | Reuse |
|---|---|---|---|
| `PosShell`, `PosHeader` | layout/context | presentational | page/PageHeader |
| `CustomerPanel` | customer selection | controlled `customerId`/usePos data | current select |
| `UniversalProductSearch` | query/open/focus/keys | UI-only search state | DataToolbar patterns |
| `ProductSearchResults` | rows/status/price pending | result metadata only | new presentational |
| `InvoiceItemsTable`, `InvoiceItemRow` | invoice lines | controlled page lines | current cart JSX |
| `InvoiceItemsSummary` | count/weight | derived props | current aggregates |
| `PaymentPanel`, `SplitPaymentRows` | payment display | controlled current fields | current payment block |
| `SaleActions` | final/cancel/draft | current handlers/isPosting | current buttons |
| `KeyboardHelp`, `PosStatusBanner` | hints/states | presentational | existing errors/toasts |

### POS_STATE_OWNERSHIP_PLAN_REVISED = COMPLETE

Business state يبقى في `PosPage`: customerId، invoice lines، pricing/totals، payment/split/installment، idempotency، drafts/reservation. UI-only state يمكن أن يكون في search component أو page: `searchQuery`, `searchOpen`, `searchResults`, `highlightedResult`, `searchLoading`, `searchError`, `activeSearchRequest/generation`. لا تتكرر authoritative item/pricing/quantity state.

## 14. Revised implementation phases

### POS_IMPLEMENTATION_PHASE_PLAN_REVISED = COMPLETE

1. Phase 1: Shell + three-column layout + terminology only.
2. Phase 2: Universal Product Search (ID/Barcode/Name/Dropdown) + Customer Panel.
3. Phase 3: Invoice Items Table + row details + count/weight.
4. Phase 4: Payment Panel + current Split/Installment presentation.
5. Phase 5: Keyboard/Focus/Async/Error UX.
6. Phase 6: Responsive/Accessibility/Visual Polish.
7. Phase 7: Strict Runtime E2E Closeout.

### PHASE_1_SEARCH_LOGIC_CHANGE = NO

Phase 1 لا ينفذ unified search؛ يحجز منطقة الوسط ويحتفظ بالبحث القديم مؤقتًا.

## 15. Phase 2 future runtime test plan

### POS_SEARCH_FUTURE_RUNTIME_TEST_PLAN = COMPLETE

على Disposable Clone فقط: exact barcode، Asset ID، Product ID إن دعمته contract، Arabic/English/partial name، dropdown بلا query، unavailable/sold/wrong branch، unsupported profile، zero price، dynamic Gold price، duplicate، rapid typing، old response after new query، Enter/arrows/Escape/focus return، multi-item، Asset qty=1، Product qty، no scope leakage، no N+1 GoldAPI calls. Persistent read-only دائمًا.

## 16. File touch map

### POS_FILE_TOUCH_MAP_REVISED = COMPLETE

| Path | Status/current role | Phase | Planned change |
|---|---|---|---|
| `app/[locale]/(dashboard)/pos/page.tsx` | موجود، orchestrator | 1–6 | JSX/layout/callback wiring |
| `features/sales/hooks/use-pos.ts` | موجود، API hooks | 2/4 | unchanged by default؛ typed adapter فقط إذا لزم |
| `hooks/use-core-erp-data.ts` | موجود، first-page resources | 2 | avoid broad prefetch إذا unified hook اختير |
| `hooks/use-data-filters.ts` | موجود، local fallback | 1/2 | لا authority؛ fallback فقط |
| `components/ui/data-toolbar.tsx` | موجود، generic search | 1/2 | reuse style أو leave unchanged |
| `features/sales/components/pos/PosShell.tsx` | غير موجود | 1 | planned new presentational |
| `features/sales/components/pos/PosHeader.tsx` | غير موجود | 1 | planned new presentational |
| `features/sales/components/pos/CustomerPanel.tsx` | غير موجود | 2 | planned controlled component |
| `features/sales/components/pos/UniversalProductSearch.tsx` | غير موجود | 2 | planned search UI |
| `features/sales/components/pos/ProductSearchResults.tsx` | غير موجود | 2 | planned result UI |
| `features/sales/components/pos/InvoiceItemsTable.tsx` | غير موجود | 3 | planned lines table |
| `features/sales/components/pos/InvoiceItemRow.tsx` | غير موجود | 3 | planned row |
| `features/sales/components/pos/PaymentPanel.tsx` | غير موجود | 4 | planned payment UI |
| `features/sales/components/pos/KeyboardHelp.tsx` | غير موجود | 5 | planned footer |
| `backend/src/controllers/erp.controller.js` | generic assets/products list | 2 only if needed | candidate extension |
| `backend/src/routes/erp.routes.js` | existing `/inventory-v2/assets`, `/pricing/calculate`, `/pos/checkout` | 2 only if needed | candidate read-only route/extension |
| `backend/src/services/gold-sale-pricing.service.js` | pricing authority | none | preserve, no UX authority |
| `backend/src/services/gold-center-reference-price.service.js` | Gold cache/provider | none | preserve, avoid N+1 |
| `messages/ar.json`, `messages/en.json` | localization | 1–6 | terminology/copy keys only |

### POS_REDESIGN_MIGRATION_REQUIRED = NO

لم يتم إنشاء أي ملف من الملفات المخططة ولم يتغير أي backend/product source في هذه الجولة.

## 17. Owner cashier flow summary

### OWNER_CASHIER_FLOW_SUMMARY = COMPLETE

يختار الكاشير العميل، يضغط F2، يمسح barcode أو يكتب ID/SKU/اسمًا، يختار نتيجة واضحة، فتظهر في `أصناف الفاتورة`. يكرر ذلك لبنود أخرى، يراجع العدد والوزن والسعر والضريبة، يختار payment، ثم يضغط إتمام البيع؛ الخادم يعيد التسعير والتحقق والـposting.

## 18. Final gate and next step

### POS_REDESIGN_UNIVERSAL_PRODUCT_SEARCH_UX_REVISION_01_GATE = PASS_REVISION_READY

اكتملت forensic map وID/barcode/name/dropdown plans وresult/pricing/security/race UX وinvoice-table design وAPI gap plan وphase boundaries. Phase 1 معزولة عن search logic، ولا توجد كتابة أو migration.

الخطوة التالية المسموح بها فقط:

`POS-REDESIGN-IMPLEMENTATION-PHASE-01-SHELL-AND-LAYOUT-REV02_IF_PASS`

لا تبدأ تلقائيًا. Universal Search يبدأ في Phase 2 بعد تثبيت API contract.

## 19. Required final tokens

```text
CURRENT_BATCH = POS-REDESIGN-UNIVERSAL-PRODUCT-SEARCH-UX-REVISION-01
MODE = OWNER_APPROVED_SEARCH_FIRST_UX_REVISION_PLAN
POS_CART_TERMINOLOGY_REMOVED_FROM_TARGET_UX = YES
POS_UNIFIED_SEARCH_FORENSIC = COMPLETE
POS_SEARCH_ID_SEMANTICS = COMPLETE
POS_BARCODE_SEARCH_PLAN = COMPLETE
POS_NAME_SEARCH_PLAN = COMPLETE
POS_DROPDOWN_BROWSE_PLAN = COMPLETE
POS_UNIFIED_SEARCH_CONTROL = APPROVED_PLAN
POS_SEARCH_INTENT_STRATEGY = COMPLETE
POS_SEARCH_RESULT_BLUEPRINT = COMPLETE
POS_UNAVAILABLE_RESULT_POLICY = COMPLETE
POS_SEARCH_RESULT_PRICING_PLAN = COMPLETE
POS_ADD_TO_INVOICE_PLAN = COMPLETE
POS_INVOICE_ITEMS_COMPONENT_PLAN = COMPLETE
POS_INVOICE_ITEMS_COLUMNS = COMPLETE
MULTI_ITEM_INVOICE_PRESERVED = YES
POS_ASSET_VS_PRODUCT_QUANTITY_PLAN = COMPLETE
POS_SEARCH_SCOPE_SECURITY = COMPLETE
POS_SEARCH_GOLD_PROVIDER_ECONOMY_PLAN = COMPLETE
POS_SEARCH_ASYNC_RACE_PLAN = COMPLETE
POS_SEARCH_STATE_UX = COMPLETE
POS_UNIFIED_SEARCH_KEYBOARD_PLAN = COMPLETE
POS_CENTER_BLUEPRINT_REVISED = COMPLETE
POS_TEXT_WIREFRAME_REVISED = COMPLETE
POS_CUSTOMER_COLUMN_DIRECTION = PRESERVED
POS_PAYMENT_COLUMN_DIRECTION = PRESERVED
POS_BUSINESS_LOGIC_FROZEN = YES
POS_SEARCH_API_GAP_TABLE = COMPLETE
POS_SEARCH_API_CHANGE_PLAN = COMPLETE
POS_COMPONENT_IMPLEMENTATION_MAP_REVISED = COMPLETE
POS_STATE_OWNERSHIP_PLAN_REVISED = COMPLETE
POS_IMPLEMENTATION_PHASE_PLAN_REVISED = COMPLETE
PHASE_1_SEARCH_LOGIC_CHANGE = NO
POS_SEARCH_FUTURE_RUNTIME_TEST_PLAN = COMPLETE
OWNER_CASHIER_FLOW_SUMMARY = COMPLETE
POS_FILE_TOUCH_MAP_REVISED = COMPLETE
POS_REDESIGN_MIGRATION_REQUIRED = NO
PERSISTENT_WRITES_THIS_BATCH = 0
PRODUCT_CODE_FILES_CHANGED = 0
MIGRATIONS_CREATED = 0
RUNTIME_ENV_CHANGED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
POS_REDESIGN_UNIVERSAL_PRODUCT_SEARCH_UX_REVISION_01_GATE = PASS_REVISION_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = POS-REDESIGN-IMPLEMENTATION-PHASE-01-SHELL-AND-LAYOUT-REV02_IF_PASS
```

لم يتم تحديث `PROJECT_PROGRESS_HANDOFF.md`؛ هذا التقرير هو artifact التخطيط الوحيد.
