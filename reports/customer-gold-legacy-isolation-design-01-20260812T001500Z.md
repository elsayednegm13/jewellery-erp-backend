# CUSTOMER-GOLD-LEGACY-ISOLATION-DESIGN-01

## 1. ملخص التصميم

هذه وثيقة تصميم وعزل فقط. لا يوجد تنفيذ للكود أو الواجهة أو الصلاحيات أو Feature Flags أو قواعد البيانات.

الاتجاه المعتمد للتصميم:

- CGP هو المالك canonical لأي شراء مستقبلي لذهب مادي من Customer.
- Scrap/Gold Deposit يبقى مسارًا تاريخيًا/توافقيًا، ولا يُحذف في أول تطبيق.
- العربون المالي للحجوزات يبقى وظيفة منفصلة تمامًا.
- Supplier Receive خارج النطاق.
- العزل يجب أن يكون خادميًا، لا مجرد إخفاء زر.
- حفظ السجلات التاريخية يتم بالمعرّفات والـlineage الحالية دون إعادة تصنيف أو حذف.

## 2. المشكلة الحالية في تجربة المبيعات

صفحة Sales تعرض عمليتين تبدوان متشابهتين:

1. `شراء كسر` → `/sales/customer-gold` → كتابة Legacy مباشرة.
2. `مسودات شراء الذهب` → `/sales/customer-gold/drafts` → مساحة CGP canonical.

الاسم الأول يبدو كأنه الإجراء التشغيلي الرئيسي، بينما المسار canonical يبدو كأنه Draft إداري فقط. كما أن كلمات Validate وApprove وPost وBatch 6 لا تشرح للموظف الفرق بين التحقق، المراجعة الإدارية، والترحيل الفعلي.

## 3. الوضع canonical الحالي

```text
DRAFT → VALIDATED → POSTED
```

- `DRAFT`: إدخال بيانات فقط؛ لا Asset ولا قيد نهائي.
- `VALIDATED`: التحقق من بيانات الأعمال؛ بوابة Posting الدنيا.
- Approval: حوكمة إدارية اختيارية، ولا يساوي Posting.
- `POSTED`: اعتراف فعلي بالشراء، ثم `CustomerGoldPurchasePostedEvent`.
- بعد Posting: تكامل Inventory/Asset، Accounting، Gold Center، CRM/Customer Creditor.

```text
CUSTOMER_PHYSICAL_GOLD_PURCHASE_CANONICAL_OWNER = CGP
CGP_TARGET_UI_MODEL = Sales customer-gold workspace واحد: شراء جديد/مسودات/تم التحقق/مشتريات مرحلة/مراجعة إدارية/طلبات عكس، مع إخفاء التسوية إلى أن يدعمها API الحالي
```

## 4. خريطة التسميات العربية

| المفهوم الحالي | التسمية المقترحة | ملاحظة التصميم |
|---|---|---|
| Customer Gold Purchase | شراء الذهب من العميل (CGP) | الاسم الرئيسي التجاري |
| New draft | شراء جديد | ينشئ Draft فقط |
| Drafts | المسودات | لا يوحي بإنشاء Asset |
| Validate | التحقق من البيانات | لا يساوي ترحيلًا |
| Approved governance | مراجعة إدارية | لا توحي بإنشاء Asset |
| Post | ترحيل عملية الشراء | الاسم المقترح للترحيل الفعلي |
| Posted | المشتريات المرحلة | حالة عملية الأعمال |
| Reversal | طلب عكس/تعويض | حسب صلاحيات وخدمات العكس |
| Scrap Gold | مشتريات الذهب القديمة | لا يظهر كإجراء يومي |
| Gold Deposit | سجل مشتريات الذهب السابقة | لا تستخدم كلمة عربون |
| Batch 6 | مسار شراء الذهب من العميل مخصص لهذا النوع من العمليات | لا يظهر اسم milestone للمستخدم |

```text
TARGET_ARABIC_LABEL_MAP = COMPLETE
CGP_LIFECYCLE_USER_EXPLANATION = COMPLETE
```

## 5. نقطة الدخول الأساسية المقترحة

التقييم:

- Option A (استبدال الزر القديم فقط): وضوح جيد، لكنه لا يوفر تاريخًا منفصلًا.
- Option B (زر CGP جديد ونقل القديم): واضح وأقل التباسًا، مع الحفاظ على direct route.
- Option C (Customer-Gold workspace موحد): أفضل اتساقًا للمسودات والحالات والتاريخ.
- Option D (زر Sales أساسي + Sidebar child): أعلى discoverability، لكنه يحتاج إضافة تنقل مستقبلية.

التوصية: **Option C أولًا، مع Option B في صفحة Sales، ثم Option D إذا أثبتت الصلاحيات الحاجة إلى عنصر Sidebar**. يجب أن يشير الزر الأساسي إلى Workspace واحد، لا إلى نظامين.

```text
PRIMARY_CGP_ENTRY_RECOMMENDATION = Sales primary action to one CGP customer-gold workspace; absorb drafts inside it; keep legacy only under history/admin access
CGP_NAVIGATION_TARGET = DEDICATED_SALES_CUSTOMER_GOLD_WORKSPACE_PLUS_ONE_PRIMARY_SALES_ACTION (optional permission-gated Sidebar child later)
```

## 6. خطة شراء جديد

- إبقاء `/sales/customer-gold/drafts` كمسار canonical مؤقتًا.
- زر `شراء جديد` يفتح إنشاء Draft داخل نفس الـworkspace.
- لا ينشئ Asset عند الحفظ أو التحقق.
- يستخدم الحقول الحالية المدعومة: Customer، items/pieces، weight، karat، stone deduction، pricing evidence.
- لا يضيف settlement أو payout إلى payload الـPosting.
- يمكن لاحقًا إضافة alias واجهة `/sales/customer-gold/new` إلى نفس draft creator، دون backend business flow جديد.
- يمكن لاحقًا إضافة `/sales/customer-gold/purchases` كقائمة read-only إذا كان API القراءة مكتملًا؛ ليست شرطًا لأول عزل.

```text
CGP_NEW_PURCHASE_UX_PLAN = Keep /sales/customer-gold/drafts as canonical workspace; add a direct New Purchase draft action and optional frontend-only /new alias later; no new business authority
```

## 7. المعالجة المستقبلية لـ Scrap/Gold Deposit

خطة مرحلية:

1. **مرحلة التنقل**: إزالة `شراء كسر` من الإجراءات اليومية، واستبداله بزر CGP الأساسي، دون حذف route.
2. **مرحلة التاريخ**: توفير شاشة `مشتريات الذهب السابقة` للقراءة والبحث والتقارير.
3. **مرحلة العزل**: منع إنشاء Pool/Asset/Journal جديد من `/customers/:id/gold/deposit` افتراضيًا عبر Guard خادمي وصلاحية Legacy مخصصة.
4. **مرحلة خدمة السجلات**: السماح بخدمة التزامات السجلات القائمة فقط، مع صلاحيات منفصلة وتدقيق كامل.
5. **بعد إثبات التبعيات**: يمكن اعتماد حظر كامل للكتابة الجديدة، مع بقاء القراءة والتسوية الضرورية للسجلات القديمة.

```text
SCRAP_GOLD_TARGET_STATE = staged: remove from daily navigation → expose read-only historical view → block new legacy creation by default → allow scoped service of existing records → consider full write block only after dependency proof
LEGACY_HISTORY_UI_RECOMMENDATION = شاشة «مشتريات الذهب السابقة» تحت Customer Gold؛ كلمة Legacy تظهر للمشرفين فقط عند الحاجة
LEGACY_ROUTE_DELETION_IN_FIRST_IMPLEMENTATION = NO
```

## 8. تصميم عزل الكتابة الخفية

### المبدأ

Frontend hiding is not security. Every direct creation route must fail closed on the server.

### السياسة المقترحة

