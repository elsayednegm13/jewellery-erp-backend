# CUSTOMER-INVOICE-SNAPSHOT-PERSISTENT-MIGRATION-PROMOTION-01

## Executive summary

تم تنفيذ ترقية واحدة مصرح بها فقط على `darfus_erp`، بعد أخذ نسخة احتياطية قابلة للاستعادة والتحقق من قاعدة Disposable. أضافت الترقية عمودي snapshot اختياريين إلى `invoices` وسجلت migration واحدة في `SequelizeMeta`. لم تُشغّل أي migration على Acceptance، ولم يحدث backfill أو تعديل في صفوف العمل.

## Owner approval / entry gate

- Owner-authorized target: `darfus_erp` فقط.
- Exact sequence: `80 -> 81`, migration `20260814010000-customer-invoice-contact-snapshots.js` فقط.
- Acceptance target remained read-only at `80`.
- Persistent active-business-write check immediately before apply: `writelike=0`.

## Safety boundary

لم يتم استخدام `npx sequelize-cli db:migrate`، ولا rollback، ولا restore فوق قاعدة العمل، ولا seed أو fixture أو backfill. كل فحوص قاعدة البيانات كانت تبدأ بـ`SELECT current_database()` وتتحقق من الاسم الدقيق. ملف `PROJECT_PROGRESS_HANDOFF.md` لم يتغير.

## Source / worktree

- Branch: `main`
- HEAD: `1657b0e9ba580faef69be48f04637835c201b521`
- Worktree كان متسخاً بتغييرات موروثة كثيرة؛ لم يتم تنظيفها أو استعادتها.
- staged files: `0`; commits/push/deploy: `0`.
- `backend/package.json` و`backend/package-lock.json` لم يتغيرا.
- `next-env.d.ts` بقي على inherited SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.

## Collision / order

تم فحص مجلد migrations: لا يوجد timestamp collision ولا ملف أحدث يعتمد على هذه migration. قبل التطبيق كان `Umzug.pending()` يعيد migration المصرح بها وحدها. بعد التطبيق أصبحت Pending في Persistent فارغة، بينما بقيت في Acceptance migration واحدة pending.

## Persistent baseline before

تم توثيق القراءة قبل التطبيق: database=`darfus_erp`, migrations=`80`, customers=`2`, invoices=`15`, payments=`30`, journal_entries=`81`, journal_lines=`209`, cash_transactions=`58`, assets=`62`. سلامة القيود المالية قبل التطبيق: unbalanced=`0`, orphan journal lines=`0`, unlinked treasury=`0`, duplicate journal sources=`0`, duplicate treasury links=`0`.

## Acceptance baseline before

database=`darfus_erp_inventory_rehearsal_20260804_160500z`, migrations=`80`, customers=`3`, invoices=`133`, payments=`122`, journal_entries=`497`, journal_lines=`1423`, cash_transactions=`173`, assets=`475`. قاعدة القبول بقيت read-only؛ baseline integrity كانت unbalanced=`0`, orphan=`0`, unlinked treasury=`0`, duplicate journal sources=`0`, duplicate treasury links=`1` (inherited baseline).

## Backup and restore-readiness

- Backup: `H:\WORK\jewellery-erp-master\backend\backups\darfus_erp_invoice_snapshot_promotion_01_2026-08-15T06-23-44-225Z.dump`
- SHA-256: `D55AF3A06B382EC111972CB6315F1CBE9EBF6C1473840541048E0E34EB178979`
- `pg_restore --list` نجح.
- تمت الاستعادة إلى Disposable `darfus_erp_invoice_snapshot_promotion_restore_20260815_062344`، وطابقت الأعداد السابقة، ثم حُذفت قاعدة التحقق.
- النسخة الاحتياطية ما زالت موجودة ولم تُحذف.

## Exact single migration execution

اُستخدم Node/Umzug narrow path من `backend` مع target صريح `DB_NAME=darfus_erp`: authenticate، ثم `SELECT current_database()`، ثم فحص active write-like sessions، ثم تحقق من pending filename، ثم `u.up({migrations:[exactFilename]})`. المحاولة الأولى لم تثبت أي تغيير؛ التحقق أظهر baseline=80، ثم أُعيد نفس المسار الضيق مرة واحدة فنجح. لم تُشغّل أي migration أخرى.

## Migration execution result

`darfus_erp` أصبح عند `81` migration، و`SequelizeMeta` يحتوي الاسم المصرح به مرة واحدة. `darfus_erp_inventory_rehearsal_20260804_160500z` ظل عند `80`، والـmigration المصرح بها غير موجودة به.

## Schema proof

الـmigration المصدر المطابق للنسخة المختبرة يضيف فقط:

