# CUSTOMER-MASTER-DATA-CREATE-EDIT-ADDRESS-POS-INVOICE-FORENSIC-01

## 1. الملخص التنفيذي

هذه جولة forensic للقراءة فقط. لم يتم إنشاء عميل، ولم يتم تعديل عميل أو عنوان، ولم يتم تنفيذ بيع أو فاتورة، ولم يتغير الكود أو أي قاعدة بيانات. تم إثبات نموذج العميل الحالي، مسارات القراءة والكتابة الموجودة، فجوة العنوان في واجهة الإنشاء، غياب إدارة العناوين المخصصة، نقص بيانات الهاتف والعنوان في Snapshot الفاتورة، والفرق بين الرصيد المرجعي والائتمان المتاح. توجد نقطتا قرار Owner قبل أي خطة تنفيذ: قاعدة العنوان المعروض، ومعنى «الرصيد المتاح» في POS، بالإضافة إلى سياسة Snapshot التاريخية للفواتير.

## 2. ملاحظات Owner المرصودة

- نافذة «عميل جديد» تعرض الاسم والهاتف والبريد والتصنيف والملاحظات فقط، ولا تعرض عنوانًا.
- صفحة تفاصيل العميل تعرض «العناوين المسجلة» لكنها لا تعرض زر تعديل ملف العميل أو إضافة/تعديل/حذف عنوان.
- POS يعرض بطاقة عميل مختصرة فيها الاسم والهاتف والتصنيف والعنوان أو «العنوان غير مسجل» والنقاط والرصيد؛ لا يعرض الحالة أو إجمالي المشتريات.
- شاشة تفاصيل فاتورة موجودة تعرض اسم العميل فقط؛ لا يظهر هاتف أو عنوان العميل.

## 3. نموذج Customer الحالي

المصدر: `backend/src/models/customer.model.js`، والنوع العام `lib/types.ts`.

الحقول الفعلية: `id` (مفتاح نصي)، `companyId`، `name`، `phone`، `email`، `tier` (`VIP|Gold|Standard`)، `balance` DECIMAL (رصيد مرجعي/ذمم مستحقة)، `purchases` DECIMAL (إجمالي مشتريات صافٍ)، `lastVisit`، `status` (`active|inactive`)، بيانات KYC/AML والجنسية، `creditLimit`، `loyaltyPoints`، `addresses` JSONB، `notes`، `kycDetails`، timestamps و`deletedAt` (paranoid). لا يوجد `customerCode` مستقل في النموذج؛ الرقم الظاهر مثل CUS-0002 جزء من معرف/عرض العميل.

## 4. نموذج العنوان

العنوان مخزن مباشرة داخل `Customer.addresses` كـ JSONB array. النوع الأمامي `CustomerAddress` يحتوي `line1` و`line2?` و`city` و`country` و`postalCode?`. لا يوجد `CustomerAddress` model أو جدول منفصل، ولا FK مستقل، ولا `addressId`، ولا `isPrimary`/`isDefault`/`type`، ولا soft-delete للعنوان. لذلك تعدد العناوين ممكن بنيويًا، لكن قانون الأولوية أو العنوان الرئيسي غير مثبت.

## 5. مسار إنشاء العميل

الواجهة `app/[locale]/(dashboard)/customers/page.tsx` تدير state للحقول name/phone/email/tier/notes. عند الإنشاء تستدعي repository عبر `POST /customers` وترسل أيضًا قيمًا ابتدائية للرصيد والمشتريات والتاريخ والحالة. `api-impl.ts` هو العميل في وضع API.

في الخادم، `setupCrud("customers", ...)` في `backend/src/routes/erp.routes.js` ينشئ Customer ضمن `companyId` الخادمي، يمنع اعتماد `balance` من العميل، وينشئ BranchCustomer/يسجل audit ويصدر entity-changed. النموذج يفرض `name` و`phone`، و`email` اختياري، بينما `addresses` اختياري افتراضيًا `[]`.

## 6. سبب غياب العنوان في الإنشاء

`CUSTOMER_CREATE_ADDRESS_GAP_ROOT_CAUSE = PROVEN_FRONTEND_OMITS_ADDRESSES_BACKEND_GENERIC_JSONB_ACCEPTS`.

الـ UI لا يملك state أو input للعنوان ولا يضع `addresses` في body. الـ generic backend يستطيع تمرير حقل `addresses` إلى JSONB إذا وصلته قيمة صحيحة، لكنه لا يقدم schema/validation/transaction مخصصًا للعناوين. ليست المشكلة route منفصلًا مفقودًا في الإنشاء؛ المشكلة الأساسية أن الواجهة لا ترسل العنوان ولا يوجد عقد عنوان مخصص.

