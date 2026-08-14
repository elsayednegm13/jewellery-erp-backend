# SUPPLIER-RECEIVE-CLONE-GOLD-RUNTIME-BROWSER-RECEIPT-CLOSEOUT-05

## النتيجة

أُجري الاختبار على قاعدة Clone مؤقتة فقط بعد نسخ Acceptance read-only. تم توريث إعداد مزود الذهب من `backend/.env` داخل عملية Clone دون طباعة السر أو تعديل `.env`. استُخدم نفس المتصفح في التسلسل Bar → Weight → Piece → Bar، ثم أُرسلت معاينة نهائية وإرسال استلام حقيقي من واجهة Supplier Receive.

## حدود السلامة

- `darfus_erp` بقي للقراءة فقط: migrations=80، Assets=62، Products=3.
- `darfus_erp_inventory_rehearsal_20260804_160500z` بقي للقراءة فقط: migrations=80، Assets=475، Products=3.
- لم تُشغّل Migration 81، ولم يُشغّل Next dev، ولم يُعاد تشغيل runtime العادي، ولم يتغير `.env` أو Dispatcher.
- أُسقطت قاعدة Clone `darfus_erp_supplier_browser_gold_202608131430` بعد الفحص، وتحقق عدم بقائها.

## Runtime والـGold

- سبب `NOT_CONFIGURED` السابق: عملية Clone السابقة لم تكن تُحمّل `backend/.env`/لم تكن في backend cwd، لذلك لم يصل مفتاح Gold للمسار runtime.
- الإصلاح التشغيلي المؤقت: تشغيل backend Clone من backend cwd مع `dotenv`، وتغيير `DB_NAME` و`DATABASE_URL` داخل العملية فقط. لم تُنسخ قيمة السر إلى ملف أو قاعدة بيانات.
- وجود السر: تم التحقق من وجوده وطوله فقط، بدون إخراجه.
- `/api/v1/health/gold` على Clone: HTTP 200، `GOLDAPI_IO / LIVE_PROVIDER / AED`، fresh quote، `isMockFallback=false`.

## دليل المتصفح الفعلي

- نفس جلسة المتصفح نفذت: `GOLD_BAR_24K` → `GOLD_BY_WEIGHT_JEWELLERY` → `GOLD_BY_PIECE` → `GOLD_BAR_24K`.
- بعد استعادة Supplier context النهائي، POST المعاينة الفعلي كان `GOLD_BAR_24K`, 24K, gross=10, stone=0, purchase/current gold rate=500, certificate=100/120, VAT=7.25/7.25.
- رد المعاينة النهائي: HTTP 200، `goodsTotal=5107.25`, `totalWeight=10`, `netWeight=10`, `pureGold9999=10`, `purchaseGoldValue=5000`, `purchaseVat=7.25`, `purchaseTotal=5107.25`, `vatRateSource=MANUAL`.
- زر الإرسال ظل معطلاً أثناء البيانات غير الصالحة، ثم أصبح فعالاً بعد اكتمال الحقول وإعادة اختيار Supplier؛ لا يوجد false unavailable في النتيجة النهائية.
- POST الاستلام الفعلي من الواجهة: HTTP 201، PO `PO-1786614658645`, total `5107.25`, idempotency key موجود.
- الاستجابة أنشأت Asset واحدة `AST-PUR-1786614658919-1-1-yurw` بباركود `GODODD24000001`، profile `GOLD_BAR_24K`، status `AVAILABLE`، و`treasuryTransaction=null`.

## إثبات Clone DB بعد POST

| الأثر | النتيجة |
|---|---|
| Purchase Order | صف واحد، `received`, total `5107.25000000` |
| Purchase Order Item | صف واحد، quantity=1، received_quantity=1 |
| Asset link | رابط واحد لنفس Asset |
| Asset | صف واحد، barcode count=1، net=10، computed gold cost=5000، final purchase cost=5100 |
| Purchase cost revision | Revision واحدة، `is_current=true`، gold value=5000، certificate base=100، VAT=7.25، total purchase cost=5107.25 |
| Journal | `JE-1786614659099` واحد، posted، debit=credit=5107.25 |
| Journal lines | `SYS-INVENTORY` مدين و`SYS-AP` دائن |
| Treasury/Cash | صفر صفوف مرتبطة بالـPO؛ لا حركة نقدية لاستلام غير مدفوع |
| Orphans/integrity | blank barcode=0، orphan journal lines=0، unlinked treasury=0، orphan PO items/asset links/cost revisions=0 |

## Idempotency

أُعيد نفس POST بنفس body ونفس Idempotency-Key مباشرة إلى Clone قبل إسقاطه. الرد أعاد HTTP 201 ونفس PO ونفس Asset، ولم ينشئ أثراً ثانياً. `GOLD_RECEIVE_IDEMPOTENCY=PASS`.

## الاختبارات

- TypeScript: `npx tsc --noEmit` PASS.
- Focused ESLint على Supplier Receive PASS.
- عقود profile-switch/async preview وGold receipt: 7/7 PASS.
- لا تحذير React أو unhandled exception في المسار النهائي؛ أخطاء HTTP 500 الوسيطة كانت معاينات متوقعة أثناء تبديل profile قبل اكتمال الحقول.

## البوابات

```text
ACTIVE_RUNTIME_GOLD_CREDENTIAL_PRESENT = YES
GOLD_SECRET_EXPOSED = NO
GOLD_SECRET_PERSISTED = NO
RUNTIME_ENV_FILE_CHANGED = NO
CLONE_GOLD_RUNTIME_HEALTH = PASS
REAL_BROWSER_CLONE_TARGET = PASS
SAME_BROWSER_MULTI_SWITCH_RECEIPT = PASS
FINAL_PREVIEW_GENERATION_MATCH = PASS
ACTUAL_FINAL_PREVIEW_POST_CAPTURE = YES
ACTUAL_FINAL_PREVIEW_RESPONSE_CAPTURE = YES
ACTUAL_BROWSER_RECEIPT_POST_CAPTURE = YES
ACTUAL_BROWSER_RECEIPT_RESPONSE_CAPTURE = YES
CLONE_BROWSER_RECEIPT_DB_PROOF = PASS
CLONE_BROWSER_RECEIPT_IDEMPOTENCY = PASS
PROFILE_SWITCH_STATE_RECHECK = PASS
FALSE_UNAVAILABLE_RUNTIME = NO
BROWSER_CONSOLE_RUNTIME = PASS
PERSISTENT_BROWSER_READONLY_ACCEPTANCE = PASS
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
ACCEPTANCE_SOURCE_PRESERVED = PASS
EPHEMERAL_CLONE_RUNTIME_STOPPED = PASS
DISPOSABLE_CLONE_DROPPED = PASS
MIGRATIONS_BEFORE = 80
MIGRATIONS_AFTER = 80
MIGRATION_81 = NO
NEXT_ENV_SHA_PRESERVED = YES
CGP_DISPATCHER_MUTATED_THIS_BATCH = NO
SUPPLIER_RECEIVE_CLONE_GOLD_RUNTIME_BROWSER_RECEIPT_CLOSEOUT_05_GATE = PASS_CONFIRMED
```

`SAME_BROWSER_RECEIPT_TABLE=COMPLETE` و`CLONE_GOLD_RUNTIME_TABLE=COMPLETE`.