| Column | Type | Nullable | Default |
|---|---|---|---|
| `customer_phone_snapshot` | `character varying(255)` | YES | NULL |
| `customer_address_snapshot` | `jsonb` | YES | NULL |

لا توجد snapshot indexes. `invoices.customer_name` ما زال `character varying`, `NOT NULL`, بلا default، وهو العمود الفيزيائي للخاصية المنطقية `customerName`.

## No-backfill / data preservation

عدد الفواتير Persistent ظل `15`، و`customer_phone_snapshot` غير الفارغ=`0`، و`customer_address_snapshot` غير الفارغ=`0`. لم يتغير أي customer/payment/journal/journal-line/cash/asset count، ولم تُحدّث أو تُحذف صفوف تاريخية.

## Acceptance unchanged

Acceptance لم تُلمس: migration=`80`، snapshot columns غير موجودة، authorized metadata=`0`، invoice count=`133`، وبقية fingerprint counts كما قبلها. Pending migration بها بقيت كما هو متوقع، دون تنفيذ.

## Runtime compatibility / old invoice proof

الموديل الحالي يعرّف `customerName` على `customer_name`، وsnapshot service يقرأ snapshot server-owned مع null-safe behavior. تقرير Clone السابق أثبت old invoice read، null snapshot، print options/browser evidence، customerName mapping، وعدم وجود live contact lookup، كما أثبت parity للمحاسبة والدفع والمخزون وVAT والتسعير والذهب. لم تُجرَ معاملة مالية جديدة هنا، لأن هذا batch migration-only.

## Financial / business parity

لا توجد كتابة مالية في هذا batch. بعد التطبيق ظلت integrity Persistent: unbalanced journals=`0`, orphan journal lines=`0`, unlinked treasury=`0`, duplicate journal sources=`0`, duplicate treasury links=`0`. لا تغيير في Accounting أو Payment أو Inventory أو VAT أو Pricing أو Gold.

## Security / privacy

الأعمدة nullable بلا default ولا backfill. المصدر canonical server-derived؛ لا client override ولا live contact lookup. لا credentials أو URLs سرية في التقرير.

## Runtime / process safety

لم يُعمل restart للـfrontend أو backend، ولم تُقتل عمليات عادية، ولم يحدث deploy. المنافذ الطبيعية 3000 و8000 ظلت listening كما كانت قبل الفحص. لا يوجد temporary restore DB متبقٍ.

## File / schema diff

| File / object | Reason | Type | Exact change | Persistent effect | Business effect | Expected |
|---|---|---|---|---|---|---|
| `backend/migrations/20260814010000-customer-invoice-contact-snapshots.js` | Owner-approved schema promotion | Migration source already present | Added two nullable columns, no default/index/backfill | Applied once to Persistent | None | Yes |
| `darfus_erp.invoices` | Authorized schema target | DB schema | Added the two columns above | Yes | None | Yes |
| `darfus_erp.SequelizeMeta` | Migration bookkeeping | DB metadata | One authorized row | Yes | None | Yes |
| Backup dump | Recovery prerequisite | Backup artifact | Created and retained | No DB effect | None | Yes |
| This report | Evidence | Report | Added after verification | None | None | Yes |

## Cleanup

Disposable restore database was dropped. Backup was retained. No Product source, environment, handoff, Acceptance database, or normal runtime artifact was cleaned.

## Gate

كل شروط Owner Review Ready متحققة: exact target، backup/restore proof، exact one migration، schema-only delta، no backfill، Persistent integrity pass، Acceptance unchanged، package/env/Git/deploy safety pass.

## Owner checklist

- Persistent migration 80→81: PASS.
- Acceptance remains 80: PASS.
- Only two nullable snapshot columns: PASS.
- `customerName` authority unchanged: PASS.
- Historical snapshots remain NULL: PASS.
- No financial/business rows changed: PASS.
- Backup retained and restore rehearsal completed: PASS.
- No restart/deploy/Git write: PASS.

## Next step

توقف هذه الدفعة هنا. الخطوة التالية المقترحة بعد Owner review فقط هي `POST_MIGRATION_RUNTIME_OBSERVATION_AND_OWNER_SIGNOFF`، بدون بدء تلقائي.

## Required tokens

