# DARFUS ERP — Inventory Authority Foundation Implementation 01A

Batch: `DARFUS-INVENTORY-AUTHORITY-FOUNDATION-IMPLEMENTATION-01A`  
Mode: `MINIMUM_SAFE_IMPLEMENTATION_WITH_FOCUSED_TESTS_AND_RUNTIME_PROOF`

## Executive Summary

Implemented the minimum authority-path changes for the five final client inventory profiles:

- Server-authoritative final-profile classification.
- Fail-closed Supplier Receive gate requiring V2/per-piece input.
- Product quantity isolation in POS search and canonical sale.
- Product quantity rejection in canonical return/exchange compatibility branches for final profiles.
- Supplier UI guard that disables the legacy quantity option for final profiles.
- Current DB guardrail wording aligned to official `darfus_erp` without deleting historical acceptance evidence.

No migration, Gold formula fix, barcode replacement, status schema, master-data provisioning, or client profile screen work was performed.

## Pre-change Baseline

- Accepted source authority remained `WORKTREE_CONTENT_PLUS_APPROVED_MANIFEST`; HEAD alone was not treated as release source.
- Pre-change Git state: branch `main`, HEAD `1657b0e9ba580faef69be48f04637835c201b521`, 86 tracked-status files, 218 untracked files, 11 stashes. No cleanup, reset, restore, stash, add, commit, or push was performed.
- Candidate source files already contained unrelated/pre-existing worktree changes. They were not cleaned or claimed as part of 01A.
- Read-only runtime: backend, PostgreSQL, and Redis were up; `/api/health`, `/api/health/db`, `/api/health/redis`, and `/api/health/gold` returned 200.
- Official DB read-only check: `current_database() = darfus_erp`, SequelizeMeta count `81`, assets `0`, products `0`.
- The official DB was not used for mutation proof.

## Guardrail Alignment

Changed only current-authority wording in `AGENTS.md` and the authoritative header of `PROJECT_PROGRESS_HANDOFF.md`:

- Official persistent DB is `darfus_erp`.
- Mutating rehearsal requires a disposable clone or explicit Owner-approved rehearsal.
- Direct persistent mutation requires explicit Owner approval, exact target/baseline checks, and active-business-write verification.
- The old acceptance DB remains explicitly historical and was not deleted or rewritten in historical sections/scripts.

No `.env`, secret, API key, migration, or runtime database setting was changed.

## Final Profile Classification

Added the server-owned classifier in `backend/src/services/inventory-master-policy.service.js`:

- `isFinalClientInventoryProfile(profile)` recognizes all nine approved internal strategies and the approved top-level labels.
- `isFinalClientInventoryProduct(product)` recognizes explicit profile values and legacy Product type values (`gold-weight`, `gold-piece`, `diamond`, `gemstone`, `pearl`).
- `assessFinalClientSupplierReceive({ body, items })` produces the pure V2-required/reject decision used by the route.

Non-final legacy values such as `watch`, `CGP_CUSTOMER_GOLD_PURCHASE`, and unrelated legacy types remain outside the final-profile block.

## Supplier V2 Enforcement Change

At `/purchase-orders/receive` and its existing compatibility alias:

- The final-profile assessment runs before the route opens its DB transaction.
- A final-profile payload without `perPiece[]`, or with `productId`/`productCode`, fails with stable code `FINAL_CLIENT_PROFILE_V2_REQUIRED`.
- Valid V2 input continues through the existing `requireV2ReceiptPieces` path, which enforces integer document quantity and exact `perPiece.length`.
- The existing transaction continues to own PO, Asset, barcode, origin, cost evidence, movement, payable, accounting, and idempotency writes for accepted V2 input.
- Legacy non-final payloads retain the existing Product compatibility branch.

## Legacy Quantity Isolation

Final profiles cannot reach the legacy Product receive branch because the server gate rejects them before transaction work. No Product quantity columns or unrelated legacy workflows were removed.

