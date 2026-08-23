# DARFUS ERP — Gold By Weight Browser + Network Acceptance 02-R1

## Executive Summary

تم إغلاق فجوة Browser/Network الخاصة بـBatch 02 على Disposable Clone فقط. نجح Login الحقيقي، تحميل المسار، عرض الأقسام الثمانية، master data server-backed، Gold Center، الحسابات server-authoritative، إنشاء Asset من المتصفح، refresh persistence، DB assertions، journal balance، وbackend correlation.

أثناء أول Browser Create ظهر عيب P1 حقيقي في payload: الحقول `weightPerUnit/grossWeight/unitCost` المطلوبة لمسار Supplier Receive لم تكن موجودة على مستوى بند الاستلام. تم تسجيل الدليل، تطبيق أقل إصلاح داخل صفحة GBW فقط، إضافة focused test، ثم إعادة الاختبار بنجاح. لا توجد كتابة على `darfus_erp`.

`GOLD_BY_WEIGHT_FINANCIAL_FORMULA = CLOSED_BY_01B`; لا يوجد deferred formula defect.

## Accepted Baseline

- Official database: `darfus_erp`.
- Official migrations: `82`.
- Gold runtime: `GOLDAPI_IO`, `LIVE_PROVIDER`, `AED`, `PER_GRAM`, healthy, fresh, `isMockFallback=false`.
- Existing Batch 02 backend/runtime/focused-test proof remained valid.
- Test clone: `darfus_erp_master_data_01d_browser_02_r1_20260817_104500`.
- Clone `SequelizeMeta=82`; it was dropped after acceptance.

## Safety Confirmation

- No migration created or executed.
- No `.env`, secret, API key, permission, or official configuration was changed.
- Official DB was read-only throughout R1.
- Clone-only fixtures: GBW master rows, barcode codes, a test supplier, and a temporary clone-only login password. Role and permissions were not weakened.
- Clone was deleted after proof; no persistent test data remains there.
- No Git reset/clean/stash/restore/commit was used.

## Frontend Runtime

