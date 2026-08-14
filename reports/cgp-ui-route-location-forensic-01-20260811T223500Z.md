# CGP-UI-ROUTE-LOCATION-FORENSIC-01

## 1. ملخص تنفيذي

تم تنفيذ تحليل جنائي للقراءة فقط. CGP موجود حاليًا في الواجهة، لكنه ليس عنصرًا مستقلًا في الـSidebar. نقطة الاكتشاف الرئيسية هي صفحة Sales، التي تعرض رابطين ثانويين إلى مسار شراء الذهب القديم ومساحة مسودات CGP. شاشة Suppliers & Purchases تعرض Profile الـCGP من العقد، لكنها تمنع الإرسال وتعرض عبارة Batch 6 كمعلومة عن تأجيل دلالات القطعة/السطر/حوض المادة؛ لا يوجد طلب API عند الضغط على الإرسال في هذا الوضع.

المسار القانوني الحالي هو مسودة CGP ثم Validate ثم Post عبر `/gold-purchases/cgp/drafts/:id/post`. Approval governance منفصل عن Posting ولا يساوي Posting. مسار `/customers/:id/gold/deposit` ما زال Legacy ويقوم مباشرة بإنشاء pool وAsset وتأثير محاسبي/دفع، ولذلك لا ينبغي اعتباره مدخل CGP canonical. مسار `/inventory-v2/cgp-items/:id/disposition` هو تحويل لاحق لعناصر CGP إلى Asset بشروط مادية، وليس Supplier → CGP.

## 2. الأدلة المصدرية

تمت قراءة `AGENTS.md` ثم `PROJECT_PROGRESS_HANDOFF.md` ثم `CGP_CANONICAL_IMPLEMENTATION_REFERENCE.md` والوثائق/التقارير المطلوبة. جميع الاستنتاجات أدناه من working tree الحالي، لا من تقرير تاريخي متعارض.

## 3. Git / Worktree

- الفرع: `main`
- HEAD: `1657b0e9ba580faef69be48f04637835c201b521`
- remotes: لا يوجد
- stashes: 11
- staged files: 0
- tracked/untracked: تغييرات موروثة كثيرة قبل هذه الجولة؛ لم يتم تعديلها أو تنظيفها.
- ملفات المصدر التي تغيرت بهذه الجولة: 0
- ملف التقرير الوحيد المضاف بهذه الجولة هو هذا التقرير المصرح به.

## 4. مكان CGP في الواجهة

### القائمة وطرق الوصول

`components/layout/sidebar.tsx:44-55,106-107` يعرّف مجموعة `salesCustomers` وفيها `/sales` بصلاحية `sales.view` و`/suppliers` بصلاحية `suppliers.view`. لا يوجد عنصر Sidebar باسم CGP أو Customer Gold Purchase.

`app/[locale]/(dashboard)/sales/page.tsx:244-245` يضيف داخل صفحة Sales رابطين ثانويين:

| الرابط | العنوان العربي | الوظيفة | التصنيف |
|---|---|---|---|
| `/sales/customer-gold` | شراء كسر | شاشة شراء ذهب عميل Legacy | LEGACY |
| `/sales/customer-gold/drafts` | مسودات شراء الذهب | مساحة مسودات CGP canonical | CANONICAL_DRAFT_UI |

إذًا CGP ليس مخفيًا بسبب Feature Flag أو Company/Branch؛ هو غير موجود كعنصر Sidebar مستقل، لكنه قابل للوصول من Sales أو بالـURL المباشر مع حارس المسار والصلاحيات.

### صفحات ومكونات CGP

| المسار | الملف/المكون | الحارس/الصلاحية | الربط | الحالة الحالية |
|---|---|---|---|---|
| `/sales/customer-gold` | `app/[locale]/(dashboard)/sales/customer-gold/page.tsx` | حارس `/sales` = `sales.view`؛ الإنشاء يستخدم `sales.create` في العميل | Sales action | Legacy/direct acquisition؛ API أو local/demo branch |
| `/sales/customer-gold/drafts` | نفس الصفحة + `GoldPurchaseDraftWorkspace kind="cgp"` | `sales.view` للقراءة fallback، و`gold_purchase.cgp.*` عند التخصيص | Sales action | Canonical draft workspace |
| `/approvals` | `app/[locale]/(dashboard)/approvals/page.tsx` | `approvals.view`؛ أزرار approve/reject حسب `gold_purchase.cgp.approve/reject/self_approve` | ليس CGP Sidebar مستقلًا | Governance review |
| `/inventory` و`/inventory/[id]` | مخزون قائم | `inventory.view` | Inventory | عرض Assets فقط؛ لا يوجد CGP Asset حالي في قاعدة القراءة |
| `/suppliers/purchases` | شاشة الاستلام | `suppliers.view`/`suppliers.create` | Suppliers | Profile CGP ظاهر من العقد، والإرسال ممنوع |