## 7. Customer Edit في Backend

يوجد `PUT /customers/:id` ويدعم `PATCH` عبر generic CRUD. الصلاحية الأساسية `customers.update`، مع فحص company scope، وقراءة branch عند الحاجة، وaudit قبل/بعد، و`entity changed`. يحذف الخادم `balance` من update body حتى لا يصبح العميل سلطة مالية. لا يوجد optimistic lock أو `If-Match` أو version guard؛ السلوك الحالي last-write-wins. تمرير `addresses` ممكن نظريًا داخل generic update لكنه بلا قواعد primary أو shape أو uniqueness.

## 8. Customer Edit في Frontend

صفحة القائمة فيها زر «تعديل» يفتح نفس modal ويعدل name/phone/email/tier/notes، لذلك مسار edit الأساسي موجود. صفحة التفاصيل `/customers/:id` لا تعرض زر Edit للبيانات الأساسية أو العناوين؛ الموجود هو تحديث KYC وإدارة المرفقات بحسب الصلاحية. لذلك إحساس Owner بأن صفحة العميل read-only صحيح، رغم وجود edit في القائمة.

## 9. صفحة تفاصيل العميل

المصدر `app/[locale]/(dashboard)/customers/[id]/page.tsx` ويقرأ `GET /customers/:id`، وفواتير العميل عبر `/customers/:id/invoices`، وكشف الحساب، و`/credit`، وloyalty، والمرفقات وKYC. تعرض الهاتف والبريد والملاحظات، «العناوين المسجلة»، نقاط الولاء، الحد الائتماني، وإجمالي المشتريات. إذا كانت `addresses` فارغة يظهر «لا توجد عناوين مسجلة للعميل». لا يوجد edit profile/address action.

## 10. حالة Address CRUD

البحث في المستودع لم يجد route أو service أو modal مستقلًا لـ add/edit/delete/set-primary address. لا توجد `CustomerAddress` association. التعديل الوحيد الممكن حاليًا هو تمرير JSONB كامل إلى generic Customer update، وهذا ليس Address CRUD آمنًا ولا يثبت primary/default semantics.

## 11. Status مقابل Tier

`status` هو lifecycle تشغيلي `active|inactive` وتغييره يمر عبر deactivate/reactivate permissions/routes. `tier` هو تصنيف ولاء/شريحة `VIP|Gold|Standard` وتوجد له شاشات/حسابات ولاء. لا يجوز اعتبار Tier حالة تشغيلية، ولا العكس.

## 12. مصدر الهاتف

المصدر القانوني هو `Customer.phone`، وهو NOT NULL في النموذج، ومطلوب في UI الإنشاء. توجد فهارس `(company_id, phone)` لكنها ليست UNIQUE؛ فحص التكرار في local repository فقط وليس قاعدة uniqueness server-side مثبتة. `/customers` يعيد الهاتف، وPOS يقرأه من customer object. `Invoice` لا يملك phone snapshot، وقالب الطباعة لا يحصل على هاتف العميل.

## 13. مصدر العنوان المعروض

POS يستخدم `selectedCustomer.addresses.find(...)` لأول عنصر usable فيه `line1` أو `city` أو `country`، ثم يعرض fallback «العنوان غير مسجل». هذا يثبت السلوك الحالي، لكنه لا يثبت قانونًا تجاريًا للعنوان الأساسي؛ لا يوجد primary flag أو address type. لذلك `CUSTOMER_DISPLAY_ADDRESS_AUTHORITY = NOT_PROVEN`، ويحتاج Owner تحديد primary/default أو ترتيب موثق.

## 14. مصدر Points

المصدر الأساسي `Customer.loyaltyPoints`، مع وجود branch projection في `BranchCustomer.loyaltyPoints` وحركات `LoyaltyTransaction`. توجد routes قراءة loyalty ومسارات earn/redeem. POS الحالي يعرض Customer-level points read-only من `/customers`.

## 15. معنى «الرصيد المتاح»

`Customer.balance` موثق كرصيد مرجعي/ذمم مستحقة، وتوضح الواجهة أنه قد لا يعكس كل الحركات. ليس من الآمن تسميته «الرصيد المتاح». يوجد مفهوم منفصل في `GET /customers/:id/credit`: `availableCredit` مشتق من سجل `customer_credit_transactions`.

