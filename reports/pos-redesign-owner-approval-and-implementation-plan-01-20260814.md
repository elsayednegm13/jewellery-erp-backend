# POS-REDESIGN-OWNER-APPROVAL-AND-IMPLEMENTATION-PLAN-01

## 1. Approved Owner decisions

تم تثبيت القرارات التالية كـ contract للتنفيذ القادم:

- ثلاثة أعمدة cashier-first على سطح المكتب: العميل يسارًا، scanner والسلة في الوسط، الدفع والملخص يمينًا.
- إبقاء ثيم DARFUS الحالي؛ لا يوجد dark POS مستقل في المرحلة الأولى.
- لا manual/free-price item authority؛ barcode/Asset/Product هو مسار الإدخال الوحيد.
- عرض points للقراءة فقط إذا كان `loyaltyPoints` موجودًا في Customer API دون طلب جديد أو تغيير حسابها.
- fullscreen/focus mode اختياري، ويؤجل إذا تسبب في مخاطرة shell أو navigation.
- returns/exchanges تبقى workflows منفصلة؛ لا negative sale lines.
- split/mixed payment الحالي هو authority ولا يُنشأ settlement model جديد.

## 2. Business logic freeze

### POS_BUSINESS_LOGIC_FROZEN = YES

لن تتحرك أي سلطة إلى React أو components:

- Barcode/Asset/Product eligibility والفرع والحالة.
- Gold Center approved current rate.
- `GOLD_BAR_24K` = 24K فقط وVAT على certificate فقط.
- Gold By Weight: gold value من net weight، والمصنعية من actual gross weight.
- Gold By Piece: current valuation + markup/discount policy.
- CGP Asset: أصل موجود فقط بعد canonical availability، ولا ينشئه POS.
- zero/invalid price fail-closed.
- VAT source/rounding، payment methods، split، installment، deposit semantics.
- customer receivable/remaining، inventory transition، posting، idempotency.
- company/branch/cashier/operator policy والpermissions.

التصميم يغيّر ترتيب العرض والـfocus فقط، ولا يغيّر payload أو route أو server formula.

## 3. Current code structure relevant to implementation

| المسار الحالي | الدور | ملاحظة التخطيط |
|---|---|---|
| `app/[locale]/(dashboard)/pos/page.tsx` | صفحة POS والـstate والـJSX الحالي | نقطة الاستخراج الأساسية؛ تبقى orchestrator في البداية |
| `features/sales/hooks/use-pos.ts` | customers، pricing preview، checkout، drafts | يبقى canonical hook ولا يُستبدل |
| `components/ui/data-toolbar.tsx` | بحث/فلترة عامة | يعاد استخدام filter فقط؛ scanner المستقل يكون adapter بصريًا |
| `components/ui/numeric-input.tsx` | numeric input normalization | يعاد استخدامه للدفع/المصنعية/الأقساط |
| `components/ui/numeric-token.tsx` | bidi/numeric presentation | يستخدم لكل ID/weight/money/rate |
| `components/ui/date-input.tsx` | date input | يستخدم لتاريخ القسط دون UTC presentation drift |
| `backend/src/routes/erp.routes.js` | `/pricing/calculate`, `/pos/checkout`, drafts، reservations | لا تعديل في إعادة التصميم |
| `backend/src/services/gold-sale-pricing.service.js` | Gold sale pricing authority | لا نقل إلى الواجهة |
| `backend/src/services/sales.service.js` | totals/payment/installment authority | لا نقل إلى الواجهة |
| `backend/src/services/inventory-v2-runtime.service.js` | Asset transitions | لا direct status mutation |
| `backend/src/services/posting.service.js` | journal/financial authority | لا UI accounting logic |
| `backend/src/middleware/auth.middleware.js` و`sales-operator-policy.service.js` | company/branch/operator context | لا fallback أو bypass |
| `lib/dates/dates.ts`, `lib/formatters/numbers.ts` | dates/numbers/currency helpers | mandatory presentation boundary |

