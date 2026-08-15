# POS Asset Status Mapping — Surgical Correction 01

## Executive summary

تم إصلاح خلل تعاقدي ضيق في POS: نتيجة البحث ترجع حالة الأصل في `rawItem.operationalStatus` بقيم canonical مثل `AVAILABLE`، بينما اختيار السطر وفحص ما قبل البيع كانا يقرآن `status` فقط. أُضيف normalization واحد عند حدود اختيار نتيجة البحث إلى عقد الـcart الموجود (`available`/القيمة lower-case). لم يتغير backend أو سياسة الإتاحة أو payload checkout.

## Previous blocker

التدفق السابق كان يتوقف بعد `/pos/search` و`pricing/calculate` وقبل `/pos/checkout` لأن الحالة كانت `undefined` في سطر الـcart. هذا هو `POS_SEARCH_RESULT_STATUS_CONTRACT_MISMATCH` المثبت في تقرير closeout السابق.

## Proven root cause

| Layer | Field | Example | Authority | Used by | Problem |
|---|---|---|---|---|---|
| Backend `/pos/search` | `rawItem.operationalStatus` | `AVAILABLE` | Asset canonical operational status | frontend result | لا يوجد top-level `status` للأصل |
| Frontend selection | `asset.operationalStatus` | `AVAILABLE` | نفس backend authority | `handleItemClick` | كان يُحفظ `asset.status` فقط |
| Cart/pre-check | `item.status` | `available` | existing POS contract | `completeSale` | لم تصل له الحالة |
| Checkout | existing payload | unchanged | existing sale API | backend | لا يوجد contract change |

## Safety boundary

Persistent وAcceptance ظلّا read-only. كل الكتابة التشغيلية حدثت داخل Disposable Clone فقط عبر الـruntime harness الموجود من الباتش السابق. لا migration Persistent/Acceptance، ولا تغيير Invoice Snapshot أو Customer أو Accounting/Inventory/Payment/VAT/Gold/Pricing/Making Charge.

## Worktree baseline

- Branch: `main`
- HEAD: `1657b0e9ba580faef69be48f04637835c201b521`
- Worktree كان يحتوي inherited changes كثيرة؛ لم يتم reset/restore/clean/stash.
- `package.json` hash: `F9DB91B73D622BD366D678F4A49863527AADF8AB8CDC52D858A6877A5157563A`
- `package-lock.json` hash: `6F14A84A411014CD5F4B785592994E5B50E791925AF52C42EF7EEEDBFA08C6DC`
- `next-env.d.ts` hash ظل inherited drift: `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`

## Backend `/pos/search` contract

الـroute يظل branch/company scoped، ويستخدم `operationalStatus` في `assetWhere` ويضعه في `rawItem`. لم يتغير الملف `backend/src/routes/erp.routes.js`.

## Frontend contract / `handleItemClick`

أُضيفت دالة `normalizePosAssetStatus` في `app/[locale]/(dashboard)/pos/page.tsx`، وتُستخدم مرة واحدة عند بناء cart line:

```ts
status: normalizePosAssetStatus(asset.operationalStatus ?? asset.status)
```

القيمة المفقودة أو غير المعروفة ترجع `undefined`، ولذلك يظل `completeSale` fail-closed (`assetStatus !== "available"`). لا يوجد hardcode لـ`AVAILABLE` ولا fallback إلى available.

## Correction decision

- `STATUS_MAPPING_FIX_LOCATION = handleItemClick boundary`
- `STATUS_MAPPING_STRATEGY = BOUNDARY_NORMALIZATION`
- `BROAD_STATUS_REFACTOR = NO`
- `STATUS_ELIGIBILITY_RULES_CHANGED = NO`
- `CLIENT_STATUS_AUTHORITY_EXPANDED = NO`

## Files changed

| File | Before role | Exact change | Why | Business logic changed? | API changed? | Tests | Rollback |
|---|---|---|---|---|---|---|---|
| `app/[locale]/(dashboard)/pos/page.tsx` | Maps selected Asset into cart | Normalize canonical `operationalStatus` into existing lower-case `status` contract | Remove proven field mismatch | No | No | focused/static + TypeScript + browser Clone | revert the two-line helper/use change |
| `backend/tests/pos-asset-status-mapping-surgical-correction.test.cjs` | none | Focused contract tests for mapping, fail-closed statuses, and backend authority | Prevent regression | No | No | 3/3 | delete test file only if Owner requests |
| `backend/reports/pos-asset-status-mapping-surgical-correction-01-20260815T083208Z.md` | none | Evidence report | Owner review | No | No | n/a | documentation-only |

