# DARFUS ERP — Unified Inventory Intake UX Integration 02-R3

## Executive Summary

تم توحيد تجربة بدء استلام المخزون في مسار واحد للمستخدم مع الحفاظ على مسار Gold By Weight الحالي المقبول. أزيل مدخل Gold By Weight المخصص من الشريط اليومي، وأضيف زر واحد في شاشة Inventory، وchooser واحد بخمسة ملفات نهائية؛ Gold By Weight فقط متاح الآن، والملفات الأربعة الأخرى معطلة بوضوح بدون شاشات وهمية.

تمت إضافة shortcut من تفاصيل المورد إلى نفس الـchooser، مع تمرير `supplierId` كإشارة واجهة فقط. شاشة GBW لا تقبل الإشارة إلا إذا ظهر المورد في عقد الموردين الذي أعاده الخادم وبحالة غير inactive. لم يتغير backend أو قاعدة البيانات أو migrations أو المحاسبة أو عقد الاستلام.

## Safety Confirmation

- الوضع: frontend-only UX consolidation.
- `BACKEND_FILES_CHANGED = 0` لهذا batch.
- `MIGRATIONS_CREATED = 0` و`MIGRATIONS_EXECUTED = 0`.
- لم تُنفذ عمليات استلام أو بيع أو تعديل مخزون أو accounting.
- إثبات المتصفح استخدم disposable clone فقط، ثم أوقف التشغيل وحذف الـclone والـdump بعد التحقق من الاسم الدقيق.
- القاعدة الرسمية `darfus_erp` لم تُكتب؛ فحص read-only النهائي أظهر نفس حالة ما بعد reset: لا suppliers/assets/products/purchase orders/journals، مع بقاء company واحدة وgold market setting واحدة.
- لم يحدث cleanup أو reset أو restore أو stash أو commit أو push.

## Existing UX / Duplicate Entry Review

المصدر الحالي كان يعرض Inventory وSuppliers في الشريط، بينما كانت شاشة GBW مستقلة بمسار locale-aware. لم يُنشأ نموذج GBW ثانٍ. أصبح chooser الجديد نقطة الاختيار الوحيدة، ويشير إلى الشاشة الحالية نفسها.

لا يوجد مدخل يومي مستقل لـPurchase Order أو Receive في الشريط الحالي. لذلك القرار هو إبقاء المسارات الحالية والـbackend محفوظة دون إضافة navigation موازٍ في هذا batch.

## Backend Authority Preservation

لم يتغير أي من التالي:

- Supplier V2 / `POST /purchase-orders/receive`.
- `Asset` كسلطة القطعة الفيزيائية.
- Barcode وmovement وaccounting وidempotency.
- صلاحيات backend أو company/branch scope.
- قاعدة البيانات أو schema.

المسار الموجود في GBW ما زال يرسل `inventoryV2: true` و`perPiece` إلى عقد الاستلام القانوني. هذا batch لا ينفذ POST.

## Sidebar Decision

تم حذف عنصر `/inventory/gold-by-weight` المخصص من `components/layout/sidebar.tsx`. بقي رابط `/inventory` مع permission `inventory.view`، وبقي المسار المباشر `/inventory/gold-by-weight` موجودًا ومبنيًا في production.

## Purchase Order / Receive Navigation Decision

`PURCHASE_ORDER_NAVIGATION_DISPOSITION = NOT_EXPOSED_DAILY_NAVIGATION_PRESERVED_ROUTES`

`RECEIVE_NAVIGATION_DISPOSITION = NOT_EXPOSED_DAILY_NAVIGATION_PRESERVED_ROUTES`

لم تُحذف أو تُعدّل routes/services الخاصة بالشراء والاستلام، ولم يُنشأ shortcut بديل لها. نقطة بدء المستخدم الجديدة هي Inventory header action والـsupplier shortcut فقط.

## Inventory Header Action

في `app/[locale]/(dashboard)/inventory/page.tsx` أضيف زر permission-aligned:

- العربية: `إضافة / استلام مخزون`.
- English: `Add / Receive Inventory`.
- يظهر عند `inventory.view`.
- يفتح `InventoryIntakeChooser` دون تغيير أي business operation.
- يدعم `openIntake=1` عند فتح Inventory من shortcut المورد.

## Profile Chooser

المكوّن الجديد هو `components/inventory/inventory-intake-chooser.tsx`، ويعرض بالضبط:

| Profile | State | Destination |
|---|---|---|
| Gold By Weight | Available now / متاح الآن | `/inventory/gold-by-weight` |
| Gold By Piece | Coming next / قريبًا | Disabled |
| Diamond | Coming next / قريبًا | Disabled |
| Gem Stone | Coming next / قريبًا | Disabled |
| Pearl | Coming next / قريبًا | Disabled |

لا توجد روابط أو شاشات وهمية للملفات غير الجاهزة.

## Supplier Master Preservation

لم يتغير supplier master أو supplier create/edit/delete أو supplier route. تمت إضافة shortcut عرضي فقط في صفحة تفاصيل المورد، gated بـ`suppliers.view`.

## Supplier Shortcut

في `app/[locale]/(dashboard)/suppliers/[id]/page.tsx`:

- العربية: `استلام مخزون من هذا المورد`.
- English: `Receive Inventory From Supplier`.
- destination: `/inventory?openIntake=1&supplierId=<encoded supplier id>`.
- يفتح نفس chooser، ثم يمرر hint إلى نفس GBW form.

## Supplier Preselection Security

في `app/[locale]/(dashboard)/inventory/gold-by-weight/page.tsx` تتم قراءة `supplierId` من query كـUI hint فقط. بعد تحميل `/inventory-v2/gold-by-weight/contract`، تتم المطابقة على `contract.suppliers` وبنفس `id` مع رفض المورد inactive. إذا لم توجد مطابقة، لا يتم preselect ولا يتم توسيع صلاحية الوصول.

## GBW Single Workflow Proof

- Browser Arabic: Inventory action → chooser → Gold By Weight → `/ar/inventory/gold-by-weight`.
- GBW loaded its existing contract and rendered the existing eight section headings.
- Supplier Arabic: supplier detail → shortcut → `/ar/inventory?openIntake=1&supplierId=SUP-R3-UX-20260817` → chooser → `/ar/inventory/gold-by-weight?supplierId=SUP-R3-UX-20260817`; contract-backed supplier was selected.
- Direct route: `/ar/inventory/gold-by-weight` without query opened the same form with the supplier select at the empty option (`value=""`, `selectedIndex === 0`).
- No receive, sale, movement, journal, payable, barcode, or asset was created.

## Locale / Translation

Arabic and English labels are local to the reusable chooser, avoiding an obsolete dedicated sidebar translation key. The old `Navigation.goldByWeight` key was removed because the dedicated navigation entry was removed; the GBW product label remains in the chooser and profile UI.

## Permission Alignment

- Inventory header action: `inventory.view`.
- Supplier shortcut: `suppliers.view`.
- Existing GBW page and backend permissions remain unchanged.
- No permission fallback or permission broadening was introduced.

## Files Changed

Intentional 02-R3 paths:

- `components/inventory/inventory-intake-chooser.tsx` — new reusable chooser.
- `components/layout/sidebar.tsx` — remove dedicated GBW daily item.
- `app/[locale]/(dashboard)/inventory/page.tsx` — header action, query-opened chooser.
- `app/[locale]/(dashboard)/suppliers/[id]/page.tsx` — supplier shortcut.
- `app/[locale]/(dashboard)/inventory/gold-by-weight/page.tsx` — safe supplier hint handling.
- `messages/ar.json` and `messages/en.json` — remove obsolete dedicated navigation key.
- `tests/unified-inventory-intake-ux-02-r3.test.cjs` — focused R3 contract test.
- `tests/gold-by-weight-sidebar-navigation-02-r2.test.cjs` — superseded R2 expectation aligned to the R3 decision.
- This report.

