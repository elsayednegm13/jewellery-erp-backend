# CGP-ASSET-POS-PRICING-EDITABILITY-FORENSIC-01

## 1. ماذا تم؟

تحقيق جنائي للقراءة فقط لمسار Customer Gold Purchase إلى Asset ثم Inventory وPOS وتسعير البيع وقابلية التعديل. تمت قراءة AGENTS.md وPROJECT_PROGRESS_HANDOFF.md وCGP_CANONICAL_IMPLEMENTATION_REFERENCE.md، وفحص المصدر وقاعدة البيانات وواجهة Inventory/POS. لم تُنفذ أي عملية أعمال ولم يتغير الكود أو قاعدة البيانات.

## 2. ماذا نجح؟

تم إثبات مصدر السعر صفر، وفصل تكلفة شراء CGP التاريخية عن سعر البيع، وتحديد سلطة Gold Center وMaking Charge، وإثبات ثبات هوية الأصل والحالة والتاريخ. تم فحص واجهة التعديل ومساراتها، وتحقق السلامة المالية والمخزنية بدون كتابة.

## 3. ماذا فشل أو ما هو العيب؟

العيب الرئيسي: مستهلك CGP ينشئ Asset بسعر 0.0000، وPOS يقرأ Asset.price، بينما مسار التسعير الديناميكي لا يضم CGP_CUSTOMER_GOLD_PURCHASE. لذلك يظهر الأصل في POS بسعر 0.00 د.إ. كما أن مسار البيع العام لا يرفض السعر الصفري.

العيب الثاني: توجد شاشات تعديل قديمة/معزولة، لكن الخادم يحجب PATCH/PUT /assets/:id بـ GENERIC_INVENTORY_MUTATION_FORBIDDEN. لا يوجد حالياً أمر قانوني مخصص لتعديل CGP metadata.

## 4. هل يوجد خطر على قاعدة العمل الأساسية؟

لا يوجد خطر ناتج عن هذه الجولة: darfus_erp بقيت للقراءة فقط، ولم تُنفذ Sale أو Settlement أو Journal أو تعديل Asset. الخطر المنتج القائم HIGH/CRITICAL هو إمكانية ظهور أصل CGP بسعر صفر وقبول بيع عام بهذا السعر.

## 5. ما الخطوة التالية؟

التوصية غير المنفذة: دفعة CGP-ASSET-POS-SELLING-PRICE-AND-EDITABLE-METADATA-FIX-01 لإدخال سلطة سعر بيع CGP أو حجب البيع الصفري، ثم أمر محدود لتعديل metadata التشغيلية فقط مع صلاحية وتدقيق. لا تُنسخ تكلفة الشراء إلى سعر البيع ولا تُفتح الحقول التاريخية.

## A. الحواجز والتنفيذ

* الوضع: STRICT READ-ONLY FORENSIC.
* لا تعديل كود أو إعدادات أو Handoff أو .env.
* لا كتابة في persistent/acceptance، لا migration، لا fixtures، لا POS sale، لا تسوية أو Accounting/Treasury.
* قاعدة persistent المقروءة: darfus_erp.
* المرجع القانوني يثبت: Sales هو مدخل CGP، لا Asset/accounting/gold-center قبل Posting، حدث CustomerGoldPurchasePostedEvent، قطعة واحدة = بند واحد = Asset واحد، والفاتورة المنشورة غير قابلة للتحرير.

## B. البصمة الحالية (SELECT فقط)

| المؤشر | القيمة |
|---|---:|
| migrations | 80 |
| Assets | 61 |
| Products | 3 |
| Cash GL signed | 0.00300000 |
| Bank GL signed | 10076.25660000 |
| open cash sessions | 1 |
| unbalanced journals | 0 |
| orphan journal lines | 0 |
| unlinked posted treasury | 0 |
| duplicate primary barcodes | 0 |
| blank barcodes | 0 |
| orphan RFID/origins | 0 |
| settlements | 2 |
| approval requests | 0 |

## C. حالة الأصل النموذجي GODGOF24000004

