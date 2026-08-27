# POS-CURRENT-UX-BUSINESS-RULES-FORENSIC-AND-REDESIGN-01

## 1. Executive summary

هذه الجولة تحليل ساكن وتصميم فقط. لم يتغير كود المنتج، ولم تُنفَّذ أي كتابة على أي قاعدة بيانات، ولم تُشغَّل migrations أو Next dev. نقطة الدخول الحالية هي `app/[locale]/(dashboard)/pos/page.tsx` وتعرض شبكة الأصناف/الأصول يسارًا وسلة الدفع يمينًا في عمودين. تدفق البيع القانوني موجود ويستخدم `usePos` ثم `/pricing/calculate` للمعاينة و`/pos/checkout` للتنفيذ، مع تفويض نهائي للخادم للتسعير، الضريبة، الصلاحيات، الفرع، المخزون، المحاسبة، الخزينة، التدقيق ومنع التكرار.

التصميم المقترح هو إعادة ترتيب بصرية cashier-first إلى ثلاثة أعمدة على سطح المكتب: العميل، مساحة البحث/الباركود والسلة، ثم الدفع والملخص. هذا لا يغيّر أي قاعدة تجارية أو endpoint أو مصدر صلاحية. التنفيذ المستقبلي يجب أن يعيد استخدام `usePos`, `apiClient`, `DataToolbar`, `NumericInput`, `NumericToken` ومسارات الخادم الحالية.

## 2. Current POS entrypoint

- المسار: `app/[locale]/(dashboard)/pos/page.tsx`.
- النوع: Client Component ضمن dashboard، مع `useAuth`, `useAppSettings`, `useCoreErpData`, `usePos`, `usePermissions`.
- مصدر البيانات: API mode هو المصدر التشغيلي؛ mock/localStorage fallback موجود للتوافق المحلي فقط.
- المسارات القانونية: `GET /customers`, `POST /pricing/calculate`, `POST /pos/checkout`، ودورة المسودات `/sales/invoices/drafts*`. مسار العربون منفصل `/reservations` ولا يُعامل كفاتورة بيع مكتملة.
- العمارة الحالية: `grid gap-5 xl:grid-cols-[1.35fr_.85fr]`؛ لا توجد شاشة POS ثانية.

## 3. Current screen inventory

1. `PageHeader`: عنوان POS، الفرع النشط، وحالة الكاشير.
2. `DataToolbar`: بحث نصي عام عبر `components/ui/data-toolbar.tsx`، فلتر النوع، وعدد النتائج. أي ماسح barcode keyboard-wedge يكتب في هذا البحث؛ لا يوجد حقل scanner مستقل أو تأكيد Enter مخصص.
3. شبكة بطاقات للأصول المتاحة والمنتجات الفعالة في الفرع.
4. سلة يمين الشاشة مع العميل، طريقة الدفع، الشحنات/الخصم/المصنعية/قيمة الحجر، الملخص، الحفظ كمسودة والطباعة.
5. حوار reservation/deposit عند اختيار `deposit`.
6. حوار journal preview ومسار طباعة الفاتورة بعد الإتمام.

## 4. Current business flow

`تحميل settings + branch` → `تحميل products/assets/customers/goldPrice` → `اختيار من الشبكة أو البحث` → `إضافة للسلة` → `POST /pricing/calculate` للمعاينة → `اختيار العميل وطريقة الدفع` → `POST /pos/checkout` مع `Idempotency-Key` → تحقق الخادم من الشركة/الفرع/العميل/الأصل أو المنتج → تسعير الذهب canonical → إنشاء Invoice وInvoiceItems → خصم product quantity أو انتقال Asset إلى `SOLD` → Payments/Installments → Journal/CashTransaction → loyalty/customer balance → Audit → replay-safe response.

العربون لا يدخل هذا المسار النهائي: يفتح حوار حجز، ويتطلب حساب branch deposit، ويدعو `/reservations` مع `initialPayment`.

## 5. Barcode flow

- التوافق الحالي: `DataToolbar` يحتوي `<input>` بحثًا؛ F2 يبحث عن `input[class*="ps-11"]` ويركزه.
- المطابقة: `filterData` يطابق حقول المنتج/الأصل المتاحة، وليس مسار قراءة barcode منفصلًا.
- الخادم في checkout يقبل `itemId`/asset أو product ويعيد التحقق من الشركة والفرع والحالة والسعر.
- لا يوجد Enter-to-add صريح، ولا صوت نجاح، ولا حالة scanner مستقلة، ولا تمييز مرئي موحد بين barcode غير موجود، أصل مباع، أصل مكرر في السلة، أو سعر ذهب غير متاح.
- التصميم المستقبلي يضيف طبقة UX فقط: حقل scanner مركز، Enter/keyboard-wedge، منع التكرار، وإعادة التركيز؛ لا يغيّر lookup أو authority.

