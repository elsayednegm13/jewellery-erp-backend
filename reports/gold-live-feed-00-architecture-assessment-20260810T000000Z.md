# GOLD-LIVE-FEED-00 — تقييم معماري Read-only

## 1. سجل التنفيذ

- النطاق: `GOLD-LIVE-FEED-00`، تقييم جاهزية تنفيذ Live Gold API + Gold Center Pricing Policy فقط.
- الوضع: تحليل قراءة فقط.
- لم يتم تعديل Product Code أو migrations أو AGENTS أو handoff.
- لم يتم إنشاء أسعار ذهب، إعدادات Provider، مفاتيح API، CGP، Journal، Gold event، أو تشغيل Server/Next/Dispatcher.
- تمت قراءة `AGENTS.md` ثم `PROJECT_PROGRESS_HANDOFF.md` ثم `CGP_CANONICAL_IMPLEMENTATION_REFERENCE.md`، وبعدها وثائق العميل Gold Center وCGP وAccounting (بما فيها `Accounting شامل.docx`).

## 2. دليل Git والحماية

- Branch: `main`
- HEAD: `1657b0e9ba580faef69be48f04637835c201b521`
- Staged قبل/بعد الجولة: 0
- التغييرات المتتبعة الموروثة: 30 ملفاً
- الملفات غير المتتبعة الموروثة: 125 ملفاً
- Stashes: 11
- Remotes: لا توجد Remotes مُسجلة.
- `next-env.d.ts` الحالي هو الانحراف المعروف SHA-256 `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`؛ لم يتم إصلاحه أو إعادة توليده.

## 3. الحالة الحالية وقاعدة البيانات

تم التحقق بقراءة مباشرة مع `SELECT current_database()` من قاعدة `darfus_erp`:

| البيان | القيمة الحالية |
|---|---:|
| migrations | 77 |
| Assets | 53 |
| Products | 3 |
| gold_prices | 0 |
| approved gold_prices | 0 |
| CGP documents | 2 |
| CGP items | 4 |
| CGP pricing snapshots | 0 |
| Gold events | 0 |
| Outbox rows | 0 |

لم تُنفذ أي كتابة في أي قاعدة. عدد Assets الفعلي هو 53 ويُسجل كما هو، دون إرجاعه إلى baseline قديم.

## 4. الوضع الحالي لتسعير الذهب

المسار الاقتصادي الحالي لـCGP هو:

`cgp-posting.service.js` → `gold-price-approval.service.js` → `resolveExecutableApprovedKaratPrice`

وهو يتطلب صفاً `APPROVED` صالحاً زمنياً لكل Company/Currency/Karat، وإلا يفشل مغلقاً بالخطأ `CGP_APPROVED_GOLD_PRICE_REQUIRED`. لذلك لا يوجد حالياً CGP اقتصادي قابل للنشر المحلي؛ وهذه نتيجة أمان صحيحة.

`gold_prices` هو سجل أسعار أعمال يمر بمراحل PENDING/APPROVED/SUPERSEDED وغيرها، وليس مخزناً مناسباً لكل tick حي. كما أن الـDB يستخدم `numeric(20,8)` بينما النموذج يعلن `DECIMAL(10,4)` والـCGP snapshot يثبت معدل 4 منازل؛ هذا خطر محاذاة دقة يجب حسمه قبل التنفيذ.

المسار العام القديم في `gold.service.js` يستخدم `GOLD_API_PROVIDER` و`GOLD_API_KEY`، ويحتوي fallback عشوائياً/محاكياً عند غياب المفتاح أو فشل المزود، كما أن `erp.routes.js` يستطيع fallback إلى صف global ثم إلى `goldService.getKaratPrices`. هذا المسار غير صالح كسلطة CGP LIVE_PROVIDER ويجب عزله في التنفيذ اللاحق، لا استعماله مباشرة.

## 5. العوامل والقياس

المصدر الوحيد الحالي في `gold-purchase-measurement.service.js` يدعم:

| Karat | factor |
|---:|---:|
| 18 | 0.750000 |
| 21 | 0.875000 |
| 22 | 0.916000 |
| 24 | 1.000000 |

