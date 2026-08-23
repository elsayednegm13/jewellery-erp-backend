# SUPPLIER-GOLD-BAR-CANONICAL-PREVIEW-UNAVAILABLE-RUNTIME-ROOT-CAUSE-FIX-02

## الحالة والحدود

- العطل المرئي أُعيد إنتاجه سابقًا في المتصفح، لكن هذا المتصفح لا يوفّر اعتراضًا لطلب/استجابة POST عبر واجهة التحكم المتاحة؛ لذلك لا أُعلن PASS_CONFIRMED.
- لا توجد كتابة إلى `darfus_erp` أو Acceptance source، ولا Migration 81، ولا تغيير `.env`، ولا إعادة تشغيل.
- كل إيصال فعلي شُغّل فقط على Disposable Clone بواسطة runner السابق، ثم أزيلت النسخة.

## السبب الثانوي المثبت من الخادم

في `backend/src/services/gold-valuation.service.js` كان Gold Bar يطلب VAT rate إجباريًا حتى عندما كانت تكلفة الشهادة `0`. عند عدم وجود VAT rate، كان `resolveVatRate(... required: true)` يرمي `GOLD_VALUATION_VAT_RATE_NOT_CONFIGURED`، والـ preview route يحول الخطأ في الواجهة إلى `غير متاح`.

تم إصلاح هذا الشرط فقط: VAT rate مطلوب عندما تكون تكلفة الشهادة موجبة، أما الشهادة الصفرية فتعطي `vatRate=0`, `vatRateSource=NOT_APPLICABLE`, `vatBase=0`, `vatAmount=0`. لا تغيير في قاعدة VAT للشهادة الموجبة، ولا توسعة لنطاق الشهادة خارج Gold Bar.

## Browser evidence

في تبويب متصفح نظيف، حالة 10g Gold Bar بدون شهادة أعطت:

- visible/internal karat: `24`
- gross/stone/net: `10 / 0 / 10`
- Gold Center purchase/current rate: `516.42415744`
- certificate cost: `0.00`
- certificate VAT: `0.00`
- canonical total rendered: `5,164.24`
- supplier remaining rendered: `5,164.24`
- `غير متاح`: غير ظاهر
- console errors/warnings: لا يوجد في التبويب النظيف

وعند certificate cost `1000` وVAT `5` ظهرت قيمة الذهب `5,164.24`، الشهادة `1,000.00`، VAT `50.00`، الإجمالي `6,214.24`، والمتبقي `6,214.24`.

تظل قيم POST body/status/response غير ملتقطة على wire؛ لا يتم استنتاجها أو ادعاء التقاطها من DOM.

## Profile switch evidence

في تبويب نظيف:

| Scenario | Immediate Gold Bar karat | Settled karat | Result |
|---|---:|---:|---|
| Weight 21K → Bar | 24 | 24 | PASS |
| Piece 21K → Bar | 24 | 24 | PASS |
| Weight 18K → Bar | 24 | 24 | PASS |
| Bar → Weight 21K → Bar | 21 → 24 | 21 → 24 | PASS |
| Piece 22K → Bar | 24 | 24 | PASS |
| 8-step rapid alternating stress | every Bar step 24 | 24 | PASS |

## Backend/clone checks

- Direct service no-certificate valuation: gold value `5000.00000000`, certificate value `0`, VAT base/amount `0`, total `5000.00000000`.
- Closeout clone runner returned `result=PASS`; it covered 24K receipt/read-back, no-certificate receipt, tamper rejection, idempotency, historical/current separation, and Weight/Piece karat matrices.
- Clone databases remaining: `0`.

## Verification

- `npx tsc --noEmit`: PASS.
- Focused ESLint (Supplier Receive + gold valuation): PASS.
- Targeted supplier tests: 11/11 PASS.
- Persistent read-only fingerprint: migrations `80`, Assets `62`, Products `3`, Suppliers `1`, PurchaseOrders `6`, Purchase revisions `61`, Audit `202`, Gold events `6`.
- Acceptance source read-only fingerprint: migrations `80`, Assets `475`, Products `3`, PurchaseOrders `314`, Purchase revisions `442`, Audit `1098`, Gold events `4`.
- Duplicate/blank barcodes, orphan RFID/profile references: `0` on both databases.
- Next-env SHA unchanged at inherited drift `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.
- Dispatcher state and runtime environment were not changed.

## Required gate result

`ACTUAL_PREVIEW_POST_BODY_CAPTURED = NO`  
`ACTUAL_PREVIEW_RESPONSE_CAPTURED = NO`  
`PREVIEW_REQUEST_RESPONSE_CORRELATED = BLOCKED`  
`RUNTIME_NETWORK_EVIDENCE_TABLE = INCOMPLETE`  
`ROOT_CAUSE_EVIDENCE = INCOMPLETE`  
`HANDOFF_RUNTIME_PREVIEW_GAP_CLOSED = NO`  
`SUPPLIER_GOLD_BAR_CANONICAL_PREVIEW_UNAVAILABLE_RUNTIME_ROOT_CAUSE_FIX_02_GATE = BLOCKED`

`NEXT_RECOMMENDED_STEP = LOCAL-PRODUCTION-SMOKE-01-RETRY-STRICT-RUNTIME`
