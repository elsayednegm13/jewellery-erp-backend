# GOLD-LIVE-FEED-01 — Provider Abstraction + Normalized Market Quote Foundation

## التنفيذ والنطاق

تم تنفيذ طبقة الأساس فقط. لا يوجد اتصال خارجي، ولا CGP live integration، ولا pricing-policy CRUD، ولا scheduler، ولا Gold Center UI، ولا production activation.

## الملفات التي تغيرت

- `backend/migrations/20260810010000-gold-live-feed-foundation.js`
- `backend/src/models/goldMarketQuote.model.js`
- `backend/src/models/goldMarketSetting.model.js`
- `backend/src/models/index.js`
- `backend/src/services/gold-market-provider.contract.js`
- `backend/src/services/gold-market-provider-registry.service.js`
- `backend/src/services/gold-market-feed.service.js`
- `backend/src/services/gold-market-settings.service.js`
- `backend/src/repositories/gold-market-quote.repository.js`
- `backend/scripts/acceptance-migration-guard.js`
- `backend/scripts/acceptance-migrate.js`
- `backend/scripts/gold-live-feed-01-migrate-rehearsal.js`
- `backend/tests/gold-live-feed-01-foundation.test.cjs`

لم تُعدّل ملفات CGP Posting أو `gold_prices` أو الواجهة أو إعدادات الأسرار.

## Migration 78

الاسم الدقيق: `20260810010000-gold-live-feed-foundation.js`.

أنشأت جدولين إضافيين فقط:

### `gold_market_quotes`

يشمل Company scope، provider، XAU، currency، `PER_GRAM`، base purity، quote/received timestamps، spot/bid/ask، معدلات 18/21/22/24 اختيارية، مصدر اشتقاق karat، provider quote ID، hash للحمولة، status/quality، وفهارس القراءة الأخيرة والهوية.

القيود تشمل XAU فقط، عملة ISO ثلاثية، `PER_GRAM`، قيم موجبة، وجود قيمة سعر واحدة على الأقل، وحالات `VALID/STALE/INVALID/UNAVAILABLE`.

### `gold_market_settings`

إعداد غير سري لكل Company: `MANUAL_APPROVED/LIVE_PROVIDER`، provider مضبوط، العملة، refresh/stale intervals، enabled، updatedBy، version. لا توجد أعمدة سرية ولا صفوف إعدادات مفعلة.

Migration additive، بلا backfill أو fixtures أو حذف أو تعديل لبيانات الأعمال أو `gold_prices`.

## العقد والـRegistry

تمت إضافة عقد محايد يعرّف `GOLDAPI_IO` و`METALS_API`، وأنواع `BID/ SPOT/ ASK`، والوحدة `PER_GRAM`، والمعدن `XAU`، وحالات quote، وcapabilities للـbid/ask/spot والعملات والوحدات والـkarat والتوقيت وquote ID.

الـadapters الحالية stubs مغلقة ولا تنفذ HTTP. provider غير المعروف يفشل مغلقاً. لا يوجد arbitrary provider URL.

## التحقق وFreshness

التحقق يرفض الأسعار الصفرية/السالبة، العملة غير الصحيحة، المعدن غير XAU، الوحدة غير `PER_GRAM`، timestamps غير الصحيحة أو المستقبلية، والـquote الخالي من أي قيمة.

`isQuoteFresh` يعتمد على وقت الخادم ويقارن عمر quote بالـstale threshold. لا توجد outlier policy أو fallback تلقائي.

## Repository وIdempotency

تمت إضافة repository للـinsert/read latest/latest eligible بترتيب:

`quoteTimestamp DESC → receivedAt DESC → id DESC`

عند وجود `providerQuoteId` أو `rawPayloadHash + quoteTimestamp` تتم إعادة النتيجة بدلاً من إنشاء duplicate. لا يتم حذف quote history.

## الشركة والفرع والعملات

- Quote مربوط بـCompany ولا يوجد Branch scope.
- العملة صريحة ISO-4217 ويجب لاحقاً أن تطابق عملة CGP حرفياً.
- لا توجد FX conversion.
- الوحدة المالية normalized إلى `PER_GRAM`.
- karats المدعومة: 18، 21، 22، 24.
- Pure Gold = 999.9، ولا توجد سلطة 995.

## الأسرار والأمان

لا توجد أسرار في schema أو model أو response. أسماء البيئة المسموح بها لاحقاً:

- `GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY`
- `GOLD_MARKET_PROVIDER_METALS_API_API_KEY`

لم تُنشأ قيم فعلية، ولم تُنفذ requests خارجية، ولم يتم تشغيل server أو dispatcher.

## Rehearsal وAcceptance

تم التحقق أولاً من قاعدة القبول عند 77 migration. تعذر template clone بسبب اتصالات قائمة، لذلك استُخدم المسار البديل الآمن:

- dump: `backend/backups/gold_live_feed_01_acceptance_before_78_20260810_120000z.dump`
- SHA-256: `CC12B7E6CF9FA6DE08F3302607557CFAEA6376D9BBF23FBEFD60713934091399`
- تم إنشاء rehearsal بالاسم المحمي `darfus_erp_gold_live_feed_01_rehearsal_20260810_120000z`.
- Migration 78 نجحت على rehearsal، ثم تم حذفها بعد تحقق prefix والاسم، دون قتل جلسات.
- تم تطبيق Migration 78 على acceptance فقط عبر `node scripts/acceptance-migrate.js --gold-live-feed-01 --execute`.

نتيجة القبول: migrations 77 → 78، migration 78 موجودة مرة واحدة، الجداول الجديدة صفوفها صفر، وأعداد Assets/Products/CGP/Journals بقيت كما كانت قبل التطبيق.

## Persistent

تمت قراءة `darfus_erp` فقط بعد التنفيذ:

- migrations = 77
- Assets = 53
- Products = 3
- جداول live-feed غير موجودة في Persistent
- لا يوجد Persistent migration أو business write

## الاختبارات

- `node scripts/verify-acceptance-migration-guard.js`: الحالات السبع PASS.
- اختبارات foundation: 4/4 PASS.
- `npx tsc --noEmit`: PASS.
- اختبارات عقود CGP IMP-01/02/03: PASS.
- `node scripts/verify-cgp-approved-price-authority.js`: manual Approved path وfail-closed blocker PASS.
- `git diff --check`: PASS.

## ما لم يُنفذ

- لا GoldAPI/Metals-API network adapter.
- لا API key أو provider activation.
- لا BullMQ polling أو Redis worker.
- لا CGP Posting integration.
- لا pricing policy أو adjustments.
- لا Gold Center UI.
- لا Migration 79.

## الحماية وGit

- Branch `main`، HEAD `1657b0e9ba580faef69be48f04637835c201b521`.
- staged هذا batch = 0، commits = 0، push/deploy = 0.
- التغييرات الموروثة القذرة لم تُمس.
- `next-env.d.ts` بقي على SHA المعروف `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` ولم يُعاد توليده.

## بوابة الخروج

`GOLD_LIVE_FEED_01_GATE = PASS_CONFIRMED`.

الدفعة التالية الموصى بها فقط بعد قرار/استمرار Owner:

`GOLD-LIVE-FEED-02_FIRST_PROVIDER_ADAPTER_AND_REFRESH_PIPELINE_IF_PASS_CONFIRMED`