لا توجد حاليًا child components مخصصة لـPOS مثل `CustomerPanel` أو `PaymentPanel` أو `CartTable`؛ ستكون ملفات extraction جديدة مخططة فقط، ولم تُنشأ في هذه الدفعة.

## 4. Target screen structure

### Desktop

```text
PosShell
├─ PosHeader: DARFUS POS / invoice context / branch / cashier / date / draft
├─ CustomerPanel (20–22%)
├─ CenterWorkspace (52–56%)
│  ├─ BarcodeScanner
│  ├─ existing useful filters
│  └─ CartTable
└─ PaymentPanel (24–28%, sticky when safe)
```

الـcenter يأخذ أكبر مساحة مفيدة. النسب إرشادية وليست قيدًا إذا فرضت المكونات حدًا أدنى للقراءة.

## 5. Phase 1 plan — SHELL + 3-COLUMN LAYOUT

### PHASE_1_PLAN = COMPLETE

**Files planned:**

- `app/[locale]/(dashboard)/pos/page.tsx`: نقل wrapper الحالي من `xl:grid-cols-[1.35fr_.85fr]` إلى shell ثلاثي؛ إبقاء كل handlers/state كما هي.
- `features/sales/components/pos/PosShell.tsx` (NEW planned): layout/panel slots فقط، بلا business logic.
- `features/sales/components/pos/PosHeader.tsx` (NEW planned): header context presentational.
- إن كان استخراج المكونات يسبب scope أو type churn، يبقى wrapper داخل page مؤقتًا ويُؤجل إنشاء الملفات الجديدة.

**JSX blocks to move:**

1. `PageHeader` والـcashier/branch context إلى `PosHeader`.
2. `DataToolbar` وشبكة المنتجات/الأصول إلى slot الوسط.
3. سلة العناصر وحقول العميل الحالية إلى panelين منفصلين دون تغيير handlers.
4. payment/summary/actions إلى slot اليمين.

**State:** كل state الحالي يبقى في `page.tsx`: `customerId`, `cart`, `query`, `type`, `method`, totals/pricing, split/installment fields, reservation state, drafts, `isPosting`, `idempotencyKey`.

**Layout:** Desktop three-column CSS grid؛ `minmax(280px,22%) minmax(0,1fr) minmax(320px,26%)` أو ما يعادله ضمن design tokens. Payment sticky فقط مع `max-height` وscroll داخلي آمن.

**No behavior change:** نفس الأزرار، نفس payload، نفس APIs، نفس totals، نفس submit، نفس permission and scope errors.

**Acceptance:** POS الحالي يعمل كما هو وظيفيًا؛ visual review فقط قبل الانتقال للمرحلة 2. Rollback = revert wrapper/extracted presentational files فقط، دون DB أو route rollback.

## 6. Phase 2 plan — CUSTOMER PANEL + BARCODE SCANNER

### PHASE_2_PLAN = COMPLETE

**CustomerPanel:**

- يستخدم `customers` الحالي من `usePos`؛ لا fetch جديد.
- search/select، بطاقة الاسم والهاتف وTier، balance إن أرجعته API، points من `loyaltyPoints` للقراءة فقط إذا كان موجودًا.
- `customerId` يبقى state في page؛ panel يستقبل `value`, `customers`, `onChange`, `disabled`, errors.
- لا إنشاء customer أو تعديل points ضمن POS redesign.

**BarcodeScanner:**

- حقل مخصص presentation/adapter فوق نفس query/filter authority.
- F2 يركزه؛ Enter يثبت exact match أو يعرض ambiguity ولا ينفذ checkout.
- بعد النجاح يمسح الحقل ويعيد focus، ويظهر success/duplicate/invalid/sold/wrong-branch status.
- لا lookup SQL أو route جديد؛ يستدعي نفس `useCoreErpData`/cart add path.
- لا manual free-price أو fallback asset creation.

**Acceptance:** barcode صالح، غير صالح، sold، wrong branch، duplicate، واستعادة focus. Rollback = إزالة component wrapper وإعادة search القديم.

## 7. Phase 3 plan — CART TABLE + ITEM SUMMARY

