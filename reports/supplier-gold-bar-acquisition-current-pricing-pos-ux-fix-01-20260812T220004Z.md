# SUPPLIER-GOLD-BAR-ACQUISITION-CURRENT-PRICING-POS-UX-FIX-01

## 1. النتيجة المختصرة

تم تنفيذ الإصلاح المحدود لمصدر سعر شراء الذهب، حراسة سعر السوق الحالي، تسعير POS الديناميكي للذهب المورد، وتصحيح أساس المصنعية في الاستلام. لم تُنفذ أي كتابة في `darfus_erp`، ولم تُشغّل Migration 81 أو Next dev أو إعادة تشغيل يدوية.

بوابة الدفعة بقيت `BLOCKED` لأن اختبار Clone/E2E الكامل ومسار قبول الاستلام الفعلي مع إنشاء أصل لم يُنفذا في هذه الجولة؛ لذلك لم يتم تحديث `PROJECT_PROGRESS_HANDOFF.md` ولم يتم إعلان PASS نهائي.

## 2. ما تم تغييره

- `backend/src/routes/erp.routes.js`
  - سعر Gold Center الحالي يُحل مرة واحدة لكل request/karat عبر cache.
  - الاستلام يضع السعر المرجعي كـ default لسعر الشراء، ويقبل override قبل الاستلام فقط مع `inventory.adjust` وسبب إلزامي.
  - override يُسجل في `audit_logs` عند حدود إنشاء Asset مع reference/approved rate/actor/company/branch/reason.
  - السعر الحالي في current valuation لا يُؤخذ كسلطة من body؛ الخادم يحله من Gold Center.
  - `/pricing/calculate` و`executeCanonicalSale` يعيدان تسعير GOLD_BY_WEIGHT/GOLD_BAR_24K من Gold Center، مع VAT bar على الشهادة فقط.
  - إضافة 14K إلى تحقق الاستلام العام، بدون تغيير enum أو Migration.
- `backend/src/services/gold-valuation.service.js`
  - المصدر يثبت `GOLD_CENTER`/`MANUAL_OVERRIDE`، والمصنعية في الاستلام والتقييم الحالي على gross weight.
- `backend/src/services/gold-sale-pricing.service.js`
  - لا يُعاد استخدام purchase certificate cost كسعر بيع؛ certificate charge المفقود يظل صفراً، وVAT غير مطلوب عندما تكون قاعدة الشهادة صفرية.
- `app/[locale]/(dashboard)/suppliers/purchases/page.tsx`
  - default سعر الشراء من `/gold/karat-prices`، وسعر السوق الحالي read-only مع المصدر/الحالة والقيمة الحالية المشتقة.
  - override ظاهر بعبارة «تم تعديل سعر الشراء يدويًا» وسبب إلزامي للمصرح.
  - التاريخ الافتراضي صار branch/local، وإضافة 14K لقائمة العيارات العامة، مع استمرار bar على 24K.
- `app/[locale]/(dashboard)/pos/page.tsx`
  - بطاقات GOLD_BY_WEIGHT/GOLD_BAR_24K/CGP تستخدم quote حالي غير صفري عند توفر Gold Center، وتُقفل عندما يكون quote غير متاح أو غير صالح.
- `backend/tests/supplier-gold-bar-acquisition-current-pricing-pos-ux.test.cjs`
  - اختبارات مركزة جديدة بلا DB writes.

## 3. القواعد والسلطة

- purchase rate: Gold Center default؛ override قبل final receipt فقط بواسطة `inventory.adjust` أو صلاحية إدارية قائمة، مع audit.
- current rate: Gold Center canonical، karat-aware، لا يثق الخادم في current rate المرسل من العميل.
- purchase snapshot يبقى في purchase revision ولا يتغير مع حركة السوق.
- current valuation منفصل ولا يكتب فوق historical purchase.
- 24K: `goldValue = netGoldWeight × rate`، وVAT = `certificateCost × rate` فقط؛ retail certificate charge منفصل ولا يُستنتج من تكلفة الشراء.
- sale making: `grossWeight × makingChargePerGram`.
- no quantity authority for serialized physical assets؛ كل قطعة تبقى Asset مستقل.

## 4. دعم العيارات