The worktree contained broad pre-existing changes from earlier batches; they were preserved. No unrelated worktree cleanup was performed.

## Focused Tests

Command:

`node --test tests/unified-inventory-intake-ux-02-r3.test.cjs tests/gold-by-weight-sidebar-navigation-02-r2.test.cjs`

Result: **7 passed, 0 failed**.

Coverage includes dedicated sidebar removal, direct route preservation, exact five chooser profiles, one enabled profile, supplier shortcut query wiring, permission checks, server-contract-backed supplier hint logic, V2/perPiece presence, and localized labels.

## Type / Static Checks

- `npm run typecheck`: passed.
- `npm run build` with disposable clone API: passed.
- `npm run build` restored with normal API `http://localhost:8000/api/v1`: passed.
- `git diff --check`: no whitespace errors; existing LF/CRLF warnings only.
- No backend source, migration, config, or official `.env` mutation.

## Arabic Browser Proof

On a production `next start` frontend backed by the disposable clone:

- Dashboard sidebar had Inventory but no dedicated GBW link.
- Inventory displayed `إضافة / استلام مخزون`.
- Chooser showed exactly five cards: `ذهب بالوزن`, `ذهب بالقطعة`, `ألماس`, `أحجار كريمة`, `لؤلؤ`.
- Only Gold By Weight was enabled; four future cards were disabled.
- Existing GBW page loaded and showed 8 level-2 workflow sections.

## Supplier Browser Proof

The isolated clone contained one disposable-only supplier fixture. The Arabic details page showed `استلام مخزون من هذا المورد`. Clicking it opened the same chooser with the encoded supplier query, and selecting Gold By Weight opened the same form with the supplier selected only after the contract returned that supplier.

## English Browser Proof

- `/en/inventory` displayed `Add / Receive Inventory`.
- The chooser displayed `Gold By Weight`, `Gold By Piece`, `Diamond`, `Gem Stone`, `Pearl`.
- Status labels were `Available now` and `Coming next`.
- `/en/suppliers/<id>` displayed `Receive Inventory From Supplier`.

## Direct Route Regression

`/ar/inventory/gold-by-weight` without `supplierId` remained reachable directly. The supplier `<select>` value was empty and its first empty option was selected. The form loaded the existing GBW contract normally.

## Console / Network Proof

- Browser console errors/warnings for the exercised R3 paths: `0`.
- Relevant backend GET paths returned successful/304 responses, including suppliers, branches, settings, assets, inventory-v2 profiles, and `inventory-v2/gold-by-weight/contract`.
- No failed R3 navigation request occurred.
- Observed non-R3 noise: an existing upload image returned 404; aborted asset/approval/reservation requests and SSE disconnects occurred during route transitions/unload. They did not block R3 navigation and are recorded as pre-existing/non-blocking observability items.

## Regressions

No R3 regression was observed. The previous R2 focused test initially failed because it asserted the entry that R3 intentionally removes; it was updated to assert the new accepted decision and then passed.

## Deferred Future Profiles

- Gold By Piece: disabled until Batch 03.
- Diamond: disabled until Batch 04.
- Gem Stone: disabled until Batch 05.
- Pearl: disabled until Batch 06.

No field set, dynamic grid, profile screen, backend workflow, or master-data provisioning for these profiles was added.

## Gate

`GATE = PASS_02_R3_UNIFIED_INVENTORY_INTAKE_UX_COMPLETE`

The gate is supported by passing focused tests, successful production build, Arabic/Supplier/English browser proof, direct-route regression, zero browser console errors on exercised paths, preserved backend authorities, and zero official DB writes.

## Next Recommended Step

Owner review only. After explicit approval, the next batch may address Gold By Piece. Do not start it automatically.

## Final Tokens