`backend/src/routes/erp.routes.js` لم يتغير. الملفات الأخرى في `git status` inherited من مراحل سابقة وليست ناتجة عن هذا الباتش.

## Available / unavailable status proof

- Available Asset: `/pos/search` 200، selection succeeded، pricing 200، والـexisting pre-check لم يعد يرفض السطر.
- Sold/unavailable: mapping test يثبت أن `SOLD` وأي non-available value لا تصبح eligible؛ exact unavailable search rows تظل disabled حسب الاختبار الموجود.
- Missing/unknown: normalization يرجع `undefined`، والـpre-check يرفضها.
- Wrong branch: route remains constrained by `companyId: req.companyId` و`branchId`، واختبار universal search يثبت branch scoping؛ لا سياسة جديدة.

## Browser and network proof

استُخدم Disposable Clone + temporary frontend/backend ports. evidence directory:

`backend/reports/customer-invoice-snapshot-clone-full-stack-runtime-closeout-01-evidence-20260815T052830940Z`

الـsanitized network أثبت:

- `GET /api/v1/pos/search?...` → `200`
- `POST /api/v1/pricing/calculate` → `200`
- `POST /api/v1/pos/checkout` → `201`

الـcheckout response وصل فعلاً بعد إزالة blocker. الـharness توقّف لاحقاً عند verification خاص بـInvoice Snapshot بسبب schema قديم في الـClone (`column "customerName" does not exist`)، وهذا ليس خللاً في status mapping ولا تم إصلاحه هنا. لا توجد كتابة في Persistent أو Acceptance.

## Checkout / domain freeze

- `POS_CHECKOUT_CONTRACT_CHANGED = NO`
- `INVOICE_SNAPSHOT_PRODUCT_LOGIC_CHANGED = NO`
- `POS_CUSTOMER_SUMMARY_CHANGED = NO`
- `CUSTOMER_BUSINESS_LOGIC_CHANGED = NO`
- Accounting/Inventory/Payment/VAT/Pricing/Gold/Making Charge: unchanged.

## Tests

- Focused status mapping/search/selection/pre-check/static tests: **15/15 PASS** (new mapping test 3/3; universal search 4/4; existing complete-sale resolver 8 assertions).
- Existing Invoice Snapshot implementation contract: **5/5 PASS**.
- TypeScript: `npx tsc --noEmit --pretty false` **PASS**.
- Focused ESLint: **0 errors**, existing warnings فقط.
- Browser Clone proof: status blocker removed and `/pos/checkout` reached with `201`; full Snapshot closeout remains a separate retry task.

## Persistent / Acceptance safety

Read-only fingerprints before/after remained unchanged:

- Persistent `darfus_erp`: migrations 80, customers 2, invoices 15, payments 30, journal entries 81, journal lines 209, cash transactions 58, assets 62; unbalanced/orphan/unlinked checks all 0.
- Acceptance `darfus_erp_inventory_rehearsal_20260804_160500z`: migrations 80, customers 3, invoices 133, payments 122, journal entries 497, journal lines 1423, cash transactions 173, assets 475; unbalanced/orphan/unlinked checks all 0 (inherited duplicate treasury-link count remains 1).
- Disposable Clone was dropped; no batch Clone remains.

## Package / environment / process

`package.json`, `package-lock.json`, `.env*`, and `next-env.d.ts` were not edited. Normal frontend/backend processes were not restarted or killed. No Git write, commit, push, deploy, or migration occurred. Temporary frontend/backend and Clone were cleaned after the run.

## Gate

`POS_ASSET_STATUS_MAPPING_SURGICAL_CORRECTION_01_GATE = PASS_OWNER_REVIEW_READY`

The gate covers the surgical mapping correction and the browser proof that the former local blocker is removed. The later Snapshot full-stack closeout must be rerun separately because its post-check still has the pre-existing `customerName` schema mismatch.

## Owner review / next step

الـOwner يراجع فقط أن Available item يصل إلى الـcheckout وأن Sold/unavailable/missing/unknown تظل fail-closed. لا يبدأ retry تلقائياً.

`NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START`

`NEXT_RECOMMENDED_STEP = CUSTOMER-INVOICE-SNAPSHOT-CLONE-FULL-STACK-RUNTIME-CLOSEOUT-01-RETRY-AFTER-POS-STATUS-FIX`
