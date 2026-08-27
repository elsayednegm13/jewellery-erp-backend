# CUSTOMER-GOLD-CGP-SCRAP-DEPOSIT-FORENSIC-01

## 1. النطاق والنتيجة التنفيذية

هذه جولة forensic للقراءة فقط. لم يتم تعديل المصدر أو الإعدادات أو الصلاحيات أو قواعد البيانات أو العمليات.

النتيجة: توجد ثلاثة أسطح متداخلة في الواجهة، لكنها ليست ثلاثة عمليات مستقلة بالكامل:

1. **CGP canonical**: شراء الشركة ذهبًا ماديًا من العميل عبر Draft/Validate/Post ثم أحداث تكاملية للمخزون والمحاسبة وGold Center وCRM.
2. **شراء كسر ذهب**: شاشة Sales قديمة تصل إلى `/customers/:id/gold/deposit` وتنفذ شراءً فوريًا مباشرًا؛ وهي نفس الحدث الاقتصادي العام تقريبًا، لكن بسلطة Legacy مختلفة وتتجاوز بوابة CGP Posting.
3. **Gold Deposit**: اسم route قديم لشراء/إيداع ذهب كسر في `CustomerGoldPool`، مع إنشاء Asset وقيد محاسبي، ودفع اختياري للعميل. ليس عربونًا نقديًا.

العربون المالي الحقيقي منفصل في مسارات الحجوزات والدفعات، ويستخدم التزام دفعات العملاء وCash/Bank، ثم تتم تسويته عند إتمام البيع أو ردها عبر مسار الحجز.

## 2. ملفات وأدلة القراءة

تمت قراءة `AGENTS.md` ثم `PROJECT_PROGRESS_HANDOFF.md` ثم `CGP_CANONICAL_IMPLEMENTATION_REFERENCE.md`، ثم التقرير السابق `cgp-ui-route-location-forensic-01-20260811T223500Z.md` وتقارير CGP وGold المطلوبة. الأدلة التنفيذية من working tree الحالي.

## 3. FLOW A — CGP canonical

### الواجهة

- المسارات: `/sales/customer-gold/drafts` (workspace canonical) و`/approvals` للمراجعة.
- صفحة Sales (`app/[locale]/(dashboard)/sales/page.tsx`) تعرض رابط `مسودات شراء الذهب`.
- المكون: `features/gold-purchases/components/GoldPurchaseDraftWorkspace.tsx` مع `kind="cgp"`.
- الصلاحيات: `gold_purchase.cgp.view/create/update_draft/validate/submit/approve/reject/self_approve/void`، مع fallbacks قراءة/إنشاء إلى `sales.view/sales.create` داخل workspace؛ Posting يتطلب `gold_purchase.cgp.post` من الخادم.
- لا توجد شاشة Settlement مستقلة مكتملة في هذا المسار؛ الدفع/التسوية المستقبلية ليست بديلًا عن Posting.

### Backend lifecycle

`backend/src/routes/index.js` يركب `goldPurchaseRoutes` تحت `/gold-purchases`، و`backend/src/routes/gold-purchase.routes.js` يوفر:

```text
POST /gold-purchases/cgp/drafts
GET/PATCH /gold-purchases/cgp/drafts[/:id]
POST /gold-purchases/cgp/drafts/:id/validate
POST /gold-purchases/cgp/drafts/:id/post
POST /gold-purchases/cgp/drafts/:id/submit
POST /gold-purchases/cgp/drafts/:id/approve
POST /gold-purchases/cgp/drafts/:id/reject
POST /gold-purchases/cgp/drafts/:id/void
POST /gold-purchases/cgp/drafts/:id/revisions
POST /gold-purchases/cgp/drafts/:id/reversal-holds
POST /gold-purchases/cgp/drafts/:id/reversal-compensations
POST /gold-purchases/cgp/reversal-requests/:id/compensate-accounting
POST /gold-purchases/cgp/reversal-requests/:id/compensate-gold
POST /gold-purchases/cgp/reversal-requests/:id/finalize
```

`cgp-posting.service.js` يفرض:

- document business status = `VALIDATED`.
- صلاحية `gold_purchase.cgp.post`.
- version/idempotency وحماية التكرار.
- pricing snapshot داخلي.
- `CustomerGoldPurchasePostedEvent` في Outbox.

Approval في `gold-purchase-governance.service.js` يغير Governance status فقط؛ لا يساوي Posting ولا ينشئ Asset أو Journal.

### الملكية الاقتصادية والمحاسبية