## 6. Asset/profile support

- Assets المتاحة في الواجهة: `status === "available"`, بدون `parentAssetId`, وتطابق الفرع.
- Profiles ذات التسعير الخادم: `GOLD_BY_WEIGHT_JEWELLERY`, `GOLD_BAR_24K`, `GOLD_BY_PIECE`, `CGP_CUSTOMER_GOLD_PURCHASE`, مع `LOOSE_GEMSTONE` و`LOOSE_PEARL` في الخدمة الموحدة.
- المنتجات غير المتسلسلة تدعم quantity؛ الأصل المتسلسل يجب أن يكون quantity=1.
- لا يوجد مصدر POS لإنشاء أصل CGP؛ POS يبيع أصلًا موجودًا فقط بعد أن يصبح متاحًا.
- أي إعادة تصميم لا تعرض حقل كمية قابلًا للتحرير للأصل المتسلسل ولا تمنح العميل أو المتصفح سلطة الحالة.

## 7. Gold/POS pricing

المصدر النهائي هو `backend/src/services/gold-sale-pricing.service.js` داخل `executeCanonicalSale`، وليس قيمة العميل أو total الواجهة.

| Profile | القاعدة الحالية | VAT | مصدر السعر |
|---|---|---|---|
| GOLD_BAR_24K | `netGoldWeight × sellingGoldRate + certificateSaleAmount` | على الشهادة فقط؛ `goldVat=0` | Gold Center approved rate، مع fallback global approved لنفس الشركة فقط ثم reference snapshot |
| GOLD_BY_WEIGHT_JEWELLERY | `netGoldWeight × rate + gross/itemWeight × makingChargePerGram` | على subtotal الذهب+المصنعية | Gold Center approved rate |
| GOLD_BY_PIECE | `currentTotalCost + markup`, ثم discount policy/minimum approval | على سعر البيع النهائي | valuation + pricing policy |
| CGP asset | يسلك weight pricing عند البيع إذا كان الأصل يحمل profile CGP، مع quote حالي | بحسب profile/الخدمة؛ لا إنشاء CGP | Gold Center + asset evidence |

الخادم يستخدم Decimal.js، يثبت precision، يرفض السعر غير الموجب عبر `POS_SELLING_PRICE_REQUIRED`، ويمكن أن يطلب approval عند minimum making/certificate/discount. المعاينة العميلية تقريبية لأغراض العرض فقط.

## 8. Customer flow

الواجهة تحمل العملاء عبر `usePos` و`GET /customers`، وتختار أول عميل تلقائيًا إذا لم يوجد اختيار. الحقول الظاهرة حاليًا: الاسم و`tier` داخل `<select>`. عند checkout يفرض الخادم `customerId` ويتحقق من `companyId`. الخادم يحدّث customer balance عند وجود remaining، ويعيد احتساب net purchases، ويسجل loyalty داخل المعاملة.

## 9. Payment methods

الخيارات مشتقة من Settings: `cash`, `card`, `transfer`, `split`, `installment` إذا مفعّل، و`deposit`. split يظهر عندما تتاح أكثر من وسيلة أساسية. installment يحترم enabled/maxInstallments/minDownPaymentPercent/allowZeroDownPayment والـ permission الخاص بالدفعة الصفرية. deposit حجز بعربون وليس checkout بيعًا نهائيًا.

## 10. VAT/tax

- الإعدادات الشركة-المحمّلة هي المصدر؛ الواجهة تمنع checkout قبل اكتمال settings في API mode.
- `sales.service.computeTotals` يحسب VAT للخطوط غير الذهبية؛ gold pricing يعيد tax لكل profile ثم تجمعه route canonical.
- Gold Bar 24K: VAT base = certificate amount فقط، وVAT الذهب صفر.
- Gold By Weight: VAT على subtotal الذهب والمصنعية وفق الخدمة الحالية.
- لا توجد سلطة VAT في المتصفح؛ أي preview لا يتغلب على رد الخادم.

## 11. Returns/exchanges

POS الحالي لا ينشئ negative line داخل نفس فاتورة البيع. الإرجاع canonical عبر `POST /sales/returns`، والاستبدال عبر `/sales/exchanges/preview` ثم `/sales/exchanges`. هذه التدفقات تستخدم state authority وposting/reversal الموجودين. التصميم لا يخلط زر return داخل checkout، ويُبقي return/exchange في سطح مبيعات مخصص.

## 12. Inventory effect