The rejected path therefore performs no idempotency claim, PO write, Product write, Asset write, barcode allocation, movement write, payable write, or journal write. Runtime DB mutation proof of this contract is deferred because no safe mutation target was available.

## POS Product Fallback Isolation

`GET /pos/search` still supports Product results for non-final legacy scope. Product rows classified as final profiles are filtered from both normal and unavailable-exact Product projections. Asset results remain branch-scoped and are resolved through operational status and existing pricing logic.

No POS UI redesign was performed.

## Checkout Defense

The canonical sale orchestration used by `/pos/checkout` and the legacy immediate-invoice adapter now rejects a Product hit classified as a final profile with `FINAL_PROFILE_PRODUCT_SALE_FORBIDDEN`.

The guard is server-side and runs before Product quantity decrement, StockMovement creation, InvoiceItem creation, payment, or journal posting. Asset sales retain the existing Asset identity and status transition path.

## Return/Exchange Identity Review

The existing canonical return path already resolves exact returned Asset identity for serialized sales. Additional fail-closed guards now reject final-profile Product rows in:

- canonical returns: `FINAL_PROFILE_PRODUCT_RETURN_FORBIDDEN`;
- read-only exchange preview and canonical exchange execution: `FINAL_PROFILE_PRODUCT_EXCHANGE_FORBIDDEN`.

Non-final Product return/exchange compatibility remains available. No return/exchange redesign was performed.

## Files Changed

Intentional 01A files:

| File | Change | Scope |
|---|---|---|
| `AGENTS.md` | current official DB/rehearsal guardrail wording | documentation/guardrail |
| `PROJECT_PROGRESS_HANDOFF.md` | current authority header alignment | documentation/guardrail |
| `backend/src/services/inventory-master-policy.service.js` | classifier and Supplier Receive assessment | backend policy |
| `backend/src/routes/erp.routes.js` | receive, POS, sale, return, exchange guards | backend routes |
| `app/[locale]/(dashboard)/suppliers/purchases/page.tsx` | final-profile quantity-mode UI guard | frontend caller |
| `backend/tests/inventory-authority-foundation-01a.test.cjs` | focused classifier/contract tests | tests |
| `backend/reports/DARFUS-INVENTORY-AUTHORITY-FOUNDATION-IMPLEMENTATION-01A-REPORT.md` | this report | report output |

The backend route, policy, and Supplier page also had pre-existing worktree changes before 01A; unrelated hunks were preserved.

## Focused Tests

Passed after the implementation:

- 6/6 new 01A Node tests.
- 29/29 narrow Supplier/POS/profile-switch contract tests, including the 6 new 01A tests.
- `npm run typecheck` passed.
- `node --check` passed for the changed backend JavaScript files.
- `git diff --check` passed for changed tracked source files.

The focused tests cover final internal strategies, top-level labels, non-final compatibility, pure Supplier Receive rejection/acceptance decisions, POS Product exclusion contract, checkout/return/exchange guards, frontend UI guard, and guardrail wording.

## Static Proof

| Contract | Result | Evidence |
|---|---|---|
| `FINAL_PROFILE_CLASSIFIER` | IMPLEMENTED | `inventory-master-policy.service.js` classifier exports |
| `SUPPLIER_V2_SERVER_GATE` | IMPLEMENTED | `assessFinalClientSupplierReceive` + `FINAL_CLIENT_PROFILE_V2_REQUIRED` |
| `LEGACY_RECEIVE_FINAL_PROFILE_BLOCK` | IMPLEMENTED | assessment occurs before transaction creation |
| `POS_PRODUCT_FINAL_PROFILE_EXCLUSION` | IMPLEMENTED | filtered normal and exact Product projections |
| `CHECKOUT_FINAL_PROFILE_PRODUCT_GUARD` | IMPLEMENTED | `FINAL_PROFILE_PRODUCT_SALE_FORBIDDEN` |
| `RETURN_EXCHANGE_ASSET_IDENTITY` | PRESERVED | final-profile Product return/exchange guards; Asset paths unchanged |

## Runtime Proof