`GoldPurchaseDraftWorkspace` يميز `kind="cgp"` ويستخدم prefix `gold_purchase.cgp`; صلاحيات القراءة/الإنشاء/التعديل/التحقق/الإبطال لها fallback إلى `sales.view` أو `sales.create` عند عدم وجود الصلاحية المخصصة، بينما submit يتطلب `gold_purchase.cgp.submit`.

## 5. مسارات Backend

التركيب في `backend/src/routes/index.js:25` هو `router.use("/gold-purchases", goldPurchaseRoutes)`.

| METHOD | PATH | Middleware/Permission | Service/Handler | الغرض | التصنيف |
|---|---|---|---|---|---|
| GET | `/gold-purchases/approvals` | auth | `goldPurchaseGovernanceService.listApprovals` | قائمة طلبات الحوكمة | CANONICAL |
| GET | `/gold-purchases/approvals/:id` | auth | `getApproval` | تفاصيل طلب | CANONICAL |
| POST | `/gold-purchases/cgp/drafts` | auth + `gold_purchase.cgp.create` أو fallback sales | `goldPurchaseDraftService.create` | إنشاء مسودة | CANONICAL |
| GET | `/gold-purchases/cgp/drafts` | auth + read permission | draft service list | قائمة المسودات | CANONICAL |
| GET | `/gold-purchases/cgp/drafts/:id` | auth + read permission | draft service get | تفاصيل المسودة | CANONICAL |
| PATCH | `/gold-purchases/cgp/drafts/:id` | auth + update permission | draft service update | تعديل Draft | CANONICAL |
| POST | `/gold-purchases/cgp/drafts/:id/validate` | auth + validate | draft service validate | DRAFT → VALIDATED | CANONICAL |
| POST | `/gold-purchases/cgp/drafts/:id/post` | auth + `gold_purchase.cgp.post` + idempotency | `cgpPostingService.post` | VALIDATED → POSTED، snapshot، Outbox event | CANONICAL |
| POST | `/gold-purchases/cgp/drafts/:id/submit` | auth + submit | governance submit | طلب اعتماد | CANONICAL_GOVERNANCE |
| POST | `/gold-purchases/cgp/drafts/:id/approve` | auth + approve/self-approve | governance approve | اعتماد Governance فقط | CANONICAL_GOVERNANCE |
| POST | `/gold-purchases/cgp/drafts/:id/reject` | auth + reject | governance reject | رفض Governance | CANONICAL_GOVERNANCE |
| POST | `/gold-purchases/cgp/drafts/:id/void` | auth + void | draft service void | إبطال قبل/حسب الحالة | CANONICAL |
| POST | `/gold-purchases/cgp/drafts/:id/revisions` | auth | draft revisions | سجل revisions | CANONICAL |
| POST | `/gold-purchases/cgp/drafts/:id/reversal-holds` | auth + reversal authority | reversal service | hold لعكس | CANONICAL_REVERSAL |
| POST | `/gold-purchases/cgp/drafts/:id/reversal-compensations` | auth + reversal authority | reversal service | تعويض | CANONICAL_REVERSAL |
| POST | `/gold-purchases/cgp/reversal-requests/:id/compensate-accounting` | auth | reversal service | تعويض Accounting | CANONICAL_REVERSAL |
| POST | `/gold-purchases/cgp/reversal-requests/:id/compensate-gold` | auth | reversal service | تعويض Gold | CANONICAL_REVERSAL |
| POST | `/gold-purchases/cgp/reversal-requests/:id/finalize` | auth | reversal service | إنهاء العكس | CANONICAL_REVERSAL |
| POST | `/customers/:id/gold/deposit` | auth فقط + isolation gate | route inline | pool + Asset + Journal + payout اختياري | LEGACY/CONFLICTING_AS_CGP |
| POST | `/customers/:id/gold/payout` | auth + idempotency | route inline | payout pool/treasury | LEGACY_CUSTOMER_GOLD |
| POST | `/customers/:id/gold/use-in-sale` | auth | route inline | استهلاك pool في Sale | LEGACY_CUSTOMER_GOLD |
| POST | `/inventory-v2/cgp-items/:id/disposition` | auth + `inventory.adjust` | route inline + `cgp-legacy-isolation` | تحويل عنصر CGP إلى Asset عند دليل مادي | TEMPORARY_CONVERSION |