- `CGP_LEGACY_ISOLATION_ENABLED` يصبح ON افتراضيًا في بيئة التشغيل المستقبلية.
- غياب الإعداد أو غموضه = isolation ON، لا fallback مفتوح.
- Opt-out طارئ محدود بمدة، وبصلاحية إدارية صريحة، وAudit event، وسبب، ومراجعة انتهاء.
- إنشاء Legacy جديد يحتاج `gold_purchase.cgp.legacy_write`، ويفضل أن تكون غير مخصصة لأي مستخدم عادي.
- أي محاولة على `/customers/:id/gold/deposit` أو ما يعادله ترفض قبل إنشاء Pool/Asset/Journal.
- Guard مركزي في `cgp-legacy-isolation.service.js` يعاد استخدامه لكل المداخل.

```text
LEGACY_WRITE_ISOLATION_DESIGN = COMPLETE
LEGACY_WRITE_DEFAULT_RECOMMENDATION = disabled by default; explicit emergency-only permission plus fail-closed flag and audit
LEGACY_ISOLATION_FLAG_DESIGN = default ON; missing/ambiguous config fails closed; temporary explicit admin opt-out only with expiry and audit
```

## 9. Create مقابل Service Existing Legacy

| العملية | السياسة المقترحة |
|---|---|
| Create new Legacy deposit | Block by default؛ لا Pool/Asset/Journal جديد |
| View history | مسموح بصلاحية `gold_purchase.cgp.legacy_history_view` |
| Payout existing pool | لا يحظر تلقائيًا؛ مسار مستقل، record-linked، صلاحية تشغيلية وتدقيق، بعد مراجعة أثر مالي |
| Use existing pool in Sale | مسموح فقط للـpool القائم، مع قفل lineage وعدم إنشاء CGP جديد |
| Reconciliation/reporting | قراءة فقط أو صلاحية محاسبية مستقلة |
| New asset conversion | ليس ضمن عزل Gold Deposit؛ يحتاج قرارًا مستقلًا إذا كان سجلًا قائمًا |

```text
LEGACY_BACKEND_GUARD_MATRIX = COMPLETE
LEGACY_CREATE_VS_EXISTING_SERVICE_POLICY = COMPLETE
```

لا ينبغي أن يمنع Guard الإنشاء الجديد عمليات تسوية أو رد أو استخدام مرتبطة بسجل قديم صالح، ولا ينبغي أن يسمح تلك العمليات بإنشاء Legacy جديد بالالتفاف.

## 10. حفظ البيانات التاريخية

السجل المعروف `AST-SCRAP-552443` أصبح `SOLD` وله AssetEvents وSale history، ومعه `CustomerGoldPool` وفاتورة دفع وقيدان وحركة نقدية. لذلك:

- لا DELETE.
- لا تعديل Dr/Cr التاريخي.
- لا إعادة تصنيف In-place إلى CGP.
- لا تغيير IDs أو barcode أو Asset lineage.
- لا تغيير invoice/journal/treasury references.
- تقارير التاريخ تقرأ المصدر الحالي وتعرض الأصل Legacy دون تزوير حالة canonical.
- أي compensation مستقبلي يستخدم المسارات المعتمدة، وليس تعديل السجل القديم.

```text
HISTORICAL_DATA_PRESERVATION_PLAN = COMPLETE
ACCOUNTING_HISTORY_IMMUTABILITY = YES
LEGACY_ASSET_HISTORY_IMMUTABLE = YES
```

## 11. حماية العربون المالي

العربون المالي في Reservations/POS خارج نطاق عزل Customer Gold. يجب أن تبقى كما هي:

- `/sales/reservations`
- `POST /reservations`
- `POST /reservations/:id/payments`
- `POST /reservations/:id/complete-sale`
- refund approval/execute
- POS reservation mode

القيد يظل Dr Cash/Bank وCr Reservation Advances/Customer Deposit Liability. لا يغير عزل CGP هذه المسارات أو receipts أو refunds أو settlement.

```text
FINANCIAL_ARABON_PROTECTED = YES
SUPPLIER_FLOW_OUT_OF_SCOPE = YES
```

## 12. Supplier وفصل Batch 6

Supplier Receive لا يتغير في هذه الخطة. مساره canonical الفيزيائي يحافظ على one piece → one Asset → unique barcode، وخيار Legacy Quantity موضوع مستقل.

بديل الرسالة الحالية `CGP deferred to Batch 6`:

> «شراء الذهب من العميل يتم من مسار شراء الذهب من العميل (CGP). شاشة استلام المورد لا تُستخدم لهذا النوع من العمليات.»

