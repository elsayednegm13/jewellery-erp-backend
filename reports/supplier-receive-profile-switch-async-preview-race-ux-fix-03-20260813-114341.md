# تقرير SUPPLIER-RECEIVE-PROFILE-SWITCH-ASYNC-PREVIEW-RACE-UX-FIX-03

## 1. ملخص تنفيذي

تم تنفيذ إصلاح محدود في شاشة Supplier Receive نفسها لعزل انتقال الـ Profile عن طلبات المعاينة المالية القديمة. الإصلاح يستخدم generation/sequence guards، وAbortController، ومسحاً ذرياً للحقول المملوكة للـ Profile، وحالة معاينة صريحة `loading/ready/unavailable`، وقفل Submit حتى تطابق المعاينة الحالية الجيل الحالي.

تمت مراجعة حقيقية في Chrome مسجّل الدخول، واختبار Playwright مع اعتراض شبكة معزول لتسجيل POST الفعلي للمعاينة دون أي اتصال بقاعدة عمل أو كتابة بيانات. اختبارات TypeScript وESLint والاختبارات المركزة نجحت. لكن معيار هذه الدفعة يطلب استلام استجابة قديمة متأخرة فعلياً بعد الاستجابة الجديدة؛ في الاختبار الواقعي أُلغي الطلب القديم قبل أن يصدر استجابة، لذلك بقيت بوابة الدفعة `BLOCKED` ولا توجد مطالبة PASS_CONFIRMED.

## 2. حدود التغيير والسلامة

- الملفات المعدلة لهذه الدفعة: `app/[locale]/(dashboard)/suppliers/purchases/page.tsx`، واختبار static جديد، وهذا التقرير.
- لا Migration، ولا Next dev، ولا restart، ولا نشر، ولا commit، ولا push.
- لا تحديث لـ `PROJECT_PROGRESS_HANDOFF.md` لأن بوابة PASS_CONFIRMED لم تتحقق.
- الاتصالان المستخدمان في فحوص القراءة فقط كانا بالاسمين الصحيحين:
  - `darfus_erp`
  - `darfus_erp_inventory_rehearsal_20260804_160500z`
- بصمة `next-env.d.ts` الحالية بقيت drift الموروث `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` ولم تتغير.

## 3. تصنيف العيب قبل الإصلاح

التصنيف المؤيد من source review ولقطات المستخدم: حالة هجينة ناتجة عن reset غير ذري للحقول، وطلبات preview متداخلة، وإمكانية عرض ملخص مالي قديم أثناء الانتقال. إعادة إنتاج الحالة الهجينة قبل تعديل الكود في نفس جلسة الدفعة لم تعد ممكنة دون الرجوع للكود، ولذلك `PRE_FIX_HYBRID_STATE_REPRODUCTION=INCOMPLETE`.

## 4. الإصلاح المنفذ

في شاشة `Supplier Receive`:

1. كل تغيير Profile يزيد generation ويُلغي Controller السابق.
2. Profile وحقوله المملوكة تُمسح في نفس handler قبل بدء preview الجديد.
3. الوصف التلقائي القديم يمسح مع بقية الحقول المملوكة، فلا ينتقل وصف Bar إلى Weight/Piece.
4. نتيجة الطلب تُقبل فقط إذا تطابق sequence والgeneration ولم يكن الطلب ملغياً.
5. حالات المعاينة منفصلة: `loading`، `ready`، `unavailable`، ولا تعرض الحالة القديمة على أنها `unavailable` أثناء الانتظار.
6. الملخص المالي الحالي لا يُحسب من fallback قديم؛ Submit مقفول حتى تطابق `acceptedPreviewKey` و`acceptedPreviewGeneration` الحالة الحالية.
7. لا توجد سلطة كمية أو تسعير جديدة؛ المسار الحالي للـ API هو نفسه.

## 5. مصفوفة ملكية الحقول

| الفئة | الحقول المملوكة | سلوك الانتقال |
|---|---|---|
| مشترك | Profile، الوصف، الوزن المشترك، الهوية، Brand/Model، Branch/Location | تبقى فقط إن كان العقد المشترك يدعمها |
| Gold Bar | certificate، VAT، purchase/current gold values، issuer/number/date، rate overrides | تمسح عند الخروج من Bar |
| Gold Weight | gold rate/value، karat، gold color، making/current values | تمسح عند الخروج من Weight |
| Piece | purchase cost، condition، piece identity | تمسح عند الخروج من Piece |
| Gemstone/Pearl/Loose | المراجع والخصائص الخاصة بها | تمسح عند الخروج من كل Profile غير المالكة |
| Derived | Net/Pure/preview totals | لا تُدخل محلياً كسلطة؛ تُعرض من preview المقبول فقط |

## 6. أدلة المتصفح والشبكة

### Chrome الحقيقي

