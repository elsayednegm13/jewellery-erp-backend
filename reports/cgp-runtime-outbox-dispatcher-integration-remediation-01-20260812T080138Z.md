# CGP-RUNTIME-OUTBOX-DISPATCHER-INTEGRATION-REMEDIATION-01

## 1. النتيجة

تم تنفيذ Dispatcher مقيّد بنوع الحدث `CustomerGoldPurchasePostedEvent` فقط، مع تفعيل صريح عبر `CGP_RUNTIME_DISPATCH_ENABLED` و`CGP_RUNTIME_DISPATCH_MIN_CREATED_AT`. الإعداد الافتراضي مقفول، وغياب الـwatermark أو عدم صلاحيته يفشل مغلقًا. لم يتم تفعيل التشغيل التلقائي على `darfus_erp` ولم تتم معالجة الـbacklog القديم.

## 2. الملفات الخاصة بهذه الجولة

- `backend/src/services/cgp-runtime-dispatcher.service.js`
- `backend/src/services/outbox.service.js`
- `backend/src/server.js`
- `backend/scripts/verify-cgp-runtime-outbox-dispatcher-01.js`
- `backend/scripts/verify-cgp-runtime-dispatcher-static.js`
- `tests/cgp-runtime-outbox-dispatcher-contract.test.cjs`

## 3. نموذج الـOutbox والـDispatcher

- المطالبة ذرّية باستخدام `FOR UPDATE SKIP LOCKED` داخل CTE ثم `UPDATE ... RETURNING`.
- تمت إضافة فلاتر نوع الحدث، الإصدار، و`created_at >= watermark` إلى primitive القائم؛ لم تتم إضافة claim logic موازٍ.
- registry صريح Server-controlled: Inventory ثم Accounting ثم Gold Center ثم Availability hard gate ثم CRM soft projection.
- `ProcessedEvent`/`IntegrationStatus` الحاليان يضمنان deduplication لكل consumer.
- حالة المصدر تصبح `PUBLISHED` بعد نجاح التسليم؛ الفشل يحفظ `RETRYABLE_FAILED` ويستخدم backoff القائم مع `last_error` منقّى.
- lifecycle مربوط بـ`server.js` مع singleton، `stop()`، وgraceful shutdown؛ Global Dispatcher العام ما زال غير مشغّل.

## 4. حدود التفعيل

- `CGP_RUNTIME_DISPATCH_ENABLED` غير موجود = disabled.
- enabled بدون `CGP_RUNTIME_DISPATCH_MIN_CREATED_AT` صالح = fail closed.
- الـwatermark قيمة ثابتة من الإعداد، وليست وقت بدء العملية، وتظل نفسها بعد restart.
- لا توجد IDs أو أرقام مستندات backlog hardcoded في Product code.

## 5. اختبار Disposable Clone

آخر Clone: `darfus_erp_cgp_runtime_dispatcher_01_rehearsal_20260812080401`.

Watermark: `2026-08-12T08:04:05.613Z`.

- Event قبل الـwatermark: بقي `PENDING`، `attempt_count=0`، receipts=0، assets=0.
- Event بعد الـwatermark: عولج تلقائيًا من خلال `runtime.start()`، وأصبح `PUBLISHED`، receipts=4، Asset=1، liability=1 بحالة `OPEN`، و`settlementReady=true`، وAsset=`AVAILABLE`.
- لا يوجد استدعاء يدوي للـconsumers في مسار النجاح التلقائي. الاستدعاء اليدوي الوحيد في الاختبار كان حقن فشل جزئي متعمد لإثبات retry boundary، وليس مسار النجاح.
- Restart/retry: فشل Accounting بعد نجاح Inventory عمدًا، أصبح الحدث `RETRYABLE_FAILED` بمحاولة واحدة، ثم أعاد runtime تشغيله بنفس watermark وأصبح `PUBLISHED` مع 4 receipts دون Asset أو Journal أو Liability مكررة.
- سباق claim متزامن لمحاولتين مستقلتين: winner واحد فقط، والحدث النهائي `PUBLISHED` مع 4 receipts وAsset واحد.
- duplicate dispatch بعد الاكتمال: `claimed=0`.
- integrity داخل Clone: unbalanced journals=0، orphan journal lines=0، unlinked treasury=0، blank barcodes=0.

## 6. فحوص المصدر والاختبارات

- `node --test tests/cgp-runtime-outbox-dispatcher-contract.test.cjs`: 4/4 PASS.
- regression/static contract suite الخاصة بـCGP وSettlement وGold وReservations: 39/39 PASS.
- `node scripts/verify-cgp-runtime-dispatcher-static.js`: PASS.
- `npx tsc --noEmit`: PASS.
- syntax checks للملفات المعدلة: PASS.

## 7. Persistent fingerprint (قراءة فقط)

تم التحقق من `current_database() = darfus_erp` بعد الاختبارات. الحالة الحالية: migrations=80، Assets=53، Products=3، CGP documents=7، CGP items=11، CGP Posted outbox events=4، وكل الأربعة `PENDING` و`attempt_count=0`، processed_events=0، integration_statuses=0، liabilities=0، settlements=0، journals=67، journal_lines=176، gold_core_events=0.

الـCGP event IDs الأربعة القديمة تم التقاطها كـprotected pre-activation backlog ولم تتغير. لا توجد Persistent synthetic CGP/Assets/Journals/Liabilities.

Financial read-only checks: unbalanced=0، orphan journal lines=0، unlinked treasury=0، duplicate treasury links=0. Inventory checks: duplicate barcodes=0، blank barcodes=0، orphan RFID=0. إعداد Gold الحالي: `GOLDAPI_IO / LIVE_PROVIDER / refresh 1500 / stale 2500`.

## 8. السلامة والنطاق

- لا migration 81، ولا migration tooling.
- لا Persistent أو Acceptance business mutation؛ Clone فقط هو قاعدة الكتابة المؤقتة ثم أزيل.
- لا تغيير Governance/UI أو Settlement business logic أو Gold provider calls.
- لا تشغيل أو إعادة تشغيل للعمليات الموروثة، ولا Next dev، ولا server/deployment.
- `next-env.d.ts` بقي على SHA المعروف الموروث `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`؛ لم تتم محاولة إصلاحه.

## 9. Gate

`CGP_RUNTIME_OUTBOX_DISPATCHER_INTEGRATION_REMEDIATION_01_GATE = PASS_IMPLEMENTED_NOT_ACTIVATED`

الخطوة التالية المسموح بها فقط: `CGP-RUNTIME-DISPATCHER-PERSISTENT-ACTIVATION-01_IF_PASS`، ولا تبدأ تلقائيًا. بعد تفعيل Persistent بموافقة Owner منفصلة، تتم معالجة backlog القديم لاحقًا event-by-event وبموافقة مستقلة.