`RUNTIME_PROOF = BLOCKED`.

Reason: 01A persistent mutation proof is not authorized for `darfus_erp`, and no disposable clone or explicitly Owner-approved rehearsal target was available. The historical acceptance DB is not required by the current Owner decision and was not used as an automatic substitute.

Read-only runtime evidence passed, including service health, DB connectivity, Redis connectivity, and canonical Gold health. No server restart or deployment was performed.

## DB Assertions

Read-only assertions passed:

- exact DB target observed: `darfus_erp`;
- migrations observed: `81`;
- assets observed: `0`;
- products observed: `0`.

Mutation assertions for rejected receive, valid receive, idempotent replay, company/branch isolation, barcode cardinality, movements, payable, and balanced journals were **not run** because `RUNTIME_PROOF_TARGET = NONE_AVAILABLE`.

## Accounting/Payable Verification

No accounting or payable implementation was changed. Static inspection confirms accepted V2 receive still calls the existing purchase posting/payable path inside the existing transaction. Runtime journal/payable balance proof is blocked with the runtime target.

## Idempotency Verification

No idempotency implementation was changed. The new rejection gate occurs before idempotency claim, so rejected final-profile legacy payloads cannot poison an idempotency result. Valid replay/conflict runtime proof remains blocked with the runtime target.

## Legacy Compatibility Verification

| Legacy Consumer | Final Client Profile Blocked? | Non-final Compatibility Preserved? | Evidence |
|---|---:|---:|---|
| Supplier Receive legacy Product branch | YES | YES | server gate before branch; non-final branch unchanged |
| POS Product search | YES | YES | final Product rows filtered; Product query remains |
| Canonical POS/legacy sale adapter | YES | YES | server Product guard; Asset path unchanged |
| Canonical returns | YES | YES | final Product return rejected; non-final Product return remains |
| Exchange preview/execution | YES | YES | final Product path rejected; non-final Product replacement remains |
| Supplier UI quantity toggle | YES | YES | disabled for final profiles only |

No compatibility claim is made for mutation runtime behavior because that proof was not executed.

## Known Deferred Issues

- P1 deferred: Gold By Weight making currently has gross-weight consumers in purchase/current/POS valuation; Owner-approved correction belongs to `DARFUS-INVENTORY-GOLD-BY-WEIGHT-FINANCIAL-FORMULA-01B`.
- Barcode replacement/history schema remains deferred to the planned barcode authority batch.
- Status model schema foundations remain deferred.
- Master-data provisioning remains deferred.
- Runtime mutation proof and full Supplier → Asset → Barcode → Movement → Accounting/Payable replay proof remain blocked by safe-target availability.

## Risk / Regression Matrix

| Risk | Classification | Severity | Mitigation/evidence |
|---|---|---:|---|
| Final profile reaches Product receive | PRODUCT_DEFECT prevented | P1 | pretransaction server gate; 01A tests pass |
| POS returns final Product row | PRODUCT_DEFECT prevented | P1 | server Product filtering and exact-row exclusion |
| Direct Product sale bypass | PRODUCT_DEFECT prevented | P1 | canonical server guard |
| Historical non-final Product flow breaks | ACCEPTANCE_GAP | P2 | non-final branches preserved; focused regressions pass |
| Runtime accounting/idempotency regression | ACCEPTANCE_GAP | P1 until proof | no mutation target; runtime proof explicitly blocked |
| Gold gross/net economics | KNOWN_DEFERRED_P1 | P1 | no change in 01A; deferred to 01B |
| Worktree source drift | SOURCE_DRIFT | P2 | pre-existing 86/218 state preserved; no cleanup |

`REGRESSIONS_INTRODUCED = NONE_OBSERVED_STATIC_AND_FOCUSED; RUNTIME_NOT_RUN`.

## Gate

`GATE = PASS_STATIC_AND_TESTS_RUNTIME_PROOF_BLOCKED`

This is not a Runtime PASS. Static classification, focused tests, source guards, and read-only health passed. Controlled mutation proof remains explicitly blocked by the safety target rule.

