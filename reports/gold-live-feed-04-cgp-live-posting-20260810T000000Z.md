# GOLD-LIVE-FEED-04 — تقرير إثبات نشر CGP بالتسعير الحي

## سجل التنفيذ

- تم الالتزام بقراءة `AGENTS.md` ثم `PROJECT_PROGRESS_HANDOFF.md` ثم المرجع القانوني لـ CGP وتقارير Gold Live Feed 00–03.
- `darfus_erp` بقي للقراءة فقط عند migration `77`، مع `Assets=53` و`Products=3`.
- Acceptance بدأ عند migration `79`، وتم إنشاء نسخة احتياطية قبل التغيير: `backend/backups/gold_live_feed_04_acceptance_before_80_20260810T210000Z.dump`، SHA-256=`0AF2F3F10A3CFE30AC18961D1987F63BB84BF273CAEC4A52A6D357871F12BF25`، الحجم `1623758` bytes، و`pg_restore --list` قابل للقراءة.
- migration 80 الوحيدة طُبقت عبر `node scripts/acceptance-migrate.js --gold-live-feed-04 --execute`؛ لم يُستخدم `sequelize-cli` الخام.

## التغييرات

- أضيفت migration additive واحدة: `20260810030000-cgp-live-pricing-snapshot-lineage.js`.
- أضيفت حقول lineage اختيارية وقيود mode-aware إلى `cgp_pricing_snapshots` مع روابط `gold_market_quotes` و`gold_pricing_policies`؛ لا توجد بيانات تجريبية في migration.
- CGP Posting أصبح يختار صراحة بين `MANUAL_APPROVED` و`LIVE_PROVIDER`. الوضع اليدوي يحافظ على مسار Gold Center المعتمد، والوضع الحي يقرأ quote داخلياً وسياسة فعالة عند Posting.
- أضيف تحقق موحد لمستهلكي Inventory وAccounting وGold Center لقبول provenance اليدوي القديم أو lineage الحي الكامل، دون إعادة تسعير.
- تم تصحيح دلالة BID/ASK: عند غياب karat BID/ASK مباشر يُشتق السعر من fine-gold BID/ASK المطابق × karat/24؛ SPOT المباشر يبقى SPOT ولا يعاد ضربه في purity.

## إثبات الوضع اليدوي والحي

- نسخة rehearsal مؤقتة `darfus_erp_gold_live_feed_04_rehearsal_20260810180208` اختبرت 79→80 عبر migration guard وأسقطت بأمان.
- نسخة disposable مؤقتة بالبادئة `darfus_erp_gold_live_feed_04_posting_` أثبتت:
  - المسار اليدوي `MANUAL_APPROVED` ما زال ينشر Snapshot بحالة `APPROVED`.
  - المسار الحي يستخدم settings/provider/quote/policy من نفس الشركة والعملة.
  - quote stale يفشل قبل Posting مع بقاء المستند `VALIDATED` وبدون Snapshot أو Asset أو Journal أو Gold Event أو Outbox.
  - quote A + policy V1 يثبتان في Snapshot؛ quote B وpolicy V2 بعد Posting لا يغيران Snapshot القديم.
  - `proposedRate` القادم من العميل ليس سلطة مالية.
  - محاولة Posting ثانية أعادت `409 STATE_CONFLICT` وبقي Posted outbox event واحداً.
  - سباقا Posting متزامنان لنفس المستند نتجا عن نجاح واحد ورفض واحد `409` مع Posted event واحد.

## خوارزمية التسعير الحي

Posting يقرأ آخر quote normalized المطابق لـ `company + GOLDAPI_IO + XAU + document currency`، ويتحقق من `VALID/PER_GRAM` والحداثة بوقت الخادم، ثم يحل policy karat-specific قبل default، ويتحقق من BID/SPOT/ASK، ويطبق adjustment مرة واحدة باستخدام Decimal وHALF_UP إلى 4 منازل. الحساب النهائي هو `Net Weight × effective karat rate` ولا توجد purity ثانية.

- BID: fine-gold BID المعياري أو karat BID الموافق الموثق، وليس SPOT مع تسمية BID.
- SPOT: karat SPOT المباشر من provider إذا كان متاحاً.
- ASK: fine-gold ASK المعياري أو karat ASK الموافق الموثق.
- quote provider/currency mismatch، quote مفقود أو stale أو غير صالح، policy غير فعالة أو karat غير مدعوم، وeffective rate غير موجب تفشل مغلقاً.
- لا توجد اتصالات HTTP خارجية داخل Posting، ولا fallback تلقائي إلى manual.

## Snapshot وDownstream

Snapshot الحي يحفظ `pricingMode`, provider, marketQuoteId, providerQuoteId الاختياري، أزمنة quote، العملة والوحدة، base/karat rates، quote type، adjustment، policy id/version/scope، final effective rate، calculatedAt، precision وderivation method. المستهلكون يستخدمون هذه الحقائق المجمدة فقط.

إثبات disposable مرّ عبر:

`DRAFT → VALIDATED → LIVE_PROVIDER → POSTED → Inventory → Accounting → Gold Center → CRM → Settlement → Reversal`.

نجحت إسقاطات Asset واحد، Journal/Customer liability، Gold Core event، CRM، settlement، وreversal. التعويض والتسوية اعتمدا قيمة Posting الأصلية ولم يقرآ quote أو policy حديثين.

## Acceptance بعد التطبيق

- `current_database() = darfus_erp_inventory_rehearsal_20260804_160500z`.
- `SequelizeMeta=80`، migration 80 موجودة مرة واحدة، ولا توجد migrations غير متوقعة.
- قبل/بعد business counts محفوظة: `Assets=475`, `Products=3`, `CGP documents=82`, `CgpPricingSnapshots=64` قبل أي synthetic test.
- بعد التنظيف في Acceptance الأصلية: `gold_market_settings=0`, `gold_market_quotes=0`, `gold_pricing_policies=0`; لا CGP/quote/policy synthetic متروك.
- Persistent بقي `current_database()=darfus_erp`, `migrations=77`, `Assets=53`, `Products=3`، ولا جدول policies live ولا configuration حي.

## الاختبارات

- migration guard: جميع الحالات السبعة PASS.
- Gold Live Feed 01 foundation: `9/9`.
- Pricing policy Feed 03: `6/6`.
- CGP account resolver وcontract: `2/2` suites PASS.
- disposable full integration: manual compatibility، stale zero-side-effects، live snapshot، inventory، accounting، Gold Center، CRM، settlement، reversal PASS.
- `npx tsc --noEmit`: PASS.
- `git diff --check`: exit `0` (تحذيرات CRLF موروثة فقط).
- لم يُشغّل Next dev، ولم يُتصل بخادم، ولم يُستخدم secret حقيقي أو external HTTP.

## الحماية وقرار الخروج

- الفرع `main`، HEAD `1657b0e9ba580faef69be48f04637835c201b521`، مع الحفاظ على تغييرات وstashes موروثة؛ لا staging/commit/push.
- `next-env.d.ts` لم يتغير وبقي SHA المعروف الموروث `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.
- `PERSISTENT_DB_WRITES_THIS_BATCH=0`, `SERVER_MUTATIONS=0`, `GLOBAL_DISPATCHER=OFF`.

`GOLD_LIVE_FEED_04_GATE = PASS_CONFIRMED`.

الخطوة التالية المسموح بها فقط بعد اختيار صريح: `GOLD-LIVE-FEED-05_GOLD_CENTER_FRONTEND_AND_ADMIN_CONTROLS`. لم تبدأ تلقائياً.
