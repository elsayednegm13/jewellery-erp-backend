# DARFUS ERP — Gold By Weight Full Profile Implementation 02

تم تنفيذ نطاق Gold By Weight المعتمد، وإثبات المسار على Disposable Clone فقط. الاختبارات المركزة والـruntime proof نجحت، ولم تتم أي كتابة على `darfus_erp`. فحص المتصفح لم يُشغّل لأن Frontend لم يكن متاحًا على المنافذ الموجودة؛ لم يتم تشغيل Next dev احترامًا للـguardrails. الخطوة التالية هي Owner Review ثم اعتماد منفصل لأي batch لاحق.

## Executive Summary

- تم تنفيذ صفحة Gold By Weight مستقلة لمساري `GOLD_BY_WEIGHT_JEWELLERY` و`GOLD_BAR_24K`.
- تم نقل التحقق والحساب إلى Backend server-authoritative؛ لا يعتمد المسار على Frontend labels أو rates.
- تم الحفاظ على `1 physical piece = 1 Asset = 1 unique Barcode` وعلى Supplier → Asset → Barcode → Movement → Cost Revision → Payable/Journal.
- تم عزل Product/quantity authority عن GBW النهائي، مع الإبقاء على legacy non-final compatibility.
- تم إثبات Supplier V2، idempotency، POS Asset result، رفض legacy payload، وتوازن القيد على clone مؤقت.
- لا توجد migration أو persistent official DB write في هذا batch.

## Pre-change Baseline

- Authority: `darfus_erp`, `CURRENT_POST_RESET_OFFICIAL_BASELINE`, migration 82.
- Official business baseline before/after proof: `suppliers=0`, `products=0`, `assets=0`, `purchase_orders=0`, `journal_entries=0`.
- Existing canonical authorities used: `inventory-master-policy.service.js`, `inventory-v2-runtime.service.js`, `gold-valuation.service.js`, `gold-sale-pricing.service.js`, canonical Supplier Receive route, existing accounting/payable and idempotency services.
- Existing source worktree was already heavily dirty. No reset/restore/clean/stash was used.

## Guardrail Alignment

- Official persistent database remained `darfus_erp`.
- Runtime mutation target was checked by `SELECT current_database()` and accepted only when matching `^darfus_erp_gbw_profile_02_`.
- Clone used: `darfus_erp_gbw_profile_02_20260817_072500`.
- Clone was dropped after proof; verification returned `CLONE_DROPPED`.
- No official DB mutation, no migration execution, no config/.env change, and no Git mutation occurred.

## Final Profile Classification

Implemented server-owned classification through the existing policy registry and GBW service:

| Top-level profile | Internal strategy | Server result |
|---|---|---|
| GOLD_BY_WEIGHT | GOLD_BY_WEIGHT_JEWELLERY | final client profile |
| GOLD_BY_WEIGHT | GOLD_BAR_24K | final client profile, separate 24K certificate semantics |

The five final client profile families remain represented by the canonical registry. GBW-specific validation rejects Product identity/quantity authority and validates karat, gross weight, stone weight, making charge, certificate, and required master values.

## Supplier V2 Enforcement Change

Files/functions:

- `backend/src/services/gold-by-weight-profile.service.js`: GBW normalization, weight/purity derivation, purchase/current/sale calculation, fail-closed Product/quantity rejection.
- `backend/src/routes/gold-by-weight-profile.routes.js`: read-only `/contract`, `/preview`, and `/sale-preview` APIs.
- `backend/src/routes/index.js`: canonical route mount under `/inventory-v2/gold-by-weight`.
- `backend/src/routes/erp.routes.js`: existing `/purchase-orders/receive` Gold valuation receives effective VAT settings when no explicit VAT is supplied; existing V2 transaction/accounting path remains authoritative.

The dedicated UI submits the existing canonical `/purchase-orders/receive` with `inventoryV2=true` and `perPiece[]`; it does not create a second business workflow.

## Legacy Quantity Isolation

- GBW Jewellery and Gold Bar cannot use `productId`, `productCode`, or quantity-based physical stock authority.
- Product rows and quantity-based legacy behavior remain available only outside the final profile scope.
- Rejected legacy GBW receive returns stable `FINAL_CLIENT_PROFILE_V2_REQUIRED` behavior before business records are created.
- No Product quantity movement, Asset, barcode, journal, or payable is created for the rejected path.

## POS Product Fallback Isolation