ويحسب `net = gross - stone` و`pureGoldWeight = net × purityFactor` باستخدام Decimal، مع رفض gross غير الموجب وstone السالب وstone غير الأصغر من gross، ورفض عدم تطابق karat/fineness. هذه السلطة يجب ألا تختلط مع عوامل `gold.service.js` العامة أو مع تطبيق purity مرتين.

## 6. التصميم المقترح الجاهز للتنفيذ

### 6.1 طبقات السلطة

1. **Raw/Normalized Market Quote**: حقيقة السوق (provider، metal، currency، unit، base purity، spot، bid، ask، timestamps، provider quote ID، payload hash، quality).
2. **Business Pricing Policy**: اختيار BID/SPOT/ASK ونوع التعديل وقيمته وإصداره ونطاق Company.
3. **Effective CGP Rate**: معدل شراء محسوب backend فقط بعد freshness/capability/currency/policy validation.
4. **Immutable Posting Snapshot**: snapshot لكل item يحفظ quote lineage وpolicy version وeffective rate؛ لا يتغير بعد Posting.

`Market Quote ≠ CGP Business Buy Rate`. لا يثق Posting بقيمة الواجهة.

### 6.2 abstraction وتبديل Provider

يُضاف لاحقاً `GoldMarketProvider`/Registry داخلي محايد، مع adapters مثل `GOLDAPI` و`METALS_API` وواجهة `fetchQuote(metal,currency)` وhealth/capabilities. اختيار المزود من إعداد غير سري؛ تبديله لا يتطلب تغيير CGP code، ويؤثر على الأسعار المستقبلية فقط. لا يوجد automatic failover.

### 6.3 الإعدادات والأسرار

- DB: provider selection، enabled، currency، refresh interval، stale threshold، health، last success/failure، والسياسة.
- Deployment secret store/env فقط: مفاتيح المزود، مثلاً `GOLD_MARKET_PROVIDER_<PROVIDER>_API_KEY`، ولا تُحفظ في DB أو response أو logs أو audit أو frontend.
- `test-connection` ينفذ server-side ويعيد status/capabilities/latency دون المفتاح.

### 6.4 السياسة

- `GOLD_PRICING_MODE = MANUAL_APPROVED | LIVE_PROVIDER`.
- الوضع المرغوب للإنتاج `LIVE_PROVIDER`; `MANUAL_APPROVED` يبقى وضعاً صريحاً للطوارئ فقط إذا وافق Owner، وليس fallback تلقائياً.
- base quote: `BID`, `SPOT_OR_MARKET`, `ASK`؛ غياب القدرة المطلوبة يفشل مغلقاً، ولا يستبدل BID بـSPOT بصمت.
- adjustment: `NONE`, `FIXED_PER_GRAM`, `PERCENTAGE`.
  - fixed: `effective = base + signedAdjustmentPerGram`.
  - percentage: `effective = base × (1 + signedPercent/100)`.
- سياسة global لكل karats مع per-karat override اختياري؛ Company-scoped، وليست Branch-scoped.
- effective time/version/approval واضحان؛ يُوصى maker/checker وبصلاحية مستقلة للسياسة.

### 6.5 العملة والوحدة والـKarat

- عملة quote يجب أن تساوي عملة CGP document حرفياً؛ لا FX غير معتمد، وإلا fail closed.
- adapter يطبع PER_TROY_OUNCE أو PER_GRAM إلى PER_GRAM مع base purity و31.1034768، ولا يضع تحويل الوحدات في CGP.
- سلطة واحدة للـKarat: direct provider per-karat إذا كانت موثوقة، وإلا normalized 24K/fine quote × عوامل `gold-purchase-measurement.service.js`; لا مزج بين المسارين.
- Pure Gold canonical هو 999.9؛ لا 995.

### 6.6 freshness/outage/refresh

- server time هو الساعة المرجعية.
- age ضمن stale threshold ⇒ eligible؛ بعده STALE ويُحظر CGP Posting بخطأ صريح.
- حالات مقترحة: HEALTHY، DEGRADED، STALE، UNAVAILABLE، AUTH_ERROR، RATE_LIMITED.
- polling مركزي عبر BullMQ/Redis الموجود، دورة واحدة لكل provider/currency، مع read/cache مشترك. لا frontend pulls ولا external call لكل CGP. لا يتم تشغيل worker في هذه الجولة.
- retention bounded/sampled، ولا تُحذف quote rows المرتبطة بـsnapshots؛ سياسة الاحتفاظ قرار Owner/Operations.