المستهلك `cgp-accounting-consumer.service.js` يحل الحسابات الدلالية خادميًا ويقيد:

```text
Dr INVENTORY_ASSET
Cr CUSTOMER_CREDITOR
```

القيمة هي `totalPayableToCustomer` الناتجة من pricing snapshot. لا يختار العميل حسابًا ولا تُنشأ الحسابات وقت المعاملة. أثر العميل هو **Customer Financial Liability / Creditor** وليس Customer receivable.

`cgp-inventory-consumer.service.js` ينشئ Asset بعد الحدث المنشور فقط، Asset واحدًا لكل CGP item، بحالة `PENDING_INTEGRATION` وbarcode فريد. `cgp-gold-center-consumer.service.js` ينشر حدث Gold Center؛ CGP لا يملك Gold Center مباشرة. `cgp-crm-consumer.service.js` يسجل Customer Timeline.

```text
CGP_CANONICAL_TRACE = COMPLETE
CGP_ACCOUNTING_SEMANTICS = Dr INVENTORY_ASSET / Cr CUSTOMER_CREDITOR via canonical Accounting event consumer
CGP_CUSTOMER_BALANCE_EFFECT = customer creditor liability increases; no cash payout at Posting
CGP_ASSET_CREATION_BEFORE_POSTING = NO
CGP_ONE_PIECE_ONE_ASSET = PASS
CGP_EXTERNAL_PROVIDER_HTTP_AT_POSTING = 0
CGP_PRICING_MODE = internal EffectiveRateService / Gold pricing authority; policy BID / NONE / 0, immutable posting snapshot
```

## 4. FLOW B — شراء كسر ذهب

### مكانه وواجهته

- عنصر Sales: `شراء كسر` في `app/[locale]/(dashboard)/sales/page.tsx:244`.
- المسار: `/sales/customer-gold`.
- الملف: `app/[locale]/(dashboard)/sales/customer-gold/page.tsx`.
- عنوان الصفحة: `شراء الذهب المستعمل من العملاء` / `Customer Scrap Gold Purchase`.
- وصف الصفحة يقول شراء الذهب والكسر من الأفراد وتسجيله كأصل مخزني غير مصنع.
- حارس الصفحة العام: `/sales` يحتاج `sales.view`؛ endpoint Legacy يكتفي حاليًا بـ`authMiddleware` بعد isolation gate، بلا صلاحية CGP مخصصة.

```text
SCRAP_GOLD_MENU_LABEL = شراء كسر (صفحة Sales) / شراء الذهب المستعمل من العملاء (عنوان الصفحة)
SCRAP_GOLD_FRONTEND_ROUTE = /sales/customer-gold
SCRAP_GOLD_FRONTEND_FILE = app/[locale]/(dashboard)/sales/customer-gold/page.tsx
SCRAP_GOLD_PERMISSION = sales.view للصفحة؛ backend auth فقط لمسار Legacy
```

### حقول وسلوك الواجهة

الحقول: Customer، description، karat، purity display، gross weight، manual `ratePerGram`، payout method (cash/transfer). الواجهة تحسب `weight × ratePerGram` للعرض. في API mode ترسل `CustomerGoldDepositRequest` إلى `/customers/:id/gold/deposit` وتعرض نجاحًا بصيغة شراء كسر وصرف. في local/demo mode تصنع Asset وInvoice داخل `erp-context` فقط؛ هذا branch عميل محلي وليس سلطة persistent.

```text
SCRAP_GOLD_FRONTEND_TRACE = COMPLETE
```

### Backend والكتابة

`POST /customers/:id/gold/deposit` في `backend/src/routes/erp.routes.js:2689` يفتح transaction واحدة، ثم:

1. يتحقق من isolation flag.
2. يحسب `calculatedValue = weight × ratePerGram` بعد rounding.
3. ينشئ `CustomerGoldPool` بحالة `approved` و`grossWeight/purity/fineWeight`.
4. ينشئ Asset فوريًا باسم/category ذهب كسر، حالة `available` أولًا، وbarcode من `barcodeIdentityService`، ثم AssetEvent `SCRAP_PURCHASED`.
5. ينشئ Journal مباشر:

```text
Dr account 1200 (inventory)
Cr account 2300 (customer gold/deposit liability)
```

6. عند `payout=true` ينشئ Invoice سالبًا من نوع `return` بحالة `paid`، InvoiceItem مرتبطًا بالـAsset، وقيد دفع:

```text
Dr RESERVATION_ADVANCE_LIABILITY / customer-deposit liability
Cr mapped cash or bank
```

7. ينشئ `CashTransaction` من نوع `cash_out`، Audit، Notification وSSE.

```text
SCRAP_GOLD_BACKEND_TRACE = COMPLETE
SCRAP_GOLD_WRITE_SET = CustomerGoldPool + Asset + AssetEvent + JournalEntry/JournalLines + optional Invoice/InvoiceItem + optional CashTransaction + Audit/Notification/SSE
SCRAP_GOLD_CREATES_ASSET = YES
SCRAP_GOLD_ASSET_TIMING = immediate in same transaction, before any canonical CGP Posting
SCRAP_GOLD_ONE_PIECE_ONE_ASSET = FAIL (single aggregate weight form; no piece cardinality proof)
SCRAP_GOLD_ACCOUNTING = Dr inventory 1200 / Cr customer gold liability 2300; optional payout Dr liability / Cr cash or bank
SCRAP_GOLD_PRICING_SOURCE = client-supplied manual ratePerGram × weight; legacy route, not canonical EffectiveRateService/provider feed
SCRAP_GOLD_PRICING_SNAPSHOT = YES (persisted cost/price and pool value, but not the canonical CGP pricing-snapshot model)
SCRAP_GOLD_LIFECYCLE = immediate approved pool + available Asset + posted journal; optional paid payout; no Draft/Validated/Posted state machine
```

هذه العملية ليست نفس تنفيذ CGP canonical تقنيًا، رغم أن الحدث الاقتصادي العام متشابه: الشركة تشتري ذهبًا ماديًا من عميل. لا توجد مراجعة Posting أو event-driven integration قبل الأثر.

## 5. FLOW C — `/customers/:id/gold/deposit`

### مكانه ومعناه

- Frontend caller: `/sales/customer-gold` في `app/[locale]/(dashboard)/sales/customer-gold/page.tsx:107`.
- Backend: `POST /customers/:id/gold/deposit` في `backend/src/routes/erp.routes.js:2689`.
- لا توجد صفحة Customer مستقلة باسم Gold Deposit في production UI؛ الوصول الحالي يأتي من شاشة شراء الكسر أو URL/API.

المصدر ينشئ `CustomerGoldPool` ويصف العملية في الرسائل والتدقيق كـ`إيداع ذهب كسر عميل` و`شراء ذهب مستعمل`. لذلك المعنى هو **legacy customer gold purchase / gold-pool intake**، وليس عربونًا نقديًا.

```text
GOLD_DEPOSIT_FRONTEND_ROUTE = /sales/customer-gold (caller; no separate customer-page route)
GOLD_DEPOSIT_FRONTEND_FILE = app/[locale]/(dashboard)/sales/customer-gold/page.tsx
GOLD_DEPOSIT_BACKEND_ROUTE = POST /customers/:id/gold/deposit
GOLD_DEPOSIT_BUSINESS_MEANING = LEGACY_CUSTOMER_GOLD_PURCHASE + GOLD_POOL_INTAKE
GOLD_DEPOSIT_USER_LABEL = شراء الذهب المستعمل من العملاء / إيداع ذهب كسر عميل
GOLD_DEPOSIT_IS_FINANCIAL_ARABON = NO
```

### الكتابة والتجاوز

```text
GOLD_DEPOSIT_WRITE_SET = CustomerGoldPool + Asset + AssetEvent + JournalEntry/JournalLines + optional payout Invoice/InvoiceItem + optional CashTransaction + Audit + Notification/SSE
GOLD_DEPOSIT_DIRECT_CREATIONS = approved CustomerGoldPool, immediate Asset/barcode, direct inventory/liability journal, optional negative paid Invoice and cash/bank payout
GOLD_DEPOSIT_BYPASSES_CGP_POSTING = YES
GOLD_DEPOSIT_ACCOUNTING = Dr inventory 1200 / Cr customer gold liability 2300; optional payout Dr liability / Cr cash or bank
GOLD_DEPOSIT_CREATES_ASSET = YES
GOLD_DEPOSIT_CREATES_POOL = YES
GOLD_DEPOSIT_ONE_PIECE_ONE_ASSET = FAIL (aggregate request; no piece-level input)
GOLD_DEPOSIT_BARCODE_GUARANTEE = YES in backend via barcodeIdentityService; local/demo branch uses non-durable LOCAL-PENDING barcode
GOLD_DEPOSIT_PRICING = manual ratePerGram × weight with karat-derived purity; persisted pool fineWeight and Asset cost/price; no canonical live quote snapshot and no repricing path
```