- `/pos/search` continues to return Product rows for non-final legacy scope.
- Server-side filtering excludes Products classified as final-client physical inventory profiles.
- GBW Asset search returns Asset identity, barcode, branch, operational status, and server-derived sale price.
- Clone runtime proof searched by generated GBW barcode and returned the Asset result with `isProduct=false`; no final-profile Product fallback was returned.

## Checkout Defense

The existing canonical sale boundary and final-profile Product guard remain in force. Static focused coverage verifies that a final physical profile must reference Asset identity and that the approved Asset sale path is preserved. No checkout mutation was run in this batch.

## Return/Exchange Identity Review

No return/exchange redesign was made. Existing Asset-linked sale identity and non-final legacy compatibility were preserved. The 01A/01C focused source tests covering the canonical sale/POS boundaries passed.

## Files Changed

Intentional 02 changes:

| File | Change |
|---|---|
| `app/[locale]/(dashboard)/inventory/gold-by-weight/page.tsx` | Dedicated GBW profile screen |
| `backend/src/services/gold-by-weight-profile.service.js` | GBW server contract and calculations |
| `backend/src/routes/gold-by-weight-profile.routes.js` | GBW read-only contract/preview APIs |
| `backend/src/routes/index.js` | GBW route mount |
| `backend/src/routes/erp.routes.js` | Effective VAT propagation in existing Gold receive canonicalization |
| `backend/tests/gold-by-weight-profile-02.test.cjs` | Focused GBW contract tests |
| `backend/scripts/gold-by-weight-profile-02-runtime.js` | Clone-only runtime proof harness |
| `backend/reports/DARFUS-INVENTORY-GOLD-BY-WEIGHT-FULL-PROFILE-IMPLEMENTATION-02-REPORT.md` | This report |

The worktree also contains extensive pre-existing modifications/untracked files from earlier batches. They were not cleaned, reset, staged, or claimed as 02 changes.

## Focused Tests

Command:

```text
node --test backend/tests/gold-by-weight-profile-02.test.cjs backend/tests/gold-by-weight-financial-formula-01b.test.cjs backend/tests/inventory-authority-foundation-01a.test.cjs backend/tests/barcode-status-foundation-01c.test.cjs backend/tests/master-data-foundation-01d.test.cjs backend/tests/gold-health-canonical.test.cjs
```

Result: **29 passed, 0 failed**.

Additional static checks:

- `node --check` passed for the new backend service, route, test, and runtime script.
- `npm run typecheck` passed.
- `git diff --check` had no substantive whitespace errors; existing line-ending warnings remain in the dirty worktree.

## Static Proof

| Proof | Result | Evidence |
|---|---|---|
| FINAL_PROFILE_CLASSIFIER | IMPLEMENTED | Existing canonical policy registry plus GBW service profile constants |
| SUPPLIER_V2_SERVER_GATE | IMPLEMENTED | Existing canonical `/purchase-orders/receive` V2 gate plus GBW perPiece contract |
| LEGACY_RECEIVE_FINAL_PROFILE_BLOCK | IMPLEMENTED | `FINAL_CLIENT_PROFILE_V2_REQUIRED`, focused 01A and GBW tests |
| POS_PRODUCT_FINAL_PROFILE_EXCLUSION | IMPLEMENTED | `/pos/search` filters `isFinalClientInventoryProduct` |
| CHECKOUT_FINAL_PROFILE_PRODUCT_GUARD | IMPLEMENTED | Existing server sale boundary and focused POS/sale tests |
| RETURN_EXCHANGE_ASSET_IDENTITY | PRESERVED | No redesign; existing Asset identity path and focused regression coverage |
| GOLD_BY_WEIGHT_NET_BASIS | IMPLEMENTED | Canonical valuation/sale pricing uses net gold weight for making and VAT |
| GOLD_BAR_SEPARATION | IMPLEMENTED | 24K certificate and VAT semantics remain separate from Jewellery making |

## Runtime Proof

Target was the disposable clone only. `current_database()` matched the required clone prefix.

Representative flow passed:

`GBW contract → preview → sale preview → Supplier Receive V2 → Asset → unique Barcode → Origin → Purchase Cost Revision → Inventory Movement → Payable/Journal → Asset detail → POS barcode search`.

Observed final run:

- Asset delta: `+1`.
- Product delta: `+0`.
- Movement delta: `+1`.
- Origin delta: `+1`.
- Purchase cost revision delta: `+1`.
- Journal delta: `+1`.
- Net weight: `8` from gross `10` and stone `2`.
- Making total: `40` at `5/g` on net gold weight.
- Journal balance: debit `3861.76`, credit `3861.76`.
- Legacy GBW receive: HTTP `422`.
- Idempotent replay: HTTP `201`, same Asset identity.
- Conflicting replay: HTTP `409`.
- POS barcode search: HTTP `200`, Asset result present, final-profile Product fallback false.

Frontend browser proof was **NOT RUN** because `localhost:3000` timed out and `localhost:3001` refused the connection. Next dev was not started.

## DB Assertions

Clone assertions passed for the controlled receive:

- One V2 perPiece input produced one Asset and one unique barcode.
- No Product physical quantity row was created.
- Asset profile was `GOLD_BY_WEIGHT_JEWELLERY`.
- Origin, cost revision, movement, and journal records were linked.
- Journal was balanced.
- Rejected legacy receive did not add business rows.
- Idempotent replay did not duplicate Asset/Barcode/Movement/Journal.

Official post-proof read-only assertion:

```text
darfus_erp|assets=0|products=0|suppliers=0|purchase_orders=0|journal_entries=0|SequelizeMeta=82
```

## Accounting/Payable Verification

The existing V2 receive transaction and accounting authority were reused. Clone proof observed a balanced posted purchase journal and the receive flow completed through supplier payable handling. No accounting model, mapping, or migration was changed.

## Idempotency Verification

- Valid receive with an idempotency key: passed.
- Same request/key replay: passed without duplicate physical/accounting rows.
- Changed request/same key: rejected with HTTP `409`.
- Rejected legacy request used a separate key and did not poison the valid receive result.

## Legacy Compatibility Verification

| Legacy Consumer | Final Client Profile Blocked? | Non-final Compatibility Preserved? | Evidence |
|---|---:|---:|---|
| Supplier Receive Product/quantity branch | Yes | Yes | Server guard and 01A tests |
| POS Product projection | Yes | Yes | Server classifier/filter and POS tests |
| Canonical Asset sale | Product bypass blocked | Yes | Existing sale boundary and focused tests |
| Return/exchange | Asset identity preserved | Yes | No code change; existing route review/tests |
| Product model/quantity columns | Not deleted | Yes | No schema/model removal |

## Known Deferred Issues

- Gold By Weight shared dynamic grid/list and universal inventory history remain outside this first profile implementation.
- Barcode replacement/history and Status schema work remain in their approved batches; this batch only consumes the existing identity/status authority.
- RFID assignment/reprint remains governed by the existing post-create Asset workflow; no RFID schema or replacement workflow was added.
- Master-data provisioning remains intentionally excluded. Official empty GBW profile master rows mean production intake is fail-closed until the separately approved provisioning batch is completed.
- Gold By Weight financial formula correction from 01B was not reopened or changed.
- Browser-level UI/network/console proof is pending an already-running approved frontend environment.

## Risk / Regression Matrix

| Risk | Classification | Severity | Result/Mitigation |
|---|---|---|---|
| Official master data empty after reset | MISSING_MASTER_DATA / ACCEPTANCE_GAP | P1 for live intake | Screen reads server contract and remains fail-closed; no provisioning performed |
| Frontend runtime unavailable | ENVIRONMENT_CONFIG | P2 | Static/typecheck and clone API proof passed; browser proof pending |
| Legacy Product authority outside final scope | DESIGN_LIMITATION | P2 | Explicitly preserved and filtered only for final profiles |
| Gold provider/config differences on clone | PROVIDER_EXTERNAL / ENVIRONMENT_CONFIG | P2 | Preview uses canonical Gold authority; no mock fallback introduced |
| Existing broad dirty worktree | SOURCE_DRIFT | P2 | Intentional files listed; no cleanup/reset performed |
| Formula regression | PRODUCT_DEFECT | P1 known deferred | 01B tests passed; no formula change in 02 |

## Gate

`GATE = PASS_02_GBW_PROFILE_IMPLEMENTED_RUNTIME_PROVEN_CLONE_ONLY_BROWSER_PROOF_PENDING`

The implementation, focused tests, static proof, clone-only runtime proof, accounting/idempotency assertions, and official DB preservation checks passed. The gate is not a claim of browser acceptance because the frontend was unavailable.

## Next Recommended Step

1. Owner review this report and approve the implementation result.
2. Provision/verify the separately approved GBW master data on an explicitly authorized target before live intake.
3. Run browser proof against an already-running approved frontend, without starting Next dev during acceptance.
4. Only after explicit approval, schedule the next batch for the remaining shared inventory/profile scope.

