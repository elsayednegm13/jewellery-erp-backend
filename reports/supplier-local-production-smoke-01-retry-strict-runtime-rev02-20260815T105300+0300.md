# SUPPLIER-LOCAL-PRODUCTION-SMOKE-01-RETRY-STRICT-RUNTIME-REV02

## Executive summary

تم تنفيذ smoke اختبار read-only على الـruntime المحلي الطبيعي فقط. تم التحقق من أن الـfrontend على المنفذ 3000 والـbackend على 8000 يعملان، وأن backend متصل فعليًا بقاعدة `darfus_erp`. تم فتح قائمة الموردين، صفحة مورد موجود، سجل أوامر الشراء والاستلام، نموذج الاستلام مع تبديل profiles، ثم POS والعملاء. تم تجهيز نموذج Gold Bar بقيم تجريبية في الذاكرة فقط، وتم عرض preview HTTP read-only بنجاح، لكن لم يتم الضغط على Submit ولم يتم تنفيذ دفع أو إنشاء استلام.

لا توجد تغييرات Product code أو migrations أو writes على Persistent أو Acceptance. النتيجة المقترحة: `PASS_OWNER_REVIEW_READY`، مع انتظار موافقة المالك قبل إغلاق Supplier Receive runtime stream.

## Entry gate and safety boundary

- `OWNER_SAFETY_REQUIREMENT = NO_UNRELATED_DAMAGE`
- Persistent `darfus_erp`: read-only طوال الجولة.
- Acceptance `darfus_erp_inventory_rehearsal_20260804_160500z`: read-only طوال الجولة.
- لا Supplier submit، لا receipt، لا payment، لا journal، لا asset mutation.
- لا migration، لا restart، لا deploy، لا Git write.
- تم إغلاق tab المتصفح الذي فتحته الجولة فقط؛ العمليات الطبيعية بقيت قيد التشغيل.

## Worktree and process baseline

- Branch: `main`
- HEAD: `1657b0e9ba580faef69be48f04637835c201b521`
- Staged files: `0`
- Worktree يحتوي تغييرات inherited كثيرة؛ لم يتم تنظيفها أو استرجاعها.
- Stashes: `11`
- Normal frontend: `localhost:3000`, listening PID `25200`.
- Normal backend: `localhost:8000`, listening PID `24508`.
- `NORMAL_FRONTEND_RESTARTED = NO`
- `NORMAL_BACKEND_RESTARTED = NO`
- `NORMAL_RUNTIME_PROCESS_KILLED = NO`

## Database identity and fingerprints

### Persistent before/after (read-only)

`SELECT current_database()` رجع `darfus_erp`.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| SequelizeMeta migrations | 81 | 81 | 0 |
| suppliers | 1 | 1 | 0 |
| purchase_orders | 6 | 6 | 0 |
| purchase_order_items | 2 | 2 | 0 |
| asset_purchase_cost_revisions | 61 | 61 | 0 |
| assets | 62 | 62 | 0 |
| journal_entries | 83 | 83 | 0 |
| journal_lines | 219 | 219 | 0 |
| cash_transactions | 60 | 60 | 0 |
| asset_certificates | 2 | 2 | 0 |

Integrity after: unbalanced journals `0`, orphan journal lines `0`, unlinked treasury `0`, blank barcodes `0`, duplicate barcodes `0`, orphan cost revisions `0`, orphan certificates `0`.

### Acceptance read-only comparison

`SELECT current_database()` رجع `darfus_erp_inventory_rehearsal_20260804_160500z`.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| SequelizeMeta migrations | 80 | 80 | 0 |
| suppliers | 1 | 1 | 0 |
| purchase_orders | 314 | 314 | 0 |
| purchase_order_items | 418 | 418 | 0 |
| asset_purchase_cost_revisions | 442 | 442 | 0 |
| assets | 475 | 475 | 0 |
| journal_entries | 497 | 497 | 0 |
| journal_lines | 1423 | 1423 | 0 |
| cash_transactions | 173 | 173 | 0 |
| asset_certificates | 79 | 79 | 0 |

Acceptance integrity after: all checks above equal zero. Snapshot migration 81 remained absent.

## Runtime health and context