## 6. العربون المالي الحقيقي

تم العثور على مسار مستقل:

- `/sales/reservations` في `app/[locale]/(dashboard)/sales/reservations/page.tsx`.
- POS reservation/deposit mode في `app/[locale]/(dashboard)/pos/page.tsx`.
- `POST /reservations` لإنشاء الحجز مع `initialPayment`.
- `POST /reservations/:id/payments` للدفعات اللاحقة.
- `POST /reservations/:id/complete-sale` للتسوية النهائية.
- `POST /reservations/:id/refunds` ثم approval/execute لمسار الرد.

`reservation.service.js` ينشئ `Reservation`, `ReservationItem`, يغيّر Asset إلى `RESERVED`، ثم `ReservationPayment` وreceipt. `_createPaymentInTransaction` ينشئ Journal وCashTransaction:

```text
Dr branch-resolved Cash/Bank
Cr CUSTOMER_DEPOSIT_LIABILITY / Reservation Advances
```

هذا هو عربون نقدي/دفعة مقدمة حقيقية؛ لا ينشئ Asset جديدًا، بل يحجز Asset قائمًا. التسوية تستخدم `postReservationAdvanceSettlementEntry` عند إتمام البيع، والرد يستخدم مسار reservation refund.

```text
FINANCIAL_ARABON_FLOW_FOUND = YES
FINANCIAL_ARABON_ROUTE = /sales/reservations + /reservations + /reservations/:id/payments (also POS reservation mode)
FINANCIAL_ARABON_ACCOUNTING = Dr branch Cash/Bank / Cr configured CUSTOMER_DEPOSIT_LIABILITY; later settlement/refund through reservation services
GOLD_DEPOSIT_AND_FINANCIAL_ARABON_ARE_SAME_FLOW = NO
```

## 7. مصفوفة الحدث الاقتصادي

| التدفق | Actor | الحدث | يدخل ذهب مادي؟ | Cash يدخل/يخرج | Creditor/Debtor | Asset | Accounting | Gold Center | Inventory | Pricing | Lifecycle | UI/Permission | الحالة |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CGP canonical | Customer | شراء شركة من عميل | نعم بعد Posting event | لا عند Posting | Customer creditor | بعد Posting، واحد/item | Dr inventory / Cr customer creditor | event consumer | event consumer | internal canonical snapshot | Draft→Validated→Posted | Sales drafts + CGP perms | CURRENT/CANONICAL |
| Scrap Gold | Customer | شراء كسر فوري | نعم فورًا | payout يخرج Cash/Bank | pool/liability + payout | فوري؛ قطعة واحدة لكل request | Dr 1200 / Cr 2300، ثم payout | لا event canonical | Asset مباشر | manual rate | immediate approved/paid | Sales action + sales.view | LEGACY_DUPLICATE |
| Gold Deposit | Customer | نفس Gold Pool intake القديم | نعم فورًا | payout اختياري | customer gold liability | فوري | نفس Scrap Gold | لا canonical event | Asset مباشر | manual rate | immediate | API caller من Sales | LEGACY_DUPLICATE |
| Financial Arabon | Customer | دفعة مقدمة لحجز Sale | لا Asset جديد | Cash/Bank يدخل | customer advances liability | لا، Asset موجود يتحول RESERVED | Dr Cash/Bank / Cr advances liability | لا | Reservation state | Sale/server price | Reservation/payment→sale/refund | Reservations/POS + reservation perms | FINANCIAL_ARABON_DISTINCT |

```text
CUSTOMER_GOLD_FLOW_MATRIX = COMPLETE
```

## 8. التداخل والتكرار

```text
SCRAP_GOLD_DUPLICATES_CGP = PARTIAL
GOLD_DEPOSIT_DUPLICATES_CGP = PARTIAL
SCRAP_GOLD_DUPLICATES_GOLD_DEPOSIT = YES
CUSTOMER_PHYSICAL_GOLD_PURCHASE_CANONICAL_OWNER = CGP
SCRAP_GOLD_CLASSIFICATION = LEGACY_DUPLICATE
GOLD_DEPOSIT_CLASSIFICATION = LEGACY_DUPLICATE
```

التداخل الاقتصادي حقيقي، لكن الفرق هو السلطة التقنية: CGP يمر عبر Draft/Validate/Post/Event ومستهلكين idempotent؛ Scrap/Deposit يكتب مباشرة في pool/Asset/Journal ويصرف نقدًا اختياريًا.