```text
CURRENT_BATCH = DARFUS-INVENTORY-UNIFIED-INTAKE-UX-INTEGRATION-02-R3
MODE = READ_FIRST_MINIMUM_SAFE_FRONTEND_UX_REROUTING_WITH_BROWSER_PROOF

ONE_USER_INTAKE_WORKFLOW = YES
MULTIPLE_SAFE_ENTRY_POINTS = YES

GBW_SIDEBAR_ENTRY_REMOVED = YES
GBW_DIRECT_ROUTE_PRESERVED = YES
INVENTORY_ADD_RECEIVE_ACTION = PASS
FINAL_PROFILE_CHOOSER = PASS
FINAL_PROFILE_COUNT = 5

GBW_CHOOSER_ENABLED = YES
GOLD_BY_PIECE_CHOOSER_ENABLED = NO_UNTIL_BATCH_03
DIAMOND_CHOOSER_ENABLED = NO_UNTIL_BATCH_04
GEM_STONE_CHOOSER_ENABLED = NO_UNTIL_BATCH_05
PEARL_CHOOSER_ENABLED = NO_UNTIL_BATCH_06

SUPPLIER_MASTER_PRESERVED = YES
SUPPLIER_RECEIVE_SHORTCUT = PASS
SUPPLIER_SHORTCUT_SAME_WORKFLOW = PASS
SUPPLIER_PRESELECTION_SERVER_VALIDATED = PASS

GBW_SINGLE_FORM_AUTHORITY = EXISTING_ACCEPTED_SCREEN
GBW_FORM_IMPLEMENTATION_COUNT = 1

PURCHASE_ORDER_BACKEND_PRESERVED = YES
RECEIVE_BACKEND_PRESERVED = YES
ASSET_AUTHORITY_PRESERVED = YES
BARCODE_AUTHORITY_PRESERVED = YES
MOVEMENT_AUTHORITY_PRESERVED = YES
ACCOUNTING_AUTHORITY_PRESERVED = YES
IDEMPOTENCY_PRESERVED = YES

PURCHASE_ORDER_NAVIGATION_DISPOSITION = NOT_EXPOSED_DAILY_NAVIGATION_PRESERVED_ROUTES
RECEIVE_NAVIGATION_DISPOSITION = NOT_EXPOSED_DAILY_NAVIGATION_PRESERVED_ROUTES

AR_BROWSER_PROOF = PASS
SUPPLIER_BROWSER_PROOF = PASS
EN_BROWSER_PROOF = PASS
GBW_DIRECT_ROUTE_REGRESSION = PASS
CONSOLE_ERRORS = 0
NAVIGATION_NETWORK_ERRORS = 0

FRONTEND_FILES_CHANGED = 7
BACKEND_FILES_CHANGED = 0
TEST_FILES_CHANGED = 2
MIGRATIONS_CREATED = 0
MIGRATIONS_EXECUTED = 0
OFFICIAL_DB_WRITES = 0

BUSINESS_LOGIC_CHANGED = NO
ACCOUNTING_LOGIC_CHANGED = NO
DB_SCHEMA_CHANGED = NO
PERMISSIONS_WEAKENED = NO

P0_BLOCKERS = 0
P1_BLOCKERS = 0
REGRESSIONS_INTRODUCED = NONE

GATE = PASS_02_R3_UNIFIED_INVENTORY_INTAKE_UX_COMPLETE
02_R3_ACCEPTANCE = COMPLETE
NEXT_RECOMMENDED_STEP = OWNER_REVIEW_THEN_EXPLICIT_APPROVAL_FOR_GOLD_BY_PIECE
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
```

02-R3 UNIFIED INVENTORY INTAKE UX COMPLETE
→ ONE USER WORKFLOW ESTABLISHED
→ GBW REMAINS THE SINGLE ACCEPTED FORM
→ SUPPLIER SHORTCUT REUSES THE SAME FLOW
→ BACKEND / DB / ACCOUNTING AUTHORITIES PRESERVED
→ OWNER REVIEW
→ 03 GOLD BY PIECE ONLY AFTER EXPLICIT "ابدأ"