| الحقل | القيمة |
|---|---|
| Asset ID | CGPA-b208dbd9d725411281b5f41b23 |
| barcode | GODGOF24000004 |
| source/profile | customer_gold_purchase / CGP_CUSTOMER_GOLD_PURCHASE |
| company/branch | الشركة الحالية / Main Branch |
| Product | لا يوجد؛ Serialized Asset بلا quantity authority |
| name/category | دهب مستعمل / customer-gold-purchase |
| karat/purity | 24K / 1.00000000 |
| gross/stone/net | 9.999997 / 0 / 9.999997 |
| pureGold9999 | 9.999997 |
| price/cost | 0.00000000 / 5182.48540000 |
| status | available / AVAILABLE |
| location/RFID | فارغ / null |
| current valuation/policy | لا row لأي منهما لهذا الأصل |

سلسلة الشراء: CGP-000007 POSTED/APPROVED بقيمة 5182.4854، liability بقيمة أصلية 5182.4854 وحالة SETTLED، purchase revision بمعدل 518.2487 ومصدر GOLDAPI، وقيد شراء منفصل عن قيد الدفع. هذه القيم تاريخية ومحمية.

## D. مصفوفة إنشاء أصل CGP

| المجموعة | ما يحدث عند Posting |
|---|---|
| الهوية | ID وBarcode من الخادم، company/branch/source/profile |
| physical | type/category/karat/purity/gross/stone/net/goldWeight |
| retail | price: 0.0000؛ لا sellingGoldRate أو making أو markup |
| acquisition | cost = snapshot.lineGoldValue + purchase-cost revision |
| state | PENDING_INTEGRATION ثم evaluator إلى AVAILABLE |
| lineage/audit | asset_origins وmetadata وAssetEvent/Movement |
| Product | لا Product link |

الدليل الحاسم: backend/src/services/cgp-inventory-consumer.service.js:110 يكتب price صفراً، بينما cost يأخذ snapshot.

## E. مسار POS وسلطة السعر

app/[locale]/(dashboard)/pos/page.tsx يختار assets المتاحة في الفرع. hooks/use-core-erp-data.ts يقرأ GET /assets عبر apiClient ويعيد price وcost. بطاقة الأصل النموذجي ظهرت 0.00 د.إ.

gold-sale-pricing.service.js يضم GOLD_BY_WEIGHT_JEWELLERY وGOLD_BAR_24K وGOLD_BY_PIECE وملفي loose المحددين فقط. CGP غير موجود في isGoldSaleProfile/isSalePricingProfile. لذلك executeCanonicalSale يسقط إلى Number(item.price) || Number(asset.price) || 0 ولا يوجد zero-price gate.

Gold Center: override معتمد من GoldPrice ثم canonical live SPOT fallback عبر /gold/karat-prices. اللقطة الحالية: fine/24K 521.24722275، 22K 477.80995419، 21K 456.09131991، 18K 390.93541706، provider GOLDAPI_IO، FRESH.

Making Charge: grossWeight × makingChargePerGram في gold-sale-pricing.service. وزن الذهب المدعوم: net × sellingRate + gross × makingRate ثم adjustments/VAT حسب profile. لا تغيّر هذا القانون.

## F. مقارنة أسعار POS

| الأصل | المصدر/profile | الوزن | price | cost | النتيجة |
|---|---|---:|---:|---:|---|
| GODGOF24000004 | CGP/CGP | 24K/9.999997g | 0.00 | 5182.4854 | صفر |
| GODGOF21000050 | supplier/GOLD_BY_WEIGHT | 21K/10g | 2092.00 | 1585.00 | يعمل |
| GODGOF21000048 | supplier/GOLD_BY_WEIGHT | 21K/10g | 2092.00 | 1585.00 | يعمل |
| GODODD24000001 | supplier/GOLD_BAR_24K | 24K/10g | 0.00 | 15601000 | valuation/policy غير projected |

CGP_PURCHASE_RATE_AND_RETAIL_RATE_SEPARATED=PASS: لا دليل على نسخ purchase cost إلى retail price.

## G. current valuation والتسعير والضريبة

مسار PUT /inventory-v2/assets/:id/current-valuation محكوم بـ inventory.adjust ويعدل normalized current valuation فقط؛ لا يغيّر purchase revision أو journal أو liability أو retail price. شاشة التفاصيل تفصل Frozen Purchase Snapshot عن Separate Current Valuation.