### PHASE_3_PLAN = COMPLETE

**Mandatory visible columns:** `#`, code/barcode، description، profile/type، qty، price/line total، remove.

**Conditional/compact columns:** karat، gross/net/weight، Gold Center rate، making/certificate، VAT. تعرض inline على desktop وتتحول row-details على 1280/tablet.

**Rules:**

- serialized Asset quantity=1 disabled؛ Product quantity فقط إذا كان product authority يسمح.
- الوزن الإجمالي للقطعة aggregate read-only؛ لا input يغير inventory facts.
- numeric columns `dir=ltr`, `bdi`/`numeric-token`, وcurrency من company/settings.
- الوصف الطويل ellipsis مع title/expanded row؛ لا يكسر layout RTL.
- cart كبير: `max-height` وvirtualized/compact rows مستقبلًا عند evidence، دون تغيير cart state.

**Acceptance:** asset/profile mix، product quantity، long names، zero-price disabled، row removal، total weight والـpricing preview unchanged. Rollback = العودة إلى cart block الحالي.

## 8. Phase 4 plan — PAYMENT PANEL + SPLIT PAYMENT PRESENTATION

### PHASE_4_PLAN = COMPLETE

PaymentPanel presentational حول state وhandlers الحالية:

- subtotal، VAT/tax، total، paid، remaining/change.
- Cash/Card/Transfer/Installment/Deposit حسب Settings الحالي.
- Split rows `cash/card/transfer` فقط حسب active base methods؛ total split must equal provisional/server total.
- Installment fields: down payment، count، frequency، first due date، guarantor وفق current rules.
- Deposit يبقى reservation dialog وليس sale checkout.
- زر Complete Sale يستخدم `completeSale` الحالي، disabled أثناء `isPosting` أو settings/pricing not ready.

لا تغيير في `resolvePayment`, `postingService`, payment records، customer balance، أو journal. Rollback = إزالة panel extraction والعودة إلى right block الحالي.

## 9. Phase 5 plan — KEYBOARD / FOCUS / ASYNC / ERROR UX

### PHASE_5_PLAN = COMPLETE

**Bindings بعد التحقق من browser/app conflicts:** F2 scanner، F4 customer، F6 payment method، F8 paid amount، F12 complete sale، Escape close/back/clear layer.

**Focus contract:** order header → scanner → cart actions → customer → payment → final action؛ بعد scan success يعود focus للscanner؛ بعد error يبقى في source field؛ بعد success يعرض invoice response ولا يعيد submit.

**Enter:** commit scanner exact result، لا final checkout إلا من زر/F12 وبعد validation. Double Enter يُحمى بـ`isPosting`, disabled button، وexisting idempotency key.

**States:** initial loading skeleton، pricing pending، Gold rate unavailable، invalid/sold/duplicate، 403/422/409، posting spinner، success banner/receipt action.

**Acceptance:** keyboard-only، rapid Enter، F12 أثناء pending، stale pricing، network error، idempotency replay. Rollback = تعطيل listeners الجدد وعودة shortcuts الحالية F2/F12/Escape.

## 10. Phase 6 plan — RESPONSIVE / ACCESSIBILITY / VISUAL POLISH

### PHASE_6_PLAN = COMPLETE

- Desktop: 3 columns، center الأكبر، payment sticky إذا آمن.
- 1280: تضييق يسار/يمين مع حد أدنى للـfont والحقول.
- Tablet: scanner/cart أولًا، payment ثانيًا، customer ثالثًا أو drawer؛ لا 3 أعمدة ضيقة.
- contrast/focus rings من tokens الحالية، لا لون جديد بلا ضرورة.
- targets لا تقل عن 44px، labels وaria-live، keyboard-only، وعدم الاعتماد على اللون.
- اختبار Windows scaling 100/125/150%، RTL/LTR، vertical overflow، sticky boundaries، print/receipt unaffected.

Rollback = CSS/layout classes وcomponent wrappers فقط.

## 11. Phase 7 runtime plan — STRICT RUNTIME REGRESSION / CLONE ACCEPTANCE