### 6.7 الجداول المقترحة (لا Migration الآن)

`gold_market_quotes`: id، provider، metal، company scope عند الحاجة، currency، unit، base purity، quoteTimestamp، receivedAt، spot/bid/ask، providerQuoteId، rawPayloadHash، quality/status، createdAt؛ فهارس provider/currency/quoteTimestamp، وFK snapshot عند الربط.

`gold_market_settings`: provider غير سري، enabled، market currency، refresh/stale intervals، health، last success/failure، version/audit.

`gold_pricing_policies`: company، mode، baseQuoteType، adjustmentType/value، effectiveFrom/Until، version، approval/audit؛ optional karat overrides child/JSONB بعد قرار schema.

يمتد `cgp_pricing_snapshots` لاحقاً ليربط quote ID وpolicy ID/version وeffective rate/provider lineage، مع بقاء `gold_prices` سلطة MANUAL_APPROVED فقط.

## 7. الواجهات المقترحة

مسارات لاحقة متوافقة مع convention بعد تثبيت الأسماء: قراءة live prices وprovider health، قراءة/تعديل policy، قراءة/تعديل provider settings، test-connection، وقراءة quote history. واجهة Gold Center تتضمن Settings → Market Data Provider، Live Prices (provider/age/health/bid/ask/spot)، وPricing Rules (mode/base quote/adjustment/overrides/effective version). لا تُنفذ الآن.

## 8. Posting والتاريخ

قبل Posting يعيد backend التحقق من provider capability، العملة، freshness، policy version، ثم يحسب rate ويثبت snapshot لكل item. بعد Posting لا يتغير snapshot مع تبديل المزود أو السياسة أو السوق. Reversal يستخدم snapshot الأصلي ولا يعيد التسعير من live market. Settlement لا يعيد التسعير.

## 9. صلاحيات وتدقيق

يوجد حالياً `gold.update` و`gold.approve_price` ولا توجد صلاحيات مستقلة لإدارة provider/policy. يُوصى لاحقاً بـ`gold.manage_market_provider` و`gold.manage_pricing_policy` مع maker/checker أو قرار Owner باستخدام `gold.approve_price`; لا hardcoded job title. كل تبديل provider أو policy يسجل actor/old/new/time/company/test result.

## 10. مقارنة المزودين