| المسار | العيارات |
|---|---|
| GOLD_BY_WEIGHT_JEWELLERY | 14K, 18K, 21K, 22K, 24K |
| GOLD_BAR_24K | 24K فقط، لأن عقد السبيكة الحالي 24K-only |
| Gold Center resolver | 14K, 18K, 21K, 22K, 24K |

لم يتم اختراع profile جديد للسبيكة متعددة العيارات ولم تُنشأ Migration 81.

## 5. الاختبارات

- `node --test backend/tests/supplier-gold-bar-acquisition-current-pricing-pos-ux.test.cjs`: 4/4 PASS.
- `node --test backend/tests/gold-making-charge-01-contract.test.cjs`: PASS.
- `node --test backend/tests/gold-market-runtime.test.cjs backend/tests/gold-live-feed-03-pricing-policy.test.cjs`: PASS.
- `npx tsc --noEmit`: PASS.
- ESLint للملفات المتأثرة: PASS؛ تحذيرات hooks الموجودة مسبقاً فقط، بلا أخطاء.
- runtime browser الحالي: صفحة الاستلام أظهرت Gold Center reference/FRESH، current rate read-only، override indicator، و14K في القائمة؛ POS أظهر `GODODD24000001` بسعر ديناميكي غير صفري.
- responsive DOM overflow: لا overflow في desktop 1440، tablet 1024، mobile 390 لكل من الاستلام وPOS.

لم يُنفذ Clone/E2E الذي ينشئ receipt/Asset أو اختبار rate movement فعلياً، ولم يُنفذ browser submit؛ لذلك هذه الأدلة لا تكفي لإغلاق البوابة.

## 6. قاعدة البيانات والحماية

- Persistent `darfus_erp` read-only verification: migrations 80، Assets 62، Products 3، blank/duplicate barcodes 0، orphan RFID 0، orphan journal lines 0، unbalanced posted journals 0، unlinked treasury 0، open sessions 1.
- Acceptance `darfus_erp_inventory_rehearsal_20260804_160500z` read-only check: migrations 80، Assets 475، Products 3.
- Persistent Gold runtime بقي `GOLDAPI_IO`, refresh 1500، stale 2500، enabled.
- `next-env.d.ts` بقي على inherited known drift SHA: `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`; لم يُصلح أو يُولد.
- Git: branch `main`، HEAD `1657b0e9ba580faef69be48f04637835c201b521`، staged 0، stashes 11، تغييرات inherited كثيرة؛ لا commit/push/deploy.

## 7. النواقص التي تمنع الإغلاق

1. Disposable Clone/E2E لم يثبت إنشاء Gold By Weight و24K receipt مع freeze/override unauthorized/rate movement.
2. لم تُثبت zero-price rejection عبر HTTP على clone مع before/after side-effect fingerprint.
3. لم تُنفذ full focused supplier receiving runtime acceptance أو responsive screenshot evidence.
4. لم يتم تعديل handoff لأن الشرط هو PASS كامل.

## 8. Required tokens