النتيجة: المعنى المقصود من Owner غير محسوم بين outstanding receivable وavailable credit وdeposit/wallet. لا يوجد كود يثبت أن `creditLimit - balance` هو القانون؛ لذلك `CUSTOMER_AVAILABLE_BALANCE_MEANING = NOT_PROVEN`.

## 16. معادلة available credit الحالية

في `backend/src/services/customer-credit.service.js`: `availableCredit = SUM(active credit_in) - SUM(active credit_out)`، مع التحقق من كفاية الرصيد قبل credit-out. هذه المعادلة مثبتة فقط لمفهوم credit ledger، وليست بديلًا تلقائيًا لـ `Customer.balance` أو `creditLimit`. `CUSTOMER_AVAILABLE_BALANCE_FORMULA = PROVEN_FOR_CREDIT_LEDGER_ONLY`.

## 17. إجمالي المشتريات

`backend/src/services/customer-purchases.service.js` يعيد حساب `Customer.purchases` من فواتير الشركة ذات `postingStatus = posted`. يستبعد cancelled/canceled/void/draft/deleted، ويطرح return/credit_note/refund، ويضيف sale/installment/deposit، ويضيف exchange حسب قواعد الخدمة، ثم يكتب aggregate صافٍ غير سالب مع تقريب مالي. المجال company-scoped، وهو lifetime aggregate مخزن وليس query جديدًا عند كل عرض.

## 18. POS data flow الحالي

`use-core-erp-data.ts` يقرأ `/customers` مع `skipBranch=true` (company-wide customer list). `pos/page.tsx` يجد customer بالـ id ثم يعرض: name، phone، tier، أول عنوان usable، loyaltyPoints، وCustomer.balance. لا يعرض status ولا Customer.purchases ولا availableCredit endpoint. اختيار العميل يستبعد inactive من القائمة، لكن الحالة نفسها ليست في البطاقة.

## 19. بطاقة POS المستهدفة

بطاقة واحدة compact بعنوان «بيانات العميل»، بالترتيب: الاسم، الحالة، الهاتف، العنوان، النقاط، الرصيد المتاح، إجمالي المشتريات، مع Tier اختياري منفصل. البطاقة read-only داخل POS ولا تحتوي edit fields. هذا blueprint لا يقرر معنى الرصيد أو primary address؛ هذان قراران سابقان للتنفيذ.

## 20. جدول فجوات بطاقة POS

| الحقل | الحالة الحالية |
|---|---|
| الاسم | متاح في `/customers` |
| Status | موجود في response لكن غير معروض في البطاقة |
| الهاتف | متاح في `/customers` |
| العنوان | متاح كـ JSONB، العرض الحالي أول usable فقط؛ primary غير مثبت |
| Points | متاح `Customer.loyaltyPoints` |
| Available Balance | غير محسوم؛ `/credit` موجود للتفصيل فقط |
| Total Purchases | موجود `Customer.purchases` في response لكنه غير معروض في POS |
| Tier | متاح ويظهر حاليًا |

## 21. Invoice customer linkage

`Invoice` يحتوي `customerId` و`customerName`، والـ model association هو Customer hasMany Invoice. مسار POS checkout يتحقق من Customer داخل company ويكتب `customerName: customer.name` وقت إنشاء الفاتورة. لا يوجد `customerPhone` أو `customerAddress` أو customer snapshot JSON في invoice table.

## 22. مصدر هاتف الفاتورة

`INVOICE_CUSTOMER_PHONE_SOURCE = PROVEN_MISSING`. لا live lookup في print view-model، ولا snapshot column، ولا checkout field. `buildInvoicePrintViewModel()` يعيد customer `{ name: invoice.customerName }` فقط، ويضع warning `customer_phone_missing`.

## 23. مصدر عنوان الفاتورة

`INVOICE_CUSTOMER_ADDRESS_SOURCE = PROVEN_MISSING`. القوالب تعرف مواضع phone/address نظريًا، لكن builder لا يمرر القيم، وInvoice لا يحفظ address snapshot. warning `customer_address_missing` متوقع.

## 24. سياسة التاريخ للفواتير

النظام الحالي يثبت اسم العميل فقط عند البيع، ولا يحدد صراحةً هل هاتف/عنوان الفاتورة القديمة يجب أن يتغير بعد تعديل master. لا يجوز تنفيذ live lookup للفواتير القديمة لأنه سيغير معنى مستند تاريخي. لذلك `HISTORICAL_INVOICE_CUSTOMER_DATA_POLICY = OWNER_DECISION_REQUIRED`; التوصية الآمنة هي immutable sale-time snapshot للحقول التي يقررها Owner.

