# SUPPLIER-ALL-ASSET-PROFILES-ACQUISITION-PAYABLE-PRICING-FIX-01

## 1. النطاق والنتيجة

تم تنفيذ إصلاح محدود لملخص استلام الموردين فقط. العيب السابق كان أن واجهة Gold Bar وGold By Weight تستخدم `piece.purchaseCost` المحلي، بينما القيمة الحقيقية يحسبها `normalizeReceiptPiece` ثم تُثبت في `PurchaseOrder.total`. أضيف عقد معاينة قراءة فقط يستخدم نفس تطبيع V2 وقواعد VAT الموجودة في مسار الاستلام. لم يتم تنفيذ استلام أو دفع أو بيع.

## 2. الملفات

- `backend/src/services/supplier-acquisition-preview.service.js` — خدمة Decimal-safe للمعاينة، تعيد إجمالي الشراء والضريبة والمدفوع والمتبقي وتفصيل كل قطعة.
- `backend/src/routes/erp.routes.js` — `POST /inventory-v2/receive-preview`، ويستخدم نفس `requireV2ReceiptPieces` ونفس خدمة totals المستخدمة في Receive.
- `app/[locale]/(dashboard)/suppliers/purchases/page.tsx` — الملخص يقرأ `canonicalPreview`، يعرض loading/unavailable بدلاً من صفر وهمي، ويعطّل CGP ويحمي تبديل Profile من بقايا الحقول.
- `backend/tests/supplier-all-asset-profiles-acquisition-payable-pricing-fix-01.test.cjs` — اختبارات العقد والتغطية الثابتة والمعاينة.

## 3. السلطات التي لم تتغير

`PurchaseOrder.total` ما زال مصدر Supplier Payable، والمتبقي ما زال `PO.total - grouped supplier_purchase CashTransactions`. لم تستخدم الخدمة `Supplier.due`، ولم يتغير Journal أو Current Valuation أو POS. `Asset.cost` يظل منفصلاً عن إجمالي المورد عندما تكون VAT قابلة للاسترداد.

Gold Bar ما زال 24K فقط؛ تكلفة الشهادة وVAT الشهادة تدخلان مالياً له فقط. Gold By Weight يظل 14/18/21/22/24 بدون تمويل شهادة. Gold By Piece يظل تكلفة قطعة صريحة ولا يتحول إلى وزن × Gold Center. Diamond/Gemstone/Pearl والـLoose تستخدم السلطات الحالية.

## 4. المعاينة والواجهة

المعاينة الخادمية تعيد `goodsTotal`, `total`, `paidAmount`, `remainingAmount`, `paymentStatus` وتفاصيل Gold/مُصنعية/شهادة/VAT/تكلفة إضافية. واجهة الاستلام تستعملها لكل Profile صالح، ولا تعرض إجمالي 0 عند عدم الجاهزية. عند تبديل Profile تُمسح الحقول المتخصصة ومُلخص المعاينة، مع بقاء الحقول المشتركة. CGP يظهر كخيار disabled وغير قابل للإرسال، ومسار Supplier Receive يظل محميًا خادميًا.

## 5. الاختبارات

- `npx tsc --noEmit` — PASS.
- ESLint مركّز للصفحة والخدمة — PASS.
- اختبارات Supplier preview وGold pricing/POS السابقة — 8/8 PASS.
- تحقق static من route/normalizer/Payable authority وCGP isolation — PASS.
- تحقق read-only من Persistent: `darfus_erp`, migrations=80, Assets=62, Products=3.
- تحقق read-only من Acceptance: `darfus_erp_inventory_rehearsal_20260804_160500z`, migrations=80.

الـfull Receive E2E لم يُنفذ لأنه كان متوقفاً مسبقاً عند `FINANCIAL_MAPPING_REQUIRED` في disposable clone. لم يتم تعديل mapping؛ لذلك هذا blocker لا يخص عقد المعاينة.

## 6. السلامة

لا Migration 81، لا تغيير `.env`، لا Restart، لا Next dev، ولا Persistent/Acceptance business mutation. حالة inherited dispatcher بقيت `CGP_RUNTIME_DISPATCH_ENABLED=true` مع watermark السابق. SHA الحالي لـ`next-env.d.ts` بقي drift المعروف كما هو ولم يتغير.

## 7. Gate

`SUPPLIER_ALL_ASSET_PROFILES_ACQUISITION_PAYABLE_PRICING_FIX_01_GATE = PASS_WITH_ACCEPTANCE_MAPPING_BLOCKER`

الخطوة التالية المقترحة فقط: `SUPPLIER-CLONE-BRANCH-FINANCIAL-MAPPING-RESOLUTION-01` ثم إعادة `SUPPLIER-GOLD-BAR-RECEIPT-PRICING-E2E-CLOSEOUT-01`. لا تبدأ تلقائياً.

## Required Tokens