التعريفات في `backend/src/bootstrap/cgp-permission-catalog-v3.js` تشمل capabilities مستقبلية مثل `post`, `view_integration_status`, `retry_integration`, `reverse`؛ هذه تعريفات كتالوج فقط ولم تُجرَ أي Permission mutation.

## 6. دورة CGP الحالية

المصدر يثبت:

```text
DRAFT → VALIDATED → POSTED
```

`gold-purchase-draft.service.js` يربط submitted/approved بحالة الأعمال `VALIDATED` مع Governance status منفصل. `gold-purchase-governance.service.js` لا ينشئ Asset ولا Journal عند approve. `cgp-posting.service.js` يفرض `businessStatus === VALIDATED`، ويستخدم permission `gold_purchase.cgp.post`، ويغيّر إلى `POSTED`، ويكتب snapshot وAudit ويضع `CustomerGoldPurchasePostedEvent` في Outbox. لذلك:

```text
CGP_POSTING_MINIMUM_BUSINESS_GATE = VALIDATED
CGP_APPROVAL_REQUIRED_BEFORE_POST = NO
```

## 7. شاشة Suppliers & Purchases

- المسار: `/suppliers/purchases`
- الملف: `app/[locale]/(dashboard)/suppliers/purchases/page.tsx`
- العنوان: `استلام التوريدات وأوامر الشراء`
- endpoint عند الاستلام الفعلي: `POST /purchase-orders/receive` (مع alias `/supplier-purchases/receive`)
- backend: auth + `suppliers.create` ثم `cgpLegacyIsolation.assertSupplierReceiveDoesNotMasqueradeAsCgp`.

### أوضاع الإدخال

| الظاهر للمستخدم | القيمة/المعنى | endpoint | الأثر | الحالة |
|---|---|---|---|---|
| `منتج قديم بالكمية (توافق فقط)` | `isQuantityBased=true` | receive endpoint | مسار Product/quantity القديم، قابل للكتابة | توافق تاريخي، ظاهر وقابل للاختيار |
| `استلام أصول فعلية منفصلة` | `isQuantityBased=false` | `/purchase-orders/receive` | كل قطعة فعلية Asset/Barcode مستقل | المسار canonical المفضل |

مصدر الشاشة يوضح أن `isCgpProfile` يتحقق من `CGP_CUSTOMER_GOLD_PURCHASE`. في الوضع serialized، `handlePostPurchase` عند السطر 401-402 يعرض رسالة أن مسار CGP مؤجل إلى Batch 6 ويعود قبل استدعاء API. لوحة المعلومات عند 1019-1021 تقول إن CGP ظاهر من العقد لكن الاستلام غير متاح حتى حسم piece/line/material-pool semantics، والزر عند 1198-1200 معطل بعنوان `CGP deferred to Batch 6`.

```text
LEGACY_QUANTITY_OPTION_STATUS = ACTIVE_SELECTABLE_COMPATIBILITY_ONLY
LEGACY_QUANTITY_OPTION_CAN_WRITE = YES
```

هذا الخيار موجود للتوافق مع Product/quantity القديم، ويمكنه الكتابة عند اختياره؛ لذلك لا يمثل سلطة المخزون الفيزيائي canonical ولا ينبغي خلطه مع CGP.

## 8. معنى Batch 6