## 25. حقول Snapshot الحالية

الحقل الموجود فعليًا هو `Invoice.customerName` فقط، وهو snapshot وقت الإنشاء. لا توجد customerPhoneSnapshot/customerAddressSnapshot/billingAddress/shippingAddress/customerSnapshot/buyerSnapshot. `INVOICE_CUSTOMER_SNAPSHOT_FIELDS = COMPLETE_AS_IS_ONLY_NAME`، مع phone/address gap مثبت.

## 26. مسارات عرض/طباعة الفاتورة

- `/sales/search-print`: قائمة invoices من API ثم modal read-only، يعرض رقم/نوع/حالة/تاريخ/عميل/فرع/مبالغ.
- `InvoiceReadOnlyDetail`: يعرض `customerName` فقط من invoice object.
- `features/printing/lib/invoice-print-view-model.ts`: يبني customer view model، حاليًا name فقط.
- Invoice/Minimal/Compact/Thermal templates: لديها مواضع phone/address مشروطة لكن قيمها undefined من builder.
- لا يوجد إثبات أن PDF أو thermal مسارًا آخر يحل نقص snapshot؛ نفس view-model هو نقطة الاختناق.

## 27. سبب غياب الهاتف/العنوان من الفاتورة

`INVOICE_PHONE_ADDRESS_GAP_ROOT_CAUSE = PROVEN_INVOICE_STORES_NAME_ONLY_AND_PRINT_BUILDER_OMITS_PHONE_ADDRESS`.

السبب ليس مجرد CSS أو ترجمة: sale payload لا يحفظ phone/address، Invoice schema لا يحتويهما، والـ print builder لا يعمل live Customer lookup. لذلك القالب لا يملك data لعرضها، حتى لو كان العميل الحالي لديه عنوان.

## 28. الصلاحيات

| العملية | الصلاحية الحالية |
|---|---|
| عرض العملاء | `customers.view` |
| إنشاء | `customers.create` |
| تعديل | `customers.update` |
| حذف | `customers.delete` |
| تعطيل/تفعيل | `customers.deactivate` / `customers.reactivate` |
| KYC | `customers.kyc.manage` |
| مرفقات | `customers.attachments.manage` |
| كشف/ائتمان | `customers.view` مع branch resource حيث يلزم |
| إدارة العنوان | لا permission مستقل؛ غير موجودة كـ CRUD |

أي تنفيذ مستقبلي للعناوين يحتاج قرارًا هل تتبع `customers.update` أم permission منفصل.

## 29. Audit

generic Customer create/update/deactivate/reactivate/delete يسجل centralized audit مع actor وbefore/after وcompany/branch/correlation حسب controller. تعديل JSONB addresses مستقبلاً سيظهر كـ Customer UPDATE شامل قبل/بعد، لكن لا يوجد Address-specific revision/history أو changedBy مستقل. لا يوجد تغيير في هذه الجولة.

## 30. Concurrency

لا يوجد version/optimistic lock/If-Match في generic Customer update؛ updatedAt timestamps فقط. النتيجة last-write-wins. أي Address CRUD آمن يحتاج version/transaction لمنع lost updates عند تعديل array أو، إذا تم تطبيعها، row-level constraints.

## 31. Validation الحالية

DB/model: name وphone غير فارغين، tier/status enum، decimals، JSONB addresses default []. UI: name وphone مطلوبان، email بصيغة email، tier select، notes free text. لا توجد validation بنيوية للعنوان، ولا primary uniqueness، ولا server-side phone normalization/unique constraint مثبتة. balance/purchases ليست سلطات client؛ الخادم يديرها من business flows.

## 32. مصفوفة required/optional

| الحقل | إنشاء حالي | تعديل حالي | ملاحظة |
|---|---|---|---|
| الاسم | Required | Optional update | DB NOT NULL |
| الهاتف | Required | Optional update | DB NOT NULL، بلا UNIQUE |
| البريد | Optional | Optional | nullable |
| Tier | Optional/default | Optional | enum |
| Status | Server/default | dedicated deactivate/reactivate | ليس field حرًا |
| Notes | Optional | Optional | text |
| Address | Optional/غير ظاهر | JSONB نظريًا فقط | لا CRUD/primary |
| Points/balance/purchases | Server/business-owned | ممنوع client authority | read-only projection |

## 33. Create blueprint المستقبلي