## 9. الاستخدام التاريخي في Persistent

تم التحقق من `SELECT current_database()` وكانت القاعدة `darfus_erp`. اللقطة الحالية تثبت:

- CGP documents: 2.
- CGP items: 4.
- CGP dispositions: 4، كلها pending piece evidence.
- Assets canonical CGP source/profile: 0.
- سجل Legacy Gold Deposit/Scrap قابل للتتبع: Pool واحد `CGP-552443`، Asset واحد `AST-SCRAP-552443`، Invoice payout واحد `PAY-11568`، Journalان (شراء الذهب والدفع)، وCashTransaction واحد `TX-1786359552606-xzpf`.
- الـAsset التاريخي أصبح `SOLD` مع Sale event، لذا توجد تبعيات Sale/Inventory/Accounting تمنع الإلغاء الفوري أو الحذف.

```text
PERSISTENT_CGP_RECORD_COUNT = 2 documents / 4 items / 4 dispositions; 0 canonical CGP Assets
PERSISTENT_SCRAP_GOLD_RECORD_COUNT = 1 identifiable AST-SCRAP asset + 1 payout invoice + 2 journals
PERSISTENT_GOLD_DEPOSIT_RECORD_COUNT = 1 CustomerGoldPool (CGP-552443)
LEGACY_FLOW_HISTORICAL_DEPENDENCIES = YES: pool, sold Asset, AssetEvents, payout Invoice, Journal entries, CashTransaction, Sale history
```

## 10. Route/Menu/Permission matrix

| Flow | Route exists | Menu | Permission | Feature flag | Active UI | Write capable |
|---|---|---|---|---|---|---|
| CGP drafts/post | نعم | Sales actions | `gold_purchase.cgp.*`, post | لا | نعم | نعم بعد gates |
| Scrap Gold | نعم | Sales `شراء كسر` | page `sales.view`; backend auth | `CGP_LEGACY_ISOLATION_ENABLED` gate، default false | نعم | نعم |
| Gold Deposit | نعم | غير مستقل؛ caller Scrap | auth + isolation gate | same | API/direct only | نعم |
| Financial Arabon | نعم | Reservations/POS | `reservations.create`, `reservations.record_payment`, treasury/branch guards | لا | نعم | نعم |

```text
FLOW_ROUTE_MENU_PERMISSION_MATRIX = COMPLETE
PERMISSION_MUTATIONS_THIS_BATCH = 0
```

## 11. Browser evidence

استخدمت الأدلة المرئية السابقة من الجلسة الموثقة دون تنفيذ أي write action: صفحة Sales أظهرت `شراء كسر` ومسودات CGP، وصفحة Scrap Gold أظهرت الحقول ووصف الشراء. محاولة إعادة ربط جلسة المتصفح في هذه الجولة لم تكن متاحة، لذلك لم يتم فتح أو إرسال نموذج جديد.

```text
BROWSER_SCRAP_GOLD_DISCOVERY = PASS
BROWSER_GOLD_DEPOSIT_DISCOVERY = NOT_FOUND (no separate customer-page action; route is reached by Scrap Gold caller/API)
BROWSER_WRITE_ACTIONS_TRIGGERED = 0
```

## 12. بصمة Persistent وسلامة البيانات

| الكيان | قبل الجولة | بعد الجولة | النتيجة |
|---|---:|---:|---|
| Migrations | 80 | 80 | محفوظ |
| Assets | 53 | 53 | محفوظ |
| Products | 3 | 3 | محفوظ |
| Customers | 1 | 1 | محفوظ |
| Suppliers | 1 | 1 | محفوظ |
| CGP documents | 2 | 2 | محفوظ |
| Sales/Invoices | 13 | 13 | محفوظ |
| Journals | 67 | 67 | محفوظ |
| JournalLines | 176 | 176 | محفوظ |
| CashTransactions | 50 | 50 | محفوظ |
| GoldMarketQuotes | 104 | 106 | نمو طبيعي للـlive worker، ليس mutation من الجولة |

فحوص القراءة: unbalanced journals=0، orphan journal lines=0، unlinked treasury=0، duplicate journal sources=0، duplicate treasury links=0، duplicate barcodes=0، blank barcodes=0. لا توجد كتابة أو Migration 81.

```text
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
GOLD_BASELINE_PRESERVED = PASS (GOLDAPI_IO / LIVE_PROVIDER / 1500 / 2500)
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO
```

