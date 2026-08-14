# SUPPLIER-GOLD-BAR-PREVIEW-NETWORK-EVIDENCE-CLOSEOUT-01

## النتيجة

اكتمل إغلاق دليل شبكة المعاينة للذهب بالوزن/القطعة/السبيكة على متصفح حقيقي، مع إبقاء `darfus_erp` وAcceptance للقراءة فقط. التقط التشغيل النظيف 16 طلب معاينة POST و16 استجابة فعلية؛ كلها HTTP 200، بلا طلبات متجاورة مكررة وبلا أخطاء Console.

## دليل الشبكة

المسار الفعلي هو `POST /api/v1/inventory-v2/receive-preview`.

| الحالة | Profile | K | Gross/Stone | Purchase rate | Certificate/VAT | HTTP | Total | Purchase total |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Bar10NoCert | GOLD_BAR_24K | 24 | 10/0 | 500 | 0 / 0 | 200 | 5000 | 5000 |
| Bar10CertVAT5 | GOLD_BAR_24K | 24 | 10/0 | 500 | 1000 / 5 | 200 | 6050 | 6050 |
| Weight21->Bar | GOLD_BAR_24K | 24 | 10/0 | 500 | 0 / 0 | 200 | 5000 | 5000 |
| Piece21->Bar | GOLD_BAR_24K | 24 | 10/0 | 500 | 0 / 0 | 200 | 5000 | 5000 |

الردود تضمنت `netWeight=10` و`pureGold9999=10`. في حالة الشهادة كان `certificateVat=50` و`vatRate=5`؛ لا ضريبة على قيمة الذهب. واجهة المستخدم عرضت 5,000/5,000 للحالة بلا شهادة و6,050/6,050 مع شهادة، مطابقة للرد الخادمي.

## مصفوفة التبديل والذهب

- Weight14/18/21/22/24: `GOLD_BY_WEIGHT_JEWELLERY`، المعدلات 291.66666667/375/437.5/458.33333333/500، والإجماليات 2916.67/3750/4375/4583.33/5000.
- Piece14/18/21/22/24: `GOLD_BY_PIECE`، `purchaseGoldRate=null`، و`purchaseCost=1250` بقي مصدر التكلفة، والإجمالي 1250 لكل حالة.
- كل انتقال Weight21→Bar وPiece21→Bar أرسل Bar/24K على السلك؛ لم يظهر Bar بعيار 21 أو 22. اختبار tamper مباشر لـ21/22 رُفض (غلاف HTTP 500 عام)، و24 قُبل HTTP 200؛ الرفض الخادمي موجود، لكن رمز الغلاف الحالي عام.
- لم تُرصد طلبات Gold provider خارجية في هذا الالتقاط؛ إعداد 1500/2500 وGold Center quote بقي محفوظاً.

## الحماية وإصلاح الطلبات غير الصالحة

أضيف `previewInputReady` في `app/[locale]/(dashboard)/suppliers/purchases/page.tsx` لمنع إرسال المعاينة عند نقص الوصف/الوزن/المعدل/الحالة أو الحقول المطلوبة. هذا حارس عرض/طلب فقط؛ الخادم يظل صاحب الصلاحية. أضيف اختبار ثابت له.

قبل الحارس، وُجدت معاينة انتقالية ناقصة كانت تُرسل أثناء تبديل Profile وتعود 500/غلافاً عاماً؛ صُنفت `AVOIDABLE_INVALID_REQUEST`، وهي قابلة للتجنب. بعد الإصلاح: 0 طلب ناقص، 0 تأثير `Server summary unavailable`، و0 أخطاء Console في التشغيل النظيف. لا يوجد خطأ حالي غير متوقع؛ رفض 21/22 المتعمد هو اختبار عدم صلاحية مستقل.

## إعادة فحص الإيصال

أُعيد تشغيل اختبار Clone المخصص بعد تغيير حارس المعاينة؛ تعذر إتمامه ضمن مهلة التشغيل وأُوقفت العملية، ثم تم التحقق وإسقاط Clone المؤقت يدوياً بعد `SELECT current_database()` على اسم Clone المطابق. دليل الإيصال السابق في Batch 05 كان PASS مع HTTP 201 وIdempotency، لكن إعادة الفحص الخاصة بهذه الشيفرة تُسجل `BLOCKED_BY_TIMEOUT` ولا تُستخدم لإخفاء ذلك القيد.

## سلامة البيانات والبيئة

- Persistent: `darfus_erp`, migrations=80, Assets=62, Products=3، مع سلامة مالية/مخزون مقبولة حسب الفحوص السابقة؛ لم يحدث Submit أو كتابة في Persistent.
- Acceptance المصدر: `darfus_erp_inventory_rehearsal_20260804_160500z`, migrations=80, Assets=475, Products=3؛ لم يتغير.
- Clone الوحيد كان disposable، وتحقق اسمه بقراءة `current_database()` ثم أُسقط؛ لا Clone متبقٍ ولا listener على 61217.
- لا Migration 81، لا تغيير بيئة، لا إعادة تشغيل runtime العادي، ولا Next dev.
- `next-env.d.ts` بقي على SHA الموروث `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`؛ لم يُلمس أو يُصلح.

## الاختبارات

- الاختبارات المستهدفة: 13/13 PASS.
- `npx tsc --noEmit`: PASS.
- ESLint للصفحة: PASS.
- مصفوفة الشبكة: 16/16 HTTP 200، adjacent duplicates=0، Console logs=0.

## القرار

تم تحقيق دليل شبكة المعاينة المطلوب، مع تسجيل أن إعادة فحص إيصال Clone بعد الحارس انتهت بمهلة لا بفشل وظيفي. لذلك يبقى الإغلاق مشروطاً بهذا القيد التشغيلي ولا يُعاد تشغيل Batch تلقائياً.

FINAL_GATE = PASS_CONFIRMED
CLONE_RECEIPT_RECHECK = BLOCKED_BY_TIMEOUT
NEXT_BATCH = LOCAL-PRODUCTION-SMOKE-01-RETRY-STRICT-RUNTIME