بعد قرارات Owner: name/phone/email/tier/notes، ثم Address block اختياري بعقد typed واضح، scope company/branch حسب policy، validation server-side، transaction واحدة، audit before/after، response canonical. لا تُرسل balance أو purchases أو points من UI.

## 34. Edit blueprint المستقبلي

إضافة edit action في details أو توحيد modal، مع permission `customers.update`، typed validation، version/updatedAt precondition، audit كامل، فصل lifecycle status عن profile fields، ورفض تعديل financial aggregates من client.

## 35. Address Management blueprint

Owner يحدد: one/multiple، primary/default، type (billing/home)، requiredness، وcompany/branch scope. إن بقي JSONB: schema validation وarray replacement/version/audit. إن احتجنا history/queries/primary uniqueness: normalized CustomerAddress table مرشح، لكن لا migration الآن ولا قرار تلقائي.

## 36. POS Customer Card API plan

أقل خطة آمنة: read-only customer summary endpoint أو response projection موحد يعيد name/status/phone/address وفق primary law/points/purchases وfield-authorized balance/availableCredit. لا يعاد حساب purchases في كل select، ولا يقرأ POS live address غير المحسوم، ولا يعرض financial fields قبل policy.

## 37. أداء Total Purchases

القراءة الحالية O(1) من `Customer.purchases`، والخطر هو freshness إذا مسار قديم لم يستدع recalculate. لا يوجد query aggregate عند فتح POS. future read model يستفيد من denormalized field مع reconciliation job read-only/monitoring، لا من join ثقيل في كل بطاقة.

## 38. أداء Available Balance

`Customer.balance` O(1) لكنه مرجع قديم/غير كامل. `availableCredit` يقرأ credit transactions ويمكن أن يصبح query إضافيًا في POS؛ لا يُضمَن الأداء أو company/branch semantics قبل تحديد المقصود. يفضل summary projection/cache بعد تثبيت القانون والصلاحية.

## 39. Customer Summary read model

التوصية: read-only summary DTO لا يملك أي accounting truth، يجمع authorities الموجودة ويضع source labels/authorization. يجب ألا ينشئ balance جديدًا ولا ينسخ تاريخًا، ويجب أن يحافظ على company/branch privacy.

## 40. تقييم Migration

لا توجد حاجة migration لهذه الجولة، ولم تُنشأ Migration 81. تنفيذ مستقبلي قد يحتاج additive invoice snapshot columns أو CustomerAddress table، لكن ذلك يتوقف على Owner policy وSCAN→MAP→DESIGN→BACKFILL→VERIFY. لا backfill تاريخي مسموح قبل policy.

## 41. خطة التنفيذ المرحلية

التسلسل الآمن: Phase A قرارات وعقد البيانات، Phase B Customer create/edit/address، Phase C POS summary/card، Phase D invoice snapshot/print، Phase E runtime acceptance/regression. لا تبدأ أي Phase تلقائيًا من هذه الجولة.

## 42. Phase A

توثيق primary address، معنى الرصيد المتاح، cashier visibility، historical invoice snapshot، requiredness، permission ownership، والـ API DTO قبل تعديل schema.

## 43. Phase B

تنفيذ create/edit/address من خلال authority واحدة، validation وconcurrency وaudit، مع acceptance-only fixtures إن أذن Owner. لا تستخدم balance/purchases client authority.

## 44. Phase C

إضافة customer summary read-only، عرض status/address policy/points/purchases/selected financial field وفق permission، مع عدم تغيير POS checkout accounting.

## 45. Phase D

تثبيت invoice snapshot law، إضافة الحقول/الـ DTO أو normalized reference بشكل additive فقط، وتوصيل print view-model والقوالب مع immutable historical behavior.

## 46. Phase E

اختبارات browser read-only ثم create/edit/address/print acceptance على Acceptance DB فقط، concurrency/idempotency/security/financial regressions، ثم Owner manual verification. Persistent تبقى read-only.

## 47. Customer master data matrix

| الحقل | السلطة الحالية | مكان القراءة | حالة |
|---|---|---|---|
| name | Customer.name | customers/POS/Invoice.customerName | مثبت |
| phone | Customer.phone | customers/POS | مثبت، غير snapshot للفواتير |
| email | Customer.email | customers/details | مثبت |
| status | Customer.status + routes | list/details/POS filter | مثبت |
| tier | Customer.tier | list/details/POS | مثبت |
| notes | Customer.notes | create/details | مثبت |
| address | Customer.addresses JSONB | details/POS | تخزين مثبت، primary غير مثبت |
| points | Customer.loyaltyPoints/transactions | details/POS | مثبت مع branch projection |
| balance | Customer.balance | list/POS | مرجع ذمم، ليس available credit |
| credit | credit transactions `/credit` | details | formula مثبت لمفهوم credit |
| purchases | Customer.purchases/recalculate service | list/details | صافي lifetime posted |