- `FRONTEND_COMMAND = npm run dev`.
- `FRONTEND_URL = http://localhost:3000`.
- `BACKEND_URL = http://localhost:8120/api/v1` during clone proof.
- The pre-existing Next process on port 3000 was replaced temporarily with the same project command and restored to the normal `.env`-backed runtime after proof.
- Next-env SHA remained unchanged: `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.

## Authentication Proof

- Real browser login: PASS.
- Session persisted across authenticated dashboard and GBW navigation: PASS.
- Clone-only test account retained the existing `admin` / `super_admin` role and permissions.
- Unauthenticated clone access redirected to `/ar/login`: PASS.
- Passwords, tokens, and cookies were not reported.

## Navigation / Route Proof

- `GBW_ROUTE = /ar/inventory/gold-by-weight`.
- Direct route load: PASS.
- Actual sidebar/menu entry: NOT PRESENT.
- Classification: intentional route-only scope for Batch 02; the route is project-consistent and not a core acceptance blocker. This remains a P2 usability follow-up if Owner later requires menu discoverability.

## Eight-Section Screen Proof

Desktop viewport: `1440x1000`, RTL.

| Section | Rendered? | Fields Present? | Result |
|---|---:|---:|---|
| 1. Item Identification | Yes | Yes | PASS |
| 2. Weight Information | Yes | Yes | PASS |
| 3. Purchase Information | Yes | Yes | PASS |
| 4. Current Cost | Yes | Yes | PASS |
| 5. Sales / Pricing | Yes | Yes | PASS |
| 6. Tag / Barcode / RFID | Yes | Yes | PASS |
| 7. Item Status | Yes | Yes | PASS |
| 8. Audit & System | Yes | Yes | PASS |

Layout checks: RTL rendered, numeric inputs were LTR, AED and grams were visible, calculated controls were read-only, and `scrollWidth == clientWidth` with no horizontal overflow.

`GBW_EIGHT_SECTIONS_BROWSER_PROOF = PASS`.

## Item Identification Proof

- Item descriptions were loaded from `GET /inventory-v2/gold-by-weight/contract`; clone displayed `Gold Anklet` and the server-provided list.
- Gold colors were server-backed; clone displayed `Rose Gold`, `White Gold`, `Yellow Gold`.
- Karat options were bounded by server policy; `21K` was selected.
- Brand, model, and model number remained optional.
- Supplier was server-backed; clone fixture displayed `GBW R1 Test Supplier`.
- Purchase date was rendered and submitted.
- Asset detail showed the server-created identity and purchase evidence.
- No hardcoded production master list was used.

## Weight / Net / Pure Proof

Browser inputs:

- Gross: `10 g`.
- Stone: `2 g`.
- Karat: `21K`.

Server preview displayed:

- Net: `8.00000000 g`.
- Pure 999.9: `7.00000000 g`.

The UI explicitly marked Net and Pure as server-calculated/read-only. The formula matched `8 × 21 / 24 = 7`.

## Zero-Stone / Validation Proof

- Gross `8`, stone `0`: Net `8.00000000`, Pure `8.75000000`; PASS.
- Stone greater than gross: preview returned intentional `422`; calculated fields cleared and submit was disabled; PASS.
- Negative gross: submit disabled and Net remained empty; PASS.
- Negative stone: submit disabled and Net remained empty; PASS.
- Missing gross on a cleared form: required field remained empty and submit was disabled; PASS.
- No business row was created by invalid scenarios.

## Purchase Information Proof

For gross `10`, stone `2`, making `5/g`:

- Gold value used the server Gold rate.
- Making total displayed `40.00 AED`, proving `5 × NET 8`, not `5 × GROSS 10`.
- VAT and purchase total were server preview values.
- Purchase rate was distinct from editable UI input authority; the backend resolved/canonicalized the accepted rate.
- Purchase fields were visually read-only where calculated.

## Gold Center Network Proof

Clone `GET /api/health/gold` returned HTTP `200` with:

- Provider: `GOLDAPI_IO`.
- Mode: `LIVE_PROVIDER`.
- Currency: `AED`.
- Unit: `PER_GRAM`.
- Health: `HEALTHY`.
- Fresh: `true`.
- Stale: `false`.
- Mock fallback: `false`.

The GBW contract displayed the same provider/currency and quote timestamp. The screen consumed canonical backend Gold data; no client GoldAPI call or N+1 provider call was observed.

## Current Cost Proof

The screen rendered Current Gold Rate, Current Gold Value, Current Making/Gram, Current Making Value, VAT, and Current Total. It explicitly stated that current valuation is separate from immutable historical purchase cost. Asset detail later showed both sections separately, with no overwrite of the purchase snapshot.

## Sales / Pricing Proof

Browser sale preview with selling making `7/g` and minimum `5/g` returned/displayed:

- Gold value: `3641.75 AED`.
- Making total: `56.00 AED` on net `8 g`.
- VAT and total: server-calculated.
- Minimum state: `within minimum`.

The screen exposed the accepted sale preview state and did not invent a production minimum-making default.

## Override Fail-Closed Proof

- UI displayed `مغلق Fail-Closed`.
- No override control was exposed to the acceptance user.
- No manual Gold cost override was submitted.
- Existing server permission/config guard was not weakened.

`OVERRIDE_FAIL_CLOSED_BROWSER_PROOF = PASS`.

## Tag / Barcode / RFID Proof

Before create:

- Asset ID: `Generated on receive`, read-only.
- Barcode: `Generated by server`, read-only.
- RFID: clearly shown as post-create/deferred identity assignment.

After create:

- Asset ID: `AST-PUR-1786954005303-1-1-xi1m`.
- Barcode: `GWANK21000001`.
- Barcode was displayed as generated identity, not editable text.
- No replacement/reprint operation was run; replacement remains outside R1.

`RFID_BROWSER_SCOPE = POST_CREATE_DEFERRED_NO_HARDWARE_PROOF`.

## Status / Condition / Branch / Location Proof

- Detail showed operational status `AVAILABLE`.
- Condition and tag state remained separate fields; tag state was `PENDING`.
- Branch came from authenticated server context (`Branch-1` / clone branch ID).
- Location was read-only/server-backed; no free-text location authority was introduced.
- Status changes were not submitted from the GBW screen.

## Audit / System Proof

Asset detail showed:

- Asset ID and Barcode.
- Created timestamp.
- Created by `Elsayed Negm`.
- Company/branch.
- Gold source and purchase rate.
- Purchase order/source evidence.
- `PURCHASE_RECEIVED` event.
- `PURCHASE_RECEIVE` movement.
- Current operational status, condition/tag state, and barcode identity.

Full history explorer remains a later shared UI scope.

## Browser Network Matrix

| Action | Method | URL | Status | Request Authority | Response Authority | Result |
|---|---|---|---:|---|---|---|
| Login | POST | `/api/v1/auth/login` | 200 | Browser credentials | Server session/token | PASS |
| Company context | GET | `/api/v1/auth/accessible-companies` | 200/304 | Session | Server company scope | PASS |
| GBW contract/master data | GET | `/api/v1/inventory-v2/gold-by-weight/contract` | 200 | Session/branch | Server master/config/Gold authority | PASS |
| Gold rates | GET | `/api/v1/gold/karat-prices?currency=AED` | 200 | Session | Canonical Gold runtime | PASS |
| GBW preview | POST | `/api/v1/inventory-v2/gold-by-weight/preview` | 200 | Input facts only | Server weights/valuation | PASS |
| Sale preview | POST | `/api/v1/inventory-v2/gold-by-weight/sale-preview` | 200 | Input facts only | Server sale pricing | PASS |
| Invalid preview | POST | `/api/v1/inventory-v2/gold-by-weight/preview` | 422 | Invalid facts | Server validation | PASS/EXPECTED |
| Final receive | POST | `/api/v1/purchase-orders/receive` | 201 | Supplier V2/perPiece | Asset/accounting transaction | PASS |
| Asset readback | GET | `/api/v1/inventory-v2/assets/AST-PUR-...` | 200/304 | Session | Server Asset/detail authority | PASS |

The initial pre-fix receive returned expected defect evidence HTTP `422`; after the focused UI fix the same browser flow returned HTTP `201`.

## Submit Payload Authority

The focused fix added the required receive transport fields at both item and per-piece levels:

- `weightPerUnit` / `grossWeight` from entered physical gross weight.
- `unitCost` transport value from server preview, while canonical backend valuation remains authoritative.
- `inventoryV2=true` and `perPiece[]`.

The payload does not use Product physical quantity authority, client-generated Asset ID, or client-generated barcode. Net/pure/final financial totals are not accepted as authority by the backend; the server recalculates and canonicalizes them.

`CLIENT_CALCULATED_TOTALS_TRUSTED = NO`.
`PRODUCT_QUANTITY_AUTHORITY_USED = NO`.

## Successful Browser Create

Successful chain:

`Browser → GBW UI → canonical Supplier Receive V2 → Asset → Barcode → Barcode History → Origin → Purchase Cost Revision → Inventory Movement → Payable → Balanced Journal`.

Correlated clone IDs:

- Asset: `AST-PUR-1786954005303-1-1-xi1m`.
- Barcode: `GWANK21000001`.
- Purchase order/source: `PO-1786954005297`.
- Journal: `JE-1786954005357`.

## Refresh Persistence

After opening Asset detail, browser refresh returned the same Asset ID and Barcode, preserved Net `8 g`, and preserved `PURCHASE_RECEIVED` history. No duplicate Asset, movement, or journal was created.

`BROWSER_REFRESH_PERSISTENCE = PASS`.

## Idempotency

- Browser UI generated and submitted an idempotency key.
- Existing Batch 02 clone/API proof verified same-key replay returns the same Asset with no duplicate rows and changed-payload replay returns `409`.
- R1 did not add a duplicate-submit control or invent a second idempotency contract.

`IDEMPOTENCY_PROOF = PASS_EXISTING_CONTRACT_PLUS_BROWSER_KEY`.

## Browser Console

- Page load, master load, preview, invalid validation, successful submit, and refresh were inspected.
- No uncaught exception, hydration failure, failed chunk, or infinite render loop.
- `BROWSER_CONSOLE_ERRORS = 0`.
- `BROWSER_CONSOLE_WARNINGS = 0`.

Backend logs contained repeated unrelated `404` requests for an existing dashboard upload/icon asset and expected aborted SSE/dashboard reads during navigation. They did not affect GBW acceptance and are classified as non-blocking P3 observability/static-asset follow-up.

## Backend Log Correlation

Clone Backend log correlated successful requests:

- Login: HTTP `200`.
- GBW contract: HTTP `200`.
- GBW preview: HTTP `200`.
- Sale preview: HTTP `200`.
- Final receive: HTTP `201`.
- Journal posting: `Dr 3865.83 / Cr 3865.83`.
- Asset detail: HTTP `200` and later `304`.
- Gold health: HTTP `200`.

No secrets, tokens, or passwords are included in this report.

## DB Assertions

Clone post-browser assertion result:

| Assertion | Result |
|---|---:|
| Assets | 1 |
| Products physical | 0 |
| Active barcode history | 1 |
| Barcode history rows | 1 |
| Origins | 1 |
| Purchase cost revisions | 1 |
| Inventory asset movements | 1 |
| Journals | 1 |
| Balanced journals | 1 |
| Duplicate barcode groups | 0 |
| Orphan movements/revisions | 0 |
| Gross / Stone / Net / Pure | 10 / 2 / 8 / 7 |
| Making total | 40.00000000 |

Clone had `SequelizeMeta=82`, and was removed after proof.

## Accounting / Journal Proof

The browser receive posted through existing V2 accounting/payable authority. The correlated journal was balanced: debit `3865.83`, credit `3865.83`. No accounting redesign or mapping change was made.

## Official DB Non-Mutation

Post-R1 read-only official assertion:

```text
darfus_erp|82|assets=0|products=0|suppliers=0|purchase_orders=0|inventory_asset_movements=0|asset_purchase_cost_revisions=0|journal_entries=0|invoices=0|payments=0|profile_master_data=0|settings=0
```

The official Gold quote count changed from the earlier observed baseline because the existing Gold scheduler/provider refresh continued to operate. This is classified separately as expected runtime provider activity, not an R1 business write.

## Defects Found

| ID | Observed | Expected | Evidence | Severity | Classification |
|---|---|---|---|---|---|
| R1-GBW-001 | First browser receive returned `422`: `وزن الوحدة للبند رقم 1 غير صحيح` | Canonical Supplier Receive must accept the valid GBW UI payload | Backend log request `881a0afe-f95b-4377-8734-33b69224124a`; UI had valid Net/Pure but omitted item transport fields | P1 | PRODUCT_DEFECT |
| R1-GBW-002 | GBW is not in the sidebar | User can use project-consistent route | Sidebar snapshot had no GBW link; direct route worked | P2 | ACCEPTANCE_GAP / ROUTE_ONLY_SCOPE |
| R1-ENV-001 | Existing dashboard upload/icon returned 404 during session bootstrap | Static assets should resolve | Backend logs show `/uploads/...png` 404; no GBW impact | P3 | ENVIRONMENT_CONFIG / OBSERVABILITY |

## Fixes Applied If Any

Applied minimum safe fix for `R1-GBW-001`:

- `app/[locale]/(dashboard)/inventory/gold-by-weight/page.tsx`: submit payload now includes `weightPerUnit`, `grossWeight`, and `unitCost` at the canonical Supplier Receive item/perPiece boundary.
- `backend/tests/gold-by-weight-profile-02.test.cjs`: added a focused static contract test for those fields and V2/perPiece submission.

No fix was applied for the sidebar route-only scope or unrelated upload asset 404.

## Files Changed

Intentional R1 files:

- `app/[locale]/(dashboard)/inventory/gold-by-weight/page.tsx`
- `backend/tests/gold-by-weight-profile-02.test.cjs`
- `backend/reports/DARFUS-INVENTORY-GOLD-BY-WEIGHT-BROWSER-NETWORK-ACCEPTANCE-02-R1-REPORT.md`

No backend production source, migration, `.env`, permission, or Git cleanup was changed in R1.

## Deferred Shared UI

- Sidebar/menu discoverability for the dedicated GBW route.
- Shared dynamic inventory grid/history explorer.
- Full barcode replacement/reprint workflow UI.
- Full RFID assignment hardware workflow.
- Shared profile screens for Gold By Piece, Diamond, Gem Stone, and Pearl.

## Owner Values Still Pending

- Official `profile_master_data`, barcode codes, locations, and settings remain empty after Reset and were not provisioned in R1.
- Clone-only master rows were marked test fixtures; `WT` and `WCH` remained `is_client_approved=false` and provisional.
- Official production minimum-making configuration and any explicit override permission remain fail-closed/pending Owner configuration.
- R1 acceptance does not claim production provisioning readiness.

## Gate

`GATE = PASS_02_R1_GBW_BROWSER_NETWORK_ACCEPTANCE_COMPLETE`

All core acceptance conditions passed after the focused fix. The only known non-core items are the intentional route-only navigation scope and unrelated upload asset 404s. No new P0/P1 regression remains.

`02_FULL_ACCEPTANCE = CLOSED`.

## Next Recommended Step

1. Owner review this R1 report and the two intentional non-core follow-ups.
2. Keep production master-data provisioning as a separately approved action; do not infer it from clone proof.
3. Do not start Gold By Piece until explicit Owner approval: `ابدأ`.

## Final Tokens

```text
CURRENT_BATCH = DARFUS-INVENTORY-GOLD-BY-WEIGHT-BROWSER-NETWORK-ACCEPTANCE-02-R1
MODE = RUNTIME_ACCEPTANCE_ONLY_WITH_REAL_BROWSER_NETWORK_BACKEND_DB_EVIDENCE

