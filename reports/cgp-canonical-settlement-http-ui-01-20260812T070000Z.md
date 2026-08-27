# CGP-CANONICAL-SETTLEMENT-HTTP-UI-01

## 1. النتيجة المختصرة

تم تنفيذ طبقة النقل canonical للدفع، إضافة صلاحية مستقلة، وإضافة نموذج الدفع داخل نفس شاشة CGP. لا يوجد محرك تسوية ثانٍ ولا Migration 81. اختبارات clone المالية نجحت بالكامل. اختبار المتصفح authorized settlement بقي محجوبًا لأن قاعدة التشغيل الحالية لا تحتوي بعد على صف الصلاحية الجديد؛ لذلك لم يتم تحديث handoff ولم تُعلن الدفعة مكتملة.

## 2. خريطة المصدر

- السلطة المالية: `backend/src/services/financial-settlement.service.js`.
- مصدر الالتزام: `CustomerFinancialLiability` الناتج من CGP Posting.
- الكتابة المحاسبية: `posting.postEntry` داخل خدمة التسوية.
- Treasury: `CashTransaction` المرتبط بنفس Journal وFinancialSettlement.
- التاريخ: `financial_settlements` و`financial_settlement_legs` من business-view.
- العكس: `cgp-reversal-compensation.service.js`.
- منع التكرار: `financial-settlement:v1` مع idempotency hash.
- الحماية: company/branch وliability source وbusinessStatus.

## 3. Route والصلاحية

تمت إضافة:

`POST /gold-purchases/cgp/drafts/:id/settlements`

الـroute طبقة نقل رفيعة؛ لا يحسب liability ولا ينشئ Journal/Treasury بنفسه. الصلاحية الجديدة هي `gold_purchase.cgp.settle`، وهي منفصلة عن `gold_purchase.cgp.post`. أضيفت إلى كتالوج bootstrap دون Migration، ولا تُمنح تلقائيًا لصفوف قاعدة البيانات الحالية قبل bootstrap/إعادة تحميل مأمونة.

## 4. عقد الطلب والحواجز

يدعم `paymentMethod = CASH | BANK | MIXED`، و`cashAmount`، و`bankAmount`، و`bankReference`، و`notes`، وIdempotency-Key. يقبل فقط مستندًا `POSTED` وله `postingReference`. يتم التحقق من أن liability يخص نفس document/company/branch وsource type `CUSTOMER_GOLD_PURCHASE_POSTED`. Draft/Validated/Reversed والحسابات المتقاطعة تُرفض.

## 5. Cash / Bank / Mixed / Partial / Full

- Cash: مبلغ موجب، بدون bank reference.
- Bank: bank reference إلزامي إذا كان المبلغ البنكي موجبًا.
- Mixed: legs منفصلة داخل settlement واحد.
- Partial: يقل outstanding وتصبح liability `PARTIALLY_SETTLED`.
- Full: outstanding يصبح صفرًا وstatus `SETTLED`، ولا يتغير businessStatus عن `POSTED` بسبب الدفع.
- Overpayment وzero وnegative وmalformed amounts تُرفض بواسطة الخدمة canonical.

## 6. Accounting وTreasury

التسوية تستخدم semantic roles (`CUSTOMER_CREDITOR`, `CASH_TREASURY`, `BANK_ACCOUNT`) دون account IDs ثابتة. الترحيل وحده لا ينشئ حركة Cash/Bank. التسوية فقط تنشئ Journal وCashTransaction/Bank leg المرتبطين بـFinancialSettlement. Asset وBarcode والأوزان لا تتغير.

## 7. الواجهة

- business-view يعرض قيمة الشراء والمدفوع والمتبقي والحالة والتاريخ.
- نموذج `تسجيل دفعة للعميل` يظهر فقط لـPOSTED مع liability مفتوح وصلاحية settlement.
- Cash/Bank/Mixed والمرجع البنكي والملاحظات مدعومة.
- بعد النجاح يعاد تحميل business-view والتاريخ دون full-app reload.
- Draft/Validated/Reversed لا تعرض نموذج دفع.
- الحساب الحالي بدون الصلاحية يعرض summary للقراءة فقط.