بالنسبة إلى CGP لا توجد سياسة tax/price متخصصة في POS حالياً؛ generic settings VAT يعمل بعد fallback العام. لا يتم استنتاج قاعدة UAE جديدة. سعر CGP لا يتغير مع live Gold Center rate لأن profile مستبعد من pricing service.

## H. مصفوفة قابلية التعديل

| الحقل | editable عادي؟ | السبب/السلطة |
|---|---|---|
| Asset ID, Barcode | لا | هوية POS/labels/events؛ Barcode immutable |
| CGP source/link/type | لا | lineage وposting |
| purchase date/cost/rate/journal | لا | historical snapshot/liability/accounting |
| company | لا | server scope |
| branch | ليس عادياً | transfer/ownership command |
| Product link | لا عادياً | Serialized Asset بلا quantity |
| name/description/category/brand/collection/notes | نعم مستقبلاً | metadata فقط، بأمر وصلاحية وتدقيق |
| image | نعم عبر attachment flow | relation مستقلة |
| location | نعم مستقبلاً | branch-scoped metadata |
| operational status/condition | لا مباشرة | canonical state machine |
| karat/purity/gross/stone/net/pure | لا عادياً | physical/gold truth؛ correction workflow |
| making/selling rate/price/markup/VAT | لا كتحرير Asset | pricing/Gold Center/accounting authority |
| current valuation | ليس edit عادياً | route مخصص موجود |
| RFID | ليس عادياً | route مخصص |
| certificates/attachments | flow مخصص | relational evidence |

الحقول immutable: الهوية، Barcode، CGP lineage، التاريخ والتكلفة والمعدل والقيد، الشركة، snapshot التاريخي، acquisition origin. الحقول normal-editable المقترحة: الاسم والوصف والتصنيف والعلامة والمجموعة والملاحظات والموقع والصورة، لكن command القانوني غير موجود حالياً. الحقول controlled-correction: branch، physical data، karat/purity، Product/Barcode، acquisition، status/condition، pricing/tax.

تغيير الوزن أو karat/purity يغيّر pure gold والvaluation وPOS وقد يصطدم بتاريخ الشراء. تغيير cost/rate/journal يمس liability وAccounting. تغيير Barcode يكسر POS والـlabels والـlineage. لذلك لا توجد إعادة حساب صامتة.

## I. التعديل والصلاحيات والتدقيق

ASSET_EDIT_CAPABILITY_EXISTS=PARTIAL: شاشة Inventory detail للعرض، وAssetEditModal/InventoryItemForm قديمتان وغير موصولتين canonical، والـPATCH العام محجوب بـ GENERIC_INVENTORY_MUTATION_FORBIDDEN. توجد routes مستقلة للـcurrent valuation/components/RFID/attachments، ولا يوجد CGP metadata edit command.

الصلاحيات الموجودة: inventory.view/create/update/adjust/delete/export/print. Admin/Manager/Owner لديهم inventory.adjust/update، وSales view فقط. لا يوجد دور Local Admin أو assignment حالي مثبت. وجود generic permission لا يساوي سلطة تعديل CGP لأن lifecycle block يمنع mutation.

audit.service.js خدمة append-only تدعم before/after وactor وtimestamp وreason وhash chain، لكنها لا تُستدعى من أمر CGP metadata edit غير الموجود.

المكان الصحيح مستقبلاً: صفحة Asset detail canonical في Inventory؛ بطاقة CGP تقدم رابط عرض الأصل وربما تعديل فقط بعد توفر command وصلاحية. لا تضع منطق تعديل مستقل داخل CGP.

## J. تصنيف العيوب

| ID | التصنيف | الشدة | الجذر | الاتجاه الآمن |
|---|---|---|---|---|
| P01 | CGP_ASSET_RETAIL_PRICE_NOT_INITIALIZED | HIGH | consumer يكتب price صفر وCGP خارج pricing service | policy/quote معتمدة أو fail-closed |
| P02 | OTHER (legacy edit UI + blocked canonical route) | HIGH | لا CGP metadata command | command محدود + permission + audit |
| P03 | ZERO_PRICE_ALLOWED_WITHOUT_SALE_GATE | CRITICAL | generic checkout يقبل صفرًا | رفض البيع الصفري قبل الأثر المالي |
| P04 | CGP profile excluded from dynamic pricing | HIGH | isGoldSaleProfile لا يضم CGP | عقد موحد للتسعير قبل POS |