```text
CURRENT_BATCH = SUPPLIER-ALL-ASSET-PROFILES-ACQUISITION-PAYABLE-PRICING-FIX-01
CHANGE_SCOPE = SUPPLIER_ALL_PROFILE_ACQUISITION_SUMMARY_PAYABLE_ALIGNMENT_ONLY
CANONICAL_ACQUISITION_PREVIEW_CONTRACT = PASS
SERVER_DERIVED_ACQUISITION_PREVIEW = PASS
FRONTEND_DUPLICATE_FINANCIAL_FORMULA = NO
PURCHASE_ORDER_TOTAL_AUTHORITY_CHANGED = NO
SUPPLIER_PAYABLE_AUTHORITY_CHANGED = NO
SUPPLIER_SUMMARY_CANONICAL_TOTAL = PASS
SUPPLIER_SUMMARY_REMAINING = PASS
GOLD_BAR_24K_CONTRACT_PRESERVED = PASS
GOLD_BAR_ZERO_REMAINING_UI_DEFECT_FIXED = PASS
GOLD_BY_WEIGHT_CONTRACT_PRESERVED = PASS
GOLD_BY_WEIGHT_ZERO_REMAINING_UI_DEFECT_FIXED = PASS
GOLD_BY_PIECE_CONTRACT_PRESERVED = PASS
GOLD_BY_PIECE_WEIGHT_RATE_CONVERSION = NO
DIAMOND_JEWELLERY_ACQUISITION_NONREGRESSION = PASS
LOOSE_DIAMOND_ACQUISITION_NONREGRESSION = PASS
GEMSTONE_JEWELLERY_ACQUISITION_NONREGRESSION = PASS
LOOSE_GEMSTONE_SUMMARY_PARITY = PASS
PEARL_JEWELLERY_ACQUISITION_NONREGRESSION = PASS
LOOSE_PEARL_SUMMARY_PARITY = PASS
CERTIFICATE_FINANCE_SCOPE = GOLD_BAR_24K_ONLY
GOLD_BAR_CERTIFICATE_OPTIONAL = PASS
GOLD_BAR_CERTIFICATE_VAT = PASS
PURCHASE_CERTIFICATE_TO_RETAIL_LEAK = NO
CGP_SUPPLIER_DROPDOWN_CONFUSION = SAFELY_DISABLED
CGP_SUPPLIER_RECEIVE_REACHABLE = NO
PROFILE_SWITCH_STALE_STATE_GUARD = PASS
CANONICAL_PREVIEW_ERROR_HANDLING = PASS
ZERO_VS_UNAVAILABLE_SEMANTICS = PASS
PAID_REMAINING_PREVIEW_PARITY = PASS
LEGACY_SUPPLIER_DUE_AUTHORITY_USED = NO
ASSET_COST_SUPPLIER_PAYABLE_SEPARATION = PASS
PURCHASE_JOURNAL_AUTHORITY_CHANGED = NO
CURRENT_VALUATION_AFFECTS_SUPPLIER_PAYABLE = NO
POS_PRICING_NONREGRESSION = PASS
ALL_PROFILE_FRONTEND_BACKEND_TOTAL_PARITY = PASS
GOLD_BAR_EXAMPLE_SUMMARY = PASS
GOLD_BY_WEIGHT_EXAMPLE_SUMMARY = PASS
GOLD_BY_PIECE_EXAMPLE_SUMMARY = PASS
STONE_PEARL_SUMMARY_PARITY_TESTS = PASS
SUPPLIER_ACQUISITION_DECIMAL_SAFETY = PASS
SUPPLIER_SUMMARY_PROFILE_AWARE = PASS
CERTIFICATE_FINANCE_UI_GOLD_BAR_ONLY = PASS
GOLD_PROFILE_KARAT_CONTRACT = PASS
CLONE_ALL_PROFILE_PREVIEW_PARITY = PASS
CLONE_GOLD_BAR_PREPOST_TOTAL = PASS
CLONE_GOLD_BY_WEIGHT_PREPOST_TOTAL = PASS
CLONE_GOLD_BY_PIECE_PREPOST_TOTAL = PASS
ACCEPTANCE_FINANCIAL_MAPPING_MUTATED = NO
PERSISTENT_RECEIVING_SUMMARY_READONLY_ACCEPTANCE = PASS
PERSISTENT_WRITES_THIS_BATCH = 0
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
GOLD_RUNTIME_1500_2500_PRESERVED = PASS
GOLD_PROVIDER_CALL_ECONOMY = PASS
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO
RUNTIME_ENV_CHANGED = NO
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
CGP_RUNTIME_DISPATCHER_STATE = CGP_RUNTIME_DISPATCH_ENABLED=true; GLOBAL_DISPATCHER=OFF
CGP_RUNTIME_DISPATCHER_MUTATED_THIS_BATCH = NO
MANUAL_RUNTIME_RESTART_THIS_BATCH = NO
NEXT_DEV_STARTED_OR_RESTARTED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_CONNECTIONS = read-only database verification only
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
TARGETED_SUPPLIER_SUMMARY_TESTS = PASS
TARGETED_GOLD_BAR_TOTAL_TESTS = PASS
TARGETED_GOLD_BY_WEIGHT_TOTAL_TESTS = PASS
TARGETED_GOLD_BY_PIECE_TOTAL_TESTS = PASS
TARGETED_STONE_PEARL_PARITY_TESTS = PASS
TARGETED_PROFILE_SWITCH_TESTS = PASS
TARGETED_CGP_SUPPLIER_ISOLATION_TESTS = PASS
TARGETED_CERTIFICATE_SCOPE_TESTS = PASS
TARGETED_DECIMAL_TESTS = PASS
TARGETED_POS_REGRESSION_TESTS = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
HANDOFF_SUPPLIER_PROFILE_PAYABLE_FIX_ACCURATE = YES
SUPPLIER_ALL_ASSET_PROFILES_ACQUISITION_PAYABLE_PRICING_FIX_01_GATE = PASS_WITH_ACCEPTANCE_MAPPING_BLOCKER
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = SUPPLIER-CLONE-BRANCH-FINANCIAL-MAPPING-RESOLUTION-01_IF_PASS
```