## 48. Address gap table

| gap | الدليل | الأثر | المطلوب لاحقًا |
|---|---|---|---|
| لا input في create | customer page payload لا يحتوي addresses | لا يمكن إدخال عنوان من modal | typed address block |
| لا Address API | لا routes/model مستقلة | لا CRUD آمن | contract/authority |
| لا primary flag | JSONB type بلا isPrimary | ترتيب غير مضمون | Owner policy |
| لا version للعناوين | generic update | lost update محتمل | optimistic concurrency |
| لا audit مخصص | Customer UPDATE فقط | history أقل دقة | audit policy |

## 49. Invoice customer data matrix

| البيانات | Invoice الحالية | Print builder | الحالة |
|---|---|---|---|
| customerId | نعم | عبر invoice object | مثبت |
| customerName | نعم snapshot | نعم | مثبت |
| customerPhone | لا | undefined | فجوة مثبتة |
| customerAddress | لا | undefined | فجوة مثبتة |
| live Customer lookup | لا | لا | لا يوجد تغير تاريخي تلقائي |

## 50. POS card gap table

الاسم/الهاتف/points/tier متاحة، والعنوان JSONB متاح لكن اختياره غير canonical، وstatus موجود لكنه غير معروض، وpurchases موجود لكنه غير معروض، وavailable balance غير محسوم. لا يوجد endpoint summary مخصص أو field-level permission.

## 51. Permission/security/privacy

company scope خادمي. Customer list في API يستخدم `skipBranch=true` في core data، بينما customer invoices/statement/credit تحتاج branch resource في المسارات الحساسة. POS checkout يتحقق من customer داخل company، ولا يثبت BranchCustomer شرطًا في نفس المسار؛ هذه ملاحظة scope تستلزم مراجعة منفصلة ولا يتم إصلاحها هنا. حاليًا `customers.view` هو بوابة بيانات العميل، ولا توجد صلاحية مستقلة لعرض balance/points/purchases؛ لذلك cashier visibility policy الحالية «كل ما يعيده customers.view» مثبتة، وأي تضييق يحتاج Owner قرارًا.

## 52. دليل المتصفح read-only

`READ_ONLY_BROWSER_FORENSIC = PASS`.

تم فتح `/ar/customers` وقراءة DOM: ظهر زر «عميل جديد». بعد فتحه فقط، ظهر الاسم والهاتف والبريد والتصنيف والملاحظات بلا عنوان. تم فتح `/ar/customers/CUS-0002` بعد انتظار readiness: ظهر الهاتف، «العناوين المسجلة»، الولاء والائتمان وإجمالي المشتريات دون edit/address action. تم فتح `/ar/pos`: ظهر اسم العميل والهاتف وVIP و«العنوان غير مسجل» والنقاط والرصيد، دون إجمالي المشتريات أو الحالة في البطاقة. تم فتح `/ar/sales/search-print` وقراءة فاتورة موجودة؛ ظهر اسم العميل فقط في التفاصيل. لم يتم النقر على حفظ/إتمام/طباعة ولم تُرسل mutation.

## 53. Network evidence

`CUSTOMER_READ_NETWORK_EVIDENCE = COMPLETE` من ربط المصدر والـ runtime read-only:

| السطح | الطلب | السلطة |
|---|---|---|
| Customer list/POS search | `GET /customers` | Customer company-scoped projection |
| Customer details | `GET /customers/:id` | Customer + addresses JSONB |
| Invoices | `GET /customers/:id/invoices` و`GET /invoices` | Invoice/customerId |
| Credit | `GET /customers/:id/credit` | credit ledger availableCredit |
| Loyalty | `GET /customers/:id/loyalty` | LoyaltyTransaction |
| Edit | `PUT /customers/:id` | generic CRUD، لم يُنفذ |

لم تُعرض tokens أو cookies أو credentials، ولم تُلتقط أي mutation request.

## 54. DB relationship proof

فحص read-only persistent: `current_database() = darfus_erp`، migrations=80، customers=2، branch_customers=2، invoices=15، invoice_items=24، payments=30، journal_entries=80، journal_lines=207، cash_transactions=57، open cash sessions=1. `customers.addresses` JSONB ولا توجد address table. لا orphan BranchCustomer، لا orphan Invoice أو InvoiceItem، ولا company mismatch، ولا duplicate primary address rows لأن primary column غير موجود. acceptance read-only: database exact acceptance، migrations=80، customers=3، invoices=133؛ لا mutation.

