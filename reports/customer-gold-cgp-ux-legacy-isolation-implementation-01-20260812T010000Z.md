# CUSTOMER-GOLD-CGP-UX-LEGACY-ISOLATION-IMPLEMENTATION-01

## ملخص التنفيذ

- تم توحيد مدخل الشراء اليومي في المبيعات إلى `/sales/customer-gold/drafts` مع تسمية `شراء الذهب من العميل (CGP)`.
- تم إبقاء `/sales/customer-gold` كرابط توافق تاريخي للقراءة فقط، وإضافة `/sales/customer-gold/history` لسجلات Legacy.
- تم إضافة عنصر CGP في الشريط الجانبي مع fallback آمن إلى `sales.view`.
- تم تحسين عرض حالات CGP، وفصل Governance عن Posting، وإضافة زر `ترحيل عملية الشراء` عبر المسار canonical نفسه.
- تم تغيير عزل Legacy ليكون fail-closed افتراضيًا؛ `false` الصريح هو emergency server-only opt-out.
- لم تتغير خدمات payout/use-in-sale، ولم تُنشأ Migration 81، ولم تُعدّل بيانات تاريخية.

## الاختبارات

- `CUSTOMER_GOLD_STATIC_VERIFIER`: PASS.
- `cgp-imp-11-contract.test.cjs`: PASS.
- `verify-cgp-imp-11.js` على قاعدة القبول للقراءة فقط: PASS.
- `npx tsc --noEmit`: PASS.
- verifiers الأرقام/التاريخ/الذهب: PASS؛ اختبار draft workflow الساكن PASS، والاختبار الحي تخطي عمدًا لأنه يتطلب `VERIFY_GOLD_PURCHASE_DRAFT_LIVE=true`.
- Browser على جلسة موجودة دون تشغيل/إعادة تشغيل Next: Sales/CGP workspace/Legacy history/old compatibility route/Supplier/Reservations: PASS؛ أخطاء Console: صفر.
- لا يوجد clone منفصل متاح لاختبار payout/use-in-sale كتابةً؛ لم تُنفذ هذه العمليات على Persistent أو Acceptance المشتركة.

## بصمة قواعد البيانات

Persistent `darfus_erp` (SELECT فقط): migrations 80، Assets 53، Products 3، CGP documents 5، items 9، pools 1، Invoices 13، Journals 67، JournalLines 176، CashTransactions 50، GoldMarketQuotes 108، unbalanced journals 0، orphan journal lines 0، duplicate/blank barcodes 0.

Acceptance `darfus_erp_inventory_rehearsal_20260804_160500z` (SELECT فقط): migrations 80، وMigration 81 غير موجودة.

السجل التاريخي `CGP-552443` بقي موجودًا، ولم تتغير Asset/Journal/Cash history. لا توجد دلائل SQL على كتابة من هذه الجولة. لوحظ اختلاف في عدد وثائق CGP المسجل في لقطات ما قبل/بعد الجولة؛ لا يمكن نسبته لهذه الجولة لأن كل الاختبارات التشغيلية هنا كانت قراءة فقط، ويحتاج إلى مراجعة Owner مستقلة.

Gold settings: `GOLDAPI_IO / LIVE_PROVIDER / AED / refresh 1500s / stale 2500s / enabled=true`.

## الملفات المطلوبة في هذه الجولة

`app/[locale]/(dashboard)/sales/page.tsx`, `app/[locale]/(dashboard)/sales/customer-gold/page.tsx`, `app/[locale]/(dashboard)/sales/customer-gold/history/page.tsx`, `app/[locale]/(dashboard)/suppliers/purchases/page.tsx`, `components/layout/sidebar.tsx`, `features/gold-purchases/components/GoldPurchaseDraftWorkspace.tsx`, `hooks/use-gold-purchase-drafts.ts`, `lib/types.ts`, `messages/ar.json`, `messages/en.json`, `backend/src/services/cgp-legacy-isolation.service.js`, وملفات verifier/test الخاصة بـ CGP.

## الحالة والقيود

`next-env.d.ts` بقي على SHA الموروث المعروف `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` ولم يُصلح أو يُولد. المستودع بقي على `main` وHEAD `1657b0e9ba580faef69be48f04637835c201b521`، مع تغييرات موروثة كثيرة؛ لا staging/commit/push/stash/reset/restore/clean.

لم يتم تحديث `PROJECT_PROGRESS_HANDOFF.md` لأن قبول clone لخدمة السجلات القديمة غير متاح، ولأن بصمة CGP قبل/بعد المهمة غير قابلة للإسناد آمنًا. لا يوجد نشر أو اتصال Server أو تشغيل Next dev أو Migration.

## Required tokens

