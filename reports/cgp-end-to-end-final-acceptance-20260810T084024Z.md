# قبول CGP النهائي المتكامل وتسليم المشروع

## النطاق والحماية

- الدفعة: `CGP-END-TO-END-FINAL-ACCEPTANCE-AND-HANDOFF`.
- لم يتغير Product Code ولم تُنشأ migration.
- قاعدة القبول الأصلية بقيت للقراءة فقط: `darfus_erp_inventory_rehearsal_20260804_160500z`.
- القاعدة الدائمة بقيت للقراءة فقط: `darfus_erp`.
- أُنشئ clone قابل للحذف فقط: `darfus_erp_cgp_e2e_final_1786351092263_aa0317e9`، من القبول عند migration `77`، ثم حُذف. تعذر `CREATE DATABASE ... TEMPLATE` بسبب جلسة خارجية على القبول؛ لم تُنهَ تلك الجلسة. استُخدمت بدلًا منه نسخة منطقية قراءة-فقط من القبول إلى clone الجديد.

## مصادر القرار المعاد مراجعتها

- `7- Customer Gold Purchase Invoice.docx`: Sales entry، `DRAFT → VALIDATED → POSTED`، لا Asset/Accounting قبل Posting، immutability، والتعويض بدل الحذف.
- `Gold Purchase (CGP - IGP).docx`: ملكية Inventory بعد Posting، `PENDING_INTEGRATION` ثم `AVAILABLE`، المسار event-first، والحالة/التاريخ.
- `7- Customers CRM.docx`: Customer history/timeline projection دون امتلاك الحقيقة المالية.
- `Gold Center Logic.docx`: Gold Event Store غير قابل للتعديل، Event/retry/replay، والتعويض additive.
- `Accounting.docx` و`Accounting شامل.docx`: Accounting/Treasury ownership، Customer Creditor، settlement، journal وعكسه بالتعويض.

## الشاهد المتكامل المؤقت

- الوثيقة: `CGPD-000083`، marker: `CGP_E2E_FINAL_ACCEPTANCE:PRIMARY_MIXED`.
- قطعة واحدة = item واحد = Asset واحد: `CGPA-af031c73cbce4d519db7f5469a`.
- Barcode: `GODGOF21000296`؛ RFID غير معرّف على هذه القطعة، ولم ينشئ الاختبار أي بديل أو Barcode آخر.
- الوزن: gross `8.000000`، stone `0.100000`، net `7.900000`، pure `6.912500`.
- snapshot karat-specific approved rate ثابت؛ قيمة السطر = net × approved karat rate، دون تطبيق purity نقديًا مرتين.
- قيمة الشراء الأصلية: `3413.5900` AED.

## رحلة الأعمال المثبتة

1. أُنشئت Draft ثم Validated عبر خدمة CGP الفعلية، وتأكد عدم وجود Asset أو Journal قبل Posting.
2. تم Posting فعلي إلى `POSTED` مع `CustomerGoldPurchasePostedEvent v1` واحد دائم.
3. عولج الحدث نفسه صراحة في Inventory وAccounting وGold Center دون تشغيل global dispatcher.
4. أنشأ Inventory Asset واحدًا بخط lineage إلى CGP item، ثم اجتاز hard gate إلى `AVAILABLE` بعد hard facts.
5. أنشأ Accounting Journal acquisition متزنًا وCustomer Creditor؛ أنشأ Gold Center acquisition event واحدًا؛ وأنشأ CRM purchase history/timeline واحدًا. إعادة CRM purchase لم تضف أثرًا.
6. نُفذت تسوية `MIXED`: Cash `1.0000` وBank `1.0000` مع bank reference، بإجمالي paidAmount `2.0000` من executed allocations فقط.
7. طُلب reversal ثم حُوّل الأصل إلى `REVERSAL_PENDING` عبر canonical hold؛ بقيت الوثيقة `POSTED` حتى اكتمال التعويضات.
8. حُقن فشل Accounting داخل clone: رفض finalizer وبقي Asset `REVERSAL_PENDING`، ثم نجحت إعادة المحاولة دون أثر مكرر.
9. أنشأ Accounting compensation Journal واحدًا متزنًا: Customer Creditor المتبقي ثم Accounts Receivable بمقدار المدفوع فقط، مقابل Inventory Asset. لا Cash/Bank recovery.
10. أنشأ Gold Center compensation event واحدًا additive باستخدام snapshot التاريخي، دون current-price lookup.
11. نجح atomic finalizer: الوثيقة `REVERSED`، الطلب `COMPLETED`، والأصل نفسه `REVERSED`، و`CustomerGoldPurchaseReversedEvent v1` واحد.
12. حُقن فشل CRM بعد finalization: بقيت hard facts النهائية صحيحة؛ ثم نجحت إعادة CRM reversal مرة واحدة، وإعادة التشغيل لم تضف projection.

