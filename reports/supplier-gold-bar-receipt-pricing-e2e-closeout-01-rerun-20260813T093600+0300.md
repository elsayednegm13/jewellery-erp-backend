# SUPPLIER-GOLD-BAR-RECEIPT-PRICING-E2E-CLOSEOUT-01-RERUN

## 1. ماذا تم؟

أُعيد تشغيل إغلاق Supplier Gold على Clone مؤقت من Acceptance فقط بعد حل سبب
`FINANCIAL_MAPPING_REQUIRED`. اختار الـrunner فرع `MAIN` بعد فحص الجاهزية
المالية، ثم نفّذ مسار الاستلام والتسعير الحقيقي، وأسقط الـClone بعد انتهاء
الاختبارات.

الإصلاحان الضروريان اللذان ظهرَا أثناء الـrerun كانا محصورين في النطاق:

- إزالة TDZ في مسار `permissionService` داخل Supplier Receive حتى يعمل override
  المصرح به.
- جعل كل GoldPrice fixture في الـClone quote جديدًا صالحًا، مع supersede للـrows
  الحالية، حتى لا تحجب الأسعار التاريخية/المنتهية quote التنفيذ.

لم تُنشأ Migration 81، ولم تتغير `.env` أو قواعد Persistent/Acceptance source.

## 2. سبب الـrerun وحل الـmapping

السبب السابق كان اختيار أول فرع نشط C10 بدل الفرع المهيأ ماليًا. في هذا الـrerun
تم تقييم readiness لكل الفروع النشطة واختيار `MAIN` فقط إذا كان `READY`؛ لم يُستخدم
ترتيب أول فرع.

## 3. الحماية والفرع

- Clone source verified: `darfus_erp_inventory_rehearsal_20260804_160500z`.
- Clone name: `darfus_erp_supplier_gold_closeout_202608130635`.
- Clone-only mutations، مع `SELECT current_database()` قبل seed وقبل كل request
  mutation، وحارس يمنع الاسمين Persistent وAcceptance.
- Selected branch: `MAIN` / `BR-cf387f66-0904-471e-85b8-9346ac3dbb03`.
- Acceptance MAIN قبل الـclone: 11 active mappings، واحد لكل role مطلوب؛ C10
  بلا mappings.

## 4. Gold Bar 24K

تم إنشاء receipt حقيقي عبر `POST /purchase-orders/receive` لقطعة واحدة:
Asset واحد، Barcode واحد، وزن موجب، وKarat=24. Purchase rate الافتراضي المقروء
كان `480` من Gold Center، وCertificate cost=`100` وVAT rate=`7.25%`.

الـread-back أثبت:

- `certificate_cost=100`
- `vat_base=100`
- `vat_amount=7.25` في Purchase snapshot
- Current valuation منفصل عن Purchase snapshot

تم أيضًا اختبار Gold Bar بلا شهادة (`certificateCost=0`): receipt نجح،
certificate VAT بقي صفرًا، وcurrent rate المرسل بشكل متلاعب (`1`) لم يصبح سلطة؛
الـread-back بقي على Gold Center rate.

## 5. Purchase override والتجميد

الـSuper Admin نفّذ override إلى `450` مع سبب، ونجح receipt وسُجل Audit action
`supplier_purchase_rate.override`. مستخدم محدود حاول override غير مصرح به فحصل
على 4xx ولم يتغير عدد Assets.

بعد تحريك Gold Center من `480` إلى `520`:

- Purchase rate/value وCertificate acquisition ظلت ثابتة.
- Current valuation تحركت.
- Supplier Payable/PO history لم تُستبدل بالقيمة الحالية.

## 6. POS والسعر الصفري والحماية من التلاعب

- POS quote قبل الحركة نجح، وبعد الحركة زاد.
- إرسال `price=1` من العميل لم يغير quote canonical.
- عند جعل كل Approved GoldPrice منتهيًا، `/pricing/calculate` فشل مغلقًا ولم
  يعطِ سعرًا صفريًا.
- Gold Bar غير 24K (22K) رُفض خادميًا.

## 7. Matrices وMaking Charge

### Gold By Weight

Receipts حقيقية لـ`14/18/21/22/24K` كلها نجحت، مع rate لكل عيار وMaking Charge
محسوب على `grossWeight`.

### Gold By Piece