### PHASE_7_PLAN = COMPLETE

التنفيذ لاحقًا فقط على Disposable Clone وبـreal browser/network/backend proof؛ `darfus_erp` SELECT-only.

الاختبارات:

- auth/company/branch/cashier/operator.
- valid/invalid/unknown barcode، sold asset، wrong branch، duplicate scan.
- `GOLD_BAR_24K`, `GOLD_BY_WEIGHT_JEWELLERY`, `GOLD_BY_PIECE`, CGP-created Asset، non-gold، zero-price، Gold Center unavailable.
- customer selection، read-only points إن عُرضت، VAT.
- Cash/Card/Transfer/Split، Installment إن enabled، Deposit isolation.
- final sale، same idempotency replay، changed body 409، concurrent submit.
- Asset `AVAILABLE→SOLD`, Product StockMovement، balanced journal، CashTransactions، Audit.
- desktop/tablet visual، F2/F4/F6/F8/F12/Escape، scanner focus، console/network clean.

كل test case يلتقط request/response/status/DB evidence قبل وبعد في clone فقط، مع rollback/cleanup الخاص بالclone.

## 12. Component architecture

### POS_COMPONENT_IMPLEMENTATION_MAP = COMPLETE

| Component planned | المسؤولية | Props/state | Business logic مسموح؟ | مصدر إعادة الاستخدام | حد الاختبار |
|---|---|---|---|---|---|
| `PosShell` | grid وresponsive slots | children/layout flags | لا | current page wrapper | visual/layout |
| `PosHeader` | branch/cashier/date/draft context | display props | لا | `PageHeader`, auth/settings | context display |
| `CustomerPanel` | customer search/summary | customers/value/onChange | لا | current select + Customer API | selection/points display |
| `CustomerSearch` | filter input | query/options | لا | DataToolbar patterns | keyboard/search |
| `CustomerSummary` | read-only customer facts | customer | لا | Customer model fields | no mutation |
| `BarcodeScanner` | focus/Enter/status UX | query/scan handlers/status | لا | current filter/cart add path | barcode states |
| `PosStatusBanner` | loading/error/success | state/message | لا | existing toast/errors | aria-live |
| `CartTable` | rows/aggregate weight | cart/actions | لا | current cart JSX | row calculations display |
| `CartRow` | one item details | item/remove | لا | current cart item shape | profile/qty display |
| `CartSummary` | central read-only totals | totals | لا | pricing response | numeric rendering |
| `PaymentPanel` | right-side payment presentation | payment props/handlers | لا | current right block | methods/disabled states |
| `PaymentMethodSelector` | method choice | options/value/onChange | لا | Settings payment options | settings filtering |
| `SplitPaymentRows` | split inputs/display | split rows | لا | current split states | sum/error UX |
| `SaleActions` | final/cancel/draft actions | busy/handlers | لا | current buttons | double-submit |
| `KeyboardHelp` | shortcut footer | active bindings | لا | no current component | keyboard discoverability |

تظل components presentational؛ `completeSale`, `calculatePricing`, `postInvoice` لا تُعاد كتابتها داخلها.

## 13. State ownership

### POS_STATE_OWNERSHIP_PLAN = COMPLETE

تظل الحالة canonical في `PosPage` خلال أول extraction لتجنب duplicate authority:

| State | المالك الحالي/المخطط |
|---|---|
| selected customer | `PosPage.customerId`؛ `CustomerPanel` controlled |
| scanner query | `PosPage.query` أو scanner-local transient فقط إذا لا يغير cart authority |
| cart | `PosPage.cart` |
| pricing/totals | `PosPage` state من `usePos.calculatePricing` response |
| payment method | `PosPage.method` |
| split rows | `PosPage.splitCash/Card/Transfer` |
| installment | `PosPage.downPayment/count/frequency/guarantor/firstDueDate` |
| validation/errors | `PosPage.pricingError/qtyError` + local field presentation |
| submit | `usePos.isPosting` + `PosPage.idempotencyKey` |
| drafts/reservation | existing `PosPage` state/hooks |

