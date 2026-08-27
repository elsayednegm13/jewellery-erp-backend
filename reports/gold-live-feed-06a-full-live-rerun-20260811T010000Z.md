# GOLD-LIVE-FEED-06A — Full Live Acceptance Rerun

## النتيجة

تمت إعادة تشغيل Gold Live Feed باستخدام السر المحلي الموجود في `backend/.env`، وبقيت كل الكتابات المالية/التجارية داخل clone مؤقت من Acceptance. لم تُستخدم قاعدة `darfus_erp` للكتابة، ولم تُطبق Migration 81.

## مصدر الإعداد والسر

- `backend/src/server.js` يستخدم `require("dotenv").config()`.
- عند التشغيل المحلي من مجلد `backend`، المصدر الفعلي هو `backend/.env`.
- المفتاح المقروء فقط من الخادم هو `GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY`.
- فحص التسرب: لا قيمة للسر في source أو frontend أو logs أو reports أو `NEXT_PUBLIC` أو Persistent/Acceptance DB.
- لا يوجد provider URL أو auth header في أي سجل أو تقرير.

## العقد الرسمي والاتصال

تمت إعادة التحقق من العقد الرسمي الحالي: `GET https://www.goldapi.io/api/XAU/{CURRENCY}` مع `x-access-token`. الاستجابة تتضمن `timestamp`, `metal`, `currency`, `price`, `bid`, `ask`, وحقول `price_gram_*`.

تم تنفيذ أربع طلبات HTTP حقيقية فقط:

1. Test Connection قبل clone.
2. Test Connection الداخلي أثناء تفعيل الإعداد عبر خدمة الإدارة canonical.
3. Refresh مركزي واحد داخل clone.
4. طلب metadata حي محدود لتوثيق timestamp.

آخر metadata موثق (دون أي سر): provider `GOLDAPI_IO`، currency `AED`، unit `PER_GRAM`، quote timestamp `2026-08-10T21:55:55.000Z`، received `2026-08-10T21:55:56.729Z`، status `VALID`، quality `OFFICIAL_RESPONSE`، وBID/SPOT/ASK و18K/21K/22K/24K normalized بنجاح.

## Clone والـrefresh

- clone: `darfus_erp_gold_live_feed_06a_rehearsal_20260810215346`.
- المصدر: Acceptance canonical migration `80`.
- baseline تطابق: Assets `475`، Products `3`، Customers `3`، CGP documents `82`، CGP items `92`، Journal entries `497`، Journal lines `1423`، Cash transactions `173`، Gold events `4`، Outbox `59`، reversal compensations `2`.
- الإعداد التجريبي: `LIVE_PROVIDER`, `GOLDAPI_IO`, `AED`, refresh `30s`, stale `120s`.
- policy الاختبار: CGP / DEFAULT / BID / NONE / `0`; ليست سياسة إنتاج.
- refresh المركزي نجح، quote حُفظ في clone فقط، والـhealth أصبح `HEALTHY`.
- Redis غير مضبوط؛ لم يبدأ polling دائمًا ولم يحدث أي global queue mutation.

## CGP Live E2E

المسار الكامل نجح:

`DRAFT → VALIDATED → POSTED → CustomerGoldPurchasePostedEvent → Inventory → Accounting → Gold Center → CRM → Settlement → Reversal`

- Posting لم ينفذ أي HTTP خارجي (`0`).
- السعر الفعال من BID والسياسة، وليس من `proposedRate` العميل.
- snapshot حفظ provider/quote/policy/karat/currency/rate/precision lineage.
- snapshot بقي immutable بعد quote أحدث مضبوط داخل clone.
- quote أحدث لم يغير Posted CGP القديم.
- Inventory أصل واحد بنفس lineage، Accounting متوازن، Gold Center وCRM وSettlement وReversal PASS.
- Settlement وReversal لم يعيدا التسعير من السوق الحالي.

## Fail-closed

- stale quote: فشل قبل Posting مع صفر side effects.
- BID مفقود: لم يُستبدل بـ SPOT، وفشل المسار مغلقًا.
- currency غير صالح للشركة: رُفض قبل إنشاء مستند قابل للنشر، بلا side effects.
- integrity النهائية في clone: unbalanced `0`، orphan journal lines `0`، unlinked treasury `0`، blank barcodes `0`.

## Making Charge وPOS

إعادة اختبار Gold Center/POS نجحت:

- `10g × 10 = 100`.
- `10g × 100 = 1000`.
- `8.75g × 100 = 875`.
- legacy POS بدون `sellingGoldRate` نجح عبر fallback الخادمي `Asset.price / netGoldWeight`.
- making charge بقي `Asset.grossWeight × makingChargePerGram`.
- وزن العميل والإجمالي المزوران غير authoritative.
- الدفع النقدي، Journal، Asset sale state، وdouble-submit canonical behavior PASS.
- CGP acquisition economics لم تتغير.

## Regression والحماية

- Gold Live Feed 01/03/05 contracts PASS.
- CGP IMP-01/02/05A/11 وCONT53 PASS.
- `npx tsc --noEmit` PASS.
- `git diff --check` PASS مع تحذيرات CRLF الموروثة فقط.
- Gold Center browser runtime لم يُستخدم؛ لا توجد جلسة محلية آمنة مسجلة، ولم يُعاد تشغيل listener الموجود.
- Persistent `darfus_erp`: migration `77`، Assets `53`، Products `3`، Customers `1`، unbalanced/orphan/unlinked `0`.
- Acceptance canonical: migration `80`، Assets `475`، Products `3`، quote/settings/policy rows `0` بعد الجولة.
- لا توجد قواعد clone باسم `darfus_erp_gold_live_feed_06a_rehearsal_*`.
- `next-env.d.ts` بقي SHA الموروث `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.
- لا server/SSH/deploy، ولا commit/push، ولا Redis global mutation.

## قرار الإنتاج

الكود والـschema جاهزان للترقية المنفصلة، لكن تفعيل Live Provider تجاريًا في Production ما زال يحتاج Owner-approved commercial pricing policy وruntime secret production configuration. لا توجد ترقية Persistent في هذه الجولة.

```text
GOLD_LIVE_FEED_06A_GATE = PASS_CONFIRMED
```
