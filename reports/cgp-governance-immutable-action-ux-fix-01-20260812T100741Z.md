# CGP-GOVERNANCE-IMMUTABLE-ACTION-UX-FIX-01

## 1. النطاق والنتيجة

تم إصلاح عيب قابلية الإجراء في مركز الموافقات فقط. كان طلب الحوكمة يظل
`pending` بعد أن يصبح مستند CGP `POSTED` أو `REVERSED`، وكانت الواجهة تبني
أزرارًا اعتمادًا على حالة الطلب وحدها. أصبحت قابلية الإجراء الآن مشتقة على
الخادم من حالة مستند CGP المرتبط، مع إبقاء سجل الحوكمة ظاهرًا للتاريخ.

لم يتغير Workflow: `DRAFT -> VALIDATED -> POSTED -> REVERSED`. Approval ما زال
مسار حوكمة منفصلًا وليس شرطًا قبل Posting.

## 2. الملفات المعدلة

- `backend/src/services/gold-purchase-governance.service.js`
  - إضافة اشتقاق actionability من المستند المرتبط.
  - إثراء list/get لطلبات CGP بحقول `actionable`, `actionBlockedCode`,
    `linkedBusinessStatus`.
  - الإبقاء على `assertCgpBusinessMutable` وحاجز `DOCUMENT_IMMUTABLE` كما هو.
- `app/[locale]/(dashboard)/approvals/page.tsx`
  - عدم عرض Approve/Reject عندما يكون الطلب غير قابل للإجراء.
  - عرض الحالة المرتبطة ورسالة عربية/إنجليزية محلية.
- `lib/types.ts`
  - إضافة حقول read-model الاختيارية دون تغيير عقد mutation.
- `messages/ar.json`, `messages/en.json`
  - رسائل immutable history غير القابلة للإجراء.
- `backend/tests/cgp-governance-immutable-actionability.test.cjs`
  - اختبارات posted/reversed/mutable/non-pending والحواجز والواجهة والترجمة.

لا توجد تغييرات في Settlement أو Posting أو الصلاحيات أو قاعدة البيانات.

## 3. قواعد الخادم والاختبارات

- `POSTED` و`REVERSED`: `actionable=false`, `DOCUMENT_IMMUTABLE`.
- CGP قابل للتعديل مع `pending` يظل actionable حسب قواعد الحوكمة القائمة.
- طلب غير pending يظل غير قابل للإجراء بالحالة القانونية القائمة.
- Guard الخادم للـApprove والـReject بقي 409 `DOCUMENT_IMMUTABLE`.
- لا يوجد client flag مثل `force` أو `ignoreImmutable` أو `actionable`.
- Posting لا يفحص `governance_status=APPROVED`، لذلك Approval ليس prerequisite.
- تاريخ الطلب لا يُحذف ولا يُعاد كتابة حالته أثناء هذه الدفعة.

الاختبارات الناجحة:

- اختبار actionability المتخصص.
- اختبارات عقود CGP السابقة وSettlement UI.
- `npx tsc --noEmit`.
- ESLint للملفين المتغيرين.
- `node --check` للخدمة.

## 4. قبول المتصفح

في جلسة Owner الحالية، صفحة `/ar/approvals` تعرض `CGPD-000006` مع:

- `business_status=POSTED`.
- `governance_status=PENDING` وapproval status `pending` محفوظان كما هما.
- الرسالة: «تم ترحيل المستند ولم يعد طلب الموافقة قابلاً للإجراء.»
- لا يوجد زر Approve أو Reject داخل بطاقة CGPD-000006.
- إعادة التحميل لم ترسل approve/reject/post، ولم تنتج 401/403/404/409/422/500.

تمت مراجعة زر `تسجيل الدفعة` للوثائق `CGPD-000004` إلى `CGPD-000007` قراءة فقط؛
ظل ظاهرًا ومتاحًا، ولم يُفتح نموذج الدفع أو تُرسل أي settlement mutation.

## 5. السلامة والبيانات

- Persistent `darfus_erp` بقي read-only: migrations=80، Assets=59، Products=3.
- business/governance fingerprints لم تتغير، وsettlements بقيت 0، وtreasury
  cash_transactions بقيت 50.
- unbalanced journals=0، orphan journal lines=0، unlinked treasury=0،
  duplicate/blank barcodes=0، orphan asset origins=0.
- Gold runtime محفوظ `GOLDAPI_IO / LIVE_PROVIDER / 1500 / 2500`.
- scoped CGP dispatcher محفوظ، watermark محفوظ عند
  `2026-08-12T08:32:21.028Z`، وGlobal Dispatcher OFF.
- لا Migration 81، ولا أي migration أو seed أو fixture أو recovery أو
  settlement أو provider request في هذه الدفعة.

## 6. سلوك العمليات

- `POSTING_AUTOMATIC_GOVERNANCE_WRITE=0`.
- `AUTOMATIC_APPROVAL_MUTATION_REQUESTS=0`.
- `AUTOMATIC_GOVERNANCE_409_ON_PAGE_LOAD=0`.
- Company/Branch scope لم يتغير، والصلاحية لا تتجاوز immutability.
- nodemon أعاد تحميل backend تلقائيًا بسبب تعديل المصدر؛ لم يتم تشغيل restart
  يدوي، ولم يتم تشغيل Next dev.
- next-env بقي على drift المعروف دون إصلاح.

## 7. Git والحماية

Branch=`main`، HEAD=`1657b0e9ba580faef69be48f04637835c201b521`، staged=0، ولم
تُستخدم أوامر add/commit/push/reset/restore/clean/stash. لا server connections
ولا deployments. التغييرات محصورة في نطاق Governance Actionability UX أعلاه
والتقرير وهذه الإضافة إلى handoff.

## 8. القرار

`CGP_GOVERNANCE_IMMUTABLE_ACTION_UX_FIX_01_GATE = PASS_CONFIRMED`

الخطوة التالية الموصى بها فقط:
`CGP-PRESENTATION-LOCALIZATION-DATE-CLEANUP-01`، بدون بدء تلقائي.