- `GET /api/v1/health` = HTTP 200, status UP.
- `GET /api/v1/health/db` = HTTP 200, PostgreSQL connected.
- `GET /api/v1/health/redis` = HTTP 200, Redis connected.
- `GET /api/v1/health/gold` = HTTP 200, `HEALTHY`, provider `GOLDAPI_IO`, mode `LIVE_PROVIDER`, currency `AED`, `fresh=true`, `stale=false`.
- Browser showed Company `DARFUS` and Branch `Main Branch`.
- Readiness bootstrap completed without error.
- No doubled `/api/v1/api/v1` request was observed in source/runtime smoke.

## Supplier page and existing receipt read smoke

The normal browser opened `/ar/suppliers` and `/ar/suppliers/SUP-001` successfully. Existing supplier `SUP-001` was displayed with Company `DARFUS`, branch `Main Branch`, active status, and supplier identity. The read-only purchase-history tab displayed six existing rows, including purchase order identifiers, dates, branch, totals, paid/remaining amounts, payment status, and received status. No `سداد`, edit, delete, or submit action was clicked.

`EXISTING_SUPPLIER_RECEIPT_READ_SMOKE = PASS`

## Profile switching and Gold Bar form smoke

On `/ar/suppliers/purchases`, an existing supplier was selected and the profile was switched to `GOLD_BAR_24K`. The profile-owned karat was respected (24K), and no submission occurred. The form was filled in memory only with:

- name/description: `Smoke Read Only Gold Bar`
- gross weight: `10`
- stone weight: `0`
- certificate cost: `0`
- paid: `0`

The UI showed a live purchase rate `516.7456424`, current value `5167.456424`, service total `5167.46 AED`, paid `0.00`, and remaining supplier `5167.46`. The rate was marked fresh. The Submit button was enabled by validation, but it was not clicked.

`SUPPLIER_PROFILE_SWITCH_RUNTIME = PASS`
`SUPPLIER_GOLD_BAR_PROFILE_RUNTIME = PASS`
`SUPPLIER_WEIGHTED_FORM_RUNTIME = PASS`
`SUPPLIER_SUBMIT_ENABLED_BUT_NOT_CLICKED = YES`

## Read-only preview proof

Source inspection of `backend/src/routes/erp.routes.js` confirms `POST /api/v1/inventory-v2/receive-preview` is explicitly read-only: it normalizes the proposed piece and calls `supplierAcquisitionPreviewService.previewFromPieces`; it does not create PurchaseOrder, Asset, payable, journal, or treasury rows and returns `readOnly: true`.

The normal browser preview path returned the rendered pricing/weight summary with no error. This is the only POST-like action exercised; it was a preview, not an acquisition submit.

`SUPPLIER_PREVIEW_PERSISTENT_SAFE = PASS`
`SUPPLIER_PREVIEW_HTTP = 200`
`SUPPLIER_PREVIEW_UI_PARITY = PASS`

## Network and console evidence

| Flow | Method | URL/pattern | Result | Mutation |
|---|---|---|---|---|
| Health | GET | `/api/v1/health` | 200 | none |
| DB health | GET | `/api/v1/health/db` | 200 | none |
| Redis health | GET | `/api/v1/health/redis` | 200 | none |
| Gold health | GET | `/api/v1/health/gold` | 200 | none |
| Supplier list/detail/history | GET | `/api/v1/suppliers...` (canonical client) | successful UI render | none |
| Acquisition preview | POST | `/api/v1/inventory-v2/receive-preview` | 200, `readOnly=true` | none |
| POS smoke | GET/read hooks | `/api/v1/...` | successful UI render | none |
| Customers smoke | GET/read hooks | `/api/v1/customers...` | successful UI render | none |

No credentials, tokens, cookies, or full database URLs were recorded. Browser dev logs after Supplier, POS, and Customers routes were empty (`[]`) for error/warning levels. No browser console build/runtime errors were observed and no 5xx response was observed in this smoke.

## Financial, inventory, and Supplier mutation safety

- `PERSISTENT_SUPPLIER_SUBMITS_THIS_BATCH = 0`
- `PERSISTENT_RECEIPTS_CREATED_THIS_BATCH = 0`
- `PERSISTENT_PO_DELTAS = 0`
- `PERSISTENT_ASSET_DELTAS = 0`
- `PERSISTENT_BARCODE_DELTAS = 0`
- `PERSISTENT_COST_REVISION_DELTAS = 0`
- `PERSISTENT_PAYABLE_DELTAS = 0`
- `PERSISTENT_JOURNAL_DELTAS = 0`
- `PERSISTENT_TREASURY_DELTAS = 0`
- `PERSISTENT_DB_MUTATIONS_THIS_BATCH = 0`
- `ACCEPTANCE_DB_MUTATIONS_THIS_BATCH = 0`

