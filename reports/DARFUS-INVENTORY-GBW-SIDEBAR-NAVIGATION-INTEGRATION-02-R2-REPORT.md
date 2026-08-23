# DARFUS ERP — GOLD BY WEIGHT SIDEBAR NAVIGATION INTEGRATION 02-R2

## Executive Summary

تمت إضافة عنصر Gold By Weight إلى مجموعة Inventory الحالية فقط، مع الحفاظ على permission authority والـlocale routing والـactive state وسلوك collapse/expand.

النتيجة:

- العربية تعرض "ذهب بالوزن" وتفتح /ar/inventory/gold-by-weight.
- الإنجليزية تعرض "Gold By Weight" وتفتح /en/inventory/gold-by-weight.
- العنصر يظهر مرة واحدة داخل مجموعة Assets & inventory.
- العنصر يستخدم permission inventory.view الموجودة مسبقًا.
- active class ظهر على المسار الحالي.
- شاشة GBW حمّلت contract، الأقسام الثمانية، وGold Center.
- لا توجد أخطاء Console.
- لم يتغير Backend أو Database أو migrations أو permissions.

## Safety Confirmation

| Item | Result | Evidence |
|---|---|---|
| Official database | darfus_erp | القراءة النهائية رجعت darfus_erp |
| Official DB writes | 0 | لم تُجرَ أي كتابة على القاعدة الرسمية |
| Official migration state | 82 | القراءة النهائية من SequelizeMeta |
| Browser proof target | Disposable clone only | darfus_erp_master_data_01d_gbw_sidebar_02r2_20260817_123000 |
| Clone state | Created, used, dropped | تحقق exact-name قبل الإسقاط ثم CLONE_DROPPED |
| .env | Unchanged | environment overrides كانت للعملية المؤقتة فقط |
| Backend Product source | Unchanged | BACKEND_FILES_CHANGED = 0 |
| Migrations | None | MIGRATIONS_CREATED = 0 |
| Git cleanup | None | لم يستخدم reset/restore/clean/stash/commit |

الـworktree كان dirty قبل هذا الباتش بدرجة واسعة. القراءة الحالية تُظهر 85 tracked/staged status entries و232 untracked entries؛ لم يتم تنظيف أو تبنّي هذا drift. الملفات المقصودة لهذا الباتش موضحة في قسم Files Changed.

## Existing Navigation Structure

الـSidebar authority الحالي هو:

- components/layout/sidebar.tsx
- مجموعة assetsInventory
- عناصر المجموعة تستخدم href وtranslation label وicon وpermission وbranchBusiness.
- Link وusePathname يأتيان من @/i18n/navigation.
- فلترة الظهور تستخدم permissionMatches(item.permission, hasPermission).
- active state الحالي هو:
  pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href)).
- collapse/expand يظل مملوكًا لـSidebar الحالي، بلا نظام navigation parallel.

تمت إضافة عنصر واحد بعد Inventory مباشرة داخل نفس المجموعة.

## Files Changed

الملفات المقصودة في هذا الباتش:

- components/layout/sidebar.tsx
- messages/ar.json
- messages/en.json
- tests/gold-by-weight-sidebar-navigation-02-r2.test.cjs
- backend/reports/DARFUS-INVENTORY-GBW-SIDEBAR-NAVIGATION-INTEGRATION-02-R2-REPORT.md

لا توجد Backend production files متغيرة.

## Sidebar Entry Implementation

التنفيذ في components/layout/sidebar.tsx:20,57:

~~~text
icon = Scale
href = /inventory/gold-by-weight
label = goldByWeight
permission = inventory.view
branchBusiness = true
~~~

الـentry داخل مجموعة assetsInventory نفسها، لذلك:

- لا يوجد permission جديد.
- لا يوجد grant أو bypass.
- لا يوجد backend route.
- لا يوجد hardcoded /ar/.
- لا يوجد absolute URL.
- route helper الحالي يضيف locale كما يفعل باقي Sidebar.

تم التحقق static من وجود entry واحد فقط.

## Locale / Translation Proof