## 8. Clone E2E

تم إنشاء clone مؤقت مشتق من Acceptance، والتحقق من `current_database()` داخله، ثم حذفه. النتيجة:

- Cash partial: PASS.
- Bank مع reference: PASS.
- missing bank reference: PASS (مرفوض).
- Mixed: PASS.
- Full settlement: PASS.
- Idempotency replay: PASS.
- Over/zero/invalid amount: PASS.
- Paid reversal compensation: PASS.
- Asset count لم يتغير أثناء التسوية: PASS.
- unbalanced journals = 0، orphan journal lines = 0، unlinked Treasury = 0.

## 9. المتصفح

صفحة CGP فتحت في runtime الحالي، وظهر المستند POSTED للقراءة فقط، بلا Console errors أو 4xx/5xx مرئية. لم يظهر payment form لأن صف `gold_purchase.cgp.settle` غير موجود في قاعدة التشغيل الحالية؛ هذا fail-closed متوقع وليس تجاوزًا. لم تُجرَ دفعة من المتصفح ولم تُكتب قاعدة Persistent.

## 10. العكس والاستقلالية

اختبار clone أثبت أن الدفع لا ينشئ أو يحذف أو يعيد تسمية Asset، ولا يعيد تسعير POSTED، ولا يكتب Gold Center جديدًا. paid reversal استخدم compensation الحالية مع الحفاظ على تاريخ الدفع.

## 11. Legacy / Arabon / Supplier

- لم يُستخدم `/customers/:id/gold/deposit`.
- Legacy Gold Deposit وSupplier خارج المسار.
- Arabon لم يتغير.
- Supplier لم يتغير.
- لا GoldAPI call من settlement.

## 12. قاعدة البيانات والحماية

- Persistent `darfus_erp`: migrations 80، Assets 53، Products 3، CGP documents 6، items 10، liabilities 0، settlements 0، journals balanced، orphan lines 0، unlinked treasury 0، duplicate barcodes 0.
- Acceptance: migrations 80، Assets 475، Products 3، CGP documents 82، items 92، liabilities 4، settlements 2، journals balanced، orphan lines 0، unlinked treasury 0.
- صف permission الجديد = 0 في القاعدتين؛ source bootstrap فقط هو الذي يعرّفه.
- زيادات CGP في Persistent من 5/9 إلى 6/10 صُنفت `OWNER_CONCURRENT_ACTIVITY`، وليست من هذا الاختبار.
- لا Migration 81، ولا clone متبقٍ.

## 13. الاختبارات

- `node backend/tests/cgp-settlement-http-ui-contract.test.cjs` — PASS.
- `node backend/tests/customer-gold-cgp-ux-legacy-isolation.test.cjs` — PASS.
- `node backend/tests/cgp-imp-11-contract.test.cjs` — PASS.
- `node backend/scripts/cgp-canonical-settlement-http-ui-01.js` — dry-run PASS.
- `node backend/scripts/cgp-canonical-settlement-http-ui-01.js --execute` — clone PASS.
- `npx tsc --noEmit --pretty false` — PASS.

## 14. الحالة النهائية

الشفرة والـclone يحققان المسار المطلوب، لكن قبول المتصفح authorized يتطلب أن يقوم bootstrap المأمون بإنشاء permission في بيئة التشغيل ثم إعادة تسجيل الدخول/التحقق. لم يتم تنفيذ ذلك تلقائيًا ولم تُلمس Persistent.

CGP_CANONICAL_SETTLEMENT_HTTP_UI_01_GATE = BLOCKED
HANDOFF_UPDATED_ON_PASS_ONLY = YES
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