- Product: ينقص `quantityAvailable` و`quantityOnHand`، يزيد `quantitySold`، وينشأ `StockMovement`.
- Asset: يلزم `status=available` وbranch صحيح وquantity=1، ثم `inventoryV2Runtime.transitionAsset(... SOLD ...)` مع AssetEvent/AssetMovement وinvoice-asset link.
- الانتقالات canonical ومقفلة بالقفل transaction؛ لا mutation مباشر من frontend.

## 13. Accounting effect

`postingService.postInvoiceEntry` هو authority. يسجل debit على cash/bank/AR حسب method/status أو split lines، credit revenue وVAT payable، وCOGS/inventory عند وجود cost. تُنشأ CashTransactions مرتبطة بالـ journal. إعدادات الحساب/الفرع authoritative من الخادم، ولا يجوز إنشاء حساب وقت البيع أو fallback client.

## 14. Security/company/branch

- `auth.middleware.js` يثبت Authorization ويفرض `X-Company-ID` للسوبر أدمن عند المسارات التشغيلية، ويرفض company خارج النطاق.
- `resolveAuthorizedBranchId` يتطلب فرعًا نشطًا تابعًا للشركة؛ sales operator policy يفرض `pos.sell` وoperator/session عند الوضع المشترك.
- `/pos/checkout` يستخدم `requireSalesCommandAccess("pos.checkout")` ثم `assertSalesOperatorPolicy`، ويرفض mismatch أو branch غير صالح.
- `Idempotency-Key` إلزامي؛ نفس المفتاح/الجسم replay، والجسم المختلف يرفض.

## 15. Current UX problems

1. كثافة وظيفية في عمودين؛ العميل والدفع والسلة متداخلون.
2. البحث العام يقوم بدور barcode دون affordance أو scanner status.
3. لا توجد cart table مخصصة تعرض profile/karat/weight/rate/making/VAT لكل سطر.
4. العميل يظهر كـ select صغير بدل بطاقة قرار واضحة.
5. الملخص والدفع ليسا sticky بشكل cashier-first.
6. F2/F12/Escape موجودة، لكن Enter scanner، Alt/number method shortcuts، وfocus recovery غير محددة.
7. حالات loading/pricing error موجودة وظيفيًا لكن غير موحدة بصريًا حسب سبب الفشل.
8. السعر الديناميكي قد يظهر unavailable دون شرح Gold Center/rate snapshot.
9. `firstDueDate` الافتراضي يستخدم UTC ISO؛ ينبغي مستقبلًا ربطه بسياسة branch date دون تغيير قاعدة البيع.
10. لا توجد points في بطاقة POS رغم أن Customer model يحمل `loyaltyPoints`؛ لا يجوز إظهارها كالتزام UI قبل قرار scope.

## 16. Reference-image mapping

| عنصر الصورة | الواقع الحالي | قرار blueprint |
|---|---|---|
| عمود العميل | select في يمين الدفع | Keep semantics / Adapt إلى panel يسار |
| Points | غير معروض في POS؛ موجود في model | Decision فقط، لا اختراع |
| Scanner field | بحث DataToolbar عام | Adapt إلى حقل scanner مخصص |
| Item table | بطاقات + cart نصية | Adapt إلى table مركزية |
| Negative line | ليس في POS | Reject من checkout؛ use returns/exchanges |
| Manual item | لا مسار عام authoritative | Decision؛ default reject |
| Total weight | متاح في cart item data | Add read-only aggregate |
| VAT breakdown | موجود في summary/server response | Keep، أوضح per-line/total |
| Mixed payment | split مدعوم | Keep server rules |
| Difference | remaining/payment validation بالخادم | Keep، أوضح change/remaining |
| Final sale | checkout canonical | Keep endpoint |
| Cancel | clear cart/draft cancel | Keep semantics |
| Keyboard footer | غير موحد | Add blueprint only |
| Cashier/date header | header/branch موجودان | Adapt إلى context strip |

## 17. Business-rule freeze

| القاعدة | قرار مجمد |
|---|---|
| Barcode | lookup server-scoped؛ لا قبول أصل غير متاح |
| Asset eligibility | available + branch + one serialized piece |
| Gold rate | Gold Center approved current rate، لا client authority |
| Gold Bar 24K | gold value منفصل، VAT certificate only |
| Gold By Weight | net weight للذهب، gross/item weight للمصنعية |
| Gold By Piece | current valuation + markup/discount policy |
| CGP Asset | existing asset only؛ لا إنشاء من POS |
| Making charge | server validation/minimum approval |
| VAT | Settings/server resolver، لا hardcode |
| Customer | company-scoped، required |
| Payment | server resolvePayment؛ split/installment/deposit semantics محفوظة |
| Final sale | `/pos/checkout` canonical، posted transaction |
| Accounting | postingService + branch mappings |
| Inventory | transitionAsset/StockMovement |
| Idempotency | mandatory key + request hash |
| Company/Branch | fixed company scope، branch required |
| Permission | `pos.sell` and policy/session |