```text
CURRENT_BATCH = CUSTOMER-INVOICE-SNAPSHOT-PERSISTENT-MIGRATION-PROMOTION-01
OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE
AUTHORIZED_MIGRATION_FILENAME = 20260814010000-customer-invoice-contact-snapshots.js
AUTHORIZED_MIGRATION_SOURCE_MATCHES_TESTED_VERSION = YES
PERSISTENT_MIGRATION_BASELINE = 80
ACCEPTANCE_MIGRATION_BASELINE = 80
MIGRATION_TIMESTAMP_COLLISION = NO
UNRELATED_PENDING_MIGRATIONS_EXIST = NO
PERSISTENT_BASELINE_CAPTURED_BEFORE = YES
ACCEPTANCE_BASELINE_CAPTURED_BEFORE = YES
PERSISTENT_BACKUP_CREATED = YES
PERSISTENT_BACKUP_PATH = H:\WORK\jewellery-erp-master\backend\backups\darfus_erp_invoice_snapshot_promotion_01_2026-08-15T06-23-44-225Z.dump
PERSISTENT_BACKUP_SHA256 = D55AF3A06B382EC111972CB6315F1CBE9EBF6C1473840541048E0E34EB178979
PERSISTENT_BACKUP_SHA256_VERIFIED = YES
BACKUP_RESTORE_READINESS = PASS
RESTORE_VERIFICATION_DB_USED = YES
SINGLE_MIGRATION_EXECUTION_PATH = PROVEN
TARGET_DATABASE_CONFIRMATION = darfus_erp
PERSISTENT_SNAPSHOT_MIGRATION_EXECUTED = YES
PERSISTENT_SNAPSHOT_MIGRATION_RESULT = PASS
UNRELATED_MIGRATIONS_EXECUTED = 0
PERSISTENT_PHONE_SNAPSHOT_COLUMN = PASS
PERSISTENT_ADDRESS_SNAPSHOT_COLUMN = PASS
SNAPSHOT_COLUMNS_NULLABLE = PASS
SNAPSHOT_DEFAULTS = NONE
CUSTOMER_NAME_AUTHORITY_UNCHANGED = PASS
HISTORICAL_PHONE_SNAPSHOT_NON_NULL_AFTER_MIGRATION = 0
HISTORICAL_ADDRESS_SNAPSHOT_NON_NULL_AFTER_MIGRATION = 0
HISTORICAL_BACKFILL = NO
ACCEPTANCE_SNAPSHOT_MIGRATION_EXECUTED = NO
ACCEPTANCE_SNAPSHOT_COLUMNS_PRESENT = NO
NORMAL_RUNTIME_CODE_SUPPORTS_SNAPSHOT = YES
NORMAL_RUNTIME_RESTART_REQUIRED = NO
OLD_INVOICE_READ_SMOKE = PASS
OLD_INVOICE_PRINT_SMOKE = PASS
OLD_INVOICE_NULL_SNAPSHOT_SAFE = PASS
CUSTOMERNAME_MAPPING_PERSISTENT = PASS
PERSISTENT_FINANCIAL_SMOKE_WRITE = NO
ACCOUNTING_PARITY_AFTER_PROMOTION = PASS
PAYMENT_PARITY_AFTER_PROMOTION = PASS
INVENTORY_PARITY_AFTER_PROMOTION = PASS
VAT_PARITY_AFTER_PROMOTION = PASS
PRICING_PARITY_AFTER_PROMOTION = PASS
GOLD_PARITY_AFTER_PROMOTION = PASS
SNAPSHOT_SECURITY_CONTRACT_UNCHANGED = PASS
PERSISTENT_BASELINE_CAPTURED_AFTER = YES
PERSISTENT_BUSINESS_ROW_DELTA = 0
PERSISTENT_SCHEMA_DELTA = AUTHORIZED_SNAPSHOT_COLUMNS_ONLY
ACCEPTANCE_BASELINE_CAPTURED_AFTER = YES
ACCEPTANCE_FINGERPRINT_DELTA = 0
ACCEPTANCE_WRITES_THIS_BATCH = 0
PERSISTENT_MIGRATIONS_AFTER = 81
ACCEPTANCE_MIGRATIONS_AFTER = 80
PERSISTENT_MIGRATION_DELTA = 1
ACCEPTANCE_MIGRATION_DELTA = 0
PACKAGE_JSON_CHANGED = NO
PACKAGE_LOCK_CHANGED = NO
RUNTIME_ENV_CHANGED = NO
PRODUCT_CODE_CHANGED_THIS_BATCH = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
GIT_PUSHES_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
NORMAL_FRONTEND_RESTARTED = NO
NORMAL_BACKEND_RESTARTED = NO
PERSISTENT_BACKUP_RETAINED = YES
RESTORE_VERIFICATION_DB_DROPPED = YES
EPHEMERAL_RUNTIME_STOPPED = NOT_APPLICABLE
TEMP_WORKSPACE_CLEANED = NOT_APPLICABLE
CUSTOMER_INVOICE_SNAPSHOT_PERSISTENT_MIGRATION_PROMOTION_01_GATE = PASS_OWNER_REVIEW_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = POST_MIGRATION_RUNTIME_OBSERVATION_AND_OWNER_SIGNOFF_IF_PASS
```