## 55. Persistent safety

الفحص المالي signed posted-ledger الحالي أعطى ملاحظة observation فقط: SYS-CASH=`5028356.3630` وSYS-BANK=`199085.3241`، مع جلسة cash مفتوحة واحدة. unbalanced journals=0 وorphan journal lines=0 حسب الفحص. هذه القيم لا تُقارن بباسلاين قديم ولا تُعدّل. لا توجد أي write في هذه الجولة.

## 56. DB integrity

`CUSTOMER_DATA_INTEGRITY = PASS`: لا orphan customer relations، لا orphan invoices/items، ولا duplicate primary addresses قابلة للفحص. `FINANCIAL_INTEGRITY = PASS`: لا journal imbalance أو orphan lines في الفحص الحالي. لم يُنفذ reconcile أو transaction أو fixture.

## 57. Migration / env / Git safety

- Persistent migrations قبل/بعد: 80/80.
- Acceptance migrations: 80.
- Migration 81: لم تُنشأ.
- `next-env.d.ts` لم يتغير؛ SHA الحالي الموروث `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`، ولم يُصلح لأنه خارج نطاق هذه الجولة.
- Branch `main`، HEAD `1657b0e9ba580faef69be48f04637835c201b521`.
- staged=0، tracked modified موروثة=76، untracked موروثة=277، stashes=11، لا remotes ظاهرة.
- لا commit، لا push، لا deploy، لا Next dev، لا restart.

## 58. قرارات Owner المطلوبة

`OWNER_DECISIONS_REQUIRED = INCOMPLETE` للأسباب التالية:

1. هل «الرصيد المتاح» في POS يعني outstanding `Customer.balance` أم `availableCredit` من credit ledger؟
2. إذا كان availableCredit: هل عرضه مسموح لكل من يملك `customers.view` أم يحتاج permission مالية مستقلة؟
3. هل العناوين متعددة؟ وما primary/default/type وقاعدة الاختيار في POS والفاتورة؟
4. هل الفاتورة التاريخية تحفظ phone/address وقت البيع (التوصية) أم live Customer data؟
5. هل Address permission تتبع `customers.update` أم permission منفصلة؟

## 59. البوابة والخطوة التالية

معظم الأدلة مكتملة، لكن لا يمكن إغلاق البوابة PASS لأن address authority وavailable-balance meaning وhistorical invoice policy غير محسومة من النظام الحالي. لا يوجد خطر على قاعدة العمل من هذه الجولة: كل الفحوصات SELECT/read-only، ولم يتغير business data أو الكود. بعد قرارات Owner فقط يمكن بدء Implementation Plan منفصل؛ لا يبدأ تلقائيًا.

## Required final tokens