بعد Phase 7 فقط، يمكن تقييم hook extraction إذا ثبت عدم وجود duplicate state؛ لا يُفترض مسبقًا.

## 14. API preservation map

### POS_API_PRESERVATION_MAP = COMPLETE

| API | الغرض الحالي | يبقى؟ | المالك بعد extraction | الرد المستخدم |
|---|---|---|---|---|
| `GET /customers` | customer list | نعم | `usePos` → CustomerPanel | id/name/phone/tier/balance/loyaltyPoints إن رجعت |
| `GET /readiness/operations` | reservation deposit readiness | نعم | page/payment panel status | READY/BLOCKED |
| `POST /pricing/calculate` | server pricing preview | نعم | `usePos` من page | subtotal/tax/total/making |
| `POST /pos/checkout` | canonical final sale | نعم | `usePos.postInvoice` من SaleActions | invoice/journal/asset result |
| `POST /reservations` | deposit reservation | نعم | existing dialog داخل PaymentPanel | reservation/receipt |
| `POST /sales/invoices/drafts` | create draft | نعم | existing draft actions | draft id/status |
| `PATCH /sales/invoices/:id` | update draft | نعم | existing draft actions | updated draft |
| `POST /sales/invoices/:id/cancel` | cancel draft | نعم | existing draft modal | cancelled status |
| `POST /sales/invoices/:id/post` | post draft | نعم | existing draft action | posted invoice |
| `GET /invoices?...` | draft list | نعم | existing drafts modal | list/date/total |

لا route جديد، ولا تغيير HTTP method/body/header، ولا bypass لـ`apiClient` أو company/branch context.

## 15. Points display plan

### CUSTOMER_POINTS_DISPLAY_PLAN = COMPLETE

- الحقل canonical: `Customer.loyaltyPoints` في `backend/src/models/customer.model.js` و`lib/types.ts`.
- المصدر: نفس `GET /customers` المستخدم حاليًا؛ لا extra API call.
- العرض: compact read-only badge داخل `CustomerSummary` فقط إذا كان field موجودًا ومحمّلًا.
- غياب field: لا placeholder يوحي بصلاحية أو رصيد؛ يعرض لا شيء/—.
- ممنوع تعديل accrual، redemption، tier، أو server loyalty calculations.
- اختبار: read-only DOM، عدم وجود mutation عند selection، وعدم زيادة request count بشكل غير متوقع.

## 16. Fullscreen / focus mode plan

### POS_FULLSCREEN_MODE_PLAN = COMPLETE

الخيار الآمن مبدئيًا: local UI state أو CSS class على POS shell لتقليل dashboard chrome، مع بقاء route/auth/company/branch كما هي. لا route جديد ولا layout global mutation. إذا كان sidebar/layout context لا يسمح بتصريح محلي آمن، يُؤجل إلى ما بعد Phase 6. يجب أن يعمل Escape للخروج، وألا يؤثر على print أو authorization.

## 17. Returns/negative line decision

### NEGATIVE_LINES_IN_NORMAL_POS = NO

الإرجاع والاستبدال يبقيان على `/sales/returns` و`/sales/exchanges`. يمكن إضافة رابط navigation فقط إن كانت permission/navigation الحالية تسمح، دون تضمين return item في Invoice sale العادية.

## 18. Theme decision

### POS_INITIAL_THEME = DARFUS_CURRENT_THEME

إعادة استخدام `bg-panel`, `bg-surface-muted`, `border-border`, `text-foreground`, `dark:*`, radii وspacing الموجودة. لا standalone dark theme ولا palette جديدة في Phase 1. أي dark cashier variant يبقى deferred decision.

## 19. Visual implementation spec

### POS_VISUAL_IMPLEMENTATION_SPEC = COMPLETE

