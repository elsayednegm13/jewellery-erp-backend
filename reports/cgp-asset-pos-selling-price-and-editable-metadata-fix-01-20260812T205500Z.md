# CGP-ASSET-POS-SELLING-PRICE-AND-EDITABLE-METADATA-FIX-01

## 1. النطاق والتنفيذ

- تم تنفيذ إصلاح محدود لمسار CGP فقط: تسعير POS ديناميكي، منع السعر الصفري عند حد البيع النهائي، وأمر تعديل بيانات وصفية آمن.
- لم تُنشأ Migration 81، ولم تتغير البيئة، ولم يُشغّل Next dev أو خادم أو نشر.
- تم الحفاظ على سعر/تكلفة الشراء التاريخية كما هي، ولم يُنسخ `Asset.cost` إلى سعر البيع.

## 2. الملفات التي تغيرت في هذه الدفعة

- `backend/src/services/gold-sale-pricing.service.js`
- `backend/src/routes/erp.routes.js`
- `backend/src/services/asset-metadata.service.js`
- `app/[locale]/(dashboard)/pos/page.tsx`
- `app/[locale]/(dashboard)/inventory/[id]/page.tsx`
- `features/gold-purchases/components/GoldPurchaseDraftWorkspace.tsx`
- `backend/tests/cgp-asset-pos-selling-price-and-editable-metadata.test.cjs`

كل الملفات الأخرى المتسخة في المستودع موروثة ولم تُنسب لهذه الدفعة.

## 3. التسعير الحالي

- أُضيف `CGP_CUSTOMER_GOLD_PURCHASE` إلى نفس `gold-sale-pricing.service` canonical authority.
- مصدر المعدل: Gold Center الحالي (GoldPrice المعتمد أولاً، ثم مرجع SPOT canonical) مع cache على مستوى الطلب، وليس طلباً لكل بطاقة POS.
- القيمة الذهبية = الوزن الصافي × معدل العيار الحالي.
- المصنعية = الوزن الإجمالي × `makingChargePerGram`؛ لم تتغير سلطة الوزن أو الصيغة.
- المعاينة تفصل قيمة الذهب عن المصنعية كي لا تُحسب المصنعية مرتين.
- POS يعرض سعراً مؤقتاً محسوباً، بينما `assets.price` التاريخي/المحفوظ لم يُعاد تعريفه أو تحديثه.
- `POS_CURRENT_SELLING_PRICE_FIELD = PosItem.price` داخل read model للبطاقات؛
  هذه قيمة ephemeral effective quote وليست إعادة تعريف للحقل المحفوظ في Asset.

## 4. بوابة السعر الصفري

- أُضيف `POS_SELLING_PRICE_REQUIRED` في `executeCanonicalSale` قبل إنشاء أثر بيع/مخزون/قيد/خزينة.
- البوابة تطبق على المنتجات، الأصول العامة، وتسعير الأصول الذهبية.
- بطاقة POS تعطل الأصل غير المسعّر وتعرض رسالة عربية/إنجليزية.
- المعدل الحالي المفقود أو غير الصالح يفشل مغلقاً ولا يستخدم التكلفة التاريخية أو `Asset.price` كبديل.

## 5. أمر البيانات الوصفية

- المسار: `PATCH /inventory-v2/assets/:id/metadata`.
- الصلاحية المعاد استخدامها: `inventory.adjust`؛ لم تُنشأ صلاحية جديدة.
- القائمة الفعلية: `name`, `description`, `category`, `brand`, `notes`, `location`.
- كل حقول الهوية/الباركود/المصدر/الشركة/الفرع/العيار/النقاء/الأوزان/التكلفة/السعر/الحالة محظورة صراحةً بالـ allowlist.
- الأمر scoped للشركة والفرع، idempotency-key و`expectedUpdatedAt` مطلوبان، ونسخة التوقيت تمنع الكتابة فوق تحديث متزامن.
- التعديل الناجح يسجل قبل/بعد/الممثل/الشركة/الفرع في `audit.service`؛ no-op لا ينشئ Audit business row.
- الواجهة أضيفت إلى صفحة Asset detail فقط، مع إبقاء التكلفة التاريخية والتقييم الحالي والحالة والحقول المادية للعرض فقط.

## 6. ربط CGP بالمخزون

- بطاقة الأصل المنشأ في شاشة CGP canonical تحتوي رابط `عرض الأصل في المخزون` إلى صفحة Asset detail نفسها، دون منطق تعديل مكرر.

## 7. اختبارات المصدر والـClone

- `node --test backend/tests/cgp-asset-pos-selling-price-and-editable-metadata.test.cjs`: PASS (3/3).
- الاختبار يغطي تغيير المعدل R1→R2 مع ثبات التكلفة، صيغة المصنعية بالوزن الإجمالي، allowlist/no-op/optimistic concurrency، overpost block، وبوابة POS الصفرية.
- `node --test backend/tests/cgp-presentation-localization-date.test.cjs`: PASS (3/3).
- Gold Making Charge/Gold Center/Gold Market runtime regressions: PASS (8/8).
- `npx tsc --noEmit`: PASS.
- تم استعمال Clone in-memory disposable في الاختبارات؛ لم تُنفذ عملية بيع مالية أو تعديل بيانات أعمال في قاعدة القبول.

## 8. تحقق Gold Center وPersistent read-only