لا يظهر اسم Batch 6 للمستخدم النهائي.

```text
BATCH_6_USER_FACING_REPLACEMENT_DESIGN = Replace developer wording with «استخدم مسار شراء الذهب من العميل (CGP)؛ شاشة المورد لا تنشئ شراء ذهب من العميل»; no behavior change in this design
```

## 13. نموذج الصلاحيات المستهدف

الصلاحيات الحالية تبقى كما هي في هذه الجولة. التصميم المستقبلي يقسمها إلى:

- `gold_purchase.cgp.view` / `view_all` / `view_branch` / `view_own`
- `gold_purchase.cgp.create`
- `gold_purchase.cgp.update_draft`
- `gold_purchase.cgp.validate`
- `gold_purchase.cgp.submit`
- `gold_purchase.cgp.approve` / `reject` / `self_approve`
- `gold_purchase.cgp.post`
- `gold_purchase.cgp.settle` أو capability التسوية الموجودة لاحقًا فقط
- `gold_purchase.cgp.reverse`
- `gold_purchase.cgp.legacy_history_view`
- `gold_purchase.cgp.legacy_write` غير مخصصة افتراضيًا
- `gold_purchase.cgp.legacy_emergency_write` طوارئ فقط مع Audit/expiry

`approvals.view` يخص صفحة المراجعة، و`inventory.adjust` لا يمنح صلاحية CGP Posting. `sales.create` لا يجب أن يصبح بديلًا لصلاحية Legacy write بعد العزل.

```text
TARGET_PERMISSION_MODEL = COMPLETE
```

## 14. صفحة Sales المستهدفة

الترتيب المقترح:

1. بحث وطباعة الفواتير
2. مرتجع مبيعات
3. استبدال قطع
4. الحجوزات
5. **شراء الذهب من العميل (CGP)** — الإجراء الأساسي
6. التقسيط
7. قسائم الهدايا
8. **مشتريات الذهب السابقة** — قراءة/تاريخ، حسب الصلاحية

يختفي من الإجراءات اليومية:

- `شراء كسر`
- رابط `مسودات شراء الذهب` المستقل، بعد امتصاصه داخل Workspace CGP

```text
SALES_PAGE_TARGET_ACTIONS = [بحث وطباعة الفواتير, مرتجع مبيعات, استبدال قطع, الحجوزات, شراء الذهب من العميل (CGP) PRIMARY, التقسيط, قسائم الهدايا, مشتريات الذهب السابقة HISTORY]
```

## 15. حالات Workspace وأزرارها

الحالات الفعلية المدعومة حاليًا هي Business status: `DRAFT`, `VALIDATED`, `POSTED`, `REVERSED`، مع Governance status منفصل `NONE/PENDING/APPROVED/REJECTED`.

```text
CGP_WORKSPACE_STATE_MODEL = DRAFT, VALIDATED (filter: تم التحقق/جاهز للترحيل), POSTED (المشتريات المرحلة), REVERSED; governance PENDING/APPROVED/REJECTED shown as separate review status; no invented settlement state
```

| الحالة | الأزرار العربية المقترحة |
|---|---|
| DRAFT | حفظ المسودة، التحقق من البيانات |
| VALIDATED | ترحيل عملية الشراء، إرسال للمراجعة الإدارية (اختياري) |
| Governance PENDING | عرض حالة المراجعة؛ لا يوحي بإنشاء Asset |
| POSTED | عرض التكاملات، طلب عكس/تعويض؛ التسوية فقط إذا توفر API |
| REVERSED | عرض عملية العكس/التعويض |

```text
CGP_STATE_ACTION_LABELS = COMPLETE
CGP_SETTLEMENT_UX_DESIGN = COMPLETE
CGP_APPROVAL_POSTING_SEPARATION_UX = COMPLETE
```

النص الثابت بجانب الحالة:

> «التحقق والمراجعة لا ينشئان أصلًا. عند ترحيل العملية فقط يبدأ الاعتراف بالشراء والتكامل مع المخزون والمحاسبة وGold Center.»

## 16. Route وRedirect strategy