المصدر الوحيد المرئي في هذه الشاشة هو `app/[locale]/(dashboard)/suppliers/purchases/page.tsx:401-402,1019-1021,1198-1200`. Batch 6 هنا اسم milestone تطويري لتأجيل دلالات القطعة والسطر وحوض المادة، وليس اسم route أو API أو feature flag. الحالة الحالية معلومة + منع إرسال في serialized CGP؛ لا يطلق handler تحويل ولا ينشئ Asset.

```text
CGP_BATCH_6_SOURCE = suppliers/purchases/page.tsx (isCgpProfile guard, info panel, disabled submit)
CGP_BATCH_6_MEANING = deferred CGP piece/line/material-pool semantics; development milestone, not a business operation
CGP_BATCH_6_ACTION_STATE = DISABLED_INFORMATIONAL
CGP_BATCH_6_CAN_WRITE = NO
```

## 9. Supplier → CGP والتحويلات

لم يُعثر على مسار يحوّل Supplier Receive أو Purchase Order إلى CGP. Guard الـfrontend والـbackend يمنعان masquerade؛ مسار Supplier يستقبل Supplier/Vendor فقط.

`/inventory-v2/cgp-items/:id/disposition` ليس Supplier → CGP: هو عنصر CGP موجود مسبقًا يُحوّل لاحقًا إلى Asset عند `CONVERTED_TO_ASSET` ودليل مادي، مع Asset/Barcode مولدين من الخادم. لذلك تصنيفه `TEMPORARY_CONVERSION` وليس مدخل CGP.

```text
SUPPLIER_TO_CGP_CONVERSION_PATH_EXISTS = NO
SUPPLIER_TO_CGP_CONVERSION_CLASSIFICATION = NOT_APPLICABLE (CGP-item disposition is a separate TEMPORARY_CONVERSION)
SUPPLIER_ACTOR = SUPPLIER
CGP_ACTOR = CUSTOMER
ACTOR_BOUNDARY_IMPLEMENTED = PASS
SUPPLIER_AND_CGP_ACCOUNTING_PATHS_SEPARATE = PARTIAL
```

السبب في `PARTIAL` هو وجود المسار Legacy `/customers/:id/gold/deposit` الذي يملك pool وAsset وJournal مباشرة، بينما المسار canonical يفصل Posting عن Inventory/Accounting/Gold Center عبر event. لا يوجد Supplier→CGP مباشر.

## 10. قاعدة قطعة واحدة

- Supplier serialized path: `one physical piece → one Asset/barcode`، وواجهة الاستلام نفسها تعرض هذا المعنى؛ PASS.
- CGP canonical consumer `cgp-inventory-consumer.service.js` يستهلك `CustomerGoldPurchasePostedEvent` وينشئ Asset واحدًا لكل CGP item بحالة `PENDING_INTEGRATION` وbarcode فريد؛ PASS من حيث الكود canonical.
- لا توجد حاليًا Assets persistent بمصدر `customer_gold_purchase` أو profile CGP في لقطة القراءة.

```text
SUPPLIER_CANONICAL_ONE_PIECE_ONE_ASSET = PASS
CGP_ONE_PIECE_ONE_ASSET = PASS
```

## 11. الصلاحيات وFeature Flags

| السطح | الصلاحيات/الشرط |
|---|---|
| Sidebar Sales | `sales.view` |
| Legacy customer-gold | route sales guard؛ API legacy auth؛ client يستخدم sales context |
| CGP draft read/create/update/validate/void | `gold_purchase.cgp.*` مع fallbacks موضحة في workspace |
| CGP submit | `gold_purchase.cgp.submit` |
| CGP approve/reject/self-approve | `gold_purchase.cgp.approve`, `.reject`, `.self_approve` |
| CGP post | `gold_purchase.cgp.post` server authority |
| Supplier receive | `suppliers.view`/`suppliers.create` |
| CGP disposition | `inventory.adjust` |
| Batch 6 | لا permission ولا feature flag؛ guard واجهة فقط |

`CGP_LEGACY_ISOLATION_ENABLED` موجود في `cgp-legacy-isolation.service.js`؛ قيمته الافتراضية الحالية false عند غياب env، لذلك Legacy deposit ليس معطلاً افتراضيًا. لم يتم تعديل env أو permissions.

## 12. مصفوفة Route/Menu/Permission