- القراءة الفعلية من `darfus_erp` أعادت للأصل `GODGOF24000004`: Barcode ثابت، `AVAILABLE`، cost=`5182.4854`، price المحفوظ=`0`، وCGP lineage وpurchase revision ثابتين.
- المعدل الحالي canonical المحسوب للـ24K كان `520.46319465`، والـPOS quote المحسوب `5204.6304`؛ لم تُكتب أي قيمة إلى Asset أو Journal.
- Persistent read-only snapshot في هذه الجلسة: migrations=`80`, Assets=`62`, Products=`3`. هذه أرقام قراءة حالية فقط ولم تُعدّل.
- Acceptance target تحقق read-only: `darfus_erp_inventory_rehearsal_20260804_160500z`, migrations=`80`, Assets=`475`, Products=`3`؛ لم تُكتب أي صفوف.
- Persistent financial/inventory checks: duplicate/blank barcodes=0، unbalanced journals=0، orphan journal lines=0، unlinked posted treasury=0، open cash sessions=1.

## 9. الحماية والبيئة

- Gold runtime محفوظ (`GOLDAPI_IO`, `LIVE_PROVIDER`, refresh=1500، stale=2500).
- لم تُنشأ Migration 81.
- `next-env.d.ts` لم يتغير؛ SHA الحالي الموروث المعروف هو `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`، ولم تُجرَ أي عملية إصلاح/توليد له في هذه الدفعة.
- لا توجد Git writes أو commit أو push أو deploy.

## 10. النتيجة

CGP_POS_PRICING_REUSES_CANONICAL_SERVICE = PASS
CGP_POS_RATE_AUTHORITY = CANONICAL_GOLD_CENTER
POS_GOLD_RATE_N_PLUS_ONE = NO
PURCHASE_COST_COPIED_TO_RETAIL_PRICE = NO
HISTORICAL_COST_BEHAVIOR = FROZEN
MAKING_CHARGE_WEIGHT_AUTHORITY = ASSET_GROSS_WEIGHT
MAKING_CHARGE_FORMULA_CHANGED = NO
ZERO_PRICE_SALE_FAIL_CLOSED = PASS
ZERO_PRICE_FRONTEND_BLOCK = PASS
ZERO_PRICE_SERVER_BLOCK = PASS
MISSING_CURRENT_GOLD_RATE_FAIL_CLOSED = PASS
GENERIC_ASSET_MUTATION_REOPENED = NO
CGP_SAFE_METADATA_COMMAND = PASS
ASSET_METADATA_ALLOWLIST = name,description,category,brand,notes,location
ASSET_IMMUTABLE_FIELDS_SERVER_ENFORCED = PASS
PHYSICAL_FINANCIAL_FIELDS_NORMAL_EDIT = BLOCKED
ASSET_METADATA_EDIT_PERMISSION = inventory.adjust
NEW_PERMISSION_CREATED = NO
ASSET_METADATA_EDIT_AUDIT = PASS
ASSET_METADATA_NOOP_BEHAVIOR = NO_BUSINESS_MUTATION_NO_AUDIT
ASSET_METADATA_CONCURRENCY_SAFETY = PASS
ASSET_DETAIL_METADATA_EDIT_UI = PASS
ASSET_HISTORICAL_DATA_READONLY_UI = PASS
ASSET_COST_VALUATION_SELLING_PRICE_SEPARATION_UI = PASS
CGP_TO_ASSET_CANONICAL_NAVIGATION = PASS
CURRENT_VALUATION_WORKFLOW_CHANGED = NO
CGP_TAX_SEMANTICS_CHANGED = NO
CLONE_CGP_DYNAMIC_PRICING_FIXTURE = PASS
CLONE_GOLD_RATE_PRICE_REACTION = PASS
CLONE_ACQUISITION_HISTORY_UNCHANGED = PASS
CLONE_CGP_MAKING_CHARGE_FORMULA = PASS
CLONE_ZERO_PRICE_HARD_GATE = PASS
CLONE_ALLOWED_METADATA_EDIT = PASS
CLONE_IMMUTABLE_FIELD_OVERPOST_BLOCK = PASS
CLONE_UNAUTHORIZED_METADATA_EDIT = PASS_BY_PERMISSION_MIDDLEWARE
CLONE_METADATA_EDIT_CONCURRENCY = PASS
CLONE_CGP_POS_PRICING_E2E = PASS_CONTRACT
SERVER_ZERO_PRICE_GATE_AT_FINAL_SALE_BOUNDARY = PASS
EXISTING_GOLD_POS_PROFILE_NONREGRESSION = PASS
NON_GOLD_POS_PRICING_NONREGRESSION = PASS
METADATA_EDIT_POS_NONREGRESSION = PASS
CGP_ASSET_LINEAGE_PRESERVED = PASS_READ_ONLY
PRICING_VIEW_ACCOUNTING_WRITES = 0
METADATA_EDIT_ACCOUNTING_WRITES = 0
GOLD_RUNTIME_1500_2500_PRESERVED = PASS
GOLD_PROVIDER_CALL_ECONOMY = PASS
CGP_RUNTIME_DISPATCHER_NONREGRESSION = PASS
RUNTIME_WATERMARK_PRESERVED = PASS
GLOBAL_DISPATCHER_ENABLED = NO
MIGRATION_81_CREATED = NO
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
PERSISTENT_WRITES_THIS_BATCH = 0
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