- احتفظ بـ`/sales/customer-gold/drafts` كـcanonical workspace في أول تطبيق.
- alias واجهة اختياري `/sales/customer-gold/new` يفتح Draft جديدًا فقط.
- alias قراءة اختياري `/sales/customer-gold/purchases` إذا اكتمل API القائمة.
- لا تحذف `/sales/customer-gold` في أول تطبيق.
- يمكن أن يوجه التنقل الجديد من `/sales/customer-gold` إلى CGP workspace، لكن لا يُعاد توجيه deep links التاريخية التي تحمل معرفات قديمة دون فحص.
- تبقى backend routes `/customers/:id/gold/deposit`, `/payout`, `/use-in-sale` موجودة في أول تطبيق؛ Guard يفرق create الجديد عن خدمة السجلات القائمة.
- أي redirect لا يرسل POST ولا ينفذ كتابة.

```text
TARGET_ROUTE_STRATEGY = preserve canonical drafts route; add optional frontend-only /new and read-only /purchases aliases; preserve legacy backend routes initially
LEGACY_ROUTE_REDIRECT_DESIGN = new daily navigation points to CGP workspace; old route remains bookmark-safe; deep historical links are not blindly redirected; redirects never write
```

## 17. حدود المحاسبة وAsset وGold Center

- لا تعديل لأي قيد Legacy أو payout.
- لا إعادة استخدام Legacy manual rate للشراء الجديد.
- CGP Pricing Authority وحدها للشراء الجديد، policy `BID / NONE / 0`، snapshot غير قابل للتغيير، ولا provider HTTP أثناء Posting.
- Asset جديد لشراء Customer لا ينشأ إلا عبر CGP Posting event consumer.
- Gold Center canonical owner للشراء الجديد هو CGP.

```text
GOLD_CENTER_CANONICAL_OWNER_FOR_NEW_CUSTOMER_GOLD = CGP
NEW_CUSTOMER_GOLD_PRICING_OWNER = CGP_PRICING_AUTHORITY
```

## 18. تقييم الحاجة إلى Migration

لا تبدو Migration مطلوبة لأول تطبيق؛ mechanisms الحالية (route guard، service guard، permission catalog، flag، navigation) تكفي. إذا تطلبت إضافة permission جديدة seed/DB row، تكون خطوة منفصلة بموافقة Owner، وليست جزءًا من هذه الخطة.

```text
EXPECTED_IMPLEMENTATION_DB_MIGRATION = NO
```

## 19. خطة قبول التنفيذ اللاحق

### UI/navigation

- زر CGP واضح وأساسي.
- لا يظهر Scrap كإجراء يومي.
- التاريخ القديم قابل للقراءة.
- لا يظهر Batch 6.
- لا يوجد Company switcher أو تغيير في نموذج الفرع.

### CGP

- إنشاء Draft.
- Validate.
- Posting من VALIDATED فقط.
- Asset بعد Posting فقط، واحد لكل item، barcode فريد.
- Accounting: Dr inventory / Cr customer creditor.
- Gold Center/CRM event consumers.
- Governance approval لا يساوي Posting.
- settlement/reversal حسب APIs الحالية فقط.

### Legacy

- محاولة إنشاء Legacy جديدة تفشل افتراضيًا.
- قراءة Pool/Asset/Invoice/Journal التاريخية تنجح.
- payout/use-in-sale لسجل قديم يختبران بصلاحيات ومسارات منفصلة.
- لا إنشاء Asset أو Journal جديد ضمن service existing.

### Arabon

- reservation create/payment/refund/complete-sale.
- POS reservation mode.
- receipts والتزامات advances دون تغيير.

### Supplier/Gold/Persistent

- Supplier untouched.
- GoldAPI_IO / LIVE_PROVIDER / 1500 / 2500 محفوظ.
- لا كتابة على Persistent؛ الاختبارات الكتابية على acceptance/disposable clone فقط.

```text
FUTURE_IMPLEMENTATION_ACCEPTANCE_PLAN = COMPLETE
```

## 20. Rollback/recovery