- **GoldAPI.io**: وثائقه الرسمية تعرض XAU/AED، timestamp، bid/ask، per-gram وper-karat، ولذلك هو المرشح التقني الأول فقط وليس اختياراً إنتاجياً مجمداً. [الوثائق الرسمية](https://www.goldapi.io/)
- **Metals-API**: وثائقه الرسمية تعرض XAU، bid/ask وختم الزمن وتواتر تحديث يعتمد على الخطة؛ يحتاج adapter وتحقق capability/وحدة/عملة. [الوثائق الرسمية](https://www.metals-api.com/documentation)
- **GoldPriceAPI**: لم يُعثر على وثائق رسمية موثوقة في هذا البحث، لذلك حالته `UNVERIFIED`.

لا شراء/اشتراك/حساب أو مفاتيح في هذه الجولة.

## 11. المخاطر الحالية

1. fallback عشوائي/قديم في `gold.service.js` لا يجوز أن يصبح سلطة اقتصادية.
2. fallback global في `erp.routes.js` يجب ألا يختلط بسلطة CGP LIVE_PROVIDER.
3. mismatch دقة DB/model/snapshot.
4. لا توجد حالياً gold market quote/settings/policy tables.
5. لا توجد policy أو provider permissions مستقلة.
6. الاختبارات الحالية تفترض صف `gold_prices` Approved ويجب تحديثها في batch التنفيذ.

## 12. الملفات المتأثرة لاحقاً

Backend: `backend/src/services/gold.service.js`، `backend/src/services/gold-price-approval.service.js`، `backend/src/services/cgp-posting.service.js`، `backend/src/services/cgp-pricing-snapshot.service.js`، `backend/src/services/gold-purchase-measurement.service.js`، `backend/src/routes/erp.routes.js`، `backend/src/routes/gold.routes.js`، نماذج/مهاجرات Gold الجديدة، queue/worker وpermission catalog.

Frontend: `app/[locale]/(dashboard)/gold-center/page.tsx`، `hooks/use-gold.ts`، `features/dashboard/components/gold-market-widget.tsx`، وGold Center settings/policy components لاحقاً.

Verifiers/tests المتأثرة: `backend/scripts/verify-cgp-approved-price-authority.js`، `verify-cgp-imp-01.js`، `verify-cgp-imp-03.js`، `verify-cgp-imp-06.js`، `verify-gold-prices-tenant.js`، `run-cgp-e2e-final-acceptance.js`، `tests/cgp-imp-01-contract.test.cjs`.

## 13. مراحل التنفيذ المقترحة

1. `GOLD-LIVE-FEED-01_PROVIDER_ABSTRACTION_AND_NORMALIZED_QUOTE_FOUNDATION`
2. `GOLD-LIVE-FEED-02_PROVIDER_ADAPTER_POLLING_HEALTH_AND_READ_API`
3. `GOLD-LIVE-FEED-03_PRICING_POLICY_EFFECTIVE_RATE_ENGINE`
4. `GOLD-LIVE-FEED-04_CGP_POSTING_LIVE_SNAPSHOT_INTEGRATION`
5. `GOLD-LIVE-FEED-05_GOLD_CENTER_SETTINGS_LIVE_PRICES_PRICING_RULES_UI`
6. `GOLD-LIVE-FEED-06_E2E_ACCEPTANCE_AND_LOCAL_PRODUCTION_CONFIGURATION`

## 14. قرارات Owner المطلوبة قبل التنفيذ

A. Production provider (GoldAPI.io أو Metals-API).
B. `CGP_PRICING_MODE = LIVE_PROVIDER`.
C. `CGP_BASE_QUOTE_TYPE` (BID أو SPOT؛ التوصية BID لكنها غير مجمدة).
D. نوع التعديل الافتراضي.
E. قيمة التعديل الافتراضي.
F. per-karat override.
G. refresh interval.
H. stale threshold.
I. market outlier policy.
J. تفعيل MANUAL_APPROVED emergency mode.
K. إلزام approval للـpricing policy.
L. permission/approval لتبديل provider.
M. quote retention.

لا حاجة لطلب أسعار 18K/21K/22K/24K يدوياً لوضع LIVE_PROVIDER.

## 15. بوابة الخروج

التقييم implementation-ready: abstraction، switching، secret handling، quote/policy/snapshot layers، freshness، precision، reversal/settlement، schema/API/UI impact، واختبارات المتأثرين محددة. لا توجد قرارات مبهمة تمنع تصميم العقد، لكن تفعيل الإنتاج ينتظر قرارات Owner أعلاه.

CURRENT_BATCH = GOLD-LIVE-FEED-00
PERSISTENT_DATABASE = darfus_erp
PERSISTENT_MIGRATIONS = 77
PERSISTENT_ASSETS_ACTUAL = 53
PERSISTENT_DB_WRITES_THIS_BATCH = 0
MIGRATIONS_THIS_BATCH = 0
BUSINESS_CONFIG_WRITES_THIS_BATCH = 0
CURRENT_GOLD_PRICE_MODE = MANUAL_APPROVED_AUTHORITY_ONLY (no live provider wired to CGP)
CURRENT_GOLD_PRICES_ROW_COUNT = 0
CURRENT_APPROVED_GOLD_PRICES_ROW_COUNT = 0
CURRENT_CGP_GOLD_PRICE_BLOCKER = CGP_APPROVED_GOLD_PRICE_REQUIRED
SUPPORTED_CGP_KARATS = [18,21,22,24]
PROPOSED_GOLD_PRICING_MODES = MANUAL_APPROVED,LIVE_PROVIDER
NORMAL_PRODUCTION_TARGET_MODE = LIVE_PROVIDER
PROPOSED_PROVIDER_ABSTRACTION = PASS
PROVIDER_SWITCH_WITHOUT_CGP_CODE_CHANGE = YES
PROVIDER_API_SECRET_STORAGE = DEPLOYMENT_ENV_OR_SECRET_STORE_ONLY; e.g. GOLD_MARKET_PROVIDER_<PROVIDER>_API_KEY
PROVIDER_SETTINGS_DB_SECRET_FREE = YES
LIVE_MARKET_QUOTE_SEPARATE_FROM_GOLD_PRICES = YES
PROPOSED_MARKET_QUOTE_STORAGE = gold_market_quotes
PROPOSED_PRICING_POLICY_STORAGE = gold_market_settings + gold_pricing_policies (+ karat overrides)
CGP_BASE_QUOTE_TYPE_OPTIONS = BID,SPOT_OR_MARKET,ASK
CGP_RECOMMENDED_BASE_QUOTE_TYPE = OWNER_DECISION_REQUIRED (owner suggestion is BID)
ADJUSTMENT_TYPES = NONE,FIXED_PER_GRAM,PERCENTAGE
GLOBAL_POLICY_WITH_PER_KARAT_OVERRIDE = YES
QUOTE_CURRENCY_RULE = exact CGP document currency; no unapproved FX; fail closed
QUOTE_UNIT_NORMALIZATION = provider adapter normalizes PER_TROY_OUNCE/PER_GRAM to PER_GRAM with base purity and 31.1034768 constant
KARAT_RATE_DERIVATION = one authority only; direct provider per-karat if reliable else normalized 24K/fine quote × canonical purity factors; no mixing
PURE_GOLD_CANONICAL = 999.9
PURE_GOLD_995_AUTHORITY = NO
QUOTE_REFRESH_EXECUTION_MODEL = existing BullMQ/Redis centralized backend refresh worker, single cycle per provider/currency; no frontend pulls
QUOTE_REFRESH_INTERVAL_OWNER_DECISION = YES
QUOTE_STALE_THRESHOLD_OWNER_DECISION = YES
STALE_QUOTE_BLOCKS_CGP_POSTING = YES
AUTOMATIC_PROVIDER_FAILOVER = NO_NOT_AUTHORIZED
MANUAL_APPROVED_AUTOMATIC_FALLBACK = NO
POSTING_REVALIDATES_QUOTE = YES
FRONTEND_RATE_IS_FINANCIAL_AUTHORITY = NO
POSTED_PRICING_SNAPSHOT_IMMUTABLE = YES
POSTED_SNAPSHOT_INCLUDES_PROVIDER_LINEAGE = YES
REVERSAL_REPRICES_FROM_LIVE_MARKET = NO
SETTLEMENT_REPRICES_FROM_LIVE_MARKET = NO
FINAL_EFFECTIVE_RATE_PRECISION_RECOMMENDATION = 4_DECIMALS_UNTIL_SEPARATE_PRECISION_DECISION
MARKET_RAW_QUOTE_HIGHER_PRECISION_ALLOWED = YES
PROVIDER_WEB_RESEARCH = DONE_OFFICIAL_DOCS_ONLY
TECHNICALLY_COMPATIBLE_PROVIDER_CANDIDATES = GOLDAPI_IO, METALS_API; GOLDPRICEAPI_UNVERIFIED
PRODUCTION_PROVIDER_OWNER_DECISION_REQUIRED = YES
PRICING_POLICY_APPROVAL_OWNER_DECISION_REQUIRED = YES
MARKET_OUTLIER_POLICY_OWNER_DECISION_REQUIRED = YES
MANUAL_EMERGENCY_MODE_OWNER_DECISION_REQUIRED = YES
LOCAL_UI_SCHEMA_SMOKE_READY = YES
LOCAL_REAL_CGP_ECONOMIC_SMOKE_READY = NO_UNTIL_LIVE_FEED_IMPLEMENTED_AND_CONFIGURED
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
GOLD_LIVE_FEED_00_GATE = PASS_CONFIRMED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_BATCH = GOLD-LIVE-FEED-01_PROVIDER_ABSTRACTION_AND_NORMALIZED_QUOTE_FOUNDATION