- **Spacing:** scale الحالية (`gap-3`, `gap-4`, `gap-5`, `p-4`, `p-5`)؛ لا قيم عشوائية.
- **Panels:** `rounded-2xl`, `border-border`, `bg-panel`; header أقل ارتفاعًا من checkout panel.
- **Header:** context strip بارتفاع يقارب 56–64px مع branch/cashier/date مقروءة.
- **Scanner:** ارتفاع 48–52px، focus ring brand، icon Barcode، placeholder واضح.
- **Cart row:** 56–72px desktop حسب البيانات؛ compact row details على tablet.
- **Payment amount:** total أكبر وأثقل من subtotal/tax؛ `NumericToken` وcurrency ثابتة.
- **Sticky:** right panel sticky مع `top` من shell و`max-height: calc(100vh - header)` وscroll داخلي.
- **Columns:** 20–22 / 52–56 / 24–28 بالمائة تقريبًا، center `minmax(0,1fr)`.
- **Typography:** title، section label، numeric total hierarchy من tokens الحالية.
- **Status colors:** success/warning/danger/muted tokens الحالية، لا لون جديد أو color-only meaning.
- **RTL:** labels RTL، IDs/dates/money/weights LTR isolated.

## 20. Arabic copy plan

### POS_ARABIC_COPY_PLAN = COMPLETE

| الاستخدام | النص المقترح |
|---|---|
| customer panel | بيانات العميل |
| customer search | بحث عن عميل |
| scanner placeholder | امسح الباركود أو اكتب الرمز… |
| cart | السلة / القطع |
| item count | عدد القطع |
| weight | إجمالي الوزن |
| pre-tax | الإجمالي قبل الضريبة |
| tax | الضريبة |
| total | الإجمالي |
| paid | المدفوع |
| remaining | المتبقي |
| change | الباقي |
| method | طريقة الدفع |
| checkout | إتمام البيع |
| cancel | إلغاء الفاتورة |
| scan loading | جاري البحث عن الباركود… |
| gold loading | جاري تحميل سعر الذهب… |
| submit loading | جاري إتمام البيع… |
| invalid | الباركود غير موجود أو غير صالح |
| sold | الأصل غير متاح للبيع |
| duplicate | القطعة موجودة بالفعل في السلة |
| rate unavailable | سعر الذهب الحالي غير متاح |

تضاف إلى namespace الحالي فقط أثناء implementation؛ لا تعديل الآن.

## 21. File touch map

### POS_FILE_TOUCH_MAP = COMPLETE

| File | Current role | Phase | Expected change type | Business logic change? | Test impact |
|---|---|---|---|---|---|
| `app/[locale]/(dashboard)/pos/page.tsx` | orchestration + current JSX | 1–6 | controlled JSX extraction, props, layout/focus wiring | NO | all POS regression |
| `features/sales/hooks/use-pos.ts` | API hooks | 1–7 | expected unchanged; touch only if proven typing/owner boundary issue | NO | API contract tests |
| `components/ui/data-toolbar.tsx` | generic search/filter | 2 | preferably unchanged; adapt via wrapper/props only if generic behavior preserved | NO | search regression |
| `components/ui/numeric-input.tsx` | numeric input | 4–6 | expected unchanged | NO | RTL numeric |
| `components/ui/numeric-token.tsx` | numeric display | 3–6 | expected unchanged | NO | bidi/currency |
| `components/ui/date-input.tsx` | date input | 4–6 | expected unchanged | NO | installment dates |
| `features/sales/components/pos/PosShell.tsx` | not present | 1 | NEW planned presentational component | NO | layout |
| `features/sales/components/pos/PosHeader.tsx` | not present | 1 | NEW planned presentational component | NO | context display |
| `features/sales/components/pos/CustomerPanel.tsx` | not present | 2 | NEW planned controlled component | NO | customer/points |
| `features/sales/components/pos/BarcodeScanner.tsx` | not present | 2/5 | NEW planned controlled component | NO | scanner/focus |
| `features/sales/components/pos/CartTable.tsx` | not present | 3 | NEW planned presentational component | NO | item table |
| `features/sales/components/pos/PaymentPanel.tsx` | not present | 4/5 | NEW planned presentational component | NO | payment methods |
| `features/sales/components/pos/KeyboardHelp.tsx` | not present | 5 | NEW planned presentational component | NO | shortcut discoverability |
| `messages/ar.json` | localization | 2–6 | add only approved POS copy keys | NO | Arabic UI |
| `messages/en.json` | localization | 2–6 | matching English keys if needed | NO | bilingual UI |
| `app/globals.css` | design tokens/global styles | 6 | only if existing tokens cannot support focus/sticky safely | NO | responsive/accessibility |

