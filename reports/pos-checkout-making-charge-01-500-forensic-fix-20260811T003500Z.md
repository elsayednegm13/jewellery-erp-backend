# POS-CHECKOUT-MAKING-CHARGE-01 — Forensic Root Cause and Safe Fix

## نتيجة الجولة

تم تحديد سبب خطأ `500 INTERNAL_SERVER_ERROR` في POS من خلال مصدر الكود وإعادة إنتاج آمنة على قاعدة clone مؤقتة من Acceptance. الإصلاح محدود إلى توافق عقد POS القديم مع خدمة التسعير الحالية، دون تغيير قاعدة الضريبة أو الخصم أو منطق الحجر أو عقد CGP.

## الدليل الجنائي قبل الإصلاح

- المسار: `POST /api/v1/pos/checkout`.
- طلب POS من `app/[locale]/(dashboard)/pos/page.tsx` كان يرسل `makingChargePerGram` وبيانات وزن/إجمالي من العميل، لكنه لم يرسل `sellingGoldRate`.
- `backend/src/services/gold-sale-pricing.service.js`, الدالة `calculateGoldSalePriceForAsset`، كانت ترفض غياب المعدل بالخطأ `GOLD_SALE_PRICING_SELLING_GOLD_RATE_REQUIRED`.
- الاستدعاء من `backend/src/routes/erp.routes.js` داخل مسار البيع كان عند السطر `782`، وظهر التحقق في `executeCanonicalSale` عند السطر `644`.
- Stack trace المعاد إنتاجه قبل الإصلاح:

  ```text
  Error: GOLD_SALE_PRICING_SELLING_GOLD_RATE_REQUIRED
      at Object.calculateGoldSalePriceForAsset (backend/src/services/gold-sale-pricing.service.js:533:11)
      at async executeCanonicalSale (backend/src/routes/erp.routes.js:782:31)
  POST /api/v1/pos/checkout 500
  ```

- الحمولة المعاد إنتاجها كانت صورة الطلب الفاشل: `grossWeight=10`, `makingChargePerGram=10`, `totalMakingCharge=100` مزور، ووزن العميل `1`، دون `sellingGoldRate`.
- معرفا الحادث الأصليان محفوظان من تقرير المالك، ولم يظهرا في السجلات المحلية المحتفظ بها؛ إعادة الإنتاج استخدمت طلبًا جديدًا وأثبتت نفس الاستثناء.
- المقارنة قبل/بعد في clone أثبتت `FAILED_CHECKOUT_PARTIAL_SIDE_EFFECTS = 0`: لا Invoice أو InvoiceItem أو CashTransaction أو Journal أو JournalLine أو حركة مخزون أو تغيير Asset قبل الإصلاح.

## الإصلاح

أضيف fallback خادمي واحد عند غياب المعدل الصريح:

```text
sellingGoldRate = Asset.price / server netGoldWeight
```

هذا fallback توافق لعقد POS التاريخي فقط. عند وجود `sellingGoldRate` صريح يظل مسار المعدل الصريح كما هو. لا يتم الوثوق في `weight` أو `totalWeight` أو `totalMakingCharge` من العميل.

يبقى making charge:

```text
Asset.grossWeight × makingChargePerGram
```

ولا توجد Migration 81 أو تغييرات schema.

## قبول POS بعد الإصلاح

تم تشغيل `backend/scripts/verify-gold-making-charge-01-pos-rehearsal.js` على clone مؤقت باسم `darfus_erp_gold_making_charge_01_rehearsal_...`، مع التحقق من `SELECT current_database()` قبل كل mutation وإسقاط clone في `finally`.

النتائج:

- `10g × 10 = 100` PASS.
- `10g × 100 = 1000` PASS.
- `8.75g × 100 = 875` PASS.
- قيم الوزن والإجمالي المزورة من العميل لم تُقبل كسلطة.
- معدل making سالب رُفض بـ `422`، وبقي Asset متاحًا.
- الدفع النقدي PASS، Journals متوازنة، orphan Journal lines = 0، unlinked Treasury = 0.
- Asset انتقل إلى `sold`، وإعادة الإرسال بنفس idempotency key أعادت نفس الفاتورة بحالة `201` وفق السلوك canonical الحالي.

## الاختبارات الأخرى

- `npx tsc --noEmit` PASS.
- Gold Making Charge contract PASS.
- Gold Live Feed 03 و05 contracts PASS.
- CGP IMP-11 contract PASS.
- CONT53 D01/D11 regression PASS.
- `git diff --check` PASS (تحذيرات CRLF الموروثة فقط).
- لا تم تشغيل Next dev، ولا GoldAPI HTTP، ولا Migration، ولا server خارجي.

## سلامة البيانات والحماية

- Persistent `darfus_erp`: migrations `77`, Assets `53`, Products `3`، بلا كتابة من هذه الجولة.
- Acceptance canonical: migrations `80`, Assets `475`, Products `3`، بلا كتابة دائمة من هذه الجولة.
- لا توجد قواعد clone باسم `darfus_erp_pos_checkout_making_charge_01_rehearsal_*` بعد الاختبار.
- Acceptance fixtures الأصلية لم تُعدّل؛ كل mutations كانت داخل clone ثم أُسقطت.
- `next-env.d.ts` بقي على SHA الموروث `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` ولم يُولّد أو يُصلح.
- GoldAPI secret ما زال غير مضبوط؛ Live Feed 06 ما زال محجوبًا ويحتاج إعداد السر وإعادة التشغيل الصريحة.

## القرار

```text
POS-CHECKOUT-MAKING-CHARGE-01 = PASS_CONFIRMED
ROOT_CAUSE_CLASS = LEGACY_POS_CONTRACT_MISSING_SELLING_GOLD_RATE
POS_CHECKOUT_INTERNAL_SERVER_ERROR_RESOLVED = YES
```