| Locale | Key | Value | Result |
|---|---|---|---|
| Arabic | Navigation.goldByWeight | ذهب بالوزن | PASS |
| English | Navigation.goldByWeight | Gold By Weight | PASS |

لم يتم استخدام internal strategy names في الواجهة.

## Permission Alignment

الـentry يستخدم بالضبط:

~~~text
permission = inventory.view
branchBusiness = true
~~~

الـvisibility يمر عبر نفس permissionMatches المستخدم لبقية المجموعة. لم تتم إضافة permission أو grant أو weakening، ولم يتم تغيير server authorization.

## Active State Proof

في العربية على:

~~~text
/ar/inventory/gold-by-weight
~~~

ظهر العنصر كـactive في DOM، واحتوى class على:

~~~text
bg-sidebar-active text-sidebar-active-foreground
~~~

في الإنجليزية على:

~~~text
/en/inventory/gold-by-weight
~~~

ظهر نفس active class. لم تتم إضافة active-state implementation جديدة؛ تم الحفاظ على convention الحالي.

## Browser Arabic Proof

تم استخدام runtime production مؤقت على http://localhost:3000 متصلًا بـdisposable clone، مع login حقيقي clone-only.

| Check | Result |
|---|---|
| Dashboard opened | PASS |
| Inventory group visible | PASS |
| ذهب بالوزن visible | PASS |
| Duplicate GBW entries | 0 |
| Click entry | PASS |
| Final URL | http://localhost:3000/ar/inventory/gold-by-weight |
| Active state | PASS |
| GBW screen loaded | PASS |

Backend correlation للعربية:

- POST /api/v1/auth/login → 200
- GET /api/v1/inventory-v2/gold-by-weight/contract → 200
- GET /api/v1/gold/karat-prices?currency=AED → 200

## Browser English Proof

تم تبديل locale من نفس authenticated browser session.

| Check | Result |
|---|---|
| English route | http://localhost:3000/en/inventory/gold-by-weight |
| Sidebar label | Gold By Weight |
| Locale-aware href | /en/inventory/gold-by-weight |
| Click/navigation | PASS |
| Active class | PASS |
| GBW screen loaded | PASS |

## Sidebar Collapse/Expand Proof

تم التحقق من السلوك الحالي دون تعديل layout logic:

- Expanded Arabic sidebar: العنصر ظاهر بالنص الكامل.
- Collapsed Arabic sidebar: زر تكبير القائمة ظهر، والـentry ظل رابطًا موجودًا بالـhref الصحيح، دون كسر layout.
- English expanded sidebar: العنصر ظاهر بالنص Gold By Weight.
- English collapsed sidebar: hasGoldLink = true.
- Expanded layout: scrollWidth = clientWidth = 1272.
- Collapsed layout: scrollWidth = clientWidth = 1272.
- Inventory group structure بقيت كما هي.
- لم يظهر horizontal overflow بسبب label.

## Console / Network Proof

Browser console بعد Arabic وEnglish navigation:

~~~text
errors = []
warnings = []
~~~

Network/backend correlation للطلبات المتعلقة بالتكامل:

| Request | Status | Result |
|---|---:|---|
| Login | 200 | PASS |
| Accessible companies | 304 | PASS |
| Branch/settings context | 304 | PASS |
| GBW contract | 200 | PASS |
| Gold karat prices | 200 | PASS |
| Browser route navigation | Successful | PASS |

الملاحظات غير الحاجزة:

- توجد 404 متكررة لأيقونة upload قديمة تحت /uploads/...png.
- توجد بعض dashboard requests aborted أثناء الانتقال بسبب تغير الصفحة/SSE lifecycle.
- لا يوجد أي failed navigation request أو failed GBW contract/gold request.
- هذه الملاحظات خارج نطاق Sidebar، ولم تنتج عن التعديل الحالي، وتصنيفها observability/static-asset follow-up غير حاجز.

## GBW Screen Smoke Check

تم إجراء smoke check محدود بعد فتح GBW من Sidebar، دون receive أو business mutation:

