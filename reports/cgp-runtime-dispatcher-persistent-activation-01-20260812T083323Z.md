# CGP-RUNTIME-DISPATCHER-PERSISTENT-ACTIVATION-01

## الحالة

تم تنفيذ تفويض Owner لترويج إعداد التشغيل المحلي فقط. تم تعديل `backend/.env`
بمفتاحي CGP Dispatcher المصرح بهما. لم تتم معالجة أي حدث Persistent، ولم يتم
إعادة تشغيل Backend.

## Watermark والـbacklog

- قاعدة البيانات المؤكدة: `darfus_erp`.
- قبل القطع: 4 أحداث `CustomerGoldPurchasePostedEvent` غير منشورة.
- أحدث `created_at` للـbacklog المحمي: `2026-08-12T06:56:11.008Z`.
- الـwatermark المختار مرة واحدة من `clock_timestamp()` بعد إعادة القراءة:
  `2026-08-12T08:32:21.028Z`.
- الإثبات: `W > max(protected.created_at)` بفارق أكثر من ساعة ونصف.
- لا توجد IDs أو أرقام مستندات hardcoded في Product code أو config.

## الإعداد والتغيير المسموح

- المصدر canonical: `backend/.env`، ويُقرأ بواسطة `dotenv` عند بدء `server.js`.
- أُضيف فقط:
  - `CGP_RUNTIME_DISPATCH_ENABLED=true`
  - `CGP_RUNTIME_DISPATCH_MIN_CREATED_AT=2026-08-12T08:32:21.028Z`
- لم يُغيّر `CGP_RUNTIME_DISPATCH_POLL_MS` أو Gold أو Redis أو DB/JWT settings.
- SHA قبل التعديل: `8723D9F07387C9784F423DB0977F24F66024951BFC18C2098ED4413D0EBB68E9`.
- SHA بعد التعديل: `B2777AE3B1BB8ABF61F928FD842969BF11E35C73DCA0CF2E8B1089CFDF615A74`.
- لا Secrets ظهرت في السجل أو التقرير؛ تم التحقق من المفاتيح دون طباعة القيم الحساسة.
- خطة rollback: حذف السطرين نفسيهما فقط وإعادة التحقق من hash/المفاتيح، دون استبدال `.env` بالكامل.

## Fail-closed وRestart

- disabled ينتج zero claims.
- enabled بدون watermark صالح يعطي `ACTIVATION_WATERMARK_REQUIRED` وzero claims.
- المصدر يُقرأ عند startup؛ لذلك `BACKEND_RESTART_REQUIRED_FOR_ACTIVATION=YES`.
- لم تُنفذ الأداة Restart. الـBackend الموروث بدأ قبل تعديل `.env`، وتم تركه دون لمس.
- الحالة الحالية: `PASS_CONFIG_PROMOTED_WAITING_OWNER_RESTART`.

## Post-promotion read-only check

بعد الترويج، أعاد `SELECT current_database()` القيمة `darfus_erp`. الأحداث الأربعة
بقيت كلها `PENDING`، `attempt_count=0`، receipts=0، integrations=0. بقيت Assets=53،
liabilities=0، journals=67، gold events=0.

لا يوجد Owner post-watermark CGP event مرصود في هذه الجولة، ولم تُنشأ أي بيانات
Persistent اصطناعية.

## Gold / migrations / integrity

- Gold محفوظ: `GOLDAPI_IO / LIVE_PROVIDER / refresh 1500 / stale 2500`.
- migrations قبل/بعد: `80 / 80`.
- Migration 81: غير موجودة ولم تُنشأ.
- Global Dispatcher: OFF.
- Persistent business writes: صفر.
- Integrity السابقة والمراجعة الحالية: journals متوازنة، orphan journal lines=0،
  unlinked treasury=0، duplicate/blank barcodes=0، orphan RFID=0.
- `next-env.d.ts` بقي على SHA المعروف الموروث
  `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`، ولم يتم إصلاحه.

## الاختبارات والسلامة

- Dispatcher config parser وdisabled/missing watermark: PASS.
- Static verifier: PASS.
- TypeScript وfocused regressions السابقة: PASS.
- لا Next dev، لا Git writes، لا server connection/deployment، ولا Redis mutation.

## القرار

`CGP_RUNTIME_DISPATCHER_PERSISTENT_ACTIVATION_01_GATE = PASS_CONFIG_PROMOTED_WAITING_OWNER_RESTART`

## Phase B — Post-restart verification

- Owner manual restart acknowledged. The active backend is PID `13564`,
  `src/server.js`, started `2026-08-12 11:36:47 AM` local (approximately
  `2026-08-12T08:36:47Z`), after the config promotion.
- The deterministic loader (`dotenv` at server startup) and the post-restart
  process identity prove the runtime loaded the promoted settings without
  exposing the process environment. `/api/v1/health` and `/api/v1/health/db`
  returned HTTP 200; Gold health returned HTTP 200 and canonical
  `GOLDAPI_IO / LIVE_PROVIDER`.
- Runtime loaded state: enabled=true and watermark exactly
  `2026-08-12T08:32:21.028Z`. One actual `src/server.js` process is running;
  nodemon is only its supervisor, so logical CGP processor count is one.
- `CGP_RUNTIME_DISPATCH_POLL_MS` is absent; source default is `250ms`.
  A two-second read-only observation covered multiple polling cycles.
- The exact Phase-A four-event set still matches. Every event remains
  `PENDING`, `attempt_count=0`, receipts=0, integrations=0. New Assets,
  Journals, Liabilities, and Gold events for that set remain zero.
- Post-watermark event count is zero; no Owner post-activation CGP was observed,
  so no manual consumer invocation or settlement test was performed.
- Persistent fingerprint remains Assets=53, Products=3, CGP documents=7,
  CGP items=11, liabilities=0, settlements=0, journals=67, journal lines=176,
  and Gold events=0. Financial and inventory integrity remain PASS.
- `gold_purchase.cgp.settle` remains present with one intended role assignment.
- `NEXT_ENV_CURRENT_SHA` remains the known inherited drift SHA and was not
  repaired. No Git/server/Redis/config writes occurred in Phase B.

`CGP_RUNTIME_DISPATCHER_PERSISTENT_ACTIVATION_01_GATE = PASS_CONFIRMED`

الخطوة التالية: `CGP-PENDING-POSTED-EVENTS-CONTROLLED-RECOVERY-01`، ولا تبدأ تلقائيًا.