## K. المتصفح والشبكة وعدم الانحدار

Inventory detail أظهر AVAILABLE وpurchase snapshot منفصل وقراءة فقط. POS أظهر CGP بسعر صفر وsupplier 21K بسعر 2092. لم تُرسل أي POST/PUT/PATCH/DELETE ولم يتم الضغط على بيع أو تعديل.

GoldMarket: provider GOLDAPI_IO، LIVE_PROVIDER، refresh 1500، stale 2500، enabled. CGP dispatcher scoped enabled مسبقاً، global dispatcher OFF، watermark محفوظ، والبيئة لم تتغير. لا توجد migration 81.

## L. الخطط المستقبلية غير المنفذة

خطة التسعير: أصل disposable في acceptance، سعر غير صفري مع Gold Center/rate/policy، مطابقة صيغة أصل supplier، إثبات making charge، stale/missing rate وzero fail-closed، وعدم لمس purchase/accounting/liability/settlement.

خطة التعديل: command واحد للـmetadata المسموح، permission server-side، before/after/actor/time/reason في Audit، رفض الهوية والتكلفة والوزن والعيارات والحالة كتحرير عادي، ثم إثبات انعكاس metadata فقط في POS.

## M. قرار البوابة

الأدلة كافية لإثبات السببين الجذريين وتصميم الإصلاح، ولا يوجد UNKNOWN يمنع تصميم العقد. لم يُنفذ الإصلاح في هذه الجولة.

## Required tokens