لا تُلمس `backend/src/routes/erp.routes.js`, pricing, posting, inventory, auth أو migrations ضمن redesign البصري.

## 22. Implementation risk table

### POS_IMPLEMENTATION_RISK_TABLE = COMPLETE

| Area | Files | Business Logic Risk | UX Risk | Runtime Risk | Rollback boundary | Required test |
|---|---|---|---|---|---|---|
| Phase 1 shell | page, PosShell, Header | منخفض إذا props فقط | proportions | overflow/sticky | wrapper/components | current POS smoke |
| Phase 2 customer/scanner | page, CustomerPanel, BarcodeScanner | متوسط إذا lookup duplicated | focus/duplicate confusion | request duplication | remove wrappers | barcode + customer API |
| Phase 3 cart | page, CartTable/Row | متوسط إذا quantity mutated | dense columns | large-cart render | cart JSX | asset/product quantity |
| Phase 4 payment | page, PaymentPanel/SplitRows | عالٍ إذا totals moved | remaining/change clarity | double submit | panel extraction | all payment modes |
| Phase 5 states | page, KeyboardHelp/status | عالٍ إذا F12 bypass | focus traps | retry loops | listeners/status UI | 409/422/rapid keys |
| Phase 6 responsive | CSS/page/components/messages | منخفض | unreadable tablet | sticky/zoom bugs | CSS/classes | 100/125/150%, tablet |
| Phase 7 acceptance | tests/scripts only | لا تغيير code authority | visual regressions | clone data/DB | disposable clone | full strict matrix |

## 23. Owner review checkpoints

### OWNER_REVIEW_CHECKPOINTS = COMPLETE

- **بعد Phase 1:** proportions 20–22/52–56/24–28، center width، payment stickiness، no action/totals regression.
- **بعد Phase 2:** scanner visible/focused، Enter behavior، duplicate/sold errors، customer card density، points read-only only.
- **بعد Phase 3:** table readability، profile/weight columns، serialized qty lock، total weight، long descriptions.
- **بعد Phase 4:** payment clarity، Split rows، installment/deposit separation، sticky total، disabled state.
- **بعد Phase 5:** keyboard-only flow، focus return، no double submit، async/error wording.
- **بعد Phase 6:** desktop/tablet at 100/125/150%، RTL numeric isolation، contrast/focus/targets.
- **قبل Phase 7:** explicit sign-off that no API/backend/business rule changed، ثم clone runtime.

## 24. Future batch sequence

### POS_FUTURE_BATCH_SEQUENCE = COMPLETE

1. `POS-REDESIGN-IMPLEMENTATION-PHASE-01-SHELL-AND-LAYOUT`
2. `POS-REDESIGN-IMPLEMENTATION-PHASE-02-CUSTOMER-AND-SCANNER`
3. `POS-REDESIGN-IMPLEMENTATION-PHASE-03-CART-TABLE`
4. `POS-REDESIGN-IMPLEMENTATION-PHASE-04-PAYMENT-PANEL`
5. `POS-REDESIGN-IMPLEMENTATION-PHASE-05-KEYBOARD-ASYNC-ERRORS`
6. `POS-REDESIGN-IMPLEMENTATION-PHASE-06-RESPONSIVE-ACCESSIBILITY-POLISH`
7. `POS-REDESIGN-RUNTIME-E2E-CLOSEOUT-01`

لا يبدأ أي batch تلقائيًا من هذه الجولة.

## 25. No-migration confirmation

### POS_REDESIGN_MIGRATION_REQUIRED = NO