| feature | route exists | menu entry | permission/guard | feature flag | can write now | result |
|---|---|---|---|---|---|---|
| Legacy customer gold | نعم | Sales action | sales.view + API auth | isolation flag false افتراضيًا | نعم | Legacy/conflicting |
| CGP drafts | نعم | Sales action | gold_purchase.cgp.* / sales fallback | لا | نعم عبر draft APIs | Canonical draft |
| CGP post | نعم | غير مستقل؛ من workspace | `gold_purchase.cgp.post` | لا | نعم بعد VALIDATED | Canonical posting |
| Approvals | نعم | صفحة Approvals | approvals.view + cgp approval keys | لا | نعم للحَوْكمة | Approval لا يساوي Posting |
| Supplier CGP profile | نعم كخيار contract | Supplier page | suppliers.* | لا | لا في serialized | Deferred informational |
| CGP item disposition | نعم | لا menu مستقل | inventory.adjust + isolation gate | نعم/false | نعم عند evidence | Temporary conversion |

```text
CGP_MENU_ENTRY_FOUND = YES
CGP_MENU_LOCATION = Sales page secondary actions (not global sidebar)
CGP_MENU_ROUTE = /sales/customer-gold and /sales/customer-gold/drafts
CGP_MENU_PERMISSION = sales.view (draft workspace also evaluates gold_purchase.cgp.*)
```

## 13. Browser evidence (قراءة فقط)

باستخدام الجلسة الموثقة الموجودة فقط:

- `/ar/gold-center`: Sidebar بلا عنصر CGP مستقل.
- `/ar/sales`: ظهرت أزرار `شراء كسر` و`مسودات شراء الذهب` بالمسارين أعلاه.
- `/ar/suppliers/purchases`: ظهرت أوضاع الإدخال، وProfile `شراء ذهب العميل CGP` ضمن العقد، مع Company/Branch المعروفتين؛ لم يتم اختيار CGP ولم يتم الضغط على Save/Post/Receive/Convert.
- `/ar/sales/customer-gold`: ظهرت شاشة Legacy لشراء الذهب من العميل.
- لم يتم تشغيل أي write action.

```text
BROWSER_CGP_DISCOVERY = PASS
BROWSER_WRITE_ACTIONS_TRIGGERED = 0
```

## 14. لقطة قاعدة البيانات (قراءة فقط)

تم في كل جلسة فحص التحقق من `SELECT current_database()` وكانت قاعدة Persistent هي `darfus_erp`. لا توجد مقارنة destructive ولا نسخ بيانات.

| الكيان | قبل | بعد | الملاحظة |
|---|---:|---:|---|
| SequelizeMeta migrations | 80 | 80 | لا Migration 81 |
| Assets | 53 | 53 | لا CGP asset حالي |
| Products | 3 | 3 | محفوظ |
| Customers | 1 | 1 | محفوظ |
| Suppliers | 1 | 1 | محفوظ |
| CGP documents | 2 | 2 | واحد approved/VALIDATED وواحد draft |
| CGP items | 4 | 4 | `proposedRate` null في اللقطة |
| CGP dispositions | 4 | 4 | كلها pending piece evidence، بلا Asset |
| Customer gold pools | 1 | 1 | Legacy history |
| Inventory gold pools | 0 | 0 | لا rows |
| Invoices | 13 | 13 | محفوظ |
| Journal entries | 67 | 67 | متوازنة |
| Journal lines | 176 | 176 | لا orphan |
| Cash transactions | 50 | 50 | لا unlinked treasury |
| Gold market quotes | 104 | 104 في اللقطة | worker growth الطبيعي غير منسوب للجولة |
| Outbox events | 0 | 0 | لا mutation |
| integration statuses | 0 | 0 | لا mutation |

Integrity checks: blank barcodes 0، duplicate barcodes 0، unbalanced journals 0، orphan journal lines 0، unlinked treasury 0. إعداد الذهب المقروء: `GOLDAPI_IO / LIVE_PROVIDER / AED / 1500 / 2500`.

```text
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
GOLD_BASELINE_PRESERVED = PASS
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO
```

## 15. تقييم UX وتوصية فقط