FORENSIC_MODE = READ_ONLY
PERSISTENT_DATABASE_CONFIRMED = darfus_erp
PERSISTENT_MIGRATIONS = 80
PERSISTENT_ASSETS = 61
PERSISTENT_PRODUCTS = 3
CGP_ASSET_EXAMPLE_STATE = COMPLETE
CGP_PURCHASE_COST_AUTHORITY = CGP item + customer liability + purchase journal + asset_purchase_cost_revisions
PURCHASE_COST_EQUALS_SELLING_PRICE_POLICY = NO
POS_ASSET_LISTING_SOURCE = GET /assets Asset read model, available+branch filtered
POS_SELLING_PRICE_AUTHORITY = Asset.price currently; gold-sale-pricing.service for supported profiles
CGP_POS_ZERO_PRICE_ROOT_CAUSE = CGP inventory consumer writes Asset.price=0.0000 and no CGP pricing projection
CURRENT_GOLD_SELLING_RATE_AUTHORITY = Gold Center approved/manual GoldPrice override or canonical live SPOT reference
CGP_PURCHASE_RATE_AND_RETAIL_RATE_SEPARATED = PASS
MAKING_CHARGE_FORMULA_AUTHORITY = gold-sale-pricing.service: grossWeight * makingChargePerGram
MAKING_CHARGE_RULE_CHANGED = NO
POS_PRICE_FORMULA = netGoldWeight*sellingGoldRate + grossWeight*makingChargePerGram + profile-authorized adjustments/VAT
CGP_ASSET_CREATION_FIELD_MATRIX = COMPLETE
CGP_ASSET_INTENDED_RETAIL_PRICING_MODEL = INCOMPLETE; approved dynamic policy or pre-sale snapshot required
ASSET_CURRENT_VALUATION_SEMANTICS = Separate normalized current valuation, not retail price or purchase cost
ZERO_PRICE_ASSET_POS_SELLABILITY_POLICY = Appears when AVAILABLE and generic checkout can accept zero
ASSET_EDIT_CAPABILITY_EXISTS = PARTIAL
CGP_ASSET_EDITABILITY_MATRIX = COMPLETE
CGP_ASSET_IMMUTABLE_FIELDS = Asset identity, Barcode, CGP lineage, purchase date/cost/rate/journal, company, historical snapshot
CGP_ASSET_NORMAL_EDITABLE_FIELDS = name/description/category/brand/collection/notes/location/image (future controlled command)
CGP_ASSET_CONTROLLED_CORRECTION_FIELDS = branch, karat, purity, weights, Product relation, Barcode, acquisition, status/condition, pricing/tax
CGP_ASSET_SELLING_METADATA_EDITABILITY = Controlled pricing authority only; not normal Asset.price/cost edit
BARCODE_NORMAL_EDIT_ALLOWED = NO
PHYSICAL_FIELD_EDIT_RISK_MATRIX = COMPLETE
ASSET_EDIT_PERMISSION_MODEL = inventory.update/inventory.adjust exist for Admin/Manager/Owner; generic mutation blocked; no CGP command
LOCAL_ADMIN_ASSET_EDIT_AUTHORITY = NO_DEDICATED_LOCAL_ADMIN_ROLE_FOUND
ASSET_EDIT_AUDIT_CAPABILITY = Generic append-only audit service available; dedicated CGP edit command absent
RECOMMENDED_ASSET_EDIT_UI_LOCATION = Canonical Inventory Asset detail page
CGP_TO_ASSET_EDIT_NAVIGATION_RECOMMENDATION = Link from CGP to Asset detail; do not duplicate edit logic
POS_PRICE_DISPLAY_CONTRACT = Current approved unit/line selling price in POS; detail keeps purchase/current valuation separate
ZERO_PRICE_SALE_FAIL_CLOSED = FAIL
POS_PRICE_REACTS_TO_GOLD_RATE = NO for current CGP POS listing; supported profiles use pricing service when rate/policy supplied
CGP_HISTORICAL_ACQUISITION_IMMUTABLE = PASS
CGP_POS_TAX_BEHAVIOR = No CGP-specific tax authority; generic settings VAT only after generic fallback
EXAMPLE_PRICE_COMPONENT_COMPARISON = COMPLETE
PRIMARY_CGP_POS_PRICING_DEFECT = CGP_ASSET_RETAIL_PRICE_NOT_INITIALIZED
PRIMARY_CGP_ASSET_EDITABILITY_GAP = OTHER: legacy edit UI exists but canonical mutation route is blocked; no safe CGP metadata command
RECOMMENDED_IMPLEMENTATION_BATCH = CGP-ASSET-POS-SELLING-PRICE-AND-EDITABLE-METADATA-FIX-01
NEXT_PRICING_ACCEPTANCE_PLAN = DEFINED
NEXT_EDITABILITY_ACCEPTANCE_PLAN = DEFINED
UNRELATED_INVENTORY_SCOPE = 0
CGP_ASSET_POS_BROWSER_FORENSIC = PASS
AUTOMATIC_BUSINESS_MUTATION_REQUESTS = 0
PERSISTENT_WRITES_THIS_BATCH = 0
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
GOLD_RUNTIME_1500_2500_PRESERVED = PASS
CGP_RUNTIME_DISPATCHER_NONREGRESSION = PASS
RUNTIME_WATERMARK_PRESERVED = PASS
GLOBAL_DISPATCHER_ENABLED = NO
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO
RUNTIME_ENV_CHANGED = NO
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
MANUAL_RUNTIME_RESTART_THIS_BATCH = NO
NEXT_DEV_STARTED_OR_RESTARTED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
CGP_ASSET_POS_PRICING_EDITABILITY_FORENSIC_01_GATE = PASS_ROOT_CAUSE_PROVEN
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = CGP-ASSET-POS-SELLING-PRICE-AND-EDITABLE-METADATA-FIX-01
CODE_MUTATIONS_THIS_BATCH = 0
DATABASE_MUTATIONS_THIS_BATCH = 0
ASSET_MUTATIONS_THIS_BATCH = 0
PRODUCT_MUTATIONS_THIS_BATCH = 0
PRICE_WEIGHT_KARAT_PURITY_COST_MUTATIONS_THIS_BATCH = 0
POS_SALE_SETTLEMENT_ACCOUNTING_MUTATIONS_THIS_BATCH = 0
HANDOFF_MUTATIONS_THIS_BATCH = 0
GIT_WRITE_THIS_BATCH = 0