- التراجع الأول يكون Navigation/UI فقط.
- إعادة flag إلى isolation ON أو إزالة alias، دون DB rollback.
- إعادة permission assignments فقط إن كانت أضيفت، مع Audit.
- Guard code يمكن revert من خلال مراجعة مصدرية دون لمس السجلات.
- لا migration ولا restore ولا حذف بيانات.
- أي اختبار فشل يوقف الإغلاق ولا يبرر فتح Legacy writes على Persistent.

```text
FUTURE_IMPLEMENTATION_ROLLBACK_PLAN = COMPLETE
```

## 21. مصفوفة قرارات Owner

| القرار | التوصية | ما يحتاج اعتمادًا صريحًا |
|---|---|---|
| الاسم النهائي | شراء الذهب من العميل (CGP) | نعم |
| إزالة شراء كسر من اليومية | نعم، مع تاريخ منفصل | نعم |
| تاريخ Legacy | شاشة مشتريات الذهب السابقة | نعم |
| New Legacy writes | تعطيل افتراضيًا | نعم |
| خدمة Pools القائمة | إبقاء payout/use-in-sale scoped بعد فحص التبعيات | نعم |
| Sidebar child | ابدأ Workspace تحت Sales، ثم Sidebar child عند الحاجة | نعم |
| Posting label | ترحيل عملية الشراء | نعم |

```text
OWNER_DECISION_MATRIX = COMPLETE
DESIGN_RECOMMENDATION_ONLY = YES
```

## 22. خط الأساس والتحقق من عدم التغيير

تمت القراءة على `darfus_erp` بعد التحقق من `SELECT current_database()`.

| الكيان | قبل | بعد التصميم | الملاحظة |
|---|---:|---:|---|
| SequelizeMeta | 80 | 80 | ثابت |
| Assets | 53 | 53 | ثابت |
| Products | 3 | 3 | ثابت |
| Customers | 1 | 1 | ثابت |
| Suppliers | 1 | 1 | ثابت |
| CGP documents | 3 | 3 | ثابت أثناء الجولة |
| CGP items | 5 | 5 | ثابت أثناء الجولة |
| CustomerGoldPool | 1 | 1 | تاريخي محفوظ |
| Invoices | 13 | 13 | ثابت |
| Journals | 67 | 67 | ثابت |
| JournalLines | 176 | 176 | ثابت |
| CashTransactions | 50 | 50 | ثابت |
| GoldMarketQuotes | 106 | 106 في اللقطة | نمو العامل مسموح طبيعيًا |

فحوص القراءة: unbalanced journals=0، orphan journal lines=0، unlinked treasury=0، duplicate barcodes=0، blank barcodes=0. Gold baseline: `GOLDAPI_IO / LIVE_PROVIDER / AED / 1500 / 2500`. Current branch `main`، HEAD `1657b0e9ba580faef69be48f04637835c201b521`، stashes=11، remotes فارغة، والـworktree يحتوي تغييرات موروثة؛ لم يتم تنظيفها.

```text
BROWSER_WRITE_ACTIONS_TRIGGERED = 0
PERSISTENT_DATABASE_WRITES_THIS_BATCH = 0
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
GOLD_BASELINE_PRESERVED = PASS
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO
PROCESS_RESTARTS_THIS_BATCH = 0
NEXT_DEV_STARTED_OR_RESTARTED = NO
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_WRITES_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
SOURCE_FILES_CHANGED_THIS_BATCH = 0
PERMISSION_MUTATIONS_THIS_BATCH = 0
FEATURE_FLAG_MUTATIONS_THIS_BATCH = 0
ROUTE_MUTATIONS_THIS_BATCH = 0
UI_MUTATIONS_THIS_BATCH = 0
HANDOFF_IMPLEMENTATION_STATE_CHANGED = NO
```

## 23. بوابة التصميم

الخطة قابلة للمراجعة والتنفيذ في batch منفصل، وتحافظ على CGP canonical، التاريخ المالي، العربون، والمورد. لا توجد تغييرات مطبقة.