`ACCOUNTING_INTEGRITY = PASS`  
`INVENTORY_INTEGRITY = PASS`  
`TREASURY_INTEGRITY = PASS`

## POS, Customer, and Invoice Snapshot non-regression smoke

POS `/ar/pos` rendered without checkout. The customer summary showed only the approved read-only fields: الاسم، العنوان، الهاتف، التصنيف، النقاط، وإجمالي المشتريات. Payment controls remained untouched and disabled for an empty invoice.

Customers `/ar/customers` rendered the existing two customers and existing read-only totals. No create/edit/delete action was used.

No Invoice Snapshot flow was executed. No snapshot logic was changed.

`POS_NON_REGRESSION_LIGHT_SMOKE = PASS`  
`CUSTOMER_NON_REGRESSION_LIGHT_SMOKE = PASS`  
`INVOICE_SNAPSHOT_REGRESSION = NOT_EXERCISED_BY_SCOPE`

## Focused verification inherited from the approved supplier batches

The following safe, pure contract checks were already green before this runtime smoke and were not rerun against Persistent:

- supplier all-profile acquisition/payable/pricing contract: 4/4
- supplier Gold Bar acquisition/current-pricing/POS UX: 4/4
- supplier receipt-pricing E2E contract: 3/3
- profile-switch async preview-race UX: 5/5
- TypeScript `npx tsc --noEmit --pretty false`: PASS
- focused Supplier ESLint: PASS

These checks do not authorize a Persistent submit and do not replace the runtime evidence above.

## Environment/package/Git/process safety

- `backend/package.json` hash: `231A19D0A81C2579F4D1B8E4D676A7085BA6811516630B811627B58A5CB3A86B`
- `backend/package-lock.json` hash: `A2E65BF8D4EBBFF9CE559532130DC896433A931C5B6515102FC48149FE602551`
- Supplier purchases page hash: `C04BCDB3FBEF15271444B8F8B9B31473BBD4F6F0EE245C8B8FB04E2CB5DDE7BF`
- `next-env.d.ts` remained inherited drift `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`; it was not edited.
- Product code changed this batch: `NO`.
- package/package-lock changed: `NO`.
- `.env` changed: `NO`.
- Git staged/commit/push/deploy: `0/0/0/0`.
- Handoff was not updated.

## Cleanup

The single browser tab opened for this batch was closed. No normal frontend/backend process was stopped. No temporary clone, fixture, migration, or runtime workspace was created.

## File diff table

| File | Reason | Type | Persistent effect | Runtime/business effect | Expected |
|---|---|---|---|---|---|
| `backend/reports/supplier-local-production-smoke-01-retry-strict-runtime-rev02-20260815T105300+0300.md` | Evidence report | Report | none | none | yes |
| Product source files | No change | Product | none | none | yes |
| Database/migrations | No change | DB | none | none | yes |

## Gate and Owner review

All required smoke controls were satisfied without mutating Persistent or Acceptance. The only unexecuted operation was the intentionally forbidden Supplier submit/payment path.

`SUPPLIER_LOCAL_PRODUCTION_SMOKE_01_RETRY_STRICT_RUNTIME_REV02_GATE = PASS_OWNER_REVIEW_READY`

Owner review checklist:

- [x] Persistent identity is `darfus_erp`, migrations remain 81.
- [x] Acceptance identity is exact rehearsal DB, migrations remain 80.
- [x] Normal runtime ports 3000/8000 stayed running.
- [x] Supplier list/detail/history is readable.
- [x] Gold Bar/weight/profile preview is readable and read-only.
- [x] Submit was not clicked.
- [x] POS and Customers light smoke passed.
- [x] Financial/inventory/treasury integrity remained clean.
- [x] No code, package, environment, migration, Git, or handoff mutation.

`NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START`
`NEXT_RECOMMENDED_STEP = OWNER_APPROVAL_TO_CLOSE_SUPPLIER_RECEIVE_RUNTIME_STREAM`

