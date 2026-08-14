# SUPPLIER-ALL-ASSET-PROFILES-ACQUISITION-PAYABLE-PRICING-FORENSIC-01

## 1. Execution record

- الوضع: تدقيق جنائي للقراءة فقط.
- المرجع: `darfus_erp`، وقراءة مقارنة من `darfus_erp_inventory_rehearsal_20260804_160500z`.
- لم يتم إنشاء شراء مورد، PO، Receipt، Asset، Payment، Journal، Treasury، Fixture أو Migration.
- لم يتم تعديل الكود أو البيئة أو `PROJECT_PROGRESS_HANDOFF.md`.
- الملف الوحيد المنشأ في هذه الجولة هو هذا التقرير.

## 2. Git / protection

- Branch: `main`
- HEAD: `1657b0e9ba580faef69be48f04637835c201b521`
- الـ worktree متسخ بتغييرات موروثة كثيرة؛ لم يتم تنظيفها أو استعادتها.
- Stashes موروثة: 11. لا توجد remotes ظاهرة في `git remote -v`.
- `next-env.d.ts` بقي كما هو، SHA الحالي:
  `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.
- لا يوجد `next dev` أو restart أو Git write في هذه الجولة.

## 3. قواعد الاستقبال الحالية

الـ endpoint هو:

`POST /purchase-orders/receive` و`POST /supplier-purchases/receive`

ويُشترط `Idempotency-Key`، المورد، والفرع. عند `inventoryV2=true` يجب إرسال `perPiece` بطول يساوي الكمية، وكل قطعة تتحول إلى Asset مستقل. `assertPieceBasedPayload` يمنع quantity authority داخل القطعة، و`cgpLegacyIsolation.assertSupplierReceiveDoesNotMasqueradeAsCgp` يرفض CGP صراحة.

## 4. Profile registry

الـ endpoint `GET /inventory-v2/profiles` يرجع registry الخادمي نفسه الموجود في `inventory-master-policy.service.js`. الشاشة تعرض 10 مفاتيح:

| الظاهر في الشاشة | المفتاح الداخلي | صالح كـ Supplier Receive؟ | مصدر الحالة |
|---|---|---|---|
| مجوهرات ذهب بالوزن | `GOLD_BY_WEIGHT_JEWELLERY` | نعم | profile registry + V2 receive |
| ذهب 24 / سبيكة | `GOLD_BAR_24K` | نعم، 24K فقط | profile registry + V2 receive |
| ذهب بالقطعة | `GOLD_BY_PIECE` | نعم | profile registry + V2 receive |
| مجوهرات ألماس | `DIAMOND_JEWELLERY` | نعم | profile registry + manual piece cost |
| ألماس سائب | `LOOSE_DIAMOND` | نعم | profile registry + manual piece cost |
| مجوهرات أحجار كريمة | `GEMSTONE_JEWELLERY` | نعم | profile registry + manual piece cost |
| أحجار كريمة سائبة | `LOOSE_GEMSTONE` | نعم | loose finance service |
| مجوهرات لؤلؤ | `PEARL_JEWELLERY` | نعم | profile registry + manual piece cost |
| لؤلؤ سائب | `LOOSE_PEARL` | نعم | loose finance service |
| شراء ذهب العميل | `CGP_CUSTOMER_GOLD_PURCHASE` | لا، Supplier path blocked | CGP isolation |

**النتيجة:** `SUPPLIER_PROFILE_REGISTRY_MATRIX = COMPLETE`، وعدد الخيارات المرئية = 10. CGP موجود لأنه عضو في نفس canonical inventory profile registry، وليس لأنه Supplier business profile صحيح.

## 5. Acquisition authority matrix

| Profile | سلطة تكلفة الشراء | الكمية الفيزيائية | الإجمالي الخادمي | وضع القراءة الحالي |
|---|---|---|---|---|
| Gold By Weight | `netGoldWeight × purchaseGoldRate + grossWeight × makingPerGram + purchase VAT` عند وجود VAT | gross/stone/net؛ 14/18/21/22/24 | `calculateReceiptGoldValuation().purchase.totalPurchaseCost` | مدعوم خادميًا، لكن ملخص الشاشة لا يعرضه كـ total |
| Gold Bar 24K | `netGoldWeight × purchaseGoldRate + certificateCost + certificate VAT`؛ making غير مطبق | gross/stone/net، karat=24 إلزامي | نفس الـ normalizer | مدعوم خادميًا، وملخص الشاشة قد يعرض صفرًا |
| Gold By Piece | `piece.purchaseCost` يدوي لكل قطعة؛ لا تحويل صامت إلى gold rate | one piece = one Asset | `piece.purchaseCost` | يعمل لأن الشاشة ترسل نفس الحقل الذي يقرأه الخادم |
| Diamond Jewellery | `piece.purchaseCost` يدوي، وVAT عام فقط إذا أُرسل `vatRate` | grossWeight كبيان فيزيائي | generic V2 normalizer | لا توجد valuation authority متخصصة |
| Loose Diamond | `piece.purchaseCost` يدوي؛ لا يوجد loose finance calculator لهذا المفتاح | grossWeight + loose detail/carats | generic V2 normalizer | مسار جزئي |
| Gemstone Jewellery | `piece.purchaseCost` يدوي، وVAT عام اختياري | grossWeight | generic V2 normalizer | مسار جزئي |
| Loose Gemstone | `baseCost + additionalCost + VAT` | grossWeight + carat/master data | `loose-profile-finance.service` | مدعوم للشراء والتقييم الحالي |
| Pearl Jewellery | `piece.purchaseCost` يدوي، وVAT عام اختياري | grossWeight | generic V2 normalizer | مسار جزئي |
| Loose Pearl | `baseCost + VAT` | grossWeight + totalPearlWeight/master size | `loose-profile-finance.service` | مدعوم للشراء والتقييم الحالي |
| CGP | ليس Supplier acquisition؛ له Sales/CGP authority مستقلة | customer-gold business model | ليس من Supplier PO | محجوب |

`ALL_PROFILE_ACQUISITION_AUTHORITY_MATRIX = COMPLETE` من ناحية الكود الحالي، لكن ليس كل Profile يملك valuation/POS capability كاملة؛ هذه فجوات موثقة أدناه.

## 6. Backend purchase-total chain

1. `normalizeReceiptPiece` يحسب weights بـ `calculateGoldWeights` ويحسب Gold valuation أو loose finance.
2. للذهب، `purchaseCost = purchase.totalPurchaseCost`، وليس `piece.purchaseCost` القادم من العميل.
3. `item.totalCost = sum(piece.purchaseCost)`، ثم `item.unitCost = item.totalCost / pieces.length`.
4. `goodsTotal = sum(item.totalCost)`، ثم PO `total` بعد معالجة VAT/RCM.
5. `postingService.postPurchaseEntry` يأخذ PO total ويقسمه إلى inventory debit، input VAT/RCM إن وجد، cash/bank paid، و`SUPPLIER_PAYABLE` للجزء غير المدفوع.
6. `asset_purchase_cost_revisions.total_purchase_cost` تحفظ إجمالي الشراء لكل Asset.
7. Asset `cost` هو `effectiveCost`: في VAT recoverable يُستبعد VAT من book cost، بينما PO/payable يظل gross.

الـ source يثبت وجود قيم عرض متعددة قبل الخادم (`purchaseCost`, gold valuation preview، VAT preview، `totalCost`) لكنها ليست سلطات مالية مستقلة بعد الإرسال؛ السلطة الدائمة هي PO total المبني من normalizer.

`BACKEND_PURCHASE_TOTAL_AUTHORITY = V2 normalizer -> PO.total -> posting.service`

`MULTIPLE_COMPETING_PURCHASE_TOTALS = YES (frontend preview paths), NO (backend durable posting authority)`

## 7. لماذا يظهر Gold Bar بقيمة موجبة ومتَبقي صفر؟

في الشاشة:

- `goldPurchaseValue` = مجموع `netWeight × purchaseGoldRate`.
- `certificateTotal` و`certificateVatTotal` محسوبان للعرض.
- لكن `totalCost` للـ V2 = `canonicalPieceTotal`، وهو مجموع `parseDecimal(piece.purchaseCost)`.
- عند Gold Bar/Gold By Weight، payload يتعمد إرسال `purchaseCost: undefined` لأن الخادم هو من يحسب gold valuation؛ لذلك يبقى `piece.purchaseCost` المحلي فارغًا/صفرًا.
- `remainingAmount = max(0, totalCost - paidAmount)`، فيظهر صفر مع paid=0.

إذن السبب مثبت من source وليس من فشل الخادم:

`GOLD_BAR_ZERO_REMAINING_ROOT_CAUSE = FRONTEND_SUMMARY_WRONG_SOURCE`

هذا خلل read-model/preview في الواجهة، وليس دليلًا على أن PO total أو payable الخادمي صفر. في آخر Gold Bar الموجود في Persistent كان PO total = `15601050.00000000`، وpurchase revision total = `15601050.00000000`، مع paid=0 وremaining=15601050.

## 8. Gold By Weight

- المفتاح: `GOLD_BY_WEIGHT_JEWELLERY`.
- karat المسموح: 14/18/21/22/24.
- `net = gross - stone`، و`pureGold9999 = net × karat / 24`.
- purchase gold value = `net × purchaseGoldRate`.
- making = `gross × makingPerGram`.
- current valuation يستخدم current canonical Gold Center rate ويُحفظ في `asset_current_valuations`.
- الشاشة نفسها تحمل نفس مشكلة zero preview لأن `totalCost` ما زال يعتمد على `piece.purchaseCost` الفارغ.

`GOLD_BY_WEIGHT_ZERO_REMAINING_DEFECT = YES`

`GOLD_BY_WEIGHT_ZERO_REMAINING_ROOT_CAUSE = FRONTEND_SUMMARY_WRONG_SOURCE (same as Gold Bar)`

## 9. Gold Bar 24K

- `GOLD_BAR_24K` يرفض أي karat غير 24.
- purchase total = gold value + certificate cost + certificate VAT؛ VAT base certificate فقط.
- making = null في gold valuation.
- current certificate cost/current VAT/current gold value منفصلة عن snapshot التاريخي.
- مثال القراءة الحالية: purchase gold value 15600000، certificate 1000، VAT 50، PO total 15601050، Asset.cost 15601000 بسبب استبعاد recoverable VAT، current valuation 21001575.

`GOLD_BAR_24K_ACQUISITION_CONTRACT = 24K_WEIGHT_RATE_PLUS_OPTIONAL_CERTIFICATE_CERTIFICATE_ONLY_VAT`

`GOLD_BAR_SUPPLIER_PAYABLE_CHAIN = normalized purchase total -> PO.total -> SUPPLIER_PAYABLE journal line -> remaining = PO.total - supplier cash-outs`

## 10. Gold By Piece

`GOLD_BY_PIECE` يتطلب `purchaseCost` لكل قطعة. الشاشة تحسب `canonicalPieceTotal` من هذا الحقل، وترسله إلى `perPiece.purchaseCost`. الخادم لا يستدعي `calculateReceiptGoldValuation` لهذا المفتاح ولا يضرب weight × Gold Center. لذلك يظهر المتبقي بطريقة مختلفة وصحيحة مقارنة بالذهب المتخصص.

`GOLD_BY_PIECE_WORKING_PATH_ROOT_CAUSE = FRONTEND_AND_BACKEND_USE_EXPLICIT_PIECE_PURCHASE_COST`

`GOLD_BY_PIECE_VS_WEIGHT_DIFFERENCE = piece cost authority مقابل weight/rate authority؛ لا يجوز دمجهما بصمت.`

## 11. Profiles غير الذهب

- **Diamond Jewellery:** تكلفة شراء يدوية لكل قطعة؛ certificate metadata ممكنة؛ لا current valuation/POS policy متخصصة مثبتة، فيبقى POS على Asset.price ما لم يوجد مسار آخر.
- **Loose Diamond:** تفاصيل diamond مطلوبة، لكن `loose-profile-finance.service` لا يدعم هذا المفتاح؛ purchase cost يدوي generic؛ current valuation/POS canonical غير مكتمل.
- **Gemstone Jewellery:** purchase cost يدوي generic؛ components ممكنة؛ لا valuation/POS specialized مثبت.
- **Loose Gemstone:** base + additional + VAT؛ current valuation مستقل؛ POS يستخدم current valuation وpricing policy markup؛ master-data/certificate authority مطلوبة عند استخدام شهادة.
- **Pearl Jewellery:** purchase cost يدوي generic؛ لا valuation/POS specialized مثبت.
- **Loose Pearl:** base + VAT؛ current valuation مستقل؛ POS يستخدم current valuation وmarkup؛ pearl size من master data، والشهادة تحتاج authority reference عند وجودها.

## 12. Certificate

الشهادة optional كـ Asset relation/metadata لكل Profile يدعمها registry، وغيابها لا يمنع generic receive في الملفات التي لا تملك certificate finance. عند وجودها تُحفظ في `asset_certificates`، لكن التكلفة والـ VAT acquisition الماليين مخصصان حاليًا بوضوح لـ Gold Bar فقط.

- الغياب: certificate row لا تُنشأ، certificate cost/VAT = 0 في المسارات المتخصصة التي تدعمها.
- Gold Bar: `certificateVAT = certificateCost × vatRate / 100`.
- باقي profiles: certificate metadata موجودة، لكن certificate purchase-cost/VAT authority ليست موحدة؛ هذا Gap وليس PASS كامل.
- purchase certificate cost لا ينتقل تلقائيًا إلى POS؛ Gold sale service يستخدم `certificateSaleAmount`/pricing policy منفصلًا.

`CERTIFICATE_OPTIONAL_CAPABILITY_ARCHITECTURE = PARTIAL`

`CERTIFICATE_ABSENT_ZERO_SEMANTICS = PASS (للمسارات المتخصصة الحالية؛ finance certificate العام غير موحد)`

`CERTIFICATE_PRESENT_ACQUISITION_FORMULA = Gold Bar only: certificateCost + certificateCost * vatRate / 100`

`PURCHASE_CERTIFICATE_TO_RETAIL_LEAK = NO`

## 13. Supplier Payable / Paid / Remaining

الـ authority هي `PurchaseOrder.total`. `supplier-payment-state.service` يحسب:

`payableAmount = PO.total`

`paidAmount = SUM(CashTransaction.amount WHERE type=cash_out AND category=supplier_purchase AND reference=PO.id)`

`remainingAmount = max(0, payableAmount - paidAmount)`

`Supplier.due` ليس authority؛ هو reference legacy فقط. عند الإنشاء، `postingService.postPurchaseEntry` ينشئ القيد ويربط cash-out إذا كان paid>0، ويضع الباقي في `SUPPLIER_PAYABLE`.

`SUPPLIER_PAYABLE_CALCULATION_AUTHORITY = PurchaseOrder.total`

`SUPPLIER_REMAINING_CALCULATION_AUTHORITY = PurchaseOrder.total - grouped supplier_purchase CashTransaction payments`

`SUPPLIER_PAYABLE_CREATION_BOUNDARY = postingService.postPurchaseEntry أثناء POST receive داخل transaction`

Persistent القراءة الحالية: PO total الكلي للـ received non-consignment = `15699490.00000000`، supplier payments = `740.0000`، computed remaining = `15698750.00000000`.

## 14. Asset.cost vs purchase total

`Asset.cost` ليس دائمًا PO total:

- مع no VAT/non-recoverable VAT: يساوي تكلفة الشراء المباشرة/المُرسملة.
- مع recoverable V2 VAT: `effectiveCost = purchaseCost - piece.vat.vatAmount`.
- PO total/payable يظل المبلغ الإجمالي المستحق للمورد.
- Purchase Revision يحتفظ بالدليل التاريخي الإجمالي، بما فيه VAT.

هذا فصل محاسبي مقصود وليس duplicate payable authority، لكنه يحتاج read-model واضحًا في الواجهة كي لا يُفهم Asset.cost على أنه supplier right.

## 15. Journal / accounting

القيد لا يأخذ `Asset.cost` أو current valuation كمرجع payable؛ يأخذ PO snapshot. inventory debit قد ينقسم حسب karat، input VAT/RCM منفصل حسب snapshot، cash/bank للمدفوع، وAP للمتبقي. Branch mapping يُحل عبر `resolveRequiredBranchFinancialAccount` مع active mapping واحد بالضبط.

`PURCHASE_JOURNAL_AMOUNT_AUTHORITY_MATRIX = COMPLETE`

`SUPPLIER_ACCOUNTING_AMOUNT_CHAIN = COMPLETE`

## 16. Current valuation / POS

- Gold Bar/Gold By Weight: `asset_current_valuations` منفصلة، update route لا يكتب purchase revisions.
- Loose Gemstone/Loose Pearl: current valuation منفصلة عبر loose finance.
- Gold By Piece وDiamond/Gemstone/Pearl jewellery وLoose Diamond: لا يوجد current valuation route متخصص مثبت بنفس الاكتمال؛ POS قد يستخدم Asset.cost/price fallback.
- POS `/pricing/calculate` يعيد حساب gold profiles من Gold Center/current valuation أو profile policy، ولا يستخدم purchase certificate cost كـ retail certificate charge.
- Gold By Piece يستخدم current total cost + markup، لكن current valuation evidence قد تكون غائبة في بعض assets، فيلجأ إلى `asset.cost`.

`CURRENT_VALUATION_SEPARATION_MATRIX = COMPLETE (للمسارات المدعومة) / PARTIAL (لباقي profiles)`

`ALL_PROFILE_POS_PRICING_AUTHORITY_MATRIX = INCOMPLETE`

## 17. Frontend/backend parity

| الحالة | شاشة Supplier | الخادم | النتيجة |
|---|---|---|---|
| Gold Bar / Weight | preview من `piece.purchaseCost` مع gold/cert cards منفصلة | normalizer يحسب total من valuation | mismatch عرض فقط، لكن خطر supplier-right UX |
| Gold By Piece | preview من piece cost | normalizer من piece cost | parity جيدة |
| Loose Gemstone/Pearl | preview من loose purchase cost | loose finance يعيد الحساب | parity مفاهيمية جيدة |
| Diamond/Gemstone/Pearl jewellery | preview manual purchaseCost | generic normalizer | parity في total، لكن valuation/POS غير كامل |
| CGP | dropdown ظاهر والزر disabled | backend يرفض masquerade | boundary سليم |

`RECEIVING_SUMMARY_FIELD_AUTHORITY_MATRIX = INCOMPLETE`

## 18. Zero-price / tax / making matrices

- V2 Gold Bar/Weight يسمح header `unitCost=0` مؤقتًا لأن specialized valuation هو المرجع، ثم normalizer يرفض missing valuation required fields ويحسب قيمة موجبة.
- Generic piece profiles تحتاج `purchaseCost` غير سالب، والـ PO يرفض total<=0.
- Gold Bar VAT certificate-only.
- Gold By Weight making على gross weight؛ tax specialized لا يستقبل configured VAT تلقائيًا إلا إذا أُرسل manual rate في valuation.
- Loose VAT generic على base فقط؛ additional cost لـ Loose Gemstone يدخل الإجمالي وليس VAT base.
- Purchase certificate cost لا يساوي retail certificate charge.

`ALL_PROFILE_ZERO_PRICE_SAFETY_MATRIX = COMPLETE (server rejects zero final total) / INCOMPLETE (preview may show zero)`
`ALL_PROFILE_MAKING_CHARGE_MATRIX = INCOMPLETE`
`ALL_PROFILE_TAX_MATRIX = INCOMPLETE`

## 19. CGP boundary

`CGP_CUSTOMER_GOLD_PURCHASE` ظاهر في dropdown لأن endpoint registry يعرض كل canonical inventory profiles، وليس Supplier-valid subset. هذا مفيد للتغطية لكنه UX boundary gap.

- زر submit في الشاشة disabled عندما `isCgpProfile`.
- الخادم يفحص body/items قبل أي normalization ويرفض `CGP_CUSTOMER_GOLD_PURCHASE` برسالة Supplier Receive لا يُستخدم لـ CGP.
- لا يوجد وصول ناجح من Supplier Receive إلى CGP في المسار الحالي.

`CGP_SUPPLIER_DROPDOWN_REASON = shared full inventory profile registry is rendered without Supplier capability filtering`

`CGP_SUPPLIER_RECEIVE_REACHABLE = NO`

`CGP_CANONICAL_WORKFLOW_BYPASS_RISK = LOW (UI confusion only; server boundary blocks write)`

## 20. Financial mapping blocker

المسار الذي يوقف الاستلام هو `postingService.postPurchaseEntry` عند resolve `INVENTORY_ASSET`, `SUPPLIER_PAYABLE` أو treasury mapping داخل `resolveRequiredBranchFinancialAccount`. الخطأ السابق في disposable clone كان:

`FINANCIAL_MAPPING_REQUIRED — The required Branch financial mapping is missing or ambiguous.`

الخطأ يحدث بعد حساب normalized pieces/PO total وقبل commit القيد/Asset. لذلك إصلاح mapping وحده قد يسمح بنشر رقم خاطئ لو تركنا frontend summary غير موحد؛ ترتيب الإصلاح الآمن هو تثبيت canonical total/read-model أولًا، ثم mapping acceptance-only، ثم E2E.

`ACCEPTANCE_FINANCIAL_MAPPING_BLOCKER = previous disposable clone lacked or resolved an ambiguous active Branch financial mapping during posting`

`FINANCIAL_MAPPING_BLOCKS_AFTER_TOTAL_CALCULATION = YES`

Acceptance الحالية المقروءة لها 11 active branch mappings، لكن لم تُشغّل أي mutation في هذه الجولة لإعادة إثبات receive.

## 21. DB fingerprint / integrity

Persistent `darfus_erp`، `current_database()` verified. القراءة الحالية:

| Object | Count |
|---|---:|
| Migrations | 80 |
| Assets | 62 |
| Products | 3 |
| Suppliers | 1 |
| Purchase Orders | 6 |
| PO Items | 2 |
| Purchase cost revisions | 61 |
| Current valuations | 2 |
| Certificates | 2 |
| Pricing policies | 2 |
| Customer CGP documents | 7 |
| Customer CGP items | 11 |
| Customer gold pools | 1 |
| Inventory gold pools | 0 |
| CGP dispositions | 4 |
| CGP approval requests | 6 |
| Journal entries | 79 |
| Journal lines | 202 |
| Cash transactions | 56 |

Integrity SELECTs: duplicate primary barcodes=0، blank barcodes=0، orphan RFID=0، orphan purchase revisions=0، orphan current valuations=0، orphan certificates=0، orphan PO-Asset links=0، orphan journal lines=0، unbalanced posted journals=0، unlinked posted treasury=0.

Canonical signed GL القراءة الحالية للحسابات mapped by `SYS-CASH`/`SYS-BANK`: Cash `5008829.81300000`، Bank `199085.32410000`. هذه القراءة الحالية تختلف عن baseline قديم، ولم تُفسر بتجربة هذه الجولة؛ لذلك لا أستنتج delta task-owned.

Gold market settings القراءة: `GOLDAPI_IO`, `LIVE_PROVIDER`, AED، refresh 1500 ثانية، stale 2500 ثانية، enabled=true. `outbox_events` = 6 وكلها `PUBLISHED`؛ لا pending/claimed. `CGP_RUNTIME_DISPATCH_ENABLED=true` موجود في `.env` الموروث، لذلك لا يمكن إعلان global dispatcher OFF في هذه الجولة.

## 22. Runtime / acceptance boundary

لم يتم تشغيل endpoint mutation أو browser submit. التقرير السابق يثبت أن closeout E2E وصل receive الحقيقي ثم توقف عند mapping blocker؛ clone disposable تم إسقاطه. لذلك لا يوجد دليل runtime جديد على كل profiles، ولا يجوز تحويل static matrix إلى PASS_ROOT_CAUSE_PROVEN.

## 23. Legacy / capability classification

| Component | التصنيف |
|---|---|
| `/inventory-v2/profiles` | KEEP، registry authority |
| `normalizeReceiptPiece` | KEEP/ADAPT، canonical server total |
| `gold-valuation.service` | KEEP، specialized Gold authority |
| `loose-profile-finance.service` | KEEP/ADAPT، only Loose Gemstone/Pearl |
| `/purchase-orders/receive` | KEEP، one canonical Supplier workflow |
| `supplierPaymentState` | KEEP، payable read model |
| CGP Sales routes/services | KEEP، separate workflow |
| CGP in Supplier dropdown | BLOCK_FOR_CGP at submit; future filter/read-only explanation |
| legacy product quantity fallback | KEEP only compatibility; V2 rejects product identity |

## 24. Gap matrix

| ID | المطلوب | الحالة | Gap / risk | الإجراء المستقبلي |
|---|---|---|---|---|
| G01 Profile registry | 10 keys from server | COMPLIANT | CGP mixed into Supplier dropdown | expose capability flag/filter |
| G02 Gold Bar total | weight/rate/cert VAT | PARTIAL | summary wrong source | canonical supplier summary read model |
| G03 Gold By Weight total | weight/rate/making | PARTIAL | same preview zero | same fix |
| G04 Gold By Piece | piece cost only | COMPLIANT | no current valuation coverage | preserve piece authority |
| G05 Diamond/Gem/Pearl jewellery | manual acquisition | PARTIAL | no specialized current/POS authority | define profile capability contracts |
| G06 Loose Diamond | acquisition | PARTIAL | no loose finance/POS authority | define stone purchase/valuation |
| G07 Loose Gemstone/Pearl | base/additional/VAT | PARTIAL | certificate cost semantics incomplete | extend optional certificate finance |
| G08 Supplier Payable | PO total | COMPLIANT | preview divergence | fix read model |
| G09 Asset.cost | operational book cost | COMPLIANT | different from gross payable with recoverable VAT | label clearly |
| G10 Journal | postPurchaseEntry | COMPLIANT | mapping can block before commit | acceptance mapping setup |
| G11 Current valuation | separate table | PARTIAL | unsupported profiles | add approved profile-specific contracts |
| G12 POS | server pricing | PARTIAL | jewellery/loose diamond fallback risk | profile POS matrix and guards |
| G13 Certificate | optional relation | PARTIAL | financial certificate authority mostly Bar-only | unified design handoff |
| G14 CGP isolation | no Supplier CGP | COMPLIANT | dropdown confusion | capability filtering/read-only label |
| G15 Acceptance E2E | all profiles | UNKNOWN | forbidden in read-only forensic; prior clone blocked | rerun only after planned fixes/mapping |

## 25. Root-cause classification

**Primary defect:** `CONFIRMED_PRODUCT_BUG`, severity HIGH, frontend Supplier summary reads wrong field for specialized Gold profiles. It can misstate supplier right before submit even though backend later calculates a nonzero PO total.

**Secondary gaps:** `PARTIAL` capability for certificate acquisition outside Bar, current valuation/POS for several stone/jewellery profiles, and CGP capability filtering in the dropdown. No evidence of a committed persistent financial corruption from this forensic.

## 26. Safe implementation handoff

`OPTIONAL_CERTIFICATE_DESIGN_HANDOFF = INCOMPLETE`

`CANONICAL_PURCHASE_TOTAL_DESIGN_HANDOFF = COMPLETE` for backend authority, `INCOMPLETE` for frontend read model.

`SUPPLIER_SUMMARY_READMODEL_HANDOFF = INCOMPLETE`

Recommended plan only (not executed):

1. `SUPPLIER-ALL-ASSET-PROFILES-ACQUISITION-PAYABLE-PRICING-FIX-01`: expose one server-derived preview/read-model amount for each piece/profile, make the summary consume it, and keep PO.total as the final authority.
2. Add profile capability matrix for certificate cost/VAT, current valuation, and POS pricing; explicitly keep purchase certificate cost separate from retail.
3. Keep Gold By Piece on piece cost and add tests preventing weight×Gold Center conversion.
4. Resolve acceptance-only Branch mappings through the existing controlled configuration path; do not copy to persistent.
5. Run Clone receipt -> PO/payable/journal -> read-back for all profiles; only after that perform Gold closeout and Local Production Smoke.

## 27. Final gate

The exact Gold Bar/Gold By Weight preview defect is proven, and the backend payable chain is proven from source plus current rows. However, full runtime proof for every profile, certificate finance parity, and current valuation/POS parity is not available in this read-only round. The gate therefore remains blocked.

## 28. Required tokens

```text
CURRENT_BATCH = SUPPLIER-ALL-ASSET-PROFILES-ACQUISITION-PAYABLE-PRICING-FORENSIC-01
FORENSIC_MODE = READ_ONLY
PERSISTENT_DATABASE_CONFIRMED = darfus_erp
PERSISTENT_MIGRATIONS = 80
SUPPLIER_PROFILE_REGISTRY_MATRIX = COMPLETE
ALL_PROFILE_ACQUISITION_AUTHORITY_MATRIX = COMPLETE
SUPPLIER_PAYABLE_CALCULATION_AUTHORITY = PurchaseOrder.total
SUPPLIER_REMAINING_CALCULATION_AUTHORITY = PurchaseOrder.total - grouped supplier_purchase CashTransaction payments
RECEIVING_SUMMARY_FIELD_AUTHORITY_MATRIX = INCOMPLETE
BACKEND_PURCHASE_TOTAL_AUTHORITY = normalizeReceiptPiece -> item.totalCost -> PO.total -> posting.service
MULTIPLE_COMPETING_PURCHASE_TOTALS = YES
GOLD_BAR_24K_ACQUISITION_CONTRACT = 24K_WEIGHT_RATE_PLUS_OPTIONAL_CERTIFICATE_CERTIFICATE_ONLY_VAT
GOLD_BAR_SUPPLIER_PAYABLE_CHAIN = PO.total -> SUPPLIER_PAYABLE journal line -> payment read model
GOLD_BAR_ZERO_REMAINING_ROOT_CAUSE = FRONTEND_SUMMARY_WRONG_SOURCE
GOLD_BY_WEIGHT_ACQUISITION_CONTRACT = NET_WEIGHT_TIMES_PURCHASE_RATE_PLUS_GROSS_MAKING
GOLD_BY_WEIGHT_SUPPLIER_PAYABLE_CHAIN = specialized valuation -> PO.total -> supplier payable
GOLD_BY_WEIGHT_ZERO_REMAINING_DEFECT = YES
GOLD_BY_WEIGHT_ZERO_REMAINING_ROOT_CAUSE = FRONTEND_SUMMARY_WRONG_SOURCE
GOLD_BY_PIECE_ACQUISITION_CONTRACT = EXPLICIT_PER_PIECE_PURCHASE_COST
GOLD_BY_PIECE_SUPPLIER_PAYABLE_CHAIN = piece.purchaseCost -> PO.total -> supplier payable
GOLD_BY_PIECE_WORKING_PATH_ROOT_CAUSE = EXPLICIT_PIECE_COST_USED_BY_BOTH_PREVIEW_AND_NORMALIZER
GOLD_PROFILE_COMPARISON_MATRIX = COMPLETE
CERTIFICATE_OPTIONAL_CAPABILITY_ARCHITECTURE = PARTIAL
CERTIFICATE_ABSENT_ZERO_SEMANTICS = PASS
CERTIFICATE_PRESENT_ACQUISITION_FORMULA = certificateCost + certificateCost * vatRate / 100 (Gold Bar)
PURCHASE_CERTIFICATE_TO_RETAIL_LEAK = NO
DIAMOND_JEWELLERY_ACQUISITION_CONTRACT = MANUAL_PIECE_PURCHASE_COST
DIAMOND_JEWELLERY_PAYABLE_CHAIN = piece.purchaseCost -> PO.total -> payable
LOOSE_DIAMOND_ACQUISITION_CONTRACT = MANUAL_PURCHASE_COST_GENERIC_V2
LOOSE_DIAMOND_PAYABLE_CHAIN = piece.purchaseCost -> PO.total -> payable
GEMSTONE_JEWELLERY_ACQUISITION_CONTRACT = MANUAL_PIECE_PURCHASE_COST
GEMSTONE_JEWELLERY_PAYABLE_CHAIN = piece.purchaseCost -> PO.total -> payable
LOOSE_GEMSTONE_ACQUISITION_CONTRACT = BASE_PLUS_ADDITIONAL_PLUS_VAT
LOOSE_GEMSTONE_PAYABLE_CHAIN = loosePurchase.totalPurchaseCost -> PO.total -> payable
PEARL_JEWELLERY_ACQUISITION_CONTRACT = MANUAL_PIECE_PURCHASE_COST
PEARL_JEWELLERY_PAYABLE_CHAIN = piece.purchaseCost -> PO.total -> payable
LOOSE_PEARL_ACQUISITION_CONTRACT = BASE_PLUS_VAT
LOOSE_PEARL_PAYABLE_CHAIN = loosePurchase.totalPurchaseCost -> PO.total -> payable
CGP_SUPPLIER_DROPDOWN_REASON = SHARED_REGISTRY_WITHOUT_SUPPLIER_CAPABILITY_FILTER
CGP_SUPPLIER_RECEIVE_REACHABLE = NO
CGP_CANONICAL_WORKFLOW_BYPASS_RISK = LOW
PROFILE_CAPABILITY_MATRIX = COMPLETE
ASSET_COST_VS_SUPPLIER_TOTAL_MATRIX = COMPLETE
PURCHASE_TOTAL_VS_PAYABLE_MATRIX = COMPLETE
SUPPLIER_PAID_REMAINING_FLOW = PO.total minus grouped supplier_purchase cash-outs
SUPPLIER_PAYABLE_CREATION_BOUNDARY = postingService.postPurchaseEntry during receive transaction
ACCEPTANCE_FINANCIAL_MAPPING_BLOCKER = missing_or_ambiguous_active_branch_mapping_in_prior_disposable_clone
FINANCIAL_MAPPING_BLOCKS_AFTER_TOTAL_CALCULATION = YES
PURCHASE_JOURNAL_AMOUNT_AUTHORITY_MATRIX = COMPLETE
SUPPLIER_ACCOUNTING_AMOUNT_CHAIN = COMPLETE
CURRENT_VALUATION_SEPARATION_MATRIX = INCOMPLETE
ALL_PROFILE_POS_PRICING_AUTHORITY_MATRIX = INCOMPLETE
ALL_PROFILE_ZERO_PRICE_SAFETY_MATRIX = INCOMPLETE
ALL_PROFILE_MAKING_CHARGE_MATRIX = INCOMPLETE
ALL_PROFILE_TAX_MATRIX = INCOMPLETE
PROFILE_SWITCH_STALE_STATE_RISK = LOW
FRONTEND_BACKEND_TOTAL_PARITY_MATRIX = INCOMPLETE
SUPPLIER_RIGHT_RISK_MATRIX = COMPLETE
PRIMARY_GOLD_SUPPLIER_PAYABLE_DEFECT = FRONTEND_SUMMARY_WRONG_SOURCE
GOLD_BY_PIECE_VS_WEIGHT_DIFFERENCE = PIECE_COST_VS_WEIGHT_RATE
OPTIONAL_CERTIFICATE_DESIGN_HANDOFF = INCOMPLETE
CANONICAL_PURCHASE_TOTAL_DESIGN_HANDOFF = INCOMPLETE
SUPPLIER_SUMMARY_READMODEL_HANDOFF = INCOMPLETE
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
PERSISTENT_WRITES_THIS_BATCH = 0
GOLD_RUNTIME_1500_2500_PRESERVED = PASS
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO
RUNTIME_ENV_CHANGED = NO
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
CGP_RUNTIME_DISPATCHER_NONREGRESSION = FAIL_PREEXISTING_ENV_TRUE_NOT_CHANGED
GLOBAL_DISPATCHER_ENABLED = YES
MANUAL_RUNTIME_RESTART_THIS_BATCH = NO
NEXT_DEV_STARTED_OR_RESTARTED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
RECOMMENDED_IMPLEMENTATION_PLAN = SUPPLIER-ALL-ASSET-PROFILES-ACQUISITION-PAYABLE-PRICING-FIX-01
NEXT_E2E_SEQUENCE = DEFINED
SUPPLIER_ALL_ASSET_PROFILES_ACQUISITION_PAYABLE_PRICING_FORENSIC_01_GATE = BLOCKED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = SUPPLIER-ALL-ASSET-PROFILES-ACQUISITION-PAYABLE-PRICING-FIX-01
```