- CGP قابل للاكتشاف من Sales، لكن غياب عنصر مستقل في Sidebar يجعل الوصول غير مباشر.
- ظهور خيار Legacy quantity بشكل بارز في شاشة Supplier قد يربك المستخدم؛ هو compatibility-only لكنه قابل للكتابة.
- عبارة Batch 6 مصطلح تطويري مكشوف للمستخدم التجاري؛ الأفضل لاحقًا استبدالها برسالة عمل مفهومة أو نقلها إلى Advanced/Legacy، بعد قرار Owner.
- CGP منطقيًا مكانه Sales/Customers لا Suppliers.
- لا أوصي بأي تغيير في هذه الجولة؛ هذه نقاط تصميم للـOwner فقط.

```text
UX_RECOMMENDATION_ONLY = YES
```

## 16. خلاصة القرار

تم تحديد المكان الفعلي، المسارات، الصلاحيات، حدود Supplier/Customer، سبب عبارة Batch 6، وعدم وجود Supplier→CGP مباشر. لم تُجرَ إصلاحات ولم تُلمس قاعدة البيانات أو الصلاحيات أو Feature Flags أو العمليات.

## 17. Required final tokens

```text
CURRENT_BATCH = CGP-UI-ROUTE-LOCATION-FORENSIC-01
FORENSIC_MODE = READ_ONLY
CGP_MENU_ENTRY_FOUND = YES
CGP_MENU_LOCATION = Sales page secondary actions (not global sidebar)
CGP_MENU_ROUTE = /sales/customer-gold and /sales/customer-gold/drafts
CGP_MENU_PERMISSION = sales.view (draft workspace also evaluates gold_purchase.cgp.*)
CGP_FRONTEND_ROUTE_INVENTORY = COMPLETE
CGP_FRONTEND_COMPONENT_INVENTORY = COMPLETE
CGP_BACKEND_ROUTE_INVENTORY = COMPLETE
CGP_POSTING_MINIMUM_BUSINESS_GATE = VALIDATED
CGP_APPROVAL_REQUIRED_BEFORE_POST = NO
SUPPLIER_RECEIVE_SCREEN_ROUTE = /suppliers/purchases
SUPPLIER_RECEIVE_SCREEN_FILE = app/[locale]/(dashboard)/suppliers/purchases/page.tsx
SUPPLIER_RECEIVE_ENTRY_MODES = isQuantityBased=true legacy Product/quantity; isQuantityBased=false serialized physical Assets
LEGACY_QUANTITY_OPTION_STATUS = ACTIVE_SELECTABLE_COMPATIBILITY_ONLY
LEGACY_QUANTITY_OPTION_CAN_WRITE = YES
CGP_BATCH_6_SOURCE = suppliers/purchases/page.tsx isCgpProfile guard/info/disabled submit
CGP_BATCH_6_MEANING = deferred piece/line/material-pool semantics milestone
CGP_BATCH_6_ACTION_STATE = DISABLED_INFORMATIONAL
CGP_BATCH_6_CAN_WRITE = NO
SUPPLIER_TO_CGP_CONVERSION_PATH_EXISTS = NO
SUPPLIER_TO_CGP_CONVERSION_CLASSIFICATION = NOT_APPLICABLE
SUPPLIER_ACTOR = SUPPLIER
CGP_ACTOR = CUSTOMER
ACTOR_BOUNDARY_IMPLEMENTED = PASS
SUPPLIER_AND_CGP_ACCOUNTING_PATHS_SEPARATE = PARTIAL
SUPPLIER_CANONICAL_ONE_PIECE_ONE_ASSET = PASS
CGP_ONE_PIECE_ONE_ASSET = PASS
BROWSER_CGP_DISCOVERY = PASS
BROWSER_WRITE_ACTIONS_TRIGGERED = 0
PERMISSION_MUTATIONS_THIS_BATCH = 0
FEATURE_FLAG_MUTATIONS_THIS_BATCH = 0
CGP_ROUTE_MENU_PERMISSION_MATRIX = COMPLETE
UX_RECOMMENDATION_ONLY = YES
SOURCE_FILES_CHANGED_THIS_BATCH = 0
PERSISTENT_DATABASE_WRITES_THIS_BATCH = 0
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
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
HANDOFF_IMPLEMENTATION_STATE_CHANGED = NO
CGP_UI_ROUTE_LOCATION_FORENSIC_01_GATE = FORENSIC_COMPLETE
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
```