التصميم يستخدم Customer API الحالي، و`loyaltyPoints` read-only إن كان موجودًا، ولا يضيف جداول أو أعمدة أو routes. إذا طلب أي feature جديد schema أو business fact غير موجود، يُؤجل ويُرفع كقرار Owner منفصل بدل إنشاء migration.

## 26. Final gate

### POS_REDESIGN_OWNER_APPROVAL_AND_IMPLEMENTATION_PLAN_01_GATE = PASS_PLAN_READY

شروط البوابة كلها متحققة: موافقة المالك على layout/theme/manual-entry/points/fullscreen/returns، business logic frozen، كل phases مخططة، component/state/API maps مكتملة، no client authority expansion، points/fullscreen/visual/copy/risk/file maps مكتملة، no migration، ولا تغيير منتج أو قاعدة بيانات أو بيئة.

## 27. Next step

```text
NEXT_RECOMMENDED_STEP = POS-REDESIGN-IMPLEMENTATION-PHASE-01-SHELL-AND-LAYOUT
```

يجب بدء هذه الخطوة في batch منفصل ومصرّح، مع قراءة AGENTS.md وPROJECT_PROGRESS_HANDOFF.md من جديد، ثم تنفيذ shell فقط ومراجعته بصريًا قبل Phase 2.

## 28. Execution record and final tokens

```text
CURRENT_BATCH = POS-REDESIGN-OWNER-APPROVAL-AND-IMPLEMENTATION-PLAN-01
MODE = OWNER_APPROVED_DESIGN_FREEZE_AND_IMPLEMENTATION_PLAN
OWNER_APPROVED_THREE_COLUMN_LAYOUT = YES
OWNER_APPROVED_CURRENT_THEME = YES
OWNER_APPROVED_NO_MANUAL_FREE_ITEM = YES
OWNER_APPROVED_POINTS_READONLY = YES
OWNER_APPROVED_OPTIONAL_FULLSCREEN = YES
OWNER_APPROVED_RETURNS_SEPARATE = YES
POS_BUSINESS_LOGIC_FROZEN = YES
PHASE_1_PLAN = COMPLETE
PHASE_2_PLAN = COMPLETE
PHASE_3_PLAN = COMPLETE
PHASE_4_PLAN = COMPLETE
PHASE_5_PLAN = COMPLETE
PHASE_6_PLAN = COMPLETE
PHASE_7_PLAN = COMPLETE
POS_COMPONENT_IMPLEMENTATION_MAP = COMPLETE
POS_STATE_OWNERSHIP_PLAN = COMPLETE
POS_API_PRESERVATION_MAP = COMPLETE
CLIENT_AUTHORITY_EXPANSION = NO
CUSTOMER_POINTS_DISPLAY_PLAN = COMPLETE
POS_FULLSCREEN_MODE_PLAN = COMPLETE
NEGATIVE_LINES_IN_NORMAL_POS = NO
POS_INITIAL_THEME = DARFUS_CURRENT_THEME
POS_VISUAL_IMPLEMENTATION_SPEC = COMPLETE
POS_ARABIC_COPY_PLAN = COMPLETE
POS_IMPLEMENTATION_RISK_TABLE = COMPLETE
POS_FILE_TOUCH_MAP = COMPLETE
POS_REDESIGN_MIGRATION_REQUIRED = NO
POS_IMPLEMENTATION_ORDER = COMPLETE
OWNER_REVIEW_CHECKPOINTS = COMPLETE
POS_FUTURE_BATCH_SEQUENCE = COMPLETE
PERSISTENT_WRITES_THIS_BATCH = 0
PRODUCT_CODE_FILES_CHANGED = 0
MIGRATIONS_CREATED = 0
RUNTIME_ENV_CHANGED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
POS_REDESIGN_OWNER_APPROVAL_AND_IMPLEMENTATION_PLAN_01_GATE = PASS_PLAN_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = POS-REDESIGN-IMPLEMENTATION-PHASE-01-SHELL-AND-LAYOUT_IF_PASS
```

لا يوجد تعديل على `PROJECT_PROGRESS_HANDOFF.md` في هذه الدفعة؛ التقرير هو artifact التخطيط الوحيد.
