# CGP-PRESENTATION-LOCALIZATION-DATE-CLEANUP-01

## النتيجة

تم تنظيف العرض داخل شاشة CGP canonical فقط، بدون تغيير Workflow أو Posting أو
Settlement أو Accounting أو Inventory أو Gold Center أو CRM.

## التغييرات

- `lib/cgp/presentation.ts`: سلطة عرض ضيقة تعيد استخدام `formatDate` و`formatDateTime`
  و`formatAppMoney` و`toEnglishDigits`، مع خرائط حالات CGP والتكامل والأصل والعكس
  وطريقة الدفع.
- `features/gold-purchases/components/GoldPurchaseDraftWorkspace.tsx`: تواريخ
  القائمة والتفاصيل، أوقات التسوية، مبالغ الأربع خانات، أوزان وIDs مع عزل LTR،
  وتسميات عربية للحالات والتكامل.
- `app/[locale]/(dashboard)/approvals/page.tsx`: ترجمة حالة Governance ونوع
  CGP مع الحفاظ على actionability والرسالة immutable السابقة.
- `backend/tests/cgp-presentation-localization-date.test.cjs`: اختبارات التاريخ
  والـdatetime والحالات والأرقام وBidi ومراجعة عدم تسريب ISO/raw tokens.

لا يوجد تعديل على تواريخ التخزين أو API، ولا Migration أو إعدادات أو صلاحيات.

## معيار العرض

- التاريخ: `DD/MM/YYYY`.
- datetime: `DD/MM/YYYY HH:mm` في `Asia/Dubai` عبر utility المشروع.
- الأرقام المرئية: Latin `0-9` عبر `toEnglishDigits`.
- النص RTL محفوظ، والأرقام وIDs معزولة باتجاه LTR.
- الأموال تعرض 4 خانات للحفاظ على الدليل المالي؛ لم يتم تقريب أو تغيير القيمة.
- DateInput الحالي يبقى نصيًا بقراءة `DD/MM/YYYY` ويدعم تطبيع الأرقام العربية/الفارسية.

## خرائط الحالات

`POSTED` = تم الترحيل، `PENDING` = معلّق، `SUCCEEDED` = تم بنجاح، وCRM pending
يظهر «معلّق — عرض إسقاطي». حالة الأصل `AVAILABLE` تظهر «متاح». رسالة
`DOCUMENT_IMMUTABLE` في Governance تظل عربية من الدفعة السابقة.

## قبول المتصفح

على `/ar/sales/customer-gold/drafts` ظهرت الوثائق الأربع المستعادة في القائمة:

| الوثيقة | تاريخ القائمة | حالة العرض | Settlement | النتيجة |
|---|---:|---|---|---|
| CGPD-000004 | 11/08/2026 | تم الترحيل | تسجيل دفعة للعميل | PASS |
| CGPD-000005 | 11/08/2026 | تم الترحيل | تسجيل دفعة للعميل | PASS |
| CGPD-000006 | 12/08/2026 | تم الترحيل | تسجيل دفعة للعميل | PASS |
| CGPD-000007 | 12/08/2026 | تم الترحيل | تسجيل دفعة للعميل | PASS |

تفاصيل العرض أظهرت Assets وBarcodes وحالة «متاح» ونتائج التكامل «تم بنجاح».
لم يظهر raw ISO date أو raw `POSTED/SUCCEEDED/PENDING / soft projection/AVAILABLE`
في النطاق الذي تم فحصه. لم يتم الضغط على Settlement.

Governance لـ`CGPD-000006` ظل ظاهرًا pending للتاريخ، بلا Approve/Reject فعّال،
مع الرسالة العربية immutable، وقراءة الصفحة لم تنتج mutation تلقائيًا.

## الاختبارات

- `node --test backend/tests/cgp-presentation-localization-date.test.cjs`: 3/3 PASS.
- `npx tsc --noEmit`: PASS.
- ESLint للملفات المعدلة: PASS.
- Browser reload: PASS، بدون أخطاء حظر في النطاق المرئي وبدون POST/PUT/PATCH/DELETE
  تلقائي من الصفحة.

## السلامة

- قاعدة Persistent المؤكدة: `darfus_erp`, migrations=80, Assets=59, Products=3.
- CGP documents=7، items=11، approval requests=6، settlements=0.
- unbalanced journals=0، orphan journal lines=0، duplicate/blank barcodes=0.
- Gold runtime محفوظ `GOLDAPI_IO / LIVE_PROVIDER / 1500 / 2500`، والـwatermark
  `2026-08-12T08:32:21.028Z` محفوظ، وGlobal Dispatcher OFF.
- Persistent writes=0، task settlement writes=0، migration 81=NO.
- nodemon/hot reload حدث تلقائيًا بسبب تعديل المصدر؛ لا يوجد restart يدوي، ولا
  Next dev جديد، ولا server connection/deployment.
- next-env بقي على الـknown drift SHA:
  `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`، دون إصلاح.

## القرار

`CGP_PRESENTATION_LOCALIZATION_DATE_CLEANUP_01_GATE = PASS_CONFIRMED`

الخطوة التالية فقط: `LOCAL-PRODUCTION-SMOKE-01-RETRY`، بدون بدء تلقائي.
