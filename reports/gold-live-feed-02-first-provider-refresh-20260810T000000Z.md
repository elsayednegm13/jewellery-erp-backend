# GOLD-LIVE-FEED-02 — First Provider Adapter + Centralized Refresh

## التنفيذ

تم تنفيذ GoldAPI.io adapter وطبقة Test Connection وhealth وrefresh pipeline على أساس Foundation 78. لم يتم تشغيل HTTP حقيقي لأن السر غير مضبوط، ولم يتم تفعيل LIVE_PROVIDER أو ربط CGP.

## وثائق GoldAPI الرسمية

تمت مراجعة الوثائق الرسمية الحالية فقط:

- `https://www.goldapi.io/`
- `https://www.goldapi.io/price/XAU/AED/json`
- `https://www.goldapi.io/price/XAU/USD/curl`

العقد المطبق:

- `GET https://www.goldapi.io/api/XAU/{CURRENCY}`
- المصادقة server-side عبر header `x-access-token`.
- `timestamp` Unix seconds.
- `price` و`bid` و`ask` لكل Troy ounce.
- `price_gram_24k`, `price_gram_22k`, `price_gram_21k`, `price_gram_18k` direct per gram.
- `metal` و`currency` يُتحقق منهما حرفياً.

## الملفات

- `backend/src/services/goldapi-io.adapter.js`
- `backend/src/services/gold-market-provider-registry.service.js`
- `backend/src/services/gold-market-health.service.js`
- `backend/src/services/gold-market-test-connection.service.js`
- `backend/src/services/gold-market-refresh.service.js`
- `backend/tests/gold-live-feed-01-foundation.test.cjs`
- `backend/reports/gold-live-feed-02-first-provider-refresh-20260810T000000Z.md`
- تحديث مختصر في `PROJECT_PROGRESS_HANDOFF.md`

لم تُنشأ Migration 79؛ Migration 78 كافية.

## Adapter والتطبيع

- `price` → `SPOT` بعد القسمة على `31.1034768`.
- `bid` → `BID` بعد القسمة على `31.1034768`.
- `ask` → `ASK` بعد القسمة على `31.1034768`.
- direct gram karats → `PROVIDER_DIRECT` للـ18/21/22/24.
- الوحدة النهائية `PER_GRAM` ودقة التخزين `DECIMAL(20,8)`.
- `providerQuoteId` غير مدّعى؛ `rawPayloadHash` يحسب من حقول normalized مختارة فقط.
- لا FX ولا تحويل صامت للعملة ولا 995.

## Secret وTest Connection

اسم السر الوحيد: `GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY`.

السر غير موجود محلياً. Test Connection يعيد facts آمنة فقط: configured/reachable/normalized/status/capabilities/timestamps/freshness، ولا يعيد secret أو Authorization أو payload سري، ولا يحفظ quote مالياً.

## Refresh وHealth

تمت إضافة pipeline مركزي:

`BullMQ Queue gold-market-refresh → Worker → Registry → GoldAPI adapter → normalize → validate → repository → health`

- queue job identity: `gold-refresh:{company}:{provider}:{currency}:{metal}`.
- attempts = 3 مع exponential backoff.
- auth/config/schema errors غير قابلة لإعادة المحاولة؛ network/5xx و429 قابلة لإعادة المحاولة ضمن الحد.
- overlap protection عبر jobId وin-flight key.
- refresh target = 30 ثانية، stale target = 120 ثانية.
- health states: HEALTHY، DEGRADED، STALE، UNAVAILABLE، AUTH_ERROR، RATE_LIMITED.
- لا يتم استخدام CGP dispatcher.
- Redis غير مضبوط؛ إنشاء البنية يعيد disabled بأمان ولا يشغّل polling محلياً تلقائياً.

## Acceptance/Rehearsal

لم توجد Migration 79، لذلك بقي Acceptance عند 78 ولم تُجرَ كتابة عليها في هذه الدفعة.

تم إنشاء rehearsal disposable:

`darfus_erp_gold_live_feed_02_rehearsal_20260810_150000z`

تم اختبار insert/replay/latest/eligible على `gold_market_quotes`: صف اصطناعي واحد، replay بلا duplicate، ثم حُذفت القاعدة بعد تحقق الاسم والـprefix. Acceptance بقيت quote rows=0.

## Persistent وCGP

- Persistent `darfus_erp`: migrations=77، Assets=53، Products=3، وجداول quote غير موجودة؛ read-only.
- `CURRENT_CGP_PRICE_AUTHORITY = MANUAL_APPROVED`.
- `CGP_LIVE_PRICE_INTEGRATION_ACTIVE = NO`.
- `CURRENT_MANUAL_CGP_PRICE_PATH_CHANGED = NO`.
- `CGP_APPROVED_GOLD_PRICE_REQUIRED` وfail-closed behavior محفوظان.
- Reversal وSettlement لا يعيدان التسعير من live market.
- Metals API بقي network-disabled.
- Global dispatcher OFF، وserver untouched.

## الاختبارات

- GoldAPI mapping fixture وBID/SPOT/ASK وkarat mapping: PASS.
- missing secret/auth/429/malformed response: PASS.
- secret redaction وTest Connection: PASS.
- registry/capabilities/unknown provider: PASS.
- freshness/health/dedup/latest/repository: PASS.
- queue job ID/attempts/backoff/Redis-disabled path: PASS.
- Acceptance DB-backed replay/latest/eligible rehearsal: PASS.
- CGP approved-price authority regression: PASS.
- CGP IMP-01/02/03 contract tests: PASS.
- `npx tsc --noEmit`: PASS.
- `git diff --check`: PASS.

## Connectivity Gate

لا يوجد secret محلي، لذلك:

`LIVE_PROVIDER_CONNECTIVITY_GATE = BLOCKED_BY_MISSING_PROVIDER_SECRET`

وهذا لا يفشل الدفعة؛ العقد والاختبارات والpipeline مكتملة دون أي unsafe fallback.

## الحماية

- Persistent writes = 0، Persistent migrations = 0.
- Acceptance migrations قبل/بعد = 78/78.
- لا API key، لا deployment، لا server connection.
- `next-env.d.ts` بقي SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.
- لم يُستخدم `npx sequelize-cli db:migrate`.

## بوابة الخروج

`GOLD_LIVE_FEED_02_GATE = PASS_CONFIRMED`.

الدفعة التالية فقط بعد قرار/تفويض مستقل:

`GOLD-LIVE-FEED-03_CGP_PRICING_POLICY_ENGINE_IF_PASS_CONFIRMED`