## Next Recommended Step

Owner review, then provide an explicit disposable clone or Owner-approved rehearsal target for the 01A controlled runtime proof. Run only the representative Gold By Weight, Loose Diamond, and Loose Pearl receive/idempotency/POS/DB assertions after target approval. Do not start 01B automatically.

## Final Tokens

```text
CURRENT_BATCH = DARFUS-INVENTORY-AUTHORITY-FOUNDATION-IMPLEMENTATION-01A
MODE = MINIMUM_SAFE_IMPLEMENTATION_WITH_FOCUSED_TESTS_AND_RUNTIME_PROOF

OFFICIAL_DATABASE = darfus_erp
PERSISTENT_OFFICIAL_DB_MUTATION_AUTHORIZED_THIS_BATCH = NO

FINAL_CLIENT_PROFILE_COUNT = 5
PHYSICAL_INVENTORY_AUTHORITY = ASSET
PHYSICAL_STOCK_QUANTITY_AUTHORITY = NOT_ALLOWED

FINAL_PROFILE_CLASSIFIER_IMPLEMENTED = YES
SUPPLIER_V2_FINAL_PROFILE_GATE_IMPLEMENTED = YES
LEGACY_RECEIVE_FINAL_PROFILE_BLOCK_IMPLEMENTED = YES
POS_PRODUCT_FINAL_PROFILE_EXCLUSION_IMPLEMENTED = YES
CHECKOUT_FINAL_PROFILE_PRODUCT_GUARD_IMPLEMENTED = YES
RETURN_EXCHANGE_ASSET_IDENTITY_PRESERVED = YES

GUARDRAIL_ALIGNMENT_COMPLETED = YES_CURRENT_AUTHORITY_ONLY

PRODUCT_CODE_FILES_CHANGED = 3_INTENTIONAL_SOURCE_FILES
TEST_FILES_CHANGED = 1
DOCUMENTATION_GUARDRAIL_FILES_CHANGED = 2
MIGRATIONS_CREATED = 0
PERSISTENT_WRITES_OFFICIAL_DB = 0

FOCUSED_TESTS = 29_NARROW_TESTS_PLUS_TYPECHECK
FOCUSED_TESTS_PASS = YES
STATIC_PROOF = PASS
RUNTIME_PROOF = BLOCKED_NO_SAFE_TARGET
RUNTIME_PROOF_TARGET = NONE_AVAILABLE
DB_ASSERTIONS = READ_ONLY_ONLY
ACCOUNTING_PAYABLE_PROOF = STATIC_PRESERVATION_RUNTIME_BLOCKED
IDEMPOTENCY_PROOF = STATIC_PRESERVATION_RUNTIME_BLOCKED
LEGACY_COMPATIBILITY_PROOF = STATIC_AND_FOCUSED_ONLY

GOLD_BY_WEIGHT_FORMULA_FIX_THIS_BATCH = NO
BARCODE_REPLACEMENT_IMPLEMENTATION_THIS_BATCH = NO
STATUS_SCHEMA_IMPLEMENTATION_THIS_BATCH = NO
MASTER_DATA_PROVISIONING_THIS_BATCH = NO
CLIENT_PROFILE_SCREEN_IMPLEMENTATION_THIS_BATCH = NO

KNOWN_DEFERRED_P1 = GOLD_BY_WEIGHT_GROSS_NET_FORMULA
REGRESSIONS_INTRODUCED = NONE_OBSERVED_STATIC_AND_FOCUSED_RUNTIME_NOT_RUN

GATE = PASS_STATIC_AND_TESTS_RUNTIME_PROOF_BLOCKED
NEXT_RECOMMENDED_STEP = OWNER_APPROVED_SAFE_TARGET_THEN_CONTROLLED_01A_RUNTIME_PROOF
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
```

01A AUTHORITY FOUNDATION COMPLETE  
→ OWNER REVIEW  
→ NEXT BATCH ONLY AFTER EXPLICIT APPROVAL
