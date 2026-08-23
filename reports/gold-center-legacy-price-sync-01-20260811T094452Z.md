# GOLD-CENTER-LEGACY-PRICE-SYNC-01

## التنفيذ

- النطاق: مزامنة قسم Gold Center السفلي فقط مع مصدر السوق المعياري.
- قاعدة البيانات الدائمة `darfus_erp` تم فحصها قراءة فقط؛ لم تُنفذ أي كتابة.
- لم تُشغّل Migration 81، ولم يُستخدم Next dev، ولم تُنفذ مكالمة GoldAPI حقيقية في هذه الدفعة.
- الدلالة ثبتت من `Gold Center Logic.docx`: Market Price معلومة عرضية، وApproved Price هو المسار التنفيذي؛ لذلك القسم السفلي يعرض Market Reference فقط ولا يملك سلطة CGP.

## المشكلة السابقة والمستهلكون

كان `hooks/use-gold.ts` يستدعي `/gold/karat-prices`، وكان المسار يصل إلى `gold.service.getKaratPrices` الذي يملك `GOLD_API_KEY` مختلفاً، تحويل AED ثابتاً، و`generateFallbackPrices()` عشوائياً حول 2330 USD. المستهلك الإنتاجي المباشر الوحيد هو صفحة Gold Center الحالية عبر `useGold`; الاستدعاءات الأخرى في scripts هي أدوات تحقق وليست مسار واجهة إنتاج.

## الإصلاح

- أضيف `backend/src/services/gold-center-reference-price.service.js` كمحول واحد provider-neutral.
- `GET /gold/karat-prices` في `backend/src/routes/erp.routes.js` يقرأ `gold_market_settings` و`gold_market_quotes` عبر `gold-market-admin.currentState`، ويعيد نفس envelope والحقول القديمة مع metadata: provider، `quoteType=SPOT`، `PER_GRAM`، timestamp، age، freshness، warning.
- القيم 24K/22K/21K/18K/14K تُشتق من fine-gold SPOT × karat/24 مرة واحدة. لا تُستخدم حقول CGP المباشرة ولا BID الخاص بـCGP في هذا العرض.
- عند STALE تعرض آخر قيمة مع تحذير واضح؛ عند UNAVAILABLE/NOT_CONFIGURED لا يوجد fallback عشوائي وتعود قائمة الأسعار فارغة.
- `effectiveKaratPrice` لا يصل إلى الخدمة القديمة؛ يظل السعر اليدوي المعتمد قابلاً للتوافق لمسارات fixing القديمة، وإلا يستخدم مرجع السوق المعياري.
- الواجهة تعرض الحالة والمزود ونوع الاقتباس والوحدة والعمر، ولم تعد تعرض `تغذية محاكاة`.

## الاختبارات

- `backend/tests/gold-center-legacy-price-sync.test.cjs`: PASS؛ fresh/stale/unavailable/not-configured، اشتقاق 14K، وعدم وصول GET إلى fallback.
- Gold Live Feed foundation/policy/runtime، making-charge، وTypeScript: PASS.
- `npx tsc --noEmit`: PASS.
- `git diff --check`: PASS (تحذيرات CRLF الموروثة فقط).
- Browser acceptance: لم تُشغّل لعدم وجود runtime signed-in آمن مخصص؛ لا يوجد تشغيل Next جديد.

## حفظ البيانات

Persistent pre/post (قراءة فقط): migrations 80، Assets 53، Products 3، CGP 2، Journals 67، JournalLines 176، CashTransactions 50، MarketQuotes 4. لا تغييرات في Assets/Products/CGP/Journals/Treasury، ولا quotes اصطناعية. الفحوص: journals غير المتوازنة 0، orphan journal lines 0، cash links غير المرتبطة 0، blank/duplicate barcodes 0.

## حماية

- `next-env.d.ts` لم يتغير؛ SHA الحالي هو drift المعروف `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`، ولم تتم إصلاحه تلقائياً.
- لا commit ولا push ولا deploy. كل تغييرات Git الأخرى موروثة ومحفوظة.

## القرار

`GOLD_CENTER_LEGACY_PRICE_SYNC_01_GATE = PASS_CONFIRMED`

التوصية التالية فقط: `GOLD-PROVIDER-SWITCHING-01_OR_LOCAL-PRODUCTION-SMOKE-01`، دون بدء تلقائي.

