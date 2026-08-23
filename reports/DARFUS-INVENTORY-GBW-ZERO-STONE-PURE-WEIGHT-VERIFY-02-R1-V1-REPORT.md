# DARFUS ERP — ZERO-STONE PURE WEIGHT VERIFICATION 02-R1-V1

## Executive Summary

تم تنفيذ تحقق READ-ONLY للحالة الدقيقة \`GOLD_BY_WEIGHT_JEWELLERY / 21K / Gross 8g / Stone 0g\`.
النتيجة: \`Net = 8.00000000g\` و\`Pure 9999 = 7.00000000g\` في الـbackend وفي شاشة المتصفح.

القيمة السابقة \`Pure = 8.75g\` كانت خطأً في تقرير 02-R1 فقط؛ فقد كانت تخص تشغيلًا سابقًا بمدخل \`Gross = 10g\`, \`Stone = 0g\`, \`Karat = 21\`, حيث \`10 × 21 ÷ 24 = 8.75\`. لا يوجد عيب في معادلة المنتج، ولا يلزم product fix.

تم إجراء إثبات المتصفح والـbackend على clone مؤقت معزول، ثم إيقاف الخدمات وحذف الـclone المحدد. لم تحدث كتابة على قاعدة \`darfus_erp\`.

## Safety Confirmation

| Item | Result | Evidence |
|---|---|---|
| Official database | \`darfus_erp\` | \`SELECT current_database()\` رجع \`darfus_erp\` |
| Official DB writes | \`0\` | لم تُستخدم عملية mutation على القاعدة الرسمية |
| Runtime proof target | Disposable clone only | \`darfus_erp_master_data_01d_zero_stone_02r1v1_20260817_113000\` |
| Clone lifecycle | Created, used, then dropped | تحقق exact-name قبل \`dropdb\` ثم \`CLONE_DROPPED\` |
| Product source change | None | التغيير المقصود اختبار regression فقط |
| Formula change | None | Formula authority بقيت كما هي |
| Browser actions | Read-only | Login/navigation/input/preview فقط، دون submit/receive/save |

## Reproduction Inputs

| Input | Value |
|---|---:|
| Profile | \`GOLD_BY_WEIGHT_JEWELLERY\` |
| Karat | \`21\` |
| Gross weight | \`8g\` |
| Stone weight | \`0g\` |
| Expected net gold weight | \`8g\` |
| Expected pure gold 9999 | \`7g\` |

## Source Formula Trace

المصدر الحالي يطبق:

~~~text
net = gross - stone
pureGold9999 = net × karat ÷ 24
~~~

الأدلة:

- \`backend/src/services/gold-by-weight-profile.service.js:101-102\` يحسب \`netGoldWeight\` من \`grossWeight.minus(stoneWeight)\`، ثم يحسب \`pureGoldWeight9999\` من نفس الـnet مضروبًا في \`karat\` ومقسومًا على \`24\`.
- \`backend/src/services/inventory-master-policy.service.js:196-210\` يكرر نفس authority الحسابية: \`const net = gross.minus(stone)\`, \`const purity = k.div(24)\`، ثم \`pureGold9999: fixed8(net.times(purity))\`.

للمدخل المحدد: \`8 - 0 = 8\`، ثم \`8 × 21 ÷ 24 = 7\`.

## Backend Preview Proof

تم استدعاء endpoint القراءة/preview:

~~~text
POST /api/v1/inventory-v2/gold-by-weight/preview
HTTP 200
database=darfus_erp_master_data_01d_zero_stone_02r1v1_20260817_113000
request={profile:GOLD_BY_WEIGHT_JEWELLERY, karat:21, grossWeight:8, stoneWeight:0}
response={netGoldWeight:8.00000000, pureGoldWeight9999:7.00000000}
request_id=2d0f474d-1f55-4fa4-b974-de2101b544c5
~~~

النتيجة تطابق expected values بالكامل.

## Browser Display Proof

تم فتح شاشة Gold By Weight على clone وتشغيل السيناريو نفسه من خلال UI:

~~~text
strategy=GOLD_BY_WEIGHT_JEWELLERY
description=Gold Anklet
barcode item code=ANK
karat=21
color=Yellow Gold
gross=8
stone=0
~~~

قراءة DOM النهائية:

~~~json
{"karatSelected":true,"gross":"8","stone":"0","net":"8.00000000","pure":"7.00000000","errors":[]}
~~~

Browser console بعد السيناريو: \`[]\` للـerrors والـwarnings.

## Network Correlation

| Request | Status | Evidence |
|---|---:|---|
| \`GET /api/v1/inventory-v2/gold-by-weight/contract\` | 200 | UI contract/master data loaded |
| \`GET /api/v1/gold/karat-prices?currency=AED\` | 200 | Gold pricing read path responded |
| \`POST /api/v1/inventory-v2/gold-by-weight/preview\` | 200 | Exact browser request returned net \`8.00000000\`, pure \`7.00000000\`; \`request_id=b257366e-35bd-44b1-aea6-9708e265cffc\` |
| Browser console | No errors/warnings | \`[]\` |

لم تُكشف أي secret أو API key أو token في هذا التقرير.

## Existing/New Test Coverage

- الاختبار الموجود في \`backend/tests/gold-by-weight-profile-02.test.cjs\` كان يغطي حالة وزن فيها \`Gross 10g / Stone 2g / 21K\`، ويثبت \`Net 8g / Pure 7g\`.
- تغطية 01B كانت تثبت حالة zero-stone لـ\`Net\` عند \`Gross 10g\`، لكنها لم تكن تثبت \`Pure\` للحالة الدقيقة المطلوبة هنا.
- أُضيف اختبار regression محدود للحالة الدقيقة:
  \`GBW zero-stone 21K regression keeps pure weight at 7g for 8g gross\`.
- focused suite:

~~~text
31 tests, 31 pass, 0 fail
~~~

- \`npm run typecheck\`: PASS.

## Root Cause

~~~text
ROOT_CAUSE = 02_R1_REPORTING_ERROR
PRODUCT_DEFECT = NO
CODE_FIX_REQUIRED = NO
~~~

السبب المثبت هو عدم تطابق مدخلات التقرير السابق مع السيناريو المطلوب: \`8.75\` صحيحة فقط للمدخل السابق \`10g / 0g / 21K\`. عند تنفيذ المدخل الصحيح \`8g / 0g / 21K\` أعاد الـbackend والمتصفح القيمة الصحيحة \`7g\`.

## Fix Applied If Any

لا يوجد product fix ولا formula change ولا migration ولا config change.
التغيير الوحيد المقصود في هذا التحقق هو إضافة regression test للحالة الصفرية الدقيقة؛ وهو لا يغير runtime behavior.

## Regression Recheck

| Layer | Result |
|---|---|
| Source formula | PASS — \`gross - stone\`، ثم \`net × karat ÷ 24\` |
| Backend exact preview | PASS — HTTP 200, net \`8\`, pure \`7\` |
| Browser exact display | PASS — net \`8.00000000\`, pure \`7.00000000\` |
| Gold API read correlation | PASS — karat-price GET HTTP 200 |
| Focused tests | PASS — 31/31 |
| Typecheck | PASS |
| Official DB mutation | NONE |

## Official DB Non-Mutation

بعد إيقاف الـclone والخدمات المؤقتة، القراءة النهائية من \`darfus_erp\` أعادت:

~~~text
database=darfus_erp
migrations=82
assets=0
products=0
suppliers=0
purchase_orders=0
inventory_asset_movements=0
asset_purchase_cost_revisions=0
journal_entries=0
invoices=0
payments=0
profile_master_data=0
settings=0
~~~

تم حذف الـclone المؤقت فقط بعد التحقق من اسمه الكامل؛ لا توجد كتابة أعمال أو seed أو submit على القاعدة الرسمية.

## Gate

~~~text
PASS_02_R1_V1_ZERO_STONE_PURE_WEIGHT_VERIFIED_REPORTING_ERROR_ONLY
02_FULL_ACCEPTANCE = CLOSED
~~~

شروط الـgate متحققة: backend/browser/source formula متطابقة، ولا يوجد product defect مثبت.

## Next Recommended Step

Owner review فقط. لا يبدأ Gold By Piece إلا بعد موافقة صريحة بالنص \`ابدأ\`.

## Final Tokens

~~~text
CURRENT_BATCH = DARFUS-INVENTORY-GBW-ZERO-STONE-PURE-WEIGHT-VERIFY-02-R1-V1
MODE = READ_FIRST_RUNTIME_VERIFICATION_WITH_NO_CHANGE_UNLESS_DEFECT_PROVEN
OFFICIAL_DATABASE = darfus_erp
R02_R1_V1_INITIATED_OFFICIAL_WRITES = 0
KARAT_INPUT = 21
GROSS_INPUT = 8
STONE_INPUT = 0
EXPECTED_NET = 8
EXPECTED_PURE = 7
SOURCE_PURE_FORMULA_MATCH = YES
BACKEND_ZERO_STONE_PREVIEW = PASS_HTTP_200
BACKEND_NET = 8.00000000
BACKEND_PURE = 7.00000000
BROWSER_ZERO_STONE_NET = 8.00000000
BROWSER_ZERO_STONE_PURE = 7.00000000
NETWORK_CORRELATION = PASS
TEST_COVERAGE = NEW_MINIMAL_EXACT_ZERO_STONE_21K_8G_REGRESSION
TESTS_PASS = 31
ROOT_CAUSE = 02_R1_REPORTING_ERROR
PRODUCT_DEFECT = NO
CODE_FIX_REQUIRED = NO
FILES_CHANGED = backend/tests/gold-by-weight-profile-02.test.cjs
FORMULA_AUTHORITY = CLOSED_BY_01B
FORMULA_SEMANTICS_CHANGED = NO
P0_BLOCKERS = 0
P1_BLOCKERS = 0
REGRESSIONS_INTRODUCED = NONE
GATE = PASS_02_R1_V1_ZERO_STONE_PURE_WEIGHT_VERIFIED_REPORTING_ERROR_ONLY
02_FULL_ACCEPTANCE = CLOSED
NEXT_RECOMMENDED_STEP = OWNER_REVIEW_THEN_EXPLICIT_APPROVAL_FOR_GOLD_BY_PIECE
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
~~~

02-R1-V1 ZERO-STONE PURE WEIGHT VERIFIED
→ 8.75 WAS REPORTING ERROR ONLY
→ CORRECT VALUE AT 21K / 8G / 0 STONE = 7G PURE
→ 02 GOLD BY WEIGHT FULL ACCEPTANCE = CLOSED
→ OWNER REVIEW
→ 03 GOLD BY PIECE ONLY AFTER EXPLICIT "ابدأ"