## 18. Proposed 3-column layout

سطح المكتب 1440+: CSS grid `minmax(280px, 320px) minmax(0, 1fr) minmax(320px, 380px)` مع gaps ثابتة. العمود الأوسط هو مساحة العمل ذات الأولوية، واليمين payment sticky. عند 1280 تضيق اليسار فقط مع بقاء نص الدفع مقروءًا. على tablet تتحول الأعمدة إلى ترتيب: scanner/cart ثم payment ثم customer drawer/card.

## 19. Customer panel

يسارًا: customer search/select، بطاقة العميل المختار (الاسم، ID معزول، الهاتف، tier، outstanding balance إن كان متاحًا)، زر تغيير/إنشاء وفق الصلاحيات الحالية فقط، ورسالة company scope. Points لا تظهر إلا بعد قرار Owner يثبت استخدامها في POS.

## 20. Barcode/work area

أعلى الوسط: حقل scanner مميز focusable مع placeholder barcode، زر بحث يدوي توافقًا، indicator الفرع/الكاشير، وعدّاد السلة. أسفلها tabs/filter profile ثم جدول السلة. كل scan يمر عبر نفس `useCoreErpData`/server lookup؛ لا query جديد بسلطة مختلفة.

## 21. Item table

الأعمدة المقترحة: barcode/asset number، الاسم، profile/type، karat، gross/net weight، quantity، Gold Center rate، making/certificate، VAT، line total، remove. الأصل serialized يظهر qty=1 disabled؛ المنتج quantity فقط وفق authority. القيم المشتقة read-only مع `NumericToken`/`bdi`.

## 22. Payment panel

يمينًا: subtotal، making، stone، discount، VAT base/amount، total، method tabs، paid، remaining/change، installment fields عند الحاجة، split rows عند الحاجة، ثم زر `Complete sale` وزر clear/save draft. deposit يعرض badge واضح `Reservation deposit` ويحوّل المستخدم للحوار الخاص بدل أن يتنكر كبيع نهائي.

## 23. Keyboard workflow

- F2: focus scanner.
- Enter: commit scanner result/first exact match؛ لا submit تلقائي إذا كان هناك ambiguity.
- F4: focus customer (مقترح).
- F6: focus payment method (مقترح).
- F8: focus paid amount/split (مقترح).
- F12: final checkout الحالي مع confirmation state.
- Escape: close popover/clear focused layer ثم clear cart وفق السياسة الحالية.
- Ctrl/Cmd+S: save draft فقط إذا كان draft scope واضحًا.
لا تُنفّذ هذه الاختصارات في هذه الجولة؛ هي contract مقترح.

## 24. Async/error states

- `loading`: skeleton للجدول وstatus strip، مع إبقاء panel الدفع disabled.
- `pricing`: spinner صغير بجانب totals، و`Pricing pending` بدل عرض رقم قديم.
- `rate unavailable`: amber، يذكر Gold Center/rate snapshot وليس “zero”.
- invalid barcode: red inline، لا يمسح cart ولا يغير customer.
- sold/wrong branch: red/amber مع الحالة، لا محاولة checkout.
- duplicate: info toast وfocus يعاد scanner.
- server 422: field/line-level error؛ 403: permission/context banner؛ 409: stale/idempotency replay message.

## 25. RTL/numeric/currency

كل رقم/باركود/ID/date/money يمر عبر `formatCurrency`, `formatEnglishNumber`, `formatDateTime` أو `NumericToken`/`bdi dir="ltr"` مع `unicode-bidi:isolate`. currency يأتي من company/settings canonical. لا تحويل رقم عربي إلى سلطة؛ normalization للمدخلات فقط. التواريخ المستقبلية تستخدم branch timezone/date utility بدل UTC default.

## 26. Responsive strategy

- Desktop: ثلاثة أعمدة وpayment sticky.
- 1280: ثلاثة أعمدة مرنة؛ collapse customer details الثانوية.
- Tablet: عمود واحد، scanner/cart أولًا، payment accordion، customer drawer.
- Mobile ليس هدف cashier الأساسي؛ يعرض read-only/limited workflow ولا يختصر قواعد checkout.

## 27. Visual direction options

### A — DARFUS theme evolution (recommended)

يحافظ brand colors، surfaces، spacing وdark classes الحالية، ويضيف hierarchy وfocus rings فقط. أقل خطرًا على accessibility والتدرج، وأسهل دمجًا مع بقية dashboard. العيب: لن يطابق مرجع الصورة الداكن عالي التباين بالكامل.