OFFICIAL_DATABASE = darfus_erp
OFFICIAL_DB_MIGRATIONS = 82
R02_R1_INITIATED_OFFICIAL_WRITES = 0

FRONTEND_RUNTIME = PASS_NPM_RUN_DEV
FRONTEND_URL = http://localhost:3000
BACKEND_URL = http://localhost:8120/api/v1 (DISPOSABLE_CLONE_DURING_PROOF)

AUTH_BROWSER_PROOF = PASS
GBW_ROUTE = /ar/inventory/gold-by-weight
NAVIGATION_ENTRY_PRESENT = NO_ROUTE_ONLY_SCOPE
GBW_EIGHT_SECTIONS_BROWSER_PROOF = PASS

MASTER_DATA_BROWSER_PROOF = PASS_CLONE_TEST_FIXTURES_SERVER_BACKED
GOLD_CENTER_BROWSER_NETWORK_PROOF = PASS
GOLD_RUNTIME_HEALTH = HEALTHY_LIVE_PROVIDER_FRESH_AED_PER_GRAM_NO_MOCK

NET_WEIGHT_BROWSER_SERVER_PROOF = PASS_10_MINUS_2_EQUALS_8
PURE_GOLD_WEIGHT_BROWSER_SERVER_PROOF = PASS_8_X_21_OVER_24_EQUALS_7
ZERO_STONE_BROWSER_PROOF = PASS
INVALID_WEIGHT_VALIDATION_PROOF = PASS_EXPECTED_422_AND_NO_CREATE