## النتائج النهائية للشاهد

- Customer Creditor residual: `0.0000`.
- Accounts Receivable: `2.0000`، يساوي paidAmount.
- Treasury reversal effects: `0`؛ صفوف payout/settlement الأصلية بقيت محفوظة.
- Gold acquisition event: واحد؛ Gold compensation event: واحد.
- final Reversed event: واحد؛ لا Journal تعويض مكرر ولا CRM projection مكرر.
- Asset النهائي غير قابل للبيع/الحجز/التحويل أو الاستعمال التشغيلي بسبب `REVERSED`.
- replay/idempotency: passed للـCRM purchase، Accounting compensation، finalizer، وCRM reversal؛ كما ثبت fail-closed hard failure/retry وsoft CRM failure/retry.

## regression and integrity

| التحقق | النتيجة |
|---|---|
| `verify-cgp-imp-10 --verify-existing` | PASS |
| `verify-cgp-imp-10a --verify-existing` | PASS |
| `verify-cgp-imp-09 --verify-existing` | PASS |
| `verify-cgp-imp-04 --verify-existing` | PASS |
| `verify-cgp-imp-05a` | PASS |
| `verify-cgp-imp-09a` (بدون exercise write) | PASS |
| `verify-cgp-imp-11` وunknown-event/global-dispatcher protection | PASS |
| `npx tsc --noEmit` | PASS |
| `git diff --check` | PASS (تحذيرات CRLF موروثة فقط) |

الـE2E المعزول أعاد إثبات Draft/Validation/Posting/Event/Inventory/Accounting/Gold/CRM/Settlement/Hold/Compensation/Finalizer، بما يغطي مراحل IMP01–IMP10 وظيفيًا دون أي كتابة جديدة في القبول الأصلي. لم يطالب أو يغيّر أي Outbox غير تجريبي؛ global dispatcher بقي OFF.

## تحقق القبول الأصلي والدائمة بعد الاختبار

- القبول الأصلي: migrations `77`؛ `CGPD-000071 = REVERSED`، reversal request `COMPLETED`، Asset `REVERSED`، final event `1`، Accounting compensation Journal المتزن `1`، Gold compensation `1`، Treasury reversal `0`، unbalanced/orphan journal lines `0`.
- الدائمة: migrations `61`، Assets `52`، Products `3`، unbalanced journals `0`، orphan journal lines `0`، unlinked Treasury `0`.
- لا توجد قواعد `darfus_erp_cgp_e2e_final_*` بعد التنظيف.
- `next-env.d.ts` بقي SHA-256 `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` ولم يُعدّل.

## قرار البوابة

`CGP_END_TO_END_FINAL_ACCEPTANCE = PASS`

`CGP_END_TO_END_GATE = PASS_CONFIRMED`

`CGP_PROJECT_STATUS = BACKEND_END_TO_END_COMPLETE_FOR_IMPLEMENTED_CGP_SCOPE`