```text
CURRENT_BATCH = SUPPLIER-GOLD-BAR-ACQUISITION-CURRENT-PRICING-POS-UX-FIX-01
CHANGE_SCOPE = SUPPLIER_ACQUISITION_CURRENT_PRICING_POS_RECEIVING_UX_ONLY
SUPPLIER_PURCHASE_RATE_DEFAULT = CANONICAL_GOLD_CENTER
SUPPLIER_PURCHASE_RATE_OVERRIDE = AUTHORIZED_PRE_FINALIZATION_ONLY
PURCHASE_RATE_OVERRIDE_INDICATOR = PASS
SUPPLIER_PURCHASE_RATE_OVERRIDE_AUDIT = PASS
SUPPLIER_PURCHASE_RATE_FREEZE = BLOCKED_CLONE_E2E_NOT_RUN
SUPPLIER_HISTORICAL_ACQUISITION_IMMUTABLE = PASS_STATIC_READ_ONLY
SUPPLIER_CURRENT_RATE_AUTHORITY = CANONICAL_GOLD_CENTER
CURRENT_RATE_ORDINARY_EDITABLE = NO
CURRENT_MARKET_VALUE_IS_DERIVED = PASS
CURRENT_VALUATION_WORKFLOW_REPURPOSED = NO
SUPPLIER_GOLD_WEIGHT_DERIVATION = PASS
SUPPLIER_KARAT_GOLD_CENTER_RESOLUTION = PASS
BULLION_KARAT_SUPPORT = GOLD_BAR_24K_ONLY; GENERAL_GOLD_BY_WEIGHT_14_18_21_22_24
BULLION_14K_SUPPORT = PASS_GENERAL_PROFILE_ONLY
SUPPLIER_BAR_ACQUISITION_FORMULA_NONREGRESSION = PASS_UNIT
SUPPLIER_RECEIVE_MAKING_CHARGE_WEIGHT_AUTHORITY = ASSET_GROSS_WEIGHT
HISTORICAL_MAKING_CHARGE_ROWS_REWRITTEN = NO
PURCHASE_CERTIFICATE_COST_USED_AS_RETAIL_CHARGE = NO
CERTIFICATE_VAT_FORMULA_CHANGED = NO
RETAIL_CERTIFICATE_CHARGE_AUTHORITY = EXISTING_POLICY_OR_ZERO_WHEN_UNCONFIGURED
SUPPLIER_BAR_POS_DYNAMIC_PRICING = PASS_STATIC_RUNTIME_CARD
SUPPLIER_BAR_POS_PRICE_FORMULA = NET_GOLD_WEIGHT_X_CANONICAL_CURRENT_RATE_PLUS_AUTHORIZED_RETAIL_CERTIFICATE_AND_VAT
SUPPLIER_BAR_POS_PRICE_READMODEL = PASS
SUPPLIER_BAR_POS_REACTS_TO_GOLD_CENTER = BLOCKED_RATE_MOVEMENT_CLONE_NOT_RUN
SUPPLIER_BAR_HISTORICAL_COST_FIXED = PASS_READ_ONLY
SUPPLIER_BAR_ZERO_PRICE_FRONTEND_BLOCK = PASS
SUPPLIER_BAR_ZERO_PRICE_SERVER_GATE = PASS
ZERO_PRICE_REJECTION_ZERO_SIDE_EFFECTS = PASS_STATIC_BLOCKED_HTTP_REPLAY
SUPPLIER_BAR_CLIENT_PRICE_TAMPERING_GUARD = PASS
SUPPLIER_POS_GOLD_RATE_N_PLUS_ONE = NO
EXTERNAL_GOLD_PROVIDER_CALL_PER_ASSET = NO
SUPPLIER_RECEIVING_UX_REDESIGN = PASS
SUPPLIER_RECEIVING_INFORMATION_HIERARCHY = PASS
SUPPLIER_RECEIVING_HEADER = PASS
SUPPLIER_RECEIVING_IDENTITY_SECTION = PASS
SUPPLIER_RECEIVING_PHYSICAL_SECTION = PASS
SUPPLIER_RECEIVING_ACQUISITION_SECTION = PASS
SUPPLIER_RECEIVING_CURRENT_MARKET_SECTION = PASS
SUPPLIER_RECEIVING_CERTIFICATE_SECTION = PASS
SUPPLIER_RECEIVING_OPTIONAL_METADATA = PASS
SUPPLIER_RECEIVING_FINANCIAL_SUMMARY = PASS
SUPPLIER_RECEIVING_DESKTOP_LAYOUT = PASS
SUPPLIER_RECEIVING_RESPONSIVE = PASS_DOM
SUPPLIER_RECEIVING_DATE_NONREGRESSION = PASS
SUPPLIER_RECEIVING_RTL_BIDI = PASS_SOURCE_RUNTIME
PURCHASE_RATE_OVERRIDE_PERMISSION_UI = PASS
CURRENT_MARKET_RATE_READONLY_UI = PASS
CURRENT_MARKET_SOURCE_VISIBILITY = PASS
BULLION_PROFILE_KARAT_VALIDATION = PASS_24K_ONLY
PURCHASE_OVERRIDE_DOES_NOT_CHANGE_CURRENT_RATE = PASS_STATIC
CURRENT_RATE_CHANGE_DOES_NOT_REWRITE_PURCHASE = PASS_READ_ONLY
PO_DIRECT_RECEIPT_PRICING_CONSISTENCY = BLOCKED_CLONE_E2E_NOT_RUN
SUPPLIER_PAYMENT_SEMANTICS_CHANGED = NO
CURRENT_MARKET_ACCOUNTING_WRITES = 0
CLONE_PURCHASE_RATE_GOLD_CENTER_DEFAULT = BLOCKED
CLONE_PURCHASE_RATE_OVERRIDE = BLOCKED
CLONE_UNAUTHORIZED_PURCHASE_RATE_OVERRIDE = BLOCKED
CLONE_PURCHASE_RATE_FREEZE = BLOCKED
CLONE_CURRENT_RATE_TAMPERING_GUARD = PASS_STATIC
CLONE_BULLION_KARAT_MATRIX = BLOCKED
CLONE_SUPPLIER_MAKING_GROSS_BASIS = PASS_UNIT
CLONE_BAR_CERTIFICATE_VAT = PASS_UNIT
CLONE_SUPPLIER_BAR_POS_QUOTE = PASS_RUNTIME_READMODEL
CLONE_SUPPLIER_BAR_RATE_REACTION = BLOCKED
CLONE_SUPPLIER_BAR_ZERO_PRICE_GATE = PASS_STATIC
EXISTING_GOLD_PROFILE_NONREGRESSION = PASS_TARGETED
NON_GOLD_POS_NONREGRESSION = PASS_TYPECHECK_STATIC
GODODD24000001_PERSISTENT_READONLY_ACCEPTANCE = PASS_READ_ONLY
PERSISTENT_SUPPLIER_CURRENT_RATE_READONLY_ACCEPTANCE = PASS_READ_ONLY
PERSISTENT_AUTOMATIC_BUSINESS_MUTATION_REQUESTS = 0
PERSISTENT_WRITES_THIS_BATCH = 0
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
FINANCIAL_INTEGRITY = PASS_READ_ONLY
INVENTORY_INTEGRITY = PASS_READ_ONLY
GOLD_RUNTIME_1500_2500_PRESERVED = PASS
GOLD_PROVIDER_CALL_ECONOMY = PASS_REQUEST_CACHE
CGP_RUNTIME_DISPATCHER_NONREGRESSION = PASS_INHERITED_READ_ONLY
RUNTIME_WATERMARK_PRESERVED = PASS_INHERITED_READ_ONLY
GLOBAL_DISPATCHER_ENABLED = NO
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO
RUNTIME_ENV_CHANGED = NO
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
NODEMON_AUTO_RELOAD = NOT_OBSERVED
FRONTEND_HOT_RELOAD = YES_OBSERVED
MANUAL_RUNTIME_RESTART_THIS_BATCH = NO
NEXT_DEV_STARTED_OR_RESTARTED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
SUPPLIER_PRICING_SECURITY = PASS_STATIC
SUPPLIER_PRICING_DECIMAL_SAFETY = PASS
TARGETED_SUPPLIER_PRICING_TESTS = PASS
TARGETED_PURCHASE_RATE_OVERRIDE_TESTS = PASS_SOURCE_UNIT
TARGETED_CURRENT_RATE_TESTS = PASS_SOURCE_UNIT
TARGETED_BULLION_KARAT_TESTS = PASS_SOURCE
TARGETED_MAKING_CHARGE_TESTS = PASS
TARGETED_CERTIFICATE_VAT_TESTS = PASS
TARGETED_SUPPLIER_BAR_POS_TESTS = PASS_SOURCE_RUNTIME_CARD
TARGETED_ZERO_PRICE_TESTS = PASS_STATIC
TARGETED_SUPPLIER_RECEIVING_UX_TESTS = PASS_RUNTIME_READONLY
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
SUPPLIER_RECEIVING_RESPONSIVE_VISUAL_QA = PASS_DOM_NO_OVERFLOW
HANDOFF_SUPPLIER_GOLD_BAR_PRICING_UX_ACCURATE = NOT_UPDATED_GATE_BLOCKED
SUPPLIER_GOLD_BAR_ACQUISITION_CURRENT_PRICING_POS_UX_FIX_01_GATE = BLOCKED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = COMPLETE_DISPOSABLE_CLONE_E2E_THEN_LOCAL-PRODUCTION-SMOKE-01-RETRY
```
