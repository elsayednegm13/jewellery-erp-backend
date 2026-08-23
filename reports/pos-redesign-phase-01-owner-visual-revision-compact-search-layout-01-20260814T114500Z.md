# POS Redesign Phase 01 — Owner Visual Revision: Compact Search Layout 01

## 1. لماذا تم رفض الشكل السابق

تم رفض نسخة Phase 1 السابقة بصرياً لأن شبكة بطاقات المنتجات كانت مفتوحة افتراضياً،
وتستهلك أغلب العمود الأوسط وتدفع «أصناف الفاتورة» أسفل الشاشة. هذه الجولة عالجت
الكثافة والترتيب فقط؛ لا تنسخ أرقام أو عملة أو VAT من الصورة المرجعية.

## 2. التعديل البصري الدقيق

- أخفيت شبكة المنتجات في حالة الخمول.
- أبقيت البحث الحالي كما هو، وأظهرت نتائجه المؤقتة كقائمة compact عند وجود query أو filter.
- جعلت «أصناف الفاتورة» القسم الرئيسي مباشرة بعد البحث.
- حولت خطوط الفاتورة إلى جدول كثيف مع تمرير داخلي bounded.
- أبقيت العميل يساراً، العملة/الدفع يميناً مع sticky على desktop، والوسط هو العمود المسيطر.
- بعد اختيار صنف تُفرّغ خانة البحث فتختفي النتائج المؤقتة.

## 3. الملفات

ملف Product الذي تغير في هذه الجولة:

- `app/[locale]/(dashboard)/pos/page.tsx`

تم إنشاء أدلة متصفح فقط تحت `backend/reports/`. لا توجد تغييرات Backend أو API أو
قواعد بيانات. ملفات الرسائل الموجودة في worktree موروثة من الجولة السابقة.

## 4–17. النطاق والسلوك

- **Product grid:** مخفي افتراضياً، مع الحفاظ على `products/assets` و`filtered` و`handleItemClick` و`handleAddProductToCart`.
- **Search:** `DataToolbar` الحالي فقط؛ لا ID search جديد، ولا endpoint، ولا debounce أو pagination.
- **Search results:** compact rows، تظهر فقط مع query/filter، ولا تبقى مفتوحة بعد اختيار الصنف.
- **Invoice Items:** جدول يستخدم البيانات المتاحة: رقم، منتج، barcode/code، وزن/عيار، كمية، سعر، إجمالي، حذف.
- **Internal scroll:** الحاوية بارتفاع أقصى 390px، بينما empty state بارتفاع صغير.
- **Customer:** نفس select والبيانات الحالية مع padding مدمج.
- **Payment:** نفس خيارات الدفع والمدخلات والحسابات والزر، مع `xl:sticky` وبدون تغيير handler.
- **Header/theme:** DARFUS الحالي؛ تم تقليل المساحات فقط، ولم يتم نسخ dark mockup حرفياً.
- **Business/API:** لا تغيير في التسعير أو VAT أو checkout أو الصلاحيات أو inventory أو accounting.
- **Handlers:** customer selection، search، add/remove، quantity، payment، totals، checkout بقيت كما هي.

## 18–23. إثبات المتصفح

تم استخدام runtime المحلي الموجود فقط، بدون تشغيل أو إعادة تشغيل Next.

- 1440×900: `innerWidth=1440`, `innerHeight=900`, `scrollHeight=900`, `scrollWidth=1440`؛ العميل والبحث وأصناف الفاتورة والدفع ظاهرة، ولا يوجد catalog طويل.
- 1280×800: `innerWidth=1280`, `innerHeight=800`, `scrollHeight=800`, `scrollWidth=1280`؛ لا clipping أو overlap.
- 768×800: `innerWidth=768`, `innerHeight=800`, `scrollHeight=1498`, `scrollWidth=760`؛ التكديس tablet آمن وبدون overflow أفقي، مع تمرير رأسي متوقع.
- Search proof: query `gold` عرض 18 نتيجة compact داخل المساحة، مع بقاء Invoice Items قريبة.
- Selection proof: اختيار `GODGOF24000006` أفرغ query، اختفى result row، وظهر جدول invoice بسطر واحد دون submit.
- Invoice-lines proof: أضيفت 3 وحدات محلياً في الواجهة فقط؛ ظهر جدول بوزن 15 جم، وكمية 3، وملخص الإجمالي، ولم تُرسل عملية بيع.
- Console: لا `error` أو `warn` في سجلات الصفحة.

## 24–25. التحقق الثابت

- `npx tsc --noEmit` = PASS.
- `npx eslint --no-ignore -- app/[locale]/(dashboard)/pos/page.tsx` = PASS، مع 3 تحذيرات hooks موروثة و0 أخطاء.
- focused POS tests = 7/7 PASS.
- لا endpoints جديدة، ولا provider calls إضافية ناتجة عن التعديل.

## 26–29. السلامة والبيانات