PURCHASE_CALCULATION_BROWSER_PROOF = PASS_MAKING_40_ON_NET_8
CURRENT_VALUATION_BROWSER_PROOF = PASS_SEPARATE_FROM_PURCHASE_SNAPSHOT
SALE_PRICING_BROWSER_PROOF = PASS
OVERRIDE_FAIL_CLOSED_BROWSER_PROOF = PASS

BARCODE_BROWSER_AUTHORITY = SERVER_GENERATED_ASSET_BARCODE
RFID_BROWSER_SCOPE = POST_CREATE_DEFERRED_NO_HARDWARE_PROOF
STATUS_DOMAIN_BROWSER_PROOF = PASS_SEPARATE_DOMAINS
LOCATION_BROWSER_AUTHORITY = SERVER_BACKED_NO_FREE_TEXT
AUDIT_BROWSER_PROOF = PASS_ASSET_DETAIL_EVENT_MOVEMENT_SOURCE

CLIENT_CALCULATED_TOTALS_TRUSTED = NO
PRODUCT_QUANTITY_AUTHORITY_USED = NO

SUCCESSFUL_BROWSER_CREATE = PASS
BROWSER_REFRESH_PERSISTENCE = PASS
IDEMPOTENCY_PROOF = PASS_EXISTING_CONTRACT_PLUS_BROWSER_KEY
NETWORK_PROOF = PASS_CORE_ENDPOINTS
BACKEND_LOG_CORRELATION = PASS
BROWSER_CONSOLE_ERRORS = 0
BROWSER_CONSOLE_WARNINGS = 0

