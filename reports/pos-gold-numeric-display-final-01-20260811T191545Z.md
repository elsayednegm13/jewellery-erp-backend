# POS-GOLD-NUMERIC-DISPLAY-FINAL-01

## النطاق والنتيجة

- إصلاح عرضي/تطبيع إدخال فقط لمسارات Gold وPOS؛ لا تغيير في السعر أو الحساب أو API أو checkout أو قاعدة البيانات.
- `POS_GOLD_NUMERIC_DISPLAY_FINAL_01_GATE = PASS_CONFIRMED`.
- RTL بقي مفعلاً؛ لم يتم فرض LTR على الصفحة.

## السبب الجذري والملفات

- Gold dashboard كان يستخدم formatter محليًا بدقة ثابتة ومن دون عزل bidi؛ بعض Gold Center/rate paths كانت تعرض القيم الخام.
- POS كان يحتوي على `type="number"` ومدخلات لا تمر كلها عبر `normalizeNumberInput`، كما أن currency strings لم تكن معزولة عن RTL.
- أضيفت السلطات العرضية المركزية:
  - `components/ui/numeric-token.tsx`: `bdi dir="ltr"` و`unicode-bidi:isolate` مع `toEnglishDigits`.
  - `components/ui/numeric-input.tsx`: text-backed decimal/numeric input مع normalization قبل callback.
  - `.numeric-token` في `app/globals.css`.
  - `normalizeNumberInput` يدعم أيضًا Arabic decimal separator `٫`.
- تم ربطها في POS، Gold dashboard card، وGold Center؛ لم تتم إضافة formatter منافس أو تغيير في helper المالي.

## التحقق المرئي

- Dashboard Gold browser acceptance: 24K/22K/21K/18K/14K ظهرت بأرقام ASCII، و`bdi` computed style = `direction:ltr`, `unicode-bidi:isolate`، ولا توجد Arabic/Persian digits.
- POS browser acceptance: Making Charge / Gram وStone/Gem Value وAdditional Discount ظهرت كـASCII text inputs؛ summary/VAT/total ظهرت بأرقام ASCII، وcurrency strings بقيت معزولة عبر Unicode bidi isolates.
- إدخال `٧` ظهر `7`، و`٨`/`۱۲۳` ظهرت `8`/`123`؛ إدخال ASCII decimal `12.34` بقي `12.34`. لم يتم checkout أو حفظ معاملة.
- Arabic layout بقي RTL (`GLOBAL_LTR_FORCED = NO`).

القيم المرئية الفعلية في نفس القراءة كانت 24K `516.22164311`، 22K
`473.20317285`، 21K `451.69393772`، 18K `387.16623233`، 14K
`301.12929181`. لم يتغير مصدرها أو حسابها؛ التغيير اقتصر على formatter/token.

## حفظ القيم والعقود

- `formatEnglishNumber` يضمن `numberingSystem: latn`، والقيم المصدرية لم تتغير.
- Making-charge formula، stone value، discount، tax، subtotal، total، Gold provider، وCGP policy لم تتغير.
- Gold بقي `GOLDAPI_IO / LIVE_PROVIDER / AED / refresh 1500 / stale 2500`، وCGP `BID/NONE/0`.

## الاختبارات

- `npx tsc --noEmit` — PASS.
- `node scripts/verify-pos-gold-numeric-display-final-01.js` — PASS.
- `node scripts/verify-local-runtime-dashboard-numeral-date-fix.js` — PASS.
- Gold suite — 27/27 PASS.
- Gold making-charge contract — PASS (`10 × 100 = 1000`, `8.75 × 100 = 875`).
- CGP IMP-11 contract — PASS.
- CONT53 D01/D11 contract — PASS.
- `git diff --check` — PASS (تحذيرات CRLF inherited فقط).

## قاعدة البيانات والسلامة

قراءة SELECT-only إلى `darfus_erp` في نفس الجلسة أثبتت:

| المقياس | قبل هذه الجولة | بعد هذه الجولة |
|---|---:|---:|
| migrations | 80 | 80 |
| Assets | 53 | 53 |
| Products | 3 | 3 |
| Customers | 1 | 1 |
| CGPs | 2 | 2 |
| Invoices | 13 | 13 |
| Journals | 67 | 67 |
| JournalLines | 176 | 176 |
| CashTransactions | 50 | 50 |
| Gold quotes | 100 | 102 |

Gold quote delta طبيعي من worker؛ لا توجد معاملات اصطناعية. duplicate/empty barcodes = 0، unbalanced journals = 0، orphan journal lines = 0، unlinked treasury = 0. لا migration 81، ولا DB/business writes.

## Git / runtime

- Branch `main`، HEAD `1657b0e9ba580faef69be48f04637835c201b521`.
- لا staging، لا commit، لا push، لا server/SSH/deploy، ولا Next restart/dev.
- inherited worktree dirty state محفوظ كما هو؛ ملفات هذا الباتش العرضية فقط هي ملفات numeric token/input، POS/Gold presentation، helper normalization، verifier، وهذا التقرير.
- `next-env.d.ts` لم يتغير؛ SHA الحالي الموروث `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.

## Required gate

`POS-GOLD-NUMERIC-DISPLAY-FINAL-01 = PASS_CONFIRMED`

Next: `OWNER_FRESH_LOGIN_VERIFICATION_THEN_LOCAL-PRODUCTION-SMOKE-01-RETRY_IF_PASS` — لا يبدأ تلقائيًا.