### B — Cashier dark POS mode (optional)

طبقة theme اختيارية للـPOS فقط: surfaces داكنة، أزرار الدفع عالية التباين، status colors واضحة، وحجم touch أكبر. العيب: يحتاج قرار Owner، QA منفصلًا للكونتراست والطباعة، وخطر ازدواج theme. لا يُفعّل تلقائيًا.

## 28. Accessibility

labels صريحة لكل حقل، tab order من scanner إلى cart إلى payment، focus visible، `aria-live` للـpricing/errors، عدم الاعتماد على اللون وحده، targets لا تقل عن 44px، دعم keyboard كامل، وعدم تحريك focus بعد error إلا إلى العنصر المسبب. قارئ الشاشة يجب أن يعلن profile والحالة والسعر وعدم الإتاحة.

## 29. Performance risks

- إعادة حساب pricing مع كل تغيير دون debounce قد تسبب requests؛ حافظ على payload key/cache الحالي وأضف debounce مستقبلًا.
- شبكة assets كبيرة؛ استخدم virtualization/pagination قبل تحميل صور جديدة.
- Gold Center rate يجب request-scoped/cache server-side؛ لا polling من كل card.
- payment sticky لا يعيد render cart كله.
- لا تُحمّل POS module ثقيلًا قبل الحاجة للطباعة/الجورنال.

## 30. Component blueprint

```text
PosShell
├─ PosHeader (cashier / branch / date / draft actions)
├─ CustomerPanel
├─ PosWorkArea
│  ├─ BarcodeScanner
│  ├─ InventoryFilterBar
│  ├─ CartTable
│  └─ KeyboardHelp
└─ PaymentPanel
   ├─ TotalsBreakdown
   ├─ PaymentMethodTabs
   ├─ SplitPaymentRows / InstallmentFields
   └─ SaleActions
```

إعادة الاستخدام: `PageHeader`, `DataToolbar`, `NumericInput`, `NumericToken`, `DateInput`, `Modal`, `JournalPreview`, `InvoicePrintOptionsDialog`. لا تُنشأ business hook ثانية.

## 31. Data-flow blueprint

`Scanner/search` → `existing asset/product query` → `cart state` → `usePos.calculatePricing` → `POST /pricing/calculate` → `server totals + pricing breakdown` → `PaymentPanel` → `usePos.postInvoice` → `POST /pos/checkout` + Idempotency-Key → transaction: Invoice/Items, Asset/StockMovement, Payments/Installments, Journal/CashTransactions, loyalty/balance, Audit → response readback → invalidate/refocus scanner.

## 32. Current-vs-proposed

| المجال | الحالي | المقترح |
|---|---|---|
| Layout | 2 columns | 3 columns desktop، stacked tablet |
| Customer | select داخل payment | left decision panel |
| Scan | generic search | dedicated scanner UX فوق cart |
| Items | cards + implicit cart | explicit canonical cart table |
| Payment | mixed with cart | sticky right summary |
| Logic | existing server authority | نفس authority بلا تغيير |
| Return | separate routes | يظل منفصلًا |
| Theme | current dashboard | A recommended، B optional |