DB_ASSERTIONS = PASS_CLONE_1_ASSET_0_PRODUCTS_1_BARCODE_HISTORY_1_ORIGIN_1_REVISION_1_MOVEMENT_1_JOURNAL
ACCOUNTING_JOURNAL_PROOF = PASS_BALANCED_3865_83_DEBIT_CREDIT
OFFICIAL_DB_NON_MUTATION_PROOF = PASS_ZERO_BUSINESS_DELTA

GOLD_BY_WEIGHT_FINANCIAL_FORMULA = CLOSED_BY_01B
GOLD_BY_WEIGHT_MAKING_BASIS = NET_GOLD_WEIGHT
FORMULA_REGRESSION = PASS

DEFECTS_FOUND = 1_FIXED_2_NONCORE_DEFERRED
P0_BLOCKERS = 0
P1_BLOCKERS = 0_AFTER_R1_FIX
REGRESSIONS_INTRODUCED = NONE_DETECTED

PRODUCT_CODE_FILES_CHANGED = 1
FRONTEND_FILES_CHANGED = 1
BACKEND_FILES_CHANGED = 0
TEST_FILES_CHANGED = 1
MIGRATIONS_CREATED = 0
MIGRATIONS_EXECUTED_OFFICIAL_DB = 0

OWNER_VALUES_STILL_PENDING = OFFICIAL_MASTER_DATA_SETTINGS_LOCATIONS_MINIMUM_MAKING_CONFIGURATION
SHARED_UI_REQUIREMENTS_DEFERRED = MENU_DISCOVERABILITY_DYNAMIC_GRID_HISTORY_RFID_REPLACEMENT_OTHER_PROFILES

GATE = PASS_02_R1_GBW_BROWSER_NETWORK_ACCEPTANCE_COMPLETE
02_FULL_ACCEPTANCE = CLOSED
NEXT_RECOMMENDED_STEP = OWNER_REVIEW_THEN_EXPLICIT_APPROVAL_FOR_GOLD_BY_PIECE
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
```

02-R1 GOLD BY WEIGHT BROWSER + NETWORK ACCEPTANCE COMPLETE
→ 02 GOLD BY WEIGHT FULL ACCEPTANCE = CLOSED
→ OWNER REVIEW
→ 03 GOLD BY PIECE ONLY AFTER EXPLICIT "ابدأ"