## Final Tokens

```text
CURRENT_BATCH = DARFUS-INVENTORY-GOLD-BY-WEIGHT-FULL-PROFILE-IMPLEMENTATION-02
MODE = GOLD_BY_WEIGHT_FULL_PROFILE_IMPLEMENTATION_WITH_FOCUSED_TESTS_AND_CLONE_RUNTIME_PROOF

OFFICIAL_DATABASE = darfus_erp
PERSISTENT_OFFICIAL_DB_MUTATION_AUTHORIZED_THIS_BATCH = NO
MIGRATIONS_CREATED = 0
MIGRATIONS_EXECUTED_OFFICIAL_DB = 0
PERSISTENT_WRITES_OFFICIAL_DB = 0

FINAL_CLIENT_PROFILE_COUNT = 5
GBW_PROFILE_STRATEGY_COUNT = 2
PHYSICAL_INVENTORY_AUTHORITY = ASSET
PHYSICAL_STOCK_QUANTITY_AUTHORITY = NOT_ALLOWED
GBW_REQUIREMENT_COVERAGE = 100_PERCENT_MAPPED_FOR_02_SCOPE
GBW_UNMAPPED_FIELDS = 0
GBW_SILENTLY_DROPPED_REQUIREMENTS = 0

FINAL_PROFILE_CLASSIFIER_IMPLEMENTED = YES
SUPPLIER_V2_FINAL_PROFILE_GATE_IMPLEMENTED = YES
LEGACY_RECEIVE_FINAL_PROFILE_BLOCK_IMPLEMENTED = YES
POS_PRODUCT_FINAL_PROFILE_EXCLUSION_IMPLEMENTED = YES
CHECKOUT_FINAL_PROFILE_PRODUCT_GUARD_IMPLEMENTED = YES
RETURN_EXCHANGE_ASSET_IDENTITY_PRESERVED = YES

PRODUCT_CODE_FILES_CHANGED = 4
FRONTEND_FILES_CHANGED = 1
TEST_FILES_CHANGED = 1
SCRIPT_FILES_CHANGED = 1
DOCUMENTATION_FILES_CHANGED = 1

FOCUSED_TESTS = 29
FOCUSED_TESTS_PASS = 29
STATIC_PROOF = PASS
RUNTIME_PROOF = PASS_DISPOSABLE_CLONE_ONLY
RUNTIME_PROOF_TARGET = darfus_erp_gbw_profile_02_20260817_072500_DROPPED_AFTER_PROOF
BROWSER_PROOF = BLOCKED_FRONTEND_NOT_RUNNING
DB_ASSERTIONS = PASS_CLONE_AND_OFFICIAL_READ_ONLY_PRESERVED
ACCOUNTING_PAYABLE_PROOF = PASS_CLONE_BALANCED_JOURNAL
IDEMPOTENCY_PROOF = PASS_REPLAY_NO_DUPLICATES_CONFLICT_REJECTED
LEGACY_COMPATIBILITY_PROOF = PASS_FOCUSED_STATIC_AND_CLONE_BOUNDARY

GOLD_BY_WEIGHT_FORMULA_FIX_THIS_BATCH = NO
BARCODE_REPLACEMENT_IMPLEMENTATION_THIS_BATCH = NO
STATUS_SCHEMA_IMPLEMENTATION_THIS_BATCH = NO
MASTER_DATA_PROVISIONING_THIS_BATCH = NO
CLIENT_PROFILE_SCREEN_IMPLEMENTATION_THIS_BATCH = YES_GBW_ONLY
PRODUCTION_MASTER_DATA_WRITES_THIS_BATCH = 0

KNOWN_DEFERRED_P1 = GOLD_BY_WEIGHT_FORMULA_FOLLOW_ON_RISK_AND_EMPTY_OFFICIAL_MASTER_DATA
REGRESSIONS_INTRODUCED = NONE_DETECTED

GATE = PASS_02_GBW_PROFILE_IMPLEMENTED_RUNTIME_PROVEN_CLONE_ONLY_BROWSER_PROOF_PENDING
NEXT_RECOMMENDED_STEP = OWNER_REVIEW_THEN_EXPLICIT_MASTER_DATA_AND_BROWSER_PROOF_DECISION
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
```

## Required Ending

02 GOLD BY WEIGHT PROFILE IMPLEMENTATION COMPLETE
→ OWNER REVIEW
→ NEXT BATCH ONLY AFTER EXPLICIT APPROVAL
