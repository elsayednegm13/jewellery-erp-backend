# PROD-PROMOTION-01 — تقرير ترقية قاعدة البيانات الدائمة المحلية

## النتيجة

تمت ترقية `darfus_erp` من 61 إلى 77 migration عبر التسلسل المصرح به فقط. لم تُنسخ أي بيانات قبول ولم تُنشأ أي بيانات أعمال تجريبية. بقيت بصمات بيانات الأعمال السابقة مطابقة قبل/بعد.

## الحماية والنسخ الاحتياطي

- تفويض `PROD-PROMOTION-00` كان موجوداً ومطابقاً لـ `darfus_erp` و`61 -> 77` و`EXACT_TESTED_62_TO_77_SEQUENCE_ONLY`.
- النسخة قبل البروفة: `backend/backups/darfus_erp_pre_prod_promotion_61_to_77_20260810t100011z.dump`؛ الحجم `638727` بايت؛ SHA-256 `1483ACE518989BEEEB1F3730DE5DA17FCE2E50667C488D58F92975FF9ED3AF15`؛ `pg_restore --list` نجح (1013 بنداً).
- النسخة النهائية قبل التطبيق: `backend/backups/darfus_erp_final_pre_prod_promotion_61_to_77_20260810t100411z.dump`؛ الحجم `638727` بايت؛ SHA-256 `C1A947BB6F61313AE791284FFA87ECA110B03FB77D3AD9C8AA58EEE3745CADB4`؛ قابلة للقراءة.
- لم يوجد active business write قبل النسخ أو قبل التطبيق. لم يحدث restore تلقائي.

## التسلسل المطبق والتصنيف

| Migration | التصنيف | الملاحظة |
|---|---|---|
| 20260809010000-cgp-aggregate-lifecycle-pricing-foundation.js | DETERMINISTIC_BACKFILL + SCHEMA_ADDITIVE | يضيف حالتي أعمال/حوكمة ويحوّل فقط الحالات legacy المعروفة؛ حوّل الوثيقتين الموجودتين وفق mapping حتمي. |
| 20260809020000-create-cgp-pricing-snapshots.js | SCHEMA_ADDITIVE | جدول snapshots وقيود وفهارس. |
| 20260809030000-create-durable-event-infrastructure.js | SCHEMA_ADDITIVE | outbox/inbox idempotency structures. |
| 20260809040000-create-integration-statuses.js | SCHEMA_ADDITIVE | حالة تكامل مستقلة. |
| 20260809050000-add-cgp-future-capabilities.js | SYSTEM_CONFIGURATION | permission definitions idempotent only. |
| 20260809060000-cgp-canonical-posting-facts.js | SCHEMA_ADDITIVE | حقائق posting وunique constraint. |
| 20260809070000-gold-center-approved-price-authority.js | SCHEMA_ADDITIVE + SYSTEM_CONFIGURATION | approval columns/constraints وpermission definition؛ لا سعر أعمال مزروع. |
| 20260809080000-cgp-inventory-pending-integration-origin.js | SCHEMA_ADDITIVE | state/origin constraints وunique CGP lineage، بعد فحص duplicate مسبق. |
| 20260809090000-customer-creditor-account-foundation.js | SYSTEM_CONFIGURATION | حساب `2500` وmapping `CUSTOMER_CREDITOR` الحتميان؛ لا Journal أو liability أو payment. |
| 20260809100000-cgp-accounting-recognition-and-customer-financial-liabilities.js | SCHEMA_ADDITIVE | جدول liability وفهرس مصدر Journal. |
| 20260809110000-create-gold-core-events.js | SCHEMA_ADDITIVE | Gold core event structure. |
| 20260809120000-create-customer-crm-projections.js | SCHEMA_ADDITIVE | CRM read projections. |
| 20260809130000-create-financial-approval-policy-foundation.js | SCHEMA_ADDITIVE | policy/evidence structures فقط. |
| 20260809140000-create-financial-settlement-foundation.js | SCHEMA_ADDITIVE | settlement structures فقط. |
| 20260809150000-create-cgp-reversal-hold-foundation.js | SCHEMA_ADDITIVE | reversal-hold evidence/state support فقط. |
| 20260809160000-cgp-reversal-compensation-finalization.js | SCHEMA_ADDITIVE | compensation evidence/constraints فقط. |