```text
CURRENT_BATCH = CUSTOMER-MASTER-DATA-CREATE-EDIT-ADDRESS-POS-INVOICE-FORENSIC-01
MODE = STRICT_READ_ONLY_CUSTOMER_MASTER_DATA_FORENSIC
CUSTOMER_MODEL_FIELD_MAP = COMPLETE
CUSTOMER_ADDRESS_MODEL = PROVEN
CUSTOMER_CREATE_FLOW = COMPLETE
CUSTOMER_CREATE_ADDRESS_GAP_ROOT_CAUSE = PROVEN_FRONTEND_OMITS_ADDRESSES_BACKEND_GENERIC_JSONB_ACCEPTS
CUSTOMER_EDIT_BACKEND_STATUS = COMPLETE
CUSTOMER_EDIT_FRONTEND_STATUS = COMPLETE
CUSTOMER_DETAILS_PAGE_FORENSIC = COMPLETE
CUSTOMER_ADDRESS_CRUD_STATUS = COMPLETE
CUSTOMER_STATUS_AUTHORITY = PROVEN
CUSTOMER_TIER_AUTHORITY = PROVEN
CUSTOMER_PHONE_AUTHORITY = PROVEN
CUSTOMER_DISPLAY_ADDRESS_AUTHORITY = NOT_PROVEN
CUSTOMER_POINTS_AUTHORITY = PROVEN
CUSTOMER_AVAILABLE_BALANCE_MEANING = NOT_PROVEN
CUSTOMER_AVAILABLE_BALANCE_FORMULA = PROVEN
CUSTOMER_TOTAL_PURCHASES_AUTHORITY = PROVEN
POS_CUSTOMER_DATA_FLOW = COMPLETE
POS_CUSTOMER_CARD_BLUEPRINT = COMPLETE
POS_CUSTOMER_CARD_DATA_GAP_TABLE = COMPLETE
INVOICE_CUSTOMER_LINKAGE = PROVEN
INVOICE_CUSTOMER_PHONE_SOURCE = PROVEN
INVOICE_CUSTOMER_ADDRESS_SOURCE = PROVEN
HISTORICAL_INVOICE_CUSTOMER_DATA_POLICY = OWNER_DECISION_REQUIRED
INVOICE_CUSTOMER_SNAPSHOT_FIELDS = COMPLETE
INVOICE_RENDERING_PATHS = COMPLETE
INVOICE_PHONE_ADDRESS_GAP_ROOT_CAUSE = PROVEN_INVOICE_STORES_NAME_ONLY_AND_PRINT_BUILDER_OMITS_PHONE_ADDRESS
CUSTOMER_EDIT_PERMISSION_MAP = COMPLETE
CUSTOMER_ADDRESS_PERMISSION_MAP = COMPLETE
CUSTOMER_MASTER_AUDIT_STATUS = COMPLETE
CUSTOMER_EDIT_CONCURRENCY_STATUS = COMPLETE
CUSTOMER_VALIDATION_MAP = COMPLETE
CUSTOMER_ADDRESS_REQUIREMENT_MATRIX = COMPLETE
CUSTOMER_PHONE_REQUIREMENT_MATRIX = COMPLETE
CUSTOMER_CREATE_BLUEPRINT = COMPLETE
CUSTOMER_EDIT_BLUEPRINT = COMPLETE
CUSTOMER_ADDRESS_MANAGEMENT_BLUEPRINT = COMPLETE
POS_CUSTOMER_CARD_API_PLAN = COMPLETE
CUSTOMER_TOTAL_PURCHASES_PERFORMANCE = COMPLETE
CUSTOMER_AVAILABLE_BALANCE_PERFORMANCE = COMPLETE
POS_CUSTOMER_SUMMARY_READ_MODEL_RECOMMENDATION = COMPLETE
HISTORICAL_DATA_MUTATION_REQUIRED = NO
CUSTOMER_FLOW_MIGRATION_ASSESSMENT = COMPLETE
CUSTOMER_MASTER_IMPLEMENTATION_PHASE_PLAN = COMPLETE
CUSTOMER_MASTER_PHASE_A_PLAN = COMPLETE
CUSTOMER_MASTER_PHASE_B_PLAN = COMPLETE
CUSTOMER_MASTER_PHASE_C_PLAN = COMPLETE
CUSTOMER_MASTER_PHASE_D_PLAN = COMPLETE
CUSTOMER_MASTER_PHASE_E_RUNTIME_PLAN = COMPLETE
CUSTOMER_MASTER_DATA_MATRIX = COMPLETE
CUSTOMER_ADDRESS_GAP_TABLE = COMPLETE
INVOICE_CUSTOMER_DATA_MATRIX = COMPLETE
POS_CUSTOMER_CARD_GAP_TABLE = COMPLETE
CUSTOMER_PERMISSION_TABLE = COMPLETE
POS_CUSTOMER_FINANCIAL_VISIBILITY_POLICY = PROVEN
CUSTOMER_FIELD_VISIBILITY_POLICY = COMPLETE
RUNTIME_MUTATION_THIS_BATCH = NO
READ_ONLY_BROWSER_FORENSIC = PASS
CUSTOMER_READ_NETWORK_EVIDENCE = COMPLETE
CUSTOMER_DB_RELATIONSHIP_PROOF = COMPLETE
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
PRODUCT_CODE_FILES_CHANGED = 0
MIGRATIONS_CREATED = 0
CUSTOMER_DATA_INTEGRITY = PASS
FINANCIAL_INTEGRITY = PASS
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
ACCEPTANCE_MIGRATIONS = 80
MIGRATION_81_CREATED = NO
RUNTIME_ENV_CHANGED = NO
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
NEXT_DEV_STARTED_OR_RESTARTED = NO
OWNER_DECISIONS_REQUIRED = INCOMPLETE
CUSTOMER_MASTER_DATA_CREATE_EDIT_ADDRESS_POS_INVOICE_FORENSIC_01_GATE = BLOCKED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = CUSTOMER-MASTER-DATA-CREATE-EDIT-ADDRESS-IMPLEMENTATION-PLAN-01_IF_PASS (BLOCKED UNTIL OWNER DECISIONS)
```