Receipts حقيقية لـ`14/18/21/22/24K` كلها نجحت. تم تمرير `purchaseCost` صريحًا
لكل قطعة، وبقي هو سلطة الاقتناء؛ الوزن/العيار لم يستبدلاه.

## 8. Payable / Accounting / Lineage

- PO.total موجب، paid=0، والـremaining يساوي total.
- Journal لكل receipt متوازن (Dr=Cr)، مع Inventory وSupplier Payable، وبدون Cash
  أو Bank movement عند paid=0.
- كل قطعة = Asset واحد = Barcode واحد؛ source=`supplier_purchase` مع PO وpurchase
  revision lineage.
- replay لنفس Gold Bar Idempotency-Key أعاد نفس Asset ولم ينشئ أثرًا مكررًا.
- CGP ظل غير قابل للوصول من Supplier Receive.

## 9. UX / العرض

اعتمدت الأدلة السابقة الخاصة بصفحة Supplier Receiving: 8/4 أو ما يعادلها،
ملخص مالي sticky، عرض acquisition/current منفصل، حقول رقمية LTR، RTL، وتوافق
desktop/tablet/mobile بدون overflow. اختبارات العقد والـTypeScript والـESLint
نجحت، ولم يحدث submit في Persistent.

## 10. قواعد البيانات والسلامة

### Persistent (قراءة فقط)

`darfus_erp`: migrations=80، Assets=62، Products=3، Cash GL=`5008829.8130`،
Bank GL=`199085.3241`، open sessions=1، unbalanced journals=0، orphan journal
lines=0، unlinked treasury=0، duplicate/blank barcodes=0.

### Acceptance source (قراءة فقط)

`darfus_erp_inventory_rehearsal_20260804_160500z`: migrations=80، Assets=475،
Products=3، unbalanced journals=0، orphan lines=0، unlinked treasury=0،
duplicate/blank barcodes=0. لم تُكتب أي صفوف فيه.

### Clone

تم إسقاط `darfus_erp_supplier_gold_closeout_202608130635`، والتحقق من عدم وجود
أي database بالبادئة `darfus_erp_supplier_gold_closeout_`.

## 11. Gold runtime / dispatcher / environment

- Provider=`GOLDAPI_IO`، mode=`LIVE_PROVIDER`، currency=`AED`، refresh=`1500`،
  stale=`2500`، enabled=true.
- `CGP_RUNTIME_DISPATCH_ENABLED=true`؛ Global Dispatcher effective state=OFF؛
  لم يحدث تعديل على dispatcher أو watermark.
- next-env بقي على inherited known drift SHA
  `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`، ولم
  يُشغّل Next dev.
- لا restart، لا migration، لا Git write، لا deploy.

## 12. الاختبارات

- Closeout clone rerun: PASS، مع 24K وGold By Weight وGold By Piece matrices.
- Focused Node tests: 13/13 PASS.
- `npx tsc --noEmit`: PASS.
- Focused ESLint (route + closeout runner): PASS.

## 13. Gate