نتيجة فحص fixtures: `0`. نتيجة فحص delete/truncate/destructive migration: `0`. لا migration يعتمد على Acceptance fixture.

## بروفة الاستعادة

- قاعدة البروفة: `darfus_erp_prod_promotion_rehearsal_20260810t100100z`، أُنشئت من النسخة الجديدة فقط، وليس من Acceptance.
- قبل التطبيق: migrations=61، Assets=52، Products=3، Customers=1، CGP=2، Journals=60، JournalLines=156، Treasury=44؛ وكل integrity counters = 0.
- بعد التطبيق: migrations=77، مع ثبات Assets/Products/Customers/CGP/Journals/JournalLines/Treasury. الجداول الجديدة `outbox/integration/gold/CRM/reversal/liability/settlement` فارغة.
- `INVENTORY_ASSET` و`ACCOUNTS_RECEIVABLE` و`CUSTOMER_CREDITOR -> 2500` حُلت بنجاح. لا dispatcher عام؛ لا backlog عولج.
- أُسقطت قاعدة البروفة المحددة بعد إغلاق اتصالاتها؛ لا توجد بعد التنظيف.

## الدائمة بعد التطبيق

- migrations=77، Assets=52، Products=3، Customers=1، CGP=2، Journals=60، JournalLines=156، Treasury=44، open cash sessions=1.
- بصمات Assets/Customers/Invoices/Journals/JournalLines/Treasury/Asset origins مطابقة تماماً مع ما قبل الترقية.
- unbalanced Journals=0، orphan JournalLines=0، unlinked Treasury=0، duplicate/blank barcode=0، orphan origins=0، orphan integration=0.
- لم يُنشأ CGP أو Asset أو Barcode أو Journal أو settlement أو Gold event أو CRM projection جديد. لم تُنسخ `CGPD-000071` أو `CGPD-000083`.
- Acceptance بقيت read-only عند migrations=77.

## الجاهزية المتبقية

البنية والـpermissions والـaccount authorities جاهزة. لا توجد حالياً أي `gold_prices` معتمدة في الدائمة؛ لذلك `PERSISTENT_CGP_GOLD_AUTHORITY_READY = BLOCKED_BY_MISSING_BUSINESS_CONFIG`. لم تُخترع قيمة سعر أو إعداد أعمال. هذا لا يغيّر سلامة ترقية schema، لكنه يمنع تشغيل CGP الاقتصادي إلى أن يضع المالك/المخول إعداد سعر معتمد في دفعة مستقلة.

## أدوات الحماية والفحوص

- أضيف `backend/scripts/persistent-promotion-migration-guard.js` و`backend/scripts/persistent-promotion-migrate.js`: يفرضان الاسم الفعلي، baseline 61، قائمة الـ16 بالترتيب، وغياب active business writes من الاتصال ذاته؛ لا يوجد raw all-pending migration path.
- `npx tsc --noEmit = PASS` و`git diff --check = PASS` (تحذيرات CRLF تخص تغييرات موروثة فقط).
- `next-env.d.ts` بقي SHA-256 `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` دون تعديل.
- لا اتصال أو تعديل أو نشر للخادم.

## انتهاء التفويض

انتهى استثناء الكتابة الخاص بـ `PROD-PROMOTION-01` بعد إغلاق هذه الدفعة. لا يسمح هذا التقرير بأي smoke test كتابي أو migration لاحق أو restore أو تعديل يدوي على الدائمة.