## 33. Text wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ POS | الكاشير | الفرع النشط | التاريخ | مسودة/طباعة                         │
├───────────────┬──────────────────────────────────────┬───────────────────────┤
│ العميل         │ ماسح الباركود / بحث                 │ الدفع والملخص          │
│ [بحث عميل]     │ [Scan barcode____________ Enter]    │ Subtotal               │
│ بطاقة العميل   │ فلاتر Profile                       │ Making / Stone         │
│ الاسم / Tier   │ ┌──────────────────────────────┐   │ Discount / VAT         │
│ الرصيد         │ │ Item table                   │   │ Total                  │
│ تغيير العميل   │ │ code | profile | qty | price │   │ [Cash][Card][Split]    │
│                 │ │ weight | VAT | remove       │   │ Paid / Remaining/Change│
│                 │ └──────────────────────────────┘   │ [إتمام البيع]          │
│                 │ [مسودة] [تفريغ] [اختصارات]         │ [حفظ مسودة]            │
└───────────────┴──────────────────────────────────────┴───────────────────────┘
```

## 34. Future implementation plan

1. Owner approves blueprint and visual direction.
2. Phase A: extract shell/panels without changing state or endpoints.
3. Phase B: scanner focus/Enter/status UX over existing lookup.
4. Phase C: cart table and customer panel; preserve payload contracts.
5. Phase D: payment panel, sticky behavior, split/installment/deposit affordances.
6. Phase E: keyboard/RTL/accessibility/performance hardening.
7. Phase F: strict disposable-clone runtime acceptance and regression.

كل مرحلة تُنفّذ فقط بعد مراجعة scope، ولا تُنشأ migration أو route أو pricing authority جديدة.

## 35. Future strict runtime test plan

على clone/disposable acceptance فقط: valid barcode، unknown barcode، sold/wrong-branch asset، duplicate scan، product quantity، Gold Bar 24K، Gold By Weight، Gold By Piece، CGP asset، non-gold، zero/missing price، Gold Center unavailable، customer company mismatch، cash/card/transfer، split exact/under/over، installment limits/zero-down permission، deposit isolation، VAT breakdown، final checkout، replay same idempotency، changed-body 409، concurrent checkout، Asset SOLD/StockMovement، balanced Journal/CashTransaction، Audit، return/exchange routes، focus/keyboard، RTL/LTR numeric rendering، 1440/1280/tablet، console/network cleanliness. Persistent `darfus_erp` يبقى SELECT-only.

## 36. Owner decisions

قرارات مطلوبة قبل التنفيذ:

1. اعتماد shell cashier-first ثلاثي الأعمدة.
2. اختيار A (الموصى به) أو B للاتجاه البصري.
3. تأكيد أن manual item entry يظل ممنوعًا؛ التوصية: نعم، barcode/catalog فقط.
4. تأكيد split payment كخيار مستمر؛ حاليًا مدعوم server-side.
5. هل POS يحتاج fullscreen cashier mode؟ ليس مطلوبًا حاليًا.
6. هل نعرض loyalty points في POS؟ التوصية: لا حتى تعريف contract واضح.
7. هل تبقى return/exchange خارج نفس invoice؟ التوصية: نعم، لا negative lines في checkout.

`OWNER_UI_APPROVAL_REQUIRED=YES` و`OWNER_DECISIONS_REQUIRED=COMPLETE` لأن هذه اختيارات عرض/نطاق وليست قواعد مالية مخفية.

## 37. Final recommendation

اعتماد Option A، وتنفيذ shell/panels تدريجيًا حول الـcanonical hooks والمسارات الحالية، مع إبقاء server pricing/payment/inventory/accounting/security كما هي. لا ينبغي نسخ الشكل المرجعي حرفيًا إذا كان يتعارض مع one-asset authority أو return workflow أو VAT authority. أي قرار يضيف points/manual items/negative lines يجب أن يمر بقرار Owner مستقل.

## 38. Gate

كل الأدلة المطلوبة للمسح الحالي، business-rule freeze، mapping، wireframe، component/data-flow، phase plan، وruntime plan مكتملة. لا يوجد UNKNOWN يمنع تصميم API/UI لأن blueprint يعيد استخدام contracts الحالية. التنفيذ غير مسموح تلقائيًا.

## 39. Execution record

- `MODE=READ_ONLY_FORENSIC_AND_DESIGN_BLUEPRINT`
- `PRODUCT_CODE_MUTATIONS_THIS_BATCH=0`
- `PERSISTENT_WRITES_THIS_BATCH=0`
- `ACCEPTANCE_WRITES_THIS_BATCH=0`
- `MIGRATIONS_CREATED=0`
- `RUNTIME_ENV_CHANGED=NO`
- `GIT_STAGED_THIS_BATCH=0`
- `GIT_COMMITS_THIS_BATCH=0`
- `SERVER_DEPLOYMENTS=0`
- `HANDOFF_UPDATED=NO`
- التقرير الجديد هو artifact هذه الجولة فقط؛ كل الملفات الأخرى dirty/inherited ولم تُنظف.

## 40. Required 42 answers

1. **شاشة POS الحالية موجودة فين؟** في `app/[locale]/(dashboard)/pos/page.tsx`.
2. **شكلها الحالي عامل إزاي باختصار؟** عمود أصناف/أصول يسارًا وسلة/دفع يمينًا؛ ليست ثلاثة أعمدة.
3. **إيه أكبر مشاكل UX الحالية؟** ازدحام، بحث عام بدل scanner، غياب جدول سطور واضح، وعدم وضوح حالات التسعير/الدفع.
4. **الباركود شغال إزاي؟** scanner يكتب في input البحث العام؛ F2 يركزه، والخادم يتحقق عند checkout؛ لا Enter scanner مستقل.
5. **إيه أنواع Assets اللي POS بيدعمها؟** كل Asset متاح في الفرع مع profiles الذهب والماس/الأحجار المدعومة بالخدمة؛ الأصل serialized كمية واحدة.
6. **Gold Bar بيتسعر إزاي؟** صافي الوزن × معدل Gold Center الحالي + certificate sale amount، وVAT على الشهادة فقط.
7. **Gold By Weight بيتسعر إزاي؟** صافي الوزن × المعدل + الوزن الفيزيائي × making per gram، وVAT على subtotal وفق الخادم.
8. **Gold By Piece بيتسعر إزاي؟** current total cost + markup ثم discount policy/minimum approval وVAT على السعر النهائي.
9. **CGP Asset بيتباع إزاي؟** كأصل موجود profile=CGP بعد إتاحته، ويعيد الخادم تسعيره؛ POS لا ينشئ CGP Asset.
10. **منع السعر صفر شغال إزاي؟** الواجهة تعطل البطاقة، والخادم يرفض `POS_SELLING_PRICE_REQUIRED` أو missing canonical rate.
11. **بيانات العميل الحالية إيه؟** الاسم وtier في الواجهة؛ الخادم يفرض customerId ويستخدم company-scoped customer وbalance/purchases.
12. **هل عندنا Points فعلًا؟** نعم في Customer model وsale awards loyalty، لكنها ليست معروضة حاليًا في POS.
13. **طرق الدفع الحالية إيه؟** cash، card، transfer، split، installment حسب settings، وdeposit للحجز.
14. **هل Mixed Payment موجود؟** نعم، split مدعوم في الواجهة والخادم ويجب أن يساوي الإجمالي.
15. **الفرق/الباقي بيتعامل معاه النظام إزاي؟** split exact؛ installment يحسب remaining؛ partial يزيد AR/customer balance؛ overpayment لا يصبح سلطة client.
16. **VAT الحالي مصدره إيه؟** Company Settings والخدمات الخادمية؛ gold profile يحدد base، و24K certificate-only.
17. **هل النظام بيدعم Return/negative line بنفس الفاتورة؟** لا في POS؛ return/exchange مسارات canonical منفصلة.
18. **القيود المحاسبية عند البيع إيه؟** postingService ينشئ balanced journal، treasury leg، revenue/VAT وCOGS/inventory حسب cost.
19. **تأثير البيع على Asset/Inventory إيه؟** Asset ينتقل AVAILABLE→SOLD مع events/movement؛ المنتج ينقص quantity ويسجل StockMovement.
20. **صلاحيات Company/Branch/Cashier إيه؟** auth/company context، branch scope، `pos.sell`، operator/session policy، وIdempotency-Key.
21. **إيه من الصورة ينفع ناخده كما هو بصريًا؟** scanner الواضح، جدول السلة، عمود العميل، ملخص الدفع، sticky total.
22. **إيه من الصورة ماينفعش ناخده؟** negative lines داخل sale، manual item غير authoritative، client pricing، أو company/branch fallback.
23. **التصميم المقترح للشاشة؟** 3 أعمدة cashier-first: customer / work-cart / payment.
24. **العمود الشمال هيبقى فيه إيه؟** بحث العميل، بطاقة الاسم/الهاتف/tier/balance، وتغيير العميل وفق permission.
25. **العمود النص هيبقى فيه إيه؟** scanner، الفلاتر، cart table، profile/weight/status details، وأزرار draft.
26. **العمود اليمين هيبقى فيه إيه؟** breakdown، طرق الدفع، paid/remaining/change، installment/split، checkout.
27. **جدول القطع المقترح أعمدته إيه؟** code، name، profile، karat، gross/net، qty، rate، making/certificate، VAT، total، remove.
28. **هل Payment panel يبقى Sticky؟** نعم على desktop؛ static/accordion على tablet.
29. **Keyboard shortcuts المقترحة؟** F2 scanner، Enter commit، F4 customer، F6 method، F8 paid، F12 checkout، Escape layer/cart.
30. **Loading states شكلها إيه؟** skeleton للبيانات وspinner صغير للتسعير مع تعطيل checkout.
31. **Error states شكلها إيه؟** inline line errors، rate unavailable amber، scope/permission banners، و409 replay/stale رسالة واضحة.
32. **Dark mode ولا نفس Theme الحالي؟** التوصية Option A نفس DARFUS؛ Option B dark cashier اختياري بقرار Owner.
33. **Desktop/Tablet هيبقوا إزاي؟** desktop 3 columns؛ 1280 مرن؛ tablet stack scanner/cart ثم payment ثم customer drawer.
34. **هل Business Logic هيتغير؟** لا، blueprint بصري فقط ويعيد استخدام canonical authorities.
35. **إيه الحاجات اللي محتاجة قرار مني قبل التنفيذ؟** اعتماد 3 أعمدة، theme، manual entry، fullscreen، points، واستمرار فصل return.
36. **خطة التنفيذ بعد الموافقة؟** shell ثم scanner ثم cart/customer ثم payment ثم keyboard/accessibility ثم clone acceptance.
37. **خطة الاختبار بعد التنفيذ؟** browser/network/backend على clone، كل profiles/payment/errors/idempotency/accounting/inventory وresponsive.
38. **Persistent writes؟** صفر؛ قاعدة `darfus_erp` لم تُكتب.
39. **هل عدلت أي كود؟** لا؛ أُنشئ تقرير Markdown فقط.
40. **Gate؟** `PASS_DESIGN_READY`.
41. **التقرير؟** هذا الملف هو التقرير الوحيد الناتج من الجولة.
42. **الخطوة التالية فقط؟** `POS-REDESIGN-OWNER-APPROVAL-AND-IMPLEMENTATION-PLAN-01_IF_APPROVED`، دون بدء تلقائي.

## 41. Required final tokens

```text
CURRENT_BATCH = POS-CURRENT-UX-BUSINESS-RULES-FORENSIC-AND-REDESIGN-01
MODE = READ_ONLY_FORENSIC_AND_DESIGN_BLUEPRINT
CURRENT_POS_ENTRYPOINT_MAP = COMPLETE
CURRENT_POS_UI_INVENTORY = COMPLETE
CURRENT_POS_BUSINESS_FLOW = COMPLETE
POS_BARCODE_SCAN_FORENSIC = COMPLETE
POS_PROFILE_MATRIX = COMPLETE
POS_GOLD_RULES_PRESERVED_IN_BLUEPRINT = YES
POS_FAIL_CLOSED_RULES = COMPLETE
POS_GOLD_CENTER_FLOW = COMPLETE
POS_CUSTOMER_FLOW = COMPLETE
POS_PAYMENT_METHOD_MATRIX = COMPLETE
POS_MIXED_PAYMENT_STATUS = SUPPORTED
POS_PAYMENT_DIFFERENCE_LAW = COMPLETE
POS_VAT_FORENSIC = COMPLETE
POS_RETURN_FLOW_STATUS = COMPLETE
POS_INVENTORY_EFFECT = COMPLETE
POS_ACCOUNTING_EFFECT = COMPLETE
POS_SECURITY_CONTEXT = COMPLETE
POS_UX_PAIN_POINTS = COMPLETE
CASHIER_FIRST_DESIGN = YES
POS_DESKTOP_BLUEPRINT = COMPLETE
POS_CENTER_WORKSPACE_BLUEPRINT = COMPLETE
POS_ITEM_TABLE_BLUEPRINT = COMPLETE
POS_CUSTOMER_COLUMN_BLUEPRINT = COMPLETE
POS_PAYMENT_COLUMN_BLUEPRINT = COMPLETE
POS_STICKY_PAYMENT_RECOMMENDATION = COMPLETE
POS_BARCODE_UX_BLUEPRINT = COMPLETE
POS_KEYBOARD_SHORTCUT_BLUEPRINT = COMPLETE
POS_ASYNC_STATE_BLUEPRINT = COMPLETE
POS_ERROR_UX_BLUEPRINT = COMPLETE
POS_DOUBLE_SUBMIT_PROTECTION_BLUEPRINT = COMPLETE
POS_RTL_NUMERIC_STANDARD = PASS
POS_CURRENCY_AUTHORITY = COMPLETE
POS_RESPONSIVE_BLUEPRINT = COMPLETE
POS_VISUAL_DIRECTION_OPTIONS = COMPLETE
POS_DARK_MODE_DECISION = COMPLETE
POS_ACCESSIBILITY_REVIEW = COMPLETE
POS_PERFORMANCE_RISK_MAP = COMPLETE
POS_BUSINESS_RULE_FREEZE_TABLE = COMPLETE
POS_REFERENCE_MAPPING_TABLE = COMPLETE
POS_CURRENT_VS_PROPOSED_TABLE = COMPLETE
POS_TEXT_WIREFRAME = COMPLETE
POS_COMPONENT_BLUEPRINT = COMPLETE
POS_DATA_FLOW_BLUEPRINT = COMPLETE
POS_IMPLEMENTATION_PHASE_PLAN = COMPLETE
POS_FUTURE_RUNTIME_TEST_PLAN = COMPLETE
OWNER_UI_APPROVAL_REQUIRED = YES
OWNER_DECISIONS_REQUIRED = COMPLETE
PERSISTENT_WRITES_THIS_BATCH = 0
PRODUCT_CODE_FILES_CHANGED = 0
MIGRATIONS_CREATED = 0
RUNTIME_ENV_CHANGED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
POS_CURRENT_UX_BUSINESS_RULES_FORENSIC_AND_REDESIGN_01_GATE = PASS_DESIGN_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = POS-REDESIGN-OWNER-APPROVAL-AND-IMPLEMENTATION-PLAN-01_IF_APPROVED
```