- تم استخدام صفحة `http://localhost:3000/ar/suppliers/purchases` في Chrome مسجّل الدخول.
- تم تنفيذ 50 انتقال Profile متتالي؛ النتيجة النهائية استقرت على آخر Profile، بلا أخطاء console أو تحذيرات.
- أثناء الانتقال ظهر `جاري إعادة الحساب…`، اختفى Submit، واختفت حقول Profile القديم.
- Bar وWeight وPiece اختُبرت بعد الاستقرار؛ لكل منها ملخص موجب، وحقل Profile الصحيح، وSubmit مفعّل فقط بعد preview صالح.
- Profile Bar أبقى karat=24K وأظهر certificate/VAT فقط عند الاستقرار.

### Playwright network harness معزول

تم التقاط POST حقيقي من الصفحة إلى `/api/v1/inventory-v2/receive-preview` مع bodies فعلية، منها:

- `GOLD_BAR_24K`, `karat=24`, `hasGoldValuation=true`
- `GOLD_BY_PIECE`, `karat=21`, `hasGoldValuation=false`

تم حجز طلب Bar ثم التحويل إلى Piece؛ أُلغيت الاستجابة القديمة بسبب AbortController، ووصلت استجابة Piece الحالية وبقيت الشاشة Piece وtotal=500 بلا unavailable. هذا يثبت الإلغاء وlatest-wins للحالة الحالية، لكنه لا يثبت وصول response قديم بعد response جديد.

في stress سريع من 50 انتقالاً في harness التقطت الشبكة طلب preview نهائياً واحداً للحالة المستقرة، ولم يظهر preview قديم في واجهة المستخدم.

## 7. نتائج السيناريوهات

| الاختبار | النتيجة | الدليل/القيد |
|---|---|---|
| Bar screen | PASS | Chrome: certificate/VAT، 24K، total، Submit بعد الاستقرار |
| Weight screen | PASS | Chrome: وزن/ملخص صالح، بلا حقول certificate |
| Piece screen | PASS | Chrome: cost/condition، total=500، بلا Gold Center/certificate |
| Non-gold isolation | PASS | stress وتسلسلات Diamond/Gemstone/Pearl/Loose |
| 50 transitions | PASS | `failures=[]`, console logs فارغة |
| click-before-settle | PASS | Submit disabled أثناء loading |
| current invalid request | PASS | تظهر `ملخص الخادم غير متاح` ويظل Submit مقفولاً |
| forced old response after new | BLOCKED | الطلب القديم أُلغي قبل response event |
| deliberately stale 4xx after valid | FAIL (دليل غير مكتمل) | لم تصل استجابة 4xx قديمة فعلياً؛ الحارس البرمجي موجود |
| clone receipt after browser multi-switch | BLOCKED | clone backend receipt proof نجح، لكن لم يُربط بإرسال UI بعد switching |

## 8. اختبار الاستلام القابل للتصرف

شُغّل `backend/scripts/supplier-gold-bar-receipt-pricing-e2e-closeout-01.js` على clone مؤقت، وكانت النتيجة PASS مع receipt/valuation/inventory integrity، ثم تم التحقق أن clone `darfus_erp_supplier_gold_closeout_*` غير موجود بعد التنظيف. هذا يثبت مسار الاستلام الخلفي، وليس شرط browser-submit بعد multi-switch؛ لذلك لا يُستخدم لإغلاق بوابة الدفعة.

## 9. الاختبارات الآلية

- `npx tsc --noEmit`: PASS
- ESLint للصفحة: PASS
- الاختبار static الجديد: 4/4 PASS
- اختبارات Supplier السابقة المركزة: 11/11 PASS
- لا توجد كتابة قاعدة بيانات من هذه الاختبارات.

## 10. بصمات قاعدة البيانات الحالية (قراءة فقط)

| DB | Migrations | Assets | Products | Journal unbalanced | Orphan lines | Unlinked cash journal | Duplicate/blank barcode |
|---|---:|---:|---:|---:|---:|---:|---:|
| `darfus_erp` | 80 | 62 | 3 | 0 | 0 | 0 | 0 / 0 |
| `darfus_erp_inventory_rehearsal_20260804_160500z` | 80 | 475 | 3 | 0 | 0 | 0 | 0 / 0 |

وفحوص القراءة فقط أظهرت orphan RFID=0، orphan profile references=0، orphan inventory movements=0 في القاعدتين. لا يمكن استنتاج أن القيمة الاقتصادية الحالية لم تتغير تاريخياً من هذه الجولة وحدها، لكن لم تُنفذ أي mutation في هذه الدفعة.

## 11. القرار

التحسين آمن من ناحية المصدر والـ state guards، لكن الدليل المطلوب لإغلاق السباق (استجابة قديمة متأخرة فعلياً، وreceipt من browser بعد multi-switch على clone) غير مكتمل. لذلك لا يتم تحديث handoff ولا تُغلق الدفعة.

## 12. التوصية التالية

إعادة تشغيل اختبار الشبكة في harness يسمح بتأخير الاستجابة القديمة ثم إرسالها فعلياً بعد نجاح الاستجابة الجديدة، مع إبقاء أول POST للـ old request قابلاً للإرسال بدلاً من إلغائه، ثم تنفيذ receipt عبر نفس browser session على clone قابل للتصرف. بعد ذلك فقط يمكن تقرير `PASS_CONFIRMED`.