## 13. توصيات Owner فقط

لا يتم تنفيذ أي توصية في هذه الجولة:

1. اعتبار CGP هو المالك canonical لأي شراء ذهب مادي من Customer.
2. إبقاء Scrap/Deposit تاريخيًا للقراءة أو عزله تدريجيًا بعد خطة اعتماد/ترحيل للتبعيات التاريخية.
3. إبقاء Financial Arabon كمسار مستقل؛ لا يُدمج مع Gold Deposit.
4. نقل أو تسمية Legacy Quantity وعبارة Batch 6 بطريقة أقل إرباكًا مستقبلًا.
5. عدم حذف أو تعديل سجل `AST-SCRAP-552443` أو Pool/Invoice/Journals؛ الـAsset دخل Sale history.

```text
RECOMMENDATION_ONLY = YES
```

## 14. إثبات عدم التغيير

```text
SOURCE_FILES_CHANGED_THIS_BATCH = 0
PERSISTENT_DATABASE_WRITES_THIS_BATCH = 0
PERMISSION_MUTATIONS_THIS_BATCH = 0
PROCESS_RESTARTS_THIS_BATCH = 0
NEXT_DEV_STARTED_OR_RESTARTED = NO
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_WRITES_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
HANDOFF_IMPLEMENTATION_STATE_CHANGED = NO
```

## 15. الحالة النهائية

```text
CURRENT_BATCH = CUSTOMER-GOLD-CGP-SCRAP-DEPOSIT-FORENSIC-01
FORENSIC_MODE = READ_ONLY
CGP_CANONICAL_TRACE = COMPLETE
CGP_ACCOUNTING_SEMANTICS = Dr INVENTORY_ASSET / Cr CUSTOMER_CREDITOR
CGP_CUSTOMER_BALANCE_EFFECT = customer creditor liability increases
CGP_ASSET_CREATION_BEFORE_POSTING = NO
CGP_ONE_PIECE_ONE_ASSET = PASS
CGP_EXTERNAL_PROVIDER_HTTP_AT_POSTING = 0
CGP_PRICING_MODE = internal canonical pricing authority, policy BID / NONE / 0
SCRAP_GOLD_FRONTEND_TRACE = COMPLETE
SCRAP_GOLD_BACKEND_TRACE = COMPLETE
SCRAP_GOLD_CREATES_ASSET = YES
SCRAP_GOLD_ASSET_TIMING = immediate before canonical Posting
SCRAP_GOLD_ONE_PIECE_ONE_ASSET = FAIL
SCRAP_GOLD_PRICING_SNAPSHOT = YES (legacy persisted value, not canonical snapshot)
GOLD_DEPOSIT_IS_FINANCIAL_ARABON = NO
GOLD_DEPOSIT_BYPASSES_CGP_POSTING = YES
GOLD_DEPOSIT_CREATES_ASSET = YES
GOLD_DEPOSIT_CREATES_POOL = YES
GOLD_DEPOSIT_ONE_PIECE_ONE_ASSET = FAIL
GOLD_DEPOSIT_BARCODE_GUARANTEE = YES backend / NO durable guarantee in local demo branch
FINANCIAL_ARABON_FLOW_FOUND = YES
GOLD_DEPOSIT_AND_FINANCIAL_ARABON_ARE_SAME_FLOW = NO
CUSTOMER_GOLD_FLOW_MATRIX = COMPLETE
SCRAP_GOLD_DUPLICATES_CGP = PARTIAL
GOLD_DEPOSIT_DUPLICATES_CGP = PARTIAL
SCRAP_GOLD_DUPLICATES_GOLD_DEPOSIT = YES
CUSTOMER_PHYSICAL_GOLD_PURCHASE_CANONICAL_OWNER = CGP
SCRAP_GOLD_CLASSIFICATION = LEGACY_DUPLICATE
GOLD_DEPOSIT_CLASSIFICATION = LEGACY_DUPLICATE
FLOW_ROUTE_MENU_PERMISSION_MATRIX = COMPLETE
PERMISSION_MUTATIONS_THIS_BATCH = 0
BROWSER_WRITE_ACTIONS_TRIGGERED = 0
SOURCE_FILES_CHANGED_THIS_BATCH = 0
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
RECOMMENDATION_ONLY = YES
HANDOFF_IMPLEMENTATION_STATE_CHANGED = NO
CUSTOMER_GOLD_CGP_SCRAP_DEPOSIT_FORENSIC_01_GATE = FORENSIC_COMPLETE
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
```

