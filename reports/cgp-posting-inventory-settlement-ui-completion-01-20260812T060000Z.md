# تقرير تنفيذ CGP-POSTING-INVENTORY-SETTLEMENT-UI-COMPLETION-01

## 1. النطاق والقيود

- تم تنفيذ تغييرات واجهة/عرض القراءة وخريطة الأعمال فقط ضمن نفس CGP flow.
- لم تُنشأ Migration 81، ولم تُستخدم قاعدة `darfus_erp` أو قاعدة Acceptance لكتابة معاملات العمل.
- كل الكتابة الاختبارية تمت داخل clone مؤقت مشتق من Acceptance ثم حُذف.
- لم يبدأ Next dev ولم يُعاد تشغيل أي خادم.

## 2. ما تم تنفيذه

- جعل طلبات أسعار Gold Center في `use-core-erp-data` demand-gated؛ صفحة CGP لا تطلب `/gold/karat-prices` بلا داعٍ.
- إضافة `GET /gold-purchases/cgp/drafts/:id/business-view` كإسقاط قراءة موحّد للتكاملات والأصول والمحاسبة والذهب وCRM ومستحق العميل والتسويات والعكس ولقطات التسعير.
- إضافة حالة قراءة تاريخية غير قابلة للتحرير للمستندين `POSTED` و`REVERSED`.
- إظهار وصف القطعة في نفس الحقل canonical `line.notes` وتمريره عبر حدث الترحيل إلى Asset name/description، بلا تغيير schema.
- إضافة لوحة أعمال بعد الترحيل: حالات التكامل، Assets وBarcode، قيمة الشراء، المدفوع والمتبقي، تاريخ التسوية، حالة العكس ولقطة التسعير غير القابلة لإعادة التسعير.
- حماية business-view بالصلاحيات الموجودة فقط؛ لم تُنشأ صلاحية settlement جديدة.

## 3. فجوة متبقية تمنع الإغلاق الكامل

خدمة `financial-settlement.service.js` موجودة ومُثبتة في clone E2E، لكن لا يوجد route HTTP canonical لـCGP settlement ولا permission باسم settlement في catalog الحالي. لذلك لم تتم إضافة زر دفع يستعمل صلاحية غير معتمدة أو legacy payout route. هذا يتطلب قرار Owner/Batch لاحق قبل جعل `CGP_SETTLEMENT_UI` مكتملًا.

## 4. نتائج clone E2E

- clone: `darfus_erp_cgp_ui_completion_1786513988111_80d094e1` ثم حُذف.
- 3 CGP items → 3 Assets، كل قطعة Asset مستقل.
- Assets: `AVAILABLE`، أسماء وأوصاف القطع محفوظة، Barcodes فريدة.
- لا Asset قبل POST، ولا Treasury payment غير مطلوب عند POST.
- Accounting journal وCustomerFinancialLiability أُنشئا بعد POST.
- Gold Center event وCRM soft projection نجحا.
- Mixed settlement: Cash `1.0000` + Bank `1.0000`، المدفوع `2.0000`، مع bank reference.
- unbalanced journals = 0، orphan journal lines = 0، unlinked treasury = 0، blank barcodes = 0.

## 5. تحقق قواعد البيانات

- Acceptance: current database صحيح، migrations `80`، Assets `475`، Products `3`، CGP documents `82`، items `92`، ولم يتغير شيء بعد الاختبار.
- Persistent: current database `darfus_erp`، migrations `80`، Assets `53`، Products `3`، unbalanced journals = 0، orphan lines = 0، blank/duplicate barcodes = 0.
- لا توجد clones متبقية باسم `darfus_erp_cgp_ui_completion_*`.

## 6. التحقق الأمامي

- صفحة CGP تعرض المستند المرحّل للقراءة فقط؛ لا تظهر أزرار حفظ/إرسال/مراجعة/تحرير للمستند POSTED.
- business-view استُدعي بنجاح من الصفحة.
- Console errors = 0، وطلبات Gold karat غير المطلوبة لم تعد تصدر من صفحة CGP.
- لا توجد مكالمات GoldAPI مباشرة من frontend.

## 7. الاختبارات

- `npx tsc --noEmit --pretty false` — PASS.
- `node backend/tests/customer-gold-cgp-ux-legacy-isolation.test.cjs` — PASS.
- `node backend/tests/cgp-imp-11-contract.test.cjs` — PASS.
- `node backend/scripts/cgp-posting-inventory-settlement-ui-completion-01.js` — dry-run PASS.
- `node backend/scripts/cgp-posting-inventory-settlement-ui-completion-01.js --execute` — clone E2E PASS.

## 8. القرار

التنفيذ الحالي يحقق عرض الحالة والتكاملات والقراءة التاريخية ويحافظ على canonical posting، لكنه لا يغلق UI settlement لأن HTTP action/permission غير موجودين. لذلك لم يتم تحديث `PROJECT_PROGRESS_HANDOFF.md`، ولم تُعلن الدفعة مكتملة.

CGP_POSTING_INVENTORY_SETTLEMENT_UI_COMPLETION_01_GATE = BLOCKED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