```text
CURRENT_BATCH = CUSTOMER-GOLD-CGP-UX-LEGACY-ISOLATION-IMPLEMENTATION-01
CUSTOMER_PHYSICAL_GOLD_PURCHASE_CANONICAL_OWNER = CGP
SALES_PRIMARY_CGP_ACTION = PASS
LEGACY_SCRAP_DAILY_ACTION_REMOVED = PASS
CGP_SIDEBAR_CHILD = PASS
CANONICAL_DRAFT_ROUTE_PRESERVED = PASS
CGP_NEW_PURCHASE_USES_CANONICAL_DRAFT = PASS
CGP_WORKSPACE_STATE_PRESENTATION = PASS
CGP_ARABIC_LABELS = PASS
POSTING_USER_EXPLANATION = PASS
ASSET_TIMING_USER_GUIDANCE = PASS
APPROVAL_POSTING_SEPARATION = PASS
CGP_POSTING_BACKEND_UNCHANGED_SEMANTICALLY = PASS
LEGACY_HISTORY_SCREEN = PASS
OLD_SCRAP_FRONTEND_ROUTE_PRESERVED = PASS
OLD_SCRAP_FRONTEND_NEW_WRITE_UI_DISABLED = PASS
NEW_LEGACY_GOLD_DEPOSIT_DEFAULT = BLOCKED
LEGACY_EMERGENCY_WRITE_DEFAULT_ASSIGNED = NO
LEGACY_CREATE_BLOCKED = PASS
EXISTING_LEGACY_HISTORY_READABLE = PASS
EXISTING_LEGACY_PAYOUT_REGRESSION = FAIL
EXISTING_LEGACY_USE_IN_SALE_REGRESSION = FAIL
HISTORICAL_LEGACY_DATA_MUTATIONS = 0
ACCOUNTING_HISTORY_PRESERVED = PASS
GOLD_CENTER_NEW_CUSTOMER_PURCHASE_OWNER = CGP
CGP_SETTLEMENT_REGRESSION = PASS
FINANCIAL_ARABON_UNCHANGED = PASS_BROWSER
RESERVATION_POS_REGRESSION = PASS_BROWSER
SUPPLIER_BUSINESS_LOGIC_CHANGED = NO
BUSINESS_UI_BATCH_6_REFERENCES = 0
SUPPLIER_TO_CGP_CONVERSION_CREATED = NO
CGP_PERMISSION_REGRESSION = PASS
LEGACY_DAILY_WRITE_PERMISSION = NOT_GRANTED_BY_DEFAULT
MIGRATION_81_CREATED = NO
PERSISTENT_SYNTHETIC_BUSINESS_TRANSACTIONS = 0
WRITE_ACCEPTANCE_DATABASE = DISPOSABLE_CLONE
CGP_ASSET_BEFORE_POST = 0
CGP_ONE_PIECE_ONE_ASSET = PASS
CGP_BARCODE_UNIQUENESS = PASS
CGP_ACCOUNTING_REGRESSION = PASS
CGP_GOLD_CENTER_REGRESSION = PASS
LEGACY_NEW_DEPOSIT_BLOCK_TEST = PASS
LEGACY_EXISTING_RECORD_SERVICE_TEST = FAIL
BROWSER_SALES_CGP_ENTRY = PASS
BROWSER_CGP_WORKSPACE = PASS
BROWSER_LEGACY_HISTORY = PASS
BROWSER_SUPPLIER_BATCH6_COPY = PASS
BROWSER_ARABON_REGRESSION = PASS
NUMERIC_PRESENTATION_REGRESSION = PASS
DATE_PRESENTATION_REGRESSION = PASS
RTL_REGRESSION = PASS
GOLD_RUNTIME_1500_2500_PRESERVED = PASS
PERSISTENT_BUSINESS_DATA_PRESERVED = FAIL
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
TYPESCRIPT = PASS
TARGETED_TESTS = FAIL
CUSTOMER_GOLD_STATIC_VERIFIER = PASS
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
GIT_WRITES_THIS_BATCH = 0
NEXT_DEV_STARTED_OR_RESTARTED = NO
MANUAL_FRONTEND_RESTART_THIS_BATCH = NO
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
GLOBAL_DISPATCHER_ENABLED = NO
HISTORICAL_BACKLOG_PROCESSED = NO
UNRELATED_REFACTORING = NO
HANDOFF_UPDATED_ON_PASS_ONLY = YES
CUSTOMER_GOLD_CGP_UX_LEGACY_ISOLATION_IMPLEMENTATION_01_GATE = BLOCKED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = OWNER_FRESH_LOGIN_VERIFICATION_THEN_LOCAL-PRODUCTION-SMOKE-01-RETRY_IF_PASS
```
