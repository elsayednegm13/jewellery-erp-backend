# CGP-SETTLEMENT-PERMISSION-PERSISTENT-PROMOTION-01

## النتيجة

تم تنفيذ تفويض المالك المحدد كـ Persistent Security Metadata Promotion فقط على
`darfus_erp`. تمت إضافة `gold_purchase.cgp.settle` وإسنادها إلى دور `admin` فقط.
لم تُكتب أي بيانات أعمال، ولم تُنشأ Migration 81. إغلاق المتصفح ينتظر Logout/Login
جديد من المالك.

## التفويض والحماية

- Owner authorization: إضافة `gold_purchase.cgp.settle` إلى دور `admin` فقط.
- قاعدة البيانات المؤكدة قبل الكتابة: `darfus_erp`.
- baseline: migration `80` قبل وبعد.
- آلية bootstrap: `accessControl.ensurePermissions` ثم
  `RolePermission.findOrCreate` بإسناد scoped إلى role slug `admin`.
- النسخة الاحتياطية: `backend/backups/darfus_erp_development_2026-08-12T06-44-52-012Z.dump`.
- SHA-256: `76DA6CF57A5ADE59FE62C7654784D4CA7489FB04D4ED5505958861C21451DD43`.
- `pg_restore --list` نجح.

## الحالة قبل/بعد

قبل:

- `gold_purchase.cgp.settle`: ABSENT.
- إسناد admin: ABSENT.
- إسنادات أخرى للصلاحية: `0`.
- `gold_purchase.cgp.post`: PRESENT.

بعد:

- Permission row: `PERM-gold_purchase.cgp.settle`.
- Role assignment: `ROLE-...-admin` فقط.
- إسنادات أدوار أخرى: `0`.
- Direct user grants: `0`.
- التغيير الأمني الدقيق: `+1 permission` و`+1 role_permission`.
- إعادة تنفيذ العملية أعادت `created=false` ولم تُنشئ صفوفًا مكررة.

## بصمة بيانات الأعمال

البصمة قبل وبعد متطابقة أثناء هذه الدفعة:

`assets=53, products=3, customers=1, suppliers=1, cgp_documents=6,
cgp_items=10, cgp_dispositions=4, liabilities=0, settlements=0,
settlement_legs=0, invoices=13, journal_entries=67, journal_lines=176,
cash_transactions=50, customer_gold_pools=1, inventory_gold_pools=0,
gold_market_quotes=115`.

التصنيف: `NO_DELTA`.

## السلامة المالية والمخزون

- unbalanced journals: `0`
- orphan journal lines: `0`
- unlinked treasury: `0`
- duplicate barcodes: `0`
- blank barcodes: `0`
- migration 81: غير موجودة/لم تُنشأ.

## الاختبارات

- `cgp-settlement-http-ui-contract.test.cjs`: PASS.
- `customer-gold-cgp-ux-legacy-isolation.test.cjs`: PASS.
- `cgp-imp-11-contract.test.cjs`: PASS.
- `npx tsc --noEmit --pretty false`: PASS.
- Clone settlement E2E: Cash/Bank/Mixed/Partial/Full/Idempotency/Reversal/Integrity: PASS.
- Acceptance `verify-cgp-imp-11.js` بقي يرفض لأن Acceptance لا تحتوي صلاحية Settlement، وهو متوقع ولا يمثل فشلًا في Persistent promotion.
- Dynamic permission lookup للـadmin أعاد `settle=true` و`post=true` بعد الإضافة.

## الحدود المحفوظة

- Posting وSettlement صلاحيتان منفصلتان؛ route يتطلب `gold_purchase.cgp.settle` ومستندًا `POSTED`.
- لا تغيير في Settlement service/route/UI أو Accounting/Treasury/CGP lifecycle.
- Legacy Gold isolation وArabon وSupplier لم تتغير.
- Gold: `GOLDAPI_IO / LIVE_PROVIDER / 1500 / 2500` محفوظ.
- لم يتم تشغيل Next dev أو إعادة تشغيل أي process.
- لم يتم إصلاح `next-env.d.ts`; SHA الموروث بقي `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.

## المتصفح وhandoff

لم تتوفر جلسة Browser جديدة مع Owner credentials. لذلك يلزم:

`Logout -> Login` بحساب المالك، ثم التحقق من ظهور `تسجيل دفعة للعميل`.

لم تُنفذ settlement حقيقية على Persistent. الكتابة الاختبارية المسموحة تبقى Clone-only، وقد نجح clone E2E السابق وأُزيل الـclone.

تم تحديث `PROJECT_PROGRESS_HANDOFF.md` بدقة: Persistent security metadata promotion PASS، وSettlement browser closeout WAITING_OWNER_FRESH_LOGIN، بدون إغلاق زائف للبوابة.

## القرار

`CGP_SETTLEMENT_PERMISSION_PERSISTENT_PROMOTION_01_GATE = PASS_PROMOTED_WAITING_OWNER_FRESH_LOGIN`

الخطوة التالية: `OWNER_FRESH_LOGIN_THEN_SETTLEMENT_BROWSER_CLOSEOUT`.