```text
CURRENT_BATCH = CUSTOMER-GOLD-LEGACY-ISOLATION-DESIGN-01
MODE = READ_ONLY_DESIGN
CUSTOMER_PHYSICAL_GOLD_PURCHASE_CANONICAL_OWNER = CGP
TARGET_ARABIC_LABEL_MAP = COMPLETE
CGP_LIFECYCLE_USER_EXPLANATION = COMPLETE
PRIMARY_CGP_ENTRY_RECOMMENDATION = Sales primary action to one CGP workspace; legacy moved to history/admin access
CGP_NEW_PURCHASE_UX_PLAN = canonical drafts workspace with direct draft creation, no new business authority
SCRAP_GOLD_TARGET_STATE = staged isolation with historical read/service preservation
LEGACY_WRITE_ISOLATION_DESIGN = COMPLETE
HISTORICAL_DATA_PRESERVATION_PLAN = COMPLETE
LEGACY_HISTORY_UI_RECOMMENDATION = مشتريات الذهب السابقة read/history workspace
LEGACY_ROUTE_DELETION_IN_FIRST_IMPLEMENTATION = NO
FINANCIAL_ARABON_PROTECTED = YES
SUPPLIER_FLOW_OUT_OF_SCOPE = YES
BATCH_6_USER_FACING_REPLACEMENT_DESIGN = business-safe CGP guidance; no Batch 6 wording
CGP_NAVIGATION_TARGET = dedicated Sales Customer Gold workspace plus one primary Sales action
TARGET_PERMISSION_MODEL = COMPLETE
LEGACY_WRITE_DEFAULT_RECOMMENDATION = disabled by default; emergency-only permission
LEGACY_ISOLATION_FLAG_DESIGN = default ON, fail closed, audited temporary opt-out
LEGACY_BACKEND_GUARD_MATRIX = COMPLETE
LEGACY_CREATE_VS_EXISTING_SERVICE_POLICY = COMPLETE
ACCOUNTING_HISTORY_IMMUTABILITY = YES
LEGACY_ASSET_HISTORY_IMMUTABLE = YES
GOLD_CENTER_CANONICAL_OWNER_FOR_NEW_CUSTOMER_GOLD = CGP
NEW_CUSTOMER_GOLD_PRICING_OWNER = CGP_PRICING_AUTHORITY
SALES_PAGE_TARGET_ACTIONS = [بحث وطباعة الفواتير, مرتجع مبيعات, استبدال قطع, الحجوزات, شراء الذهب من العميل (CGP) PRIMARY, التقسيط, قسائم الهدايا, مشتريات الذهب السابقة HISTORY]
CGP_WORKSPACE_STATE_MODEL = DRAFT, VALIDATED, POSTED, REVERSED plus separate governance status
CGP_STATE_ACTION_LABELS = COMPLETE
CGP_SETTLEMENT_UX_DESIGN = COMPLETE
CGP_APPROVAL_POSTING_SEPARATION_UX = COMPLETE
TARGET_ROUTE_STRATEGY = COMPLETE
LEGACY_ROUTE_REDIRECT_DESIGN = preserve bookmarks/history; new navigation points to CGP; no write redirect
EXPECTED_IMPLEMENTATION_DB_MIGRATION = NO
FUTURE_IMPLEMENTATION_ACCEPTANCE_PLAN = COMPLETE
FUTURE_IMPLEMENTATION_ROLLBACK_PLAN = COMPLETE
OWNER_DECISION_MATRIX = COMPLETE
DESIGN_RECOMMENDATION_ONLY = YES
BROWSER_WRITE_ACTIONS_TRIGGERED = 0
PERSISTENT_DATABASE_WRITES_THIS_BATCH = 0
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
GOLD_BASELINE_PRESERVED = PASS
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO
PROCESS_RESTARTS_THIS_BATCH = 0
NEXT_DEV_STARTED_OR_RESTARTED = NO
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_WRITES_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
SOURCE_FILES_CHANGED_THIS_BATCH = 0
PERMISSION_MUTATIONS_THIS_BATCH = 0
FEATURE_FLAG_MUTATIONS_THIS_BATCH = 0
ROUTE_MUTATIONS_THIS_BATCH = 0
UI_MUTATIONS_THIS_BATCH = 0
HANDOFF_IMPLEMENTATION_STATE_CHANGED = NO
CUSTOMER_GOLD_LEGACY_ISOLATION_DESIGN_01_GATE = DESIGN_COMPLETE
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
```

