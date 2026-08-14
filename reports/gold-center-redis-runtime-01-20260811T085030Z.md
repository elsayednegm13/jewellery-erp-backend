# GOLD-CENTER-REDIS-RUNTIME-01

## النتيجة

تم تشغيل Redis محليًا بطريقة مؤقتة وآمنة، وثبتت جدولة BullMQ الفعلية كل 30
ثانية. لكن كل استدعاءات GoldAPI فشلت مغلقًا بـ`GOLDAPI_IO_AUTH_ERROR`؛ لذلك
لم يتحول الـquote إلى Fresh، ولم تُغلق دفعة runtime.

`GOLD_CENTER_REDIS_RUNTIME_01_GATE = FAIL`

`GOLD_CENTER_LIVE_RUNTIME_FIX_01_GATE = STILL_BLOCKED`

## اكتشاف Redis والخيار المستخدم

- Docker Desktop موجود ويعمل.
- صورة `redis:7-alpine` موجودة محليًا.
- Redis المشروع `darfus-redis` كان يعمل، لكنه مربوط على واجهات المضيف (`0.0.0.0:6379`)؛ لم يتم لمسه.
- تم اختيار حاوية مؤقتة مستقلة:
  - الاسم: `darfus-gold-runtime-01-redis`
  - الصورة: `redis:7-alpine`
  - الربط: `127.0.0.1:6380 -> 6379`
  - restart policy: `no`
- `PING` أعاد `PONG`.
- تم إيقاف الحاوية وإزالتها بعد الاختبار.
- لم يتم تثبيت برنامج أو تعديل Docker Compose أو تشغيل Redis على الخادم.

`LOCAL_REDIS_CONFIGURATION_SCOPE = LOCAL_ONLY`
`SERVER_REDIS_CONFIGURATION = NOT_TOUCHED`
`REDIS_PUBLICLY_EXPOSED = NO` للحاوية المؤقتة.

## إعداد البيئة

- الاسم canonical: `REDIS_URL`.
- المصدر المعتاد: `backend/.env` عبر `dotenv`.
- لم تتم إضافة أو تعديل `backend/.env`؛ استُخدم override مؤقت لعملية الاختبار فقط:
  `redis://127.0.0.1:6380`.
- hash ملف `.env` قبل/بعد بقي `52EC62DA520BEDE14B0201B4971E4732D5011349375370C13C8AC2782DD64332`.
- لم يتم كشف أو تعديل API key أو أي credential.

## Runtime / Scheduler

- Entrypoint: `backend/src/server.js -> gold-market-runtime.service.start`.
- Queue: `gold-market-refresh`.
- Scheduler key:
  `gold-market-refresh:<company>:<provider>:<currency>:XAU`.
- Resolved scope: provider `GOLDAPI_IO`, currency `AED`, metal `XAU`.
- Redis connection وBullMQ worker نجحا.
- تسجيل مكرر أعاد Scheduler منطقيًا واحدًا فقط.
- `getJobSchedulers()` أثبت `count=1` و`every=30000`.
- overlap محمي بتسلسل BullMQ وworker concurrency=1.
- retries محدودة، والأخطاء غير القابلة للإعادة أصبحت `UnrecoverableError`؛ خطأ المصادقة نفذ محاولة واحدة لكل دورة.

## Recurring observation

تمت ملاحظة دورات فعلية تقريبًا عند:

- `11:46:33`
- `11:47:03`
- `11:47:33`
- `11:48:03`

الفاصل المرصود: `30` ثانية تقريبًا. كل دورة وصلت إلى GoldAPI ثم فشلت بـ`GOLDAPI_IO_AUTH_ERROR`.
إجمالي الطلبات الحقيقية: `4`. لم يُنشأ أي quote صناعي.

## Quote / Current State

قبل التشغيل كان آخر quote واحدًا، صالحًا لكنه stale. بعد التشغيل بقي عدد quotes واحدًا
لأن GoldAPI لم يعطِ استجابة مصادقًا عليها.

- quote قبل/بعد: `1 / 1`
- status بعد التشغيل: `STALE`
- age بعد التشغيل: أكبر من `120` ثانية
- provider health بعد recurring: لم يصبح HEALTHY
- `currentState`: `LIVE_PROVIDER / GOLDAPI_IO / AED / 30 / 120`، health `STALE`
- Effective CGP rates: بقيت `null` للـ18K/21K/22K/24K
- stale quote ما زال يحجب CGP Posting.
- لا يوجد HTTP داخل CGP Posting.

لا يتم تعديل مفتاح GoldAPI في هذه الدفعة؛ يلزم Owner توفير credential صالح في البيئة المحلية ثم إعادة الاختبار.

## Persistent integrity

قبل وبعد التشغيل، مع إثبات `SELECT current_database() = darfus_erp`:

- migrations `80`
- Assets `53`
- Products `3`
- Customers `1`
- CGPs `2`
- Journals `67`
- JournalLines `176`
- Treasury/CashTransactions `50`
- market settings `1`
- pricing policies `1`
- market quotes `1 / 1`
- unbalanced journals `0`
- orphan journal lines `0`
- unlinked treasury `0`

لم تحدث أي كتابة في Assets أو Products أو Customers أو CGP أو Journals أو Treasury أو settings أو policy.

## Regressions / protection

- Gold Market runtime and duplicate scheduler tests: PASS.
- Gold Live Feed, pricing policy, CGP, making-charge, POS contracts: `33/33 PASS`.
- TypeScript: PASS.
- `git diff --check`: PASS، مع تحذيرات CRLF موروثة فقط.
- `next-env.d.ts` بقي على SHA الموروث
  `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.
- القسم Legacy Gold Center لم يتغير.
- Migration 81 لم تُنشأ.
- لا SSH أو server Redis أو deployment أو commit أو push.
- runtime والحاوية المؤقتة أُوقفا؛ لا توجد duplicate process.

## Exit

سبب الإيقاف الوحيد: `GOLDAPI_IO_AUTH_ERROR`، وليس Redis أو scheduler.
لا يتم تحديث `PROJECT_PROGRESS_HANDOFF.md` لأن PASS_CONFIRMED لم يتحقق.