- `darfus_erp` تم فحصه بـSELECT فقط: migrations=80، Assets=62، Products=3، unbalanced journals=0، orphan journal lines=0، unlinked treasury=0، blank barcodes=0، duplicate barcode groups=0.
- canonical ledger read-only الحالي: Cash=5008829.813، Bank=199085.3241، mirror differences=0/0؛ لا يوجد write من هذه الجولة.
- Acceptance تم التحقق منه بـ`SELECT current_database()` على `darfus_erp_inventory_rehearsal_20260804_160500z`: migrations=80، Assets=475، Products=3، open journals=0.
- لا Migration 81، لا migration command، لا fixture، لا sale/checkout، ولا runtime/env change.
- `next-env.d.ts` ظل على SHA الموروث المعروف `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` ولم تتم معالجته.

## 30. الأدلة البصرية

- `backend/reports/pos-redesign-owner-visual-1440x900.png`
- `backend/reports/pos-redesign-owner-visual-1280x800.png`
- `backend/reports/pos-redesign-owner-visual-search-results-1440x900.png`
- `backend/reports/pos-redesign-owner-visual-invoice-lines-1440x900.png`
- `backend/reports/pos-redesign-owner-visual-768x800.png`
- `backend/reports/pos-redesign-owner-visual-1440x900-final.png`

## 31. أسئلة مراجعة المالك

1. هل اختفاء Grid المنتجات من الشاشة الافتراضية هو المطلوب؟
2. هل البحث في أعلى الوسط واضح؟
3. هل أصناف الفاتورة ظهرت مباشرة بدون Scroll طويل؟
4. هل الجدول بالحجم المناسب؟
5. هل العمود الأوسط واسع كفاية؟
6. هل العميل واخد مساحة مناسبة؟
7. هل الدفع واضح ومثبت؟
8. هل ارتفاع الشاشة مناسب؟
9. هل نبدأ بعدها Universal Search الحقيقي؟

## 32. Gate وNext Step

كل شروط هذه الجولة تحققت، والنتيجة جاهزة للمراجعة البصرية النهائية من المالك.
Phase 2 لا تبدأ تلقائياً.

```text
CURRENT_BATCH = POS-REDESIGN-PHASE-01-OWNER-VISUAL-REVISION-COMPACT-SEARCH-LAYOUT-01
MODE = OWNER_APPROVED_COMPACT_POS_VISUAL_REVISION
PREVIOUS_PHASE_OWNER_VISUAL_APPROVAL = REJECTED_FOR_REVISION
DEFAULT_PRODUCT_GRID_VISIBLE = NO
CURRENT_PRODUCT_DATA_FLOW_PRESERVED = YES
CENTER_PRIMARY_CONTENT = INVOICE_ITEMS
SEARCH_RESULTS_VISUAL_MODE = COMPACT_LIST
SEARCH_RESULTS_DEFAULT_EXPANDED = NO
INVOICE_ITEMS_ABOVE_FOLD = PASS
DESKTOP_BODY_SCROLL_DEPENDENCY = MINIMIZED
INVOICE_ITEMS_INTERNAL_SCROLL = PASS
DESKTOP_SINGLE_SCREEN_CORE_WORKFLOW = PASS
CUSTOMER_PANEL_COMPACT = PASS
PAYMENT_PANEL_COMPACT = PASS
CENTER_COLUMN_DOMINANT = PASS
POS_HEADER_COMPACT = PASS
EXCESS_LAYOUT_SPACE_REDUCED = PASS
SHOPPING_CART_TERMINOLOGY_VISIBLE = NO
MANUAL_FREE_ITEM_ENTRY_ADDED = NO
SEARCH_LOGIC_CHANGED_THIS_REVISION = NO
API_CONTRACT_CHANGED_THIS_REVISION = NO
BACKEND_FILES_CHANGED = 0
BUSINESS_LOGIC_CHANGED_THIS_REVISION = NO
POS_THEME = DARFUS_CURRENT_THEME
POS_RTL_NUMERIC_STANDARD = PASS
REAL_BROWSER_VISUAL_PROOF = PASS
EMPTY_INVOICE_STATE_COMPACT = PASS
INVOICE_LINES_VISUAL_DENSITY_PROOF = PASS
SEARCH_RESULT_COMPACT_VISUAL_PROOF = PASS
LONG_CATALOG_PAGE_BEHAVIOR = REMOVED
STICKY_SCROLL_INTERACTION = PASS
FUTURE_SEARCH_DROPDOWN_LAYOUT_READY = PASS
CURRENT_POS_HANDLER_WIRING_PRESERVED = PASS
NEW_API_ENDPOINTS_THIS_REVISION = 0
UNEXPECTED_DUPLICATE_REQUESTS = 0
GOLD_PROVIDER_CALL_ECONOMY_REGRESSION = NO
BROWSER_CONSOLE = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
FOCUSED_POS_TESTS = PASS
REVISION_FILE_SCOPE_MINIMAL = PASS
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO
RUNTIME_ENV_CHANGED = NO
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
NEXT_DEV_STARTED_OR_RESTARTED = NO
OWNER_VISUAL_EVIDENCE_SET = COMPLETE
OWNER_REVIEW_CHECKLIST = COMPLETE
POS_REDESIGN_PHASE_01_OWNER_VISUAL_REVISION_COMPACT_SEARCH_LAYOUT_01_GATE = PASS_OWNER_REVIEW_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = POS-REDESIGN-IMPLEMENTATION-PHASE-02-UNIVERSAL-SEARCH-AND-CUSTOMER_IF_OWNER_APPROVES
```