| Check | Result |
|---|---|
| Existing GBW route loaded | PASS |
| Contract loaded | PASS, HTTP 200 |
| Eight section headings rendered | PASS, count = 8 |
| Gold Center state | PASS, Gold Center ready |
| Provider/currency visible | PASS, GOLDAPI_IO · AED |
| No Product quantity authority message regression | PASS |
| No Console errors/warnings | PASS |
| No horizontal overflow | PASS |

لم تتم إعادة تشغيل Batch 02 accounting/runtime acceptance الكامل؛ لم تظهر حاجة لذلك.

## Regressions

لم تُكتشف regression مرتبطة بهذا الباتش.

| Area | Result |
|---|---|
| Backend behavior | Unchanged |
| Database | Unchanged |
| Permissions/RBAC | Preserved |
| Locale routing | Preserved |
| Existing Inventory entry | Preserved |
| Gold Center | Unchanged |
| Supplier/POS/Accounting | Untouched |
| Sidebar collapse/expand | Preserved |
| GBW route/screen | Loaded successfully |
| P0/P1 regressions | 0 |

## Gate

~~~text
PASS_02_R2_GBW_SIDEBAR_NAVIGATION_INTEGRATION_COMPLETE
~~~

شروط النجاح متحققة:

- GBW Sidebar entry visible.
- Arabic/English labels correct.
- Locale-aware routing correct.
- Click opens existing GBW route.
- Active state correct.
- Permission policy preserved.
- Collapse/expand preserved.
- No Console blocking error.
- No navigation regression.
- Backend files changed = 0.
- Official DB writes = 0.

## Next Recommended Step

Owner review فقط. لا يبدأ Gold By Piece إلا بعد موافقة صريحة بالنص "ابدأ".

## Final Tokens

~~~text
CURRENT_BATCH = DARFUS-INVENTORY-GBW-SIDEBAR-NAVIGATION-INTEGRATION-02-R2
MODE = MINIMUM_SAFE_FRONTEND_NAVIGATION_CHANGE_WITH_BROWSER_PROOF

GBW_ROUTE = /[locale]/inventory/gold-by-weight
GBW_NAVIGATION_ENTRY_IMPLEMENTED = YES
ARABIC_LABEL = ذهب بالوزن
ENGLISH_LABEL = Gold By Weight
LOCALE_AWARE_ROUTE = YES
ACTIVE_STATE = PASS
PERMISSION_POLICY_PRESERVED = YES_inventory.view
SIDEBAR_COLLAPSE_EXPAND_PRESERVED = YES

AR_BROWSER_PROOF = PASS_CLONE_RUNTIME
EN_BROWSER_PROOF = PASS_CLONE_RUNTIME
CONSOLE_ERRORS = 0
NETWORK_NAVIGATION_ERRORS = 0
GBW_SCREEN_SMOKE_CHECK = PASS_8_SECTIONS_CONTRACT_200_GOLD_AUTHORITY

FRONTEND_FILES_CHANGED = components/layout/sidebar.tsx; messages/ar.json; messages/en.json
BACKEND_FILES_CHANGED = 0
TEST_FILES_CHANGED = tests/gold-by-weight-sidebar-navigation-02-r2.test.cjs
MIGRATIONS_CREATED = 0
OFFICIAL_DB_WRITES = 0

P0_BLOCKERS = 0
P1_BLOCKERS = 0
REGRESSIONS_INTRODUCED = NONE

GATE = PASS_02_R2_GBW_SIDEBAR_NAVIGATION_INTEGRATION_COMPLETE
02_NAVIGATION_ACCEPTANCE = COMPLETE
NEXT_RECOMMENDED_STEP = OWNER_REVIEW_THEN_EXPLICIT_APPROVAL_FOR_GOLD_BY_PIECE
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
~~~

02-R2 GOLD BY WEIGHT SIDEBAR NAVIGATION COMPLETE
→ GBW IS NOW DISCOVERABLE FROM INVENTORY
→ OWNER REVIEW
→ 03 GOLD BY PIECE ONLY AFTER EXPLICIT "ابدأ"