```text
CURRENT_BATCH = SUPPLIER-GOLD-BAR-RECEIPT-PRICING-E2E-CLOSEOUT-01-RERUN
MODE = DISPOSABLE_CLONE_FULL_SUPPLIER_GOLD_E2E
RUNNER_BRANCH_SELECTION_MODE = DETERMINISTIC_FINANCIALLY_READY_BRANCH
FIRST_ACTIVE_BRANCH_SELECTION_USED = NO
PERSISTENT_DATABASE = darfus_erp
ACCEPTANCE_SOURCE = darfus_erp_inventory_rehearsal_20260804_160500z
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
CLONE_ONLY_MUTATION = YES
DISPOSABLE_CLONE_GUARD = PASS
FINANCIALLY_READY_BRANCH = MAIN
SELECTED_BRANCH_FINANCIAL_MAPPING_READINESS = PASS
FINANCIAL_MAPPING_FAIL_CLOSED_PRESERVED = PASS
CLONE_24K_BAR_RECEIPT_E2E = PASS
CLONE_24K_BAR_PURCHASE_RATE_DEFAULT = PASS
CLONE_24K_BAR_PURCHASE_OVERRIDE = PASS
PURCHASE_RATE_OVERRIDE_AUDIT = PASS
CLONE_UNAUTHORIZED_PURCHASE_OVERRIDE = PASS
CLONE_24K_BAR_HISTORICAL_FREEZE = PASS
CLONE_CURRENT_MARKET_REACTS = PASS
CLONE_POS_QUOTE_REACTS = PASS
CLONE_24K_BAR_POS_PRICE = PASS
CLONE_ZERO_PRICE_FAIL_CLOSED = PASS
CERTIFICATE_FINANCE_SCOPE = GOLD_BAR_24K_ONLY
CLONE_CERTIFICATE_VAT = PASS
PURCHASE_CERTIFICATE_TO_RETAIL_LEAK = NO
GOLD_BAR_CERTIFICATE_OPTIONAL = PASS
CLONE_MAKING_GROSS_WEIGHT = PASS
CLONE_GOLD_BY_WEIGHT_KARAT_MATRIX = PASS
CLONE_GOLD_BY_PIECE_KARAT_MATRIX = PASS
CLONE_BAR_NON_24K_REJECTION = PASS
CLONE_CURRENT_RATE_TAMPERING_GUARD = PASS
CLONE_POS_PRICE_TAMPERING_GUARD = PASS
SUPPLIER_SUMMARY_RUNTIME_PARITY = PASS
CLONE_SUPPLIER_PAYABLE_RUNTIME = PASS
CLONE_GOLD_BAR_ACCOUNTING = PASS
CLONE_ASSET_BARCODE_LINEAGE = PASS
CLONE_GOLD_BAR_IDEMPOTENCY = PASS
CGP_SUPPLIER_RECEIVE_REACHABLE = NO
CGP_SUPPLIER_ISOLATION_NONREGRESSION = PASS
EXISTING_GOLD_PROFILE_NONREGRESSION = PASS
NON_GOLD_POS_NONREGRESSION = PASS
RECEIVING_DESKTOP_SPACE_QA = PASS
RECEIVING_TABLET_VISUAL_QA = PASS
RECEIVING_MOBILE_VISUAL_QA = PASS
RECEIVING_DENSITY_REVIEW = PASS
ACQUISITION_CURRENT_SIDE_BY_SIDE = PASS
HISTORICAL_CURRENT_VISUAL_SEPARATION = PASS
CURRENT_RATE_READONLY_PRESENTATION = PASS
PURCHASE_RATE_UX = PASS
GOLD_BAR_KARAT_UI_LOCK = PASS
GENERAL_GOLD_KARAT_SELECTOR = PASS
GODODD24000001_PERSISTENT_READONLY_ACCEPTANCE = PASS
PERSISTENT_RECEIVING_READONLY_ACCEPTANCE = PASS
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
ACCEPTANCE_SOURCE_PRESERVED = PASS
DISPOSABLE_CLONE_DROPPED = PASS
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
CGP_RUNTIME_DISPATCH_ENV = true
GLOBAL_DISPATCHER_EFFECTIVE_STATE = OFF
CGP_DISPATCHER_MUTATED_THIS_BATCH = NO
MANUAL_RUNTIME_RESTART_THIS_BATCH = NO
NEXT_DEV_STARTED_OR_RESTARTED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
TARGETED_SUPPLIER_RECEIPT_TESTS = PASS
TARGETED_PURCHASE_RATE_OVERRIDE_TESTS = PASS
TARGETED_GOLD_CENTER_RATE_TESTS = PASS
TARGETED_BAR_24K_TESTS = PASS
TARGETED_GOLD_BY_WEIGHT_KARAT_TESTS = PASS
TARGETED_GOLD_BY_PIECE_KARAT_TESTS = PASS
TARGETED_MAKING_CHARGE_TESTS = PASS
TARGETED_CERTIFICATE_VAT_TESTS = PASS
TARGETED_SUPPLIER_POS_TESTS = PASS
TARGETED_ZERO_PRICE_TESTS = PASS
TARGETED_RECEIVING_UX_TESTS = PASS
TARGETED_BRANCH_SELECTION_TESTS = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
UNPLANNED_SCOPE_EXPANSION = NO
HANDOFF_SUPPLIER_GOLD_CLOSEOUT_RERUN_ACCURATE = YES
SUPPLIER_GOLD_BAR_RECEIPT_PRICING_E2E_CLOSEOUT_01_RERUN_GATE = PASS_CONFIRMED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = LOCAL-PRODUCTION-SMOKE-01-RETRY
```

