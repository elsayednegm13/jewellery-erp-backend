# SUPPLIER-CLONE-BRANCH-FINANCIAL-MAPPING-RESOLUTION-01

## Execution

- Mode: clone-only financial-mapping resolution; Persistent and Acceptance source were SELECT-only.
- Source: `darfus_erp_inventory_rehearsal_20260804_160500z` (`current_database()` verified before dump).
- Disposable clone: uniquely named `darfus_erp_supplier_mapping_resolution_*`; created from the Acceptance source and dropped in `finally`.
- No migration, `.env` edit, restart, deployment, or destructive Git action.

## Root cause

The previous runner selected the first active branch by ID, `BR-C10-1785859057817` (`C10D`, `C10 Destination`), rather than the mapped operational branch `BR-cf387f66-0904-471e-85b8-9346ac3dbb03` (`MAIN`). The source copy was correct: MAIN had exactly 11 active mappings, while C10 had zero active `BranchFinancialMapping` rows and zero branch `SystemAccountRole` rows. The first Supplier Receive posting line is the inventory debit (`accountCode=1200`), so the first exact failing role was `INVENTORY_ASSET`; `SUPPLIER_PAYABLE` would also be required for the unpaid credit. This was a missing branch configuration, not an ambiguous duplicate and not a defective resolver.

`resolveRequiredBranchFinancialAccount` remained fail-closed (`active count !== 1` => `FINANCIAL_MAPPING_REQUIRED`). The fresh clone reproduced `422 FINANCIAL_MAPPING_REQUIRED` before configuration.

## Role and mapping evidence

The canonical `BRANCH_MAPPING_CATALOG` contains 11 required branch roles: CASH_TREASURY, BANK_ACCOUNT, ACCOUNTS_RECEIVABLE, SUPPLIER_PAYABLE, INVENTORY_ASSET, COST_OF_GOODS_SOLD, SALES_REVENUE, RESERVATION_ADVANCE_LIABILITY, DEFAULT_EXPENSE, OTHER_INCOME, and VAT_PAYABLE. Acceptance MAIN and Persistent each contain one active row for every role with matching stable `SYS-*` account semantics. C10 contained zero active rows in the clone.

`paid=0`, no-VAT Supplier Receive requires the inventory debit and Supplier Payable credit; cash/bank mappings are not used by this proof. All profile families share the same branch mapping authority; no profile-specific mapping fallback exists.

## Controlled clone resolution

The existing canonical `POST /financial/reconcile` path was used in the clone with explicit company/branch context and `dryRun=false`. `financialBootstrapService.reconcile` resolved stable account-role definitions server-side, created 12 branch SystemAccountRole rows and 11 active BranchFinancialMapping rows, and returned `READY`. No client Account ID, hardcoded ID, branch fallback, or resolver weakening was used. The route emitted the existing `financial_configuration.reconciled` audit action (audit count delta +1 in the clone).

`CLONE_MAPPING_MUTATION_COUNT=11`; the extra 12 role rows are configuration support, not business transactions. No account rows were created (`createdAccounts=0`).

## Minimal Supplier proof

After resolution, the same real `POST /purchase-orders/receive` path returned `201` for one serialized physical piece (`GOLD_BY_PIECE` used only to avoid requiring unrelated Gold Market settings in this mapping-only proof). Results:

- PO total `100`, paid `0`, remaining `100`, payment status `unpaid`.
- One PurchaseOrderItem, one Asset, one unique barcode, one current purchase-cost revision.
- Asset remained V2 `AVAILABLE`, with one-piece identity and no Product quantity authority.
- Journal debit `100` to `SYS-INVENTORY`, credit `100` to `SYS-AP`; balanced.
- Treasury transaction was `null` for `paid=0`.
- Same idempotency key replay returned `201` and the same PO; counts for PO/Asset/PO item/revision/Journal increased only once and Treasury increased zero.

## Preservation and integrity

Read-only checks after clone cleanup:

- Acceptance source: migrations `80`, Assets `475`, Products `3`, 11 active mappings on MAIN, no duplicate active mapping role.
- Persistent `darfus_erp`: migrations `80`, Assets `62`, Products `3`, the same 11 active MAIN mappings. No Persistent mutation occurred.
- Persistent signed-ledger query observed `SYS-CASH=5008829.8130` and `SYS-BANK=199085.3241`; these are current read-only values and were not changed by this batch. Posted journals were balanced, orphan JournalLines `0`, unlinked posted Treasury `0`, duplicate journal sources `0`, duplicate Treasury journal links `0`; one OPEN cash-register session remained.
- Duplicate and blank Asset primary barcodes were `0` in both inspected databases.
- Clone database list after cleanup was empty; only the exact generated clone was dropped.

## Source/process safety

- Production business source changed: `NO`; only the disposable-clone runner was added/updated.
- Financial resolver fail-closed semantics preserved.
- Acceptance source and Persistent mapping rows remained unchanged.
- Gold runtime and dispatcher configuration were not changed; no Gold provider request was made by this batch.
- Read-only `gold_market_settings` verification on Persistent remained
  `GOLDAPI_IO / LIVE_PROVIDER / AED / refresh=1500 / stale=2500 / enabled=true`;
  Acceptance has no GoldMarketSetting row and was not modified.
- `next-env.d.ts` retained inherited known drift SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`; no Next dev was run.
- Focused Node tests: PASS (9/9 mapping/supplier cases plus 4/4 CGP-isolation/closeout contracts); TypeScript: PASS; focused ESLint: PASS.

## Final tokens

```text
CURRENT_BATCH = SUPPLIER-CLONE-BRANCH-FINANCIAL-MAPPING-RESOLUTION-01
MODE = CLONE_ONLY_FINANCIAL_MAPPING_RESOLUTION
PERSISTENT_DATABASE = darfus_erp
ACCEPTANCE_SOURCE = darfus_erp_inventory_rehearsal_20260804_160500z
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
CLONE_ONLY_MUTATION = YES
FINANCIAL_MAPPING_BLOCKER_ROOT_CAUSE = WRONG_BRANCH_SELECTED; selected C10 had zero active roles/mappings while MAIN had all 11
SUPPLIER_RECEIVE_REQUIRED_FINANCIAL_ROLE_MATRIX = COMPLETE
FINANCIAL_MAPPING_FAILURE_BOUNDARY = after normalization/PO stage, at posting inventory account resolution before commit
MAPPING_FAILURE_BEFORE_PERSISTENT_COMMIT = PASS
ACCEPTANCE_MAPPING_INVENTORY = COMPLETE
PERSISTENT_MAPPING_COMPARISON = COMPLETE
HARDCODED_ACCOUNT_IDS_USED = NO
CONTROLLED_FINANCIAL_MAPPING_PATH = POST /financial/reconcile -> financialBootstrapService.reconcile
DISPOSABLE_CLONE_GUARD = PASS
FRESH_CLONE_MAPPING_BLOCKER_REPRODUCED = PASS
EXACT_FAILED_MAPPING_ROLE = INVENTORY_ASSET (SUPPLIER_PAYABLE is the second required unpaid role)
EXACT_FAILED_MAPPING_REASON = MISSING
CLONE_MAPPING_RESOLUTION_PLAN = SAFE_AND_CANONICAL
CLONE_MAPPING_MUTATION_COUNT = 11
PERSISTENT_MAPPING_MUTATION_COUNT = 0
ACCEPTANCE_MAPPING_MUTATION_COUNT = 0
CLONE_MAPPING_AUDIT_PATH = PASS
COMPANY_BRANCH_SECURITY_PRESERVED = PASS
MINIMAL_SUPPLIER_RECEIPT_CROSSES_MAPPING_GATE = PASS
MINIMAL_RECEIPT_POSTING_ASSERTIONS = PASS
GOLD_BAR_CONTRACT_NONREGRESSION = PASS
SUPPLIER_PAYABLE_AUTHORITY_NONREGRESSION = PASS
ASSET_COST_VS_PAYABLE_NONREGRESSION = NOT_APPLICABLE
CLONE_RECEIPT_JOURNAL_INTEGRITY = PASS
CLONE_RECEIPT_IDEMPOTENCY = PASS
CLONE_CASH_MAPPING_READINESS = READY
CLONE_BANK_MAPPING_READINESS = READY
ALL_SUPPLIER_PROFILE_MAPPING_READINESS_MATRIX = COMPLETE
FINANCIAL_MAPPING_FAIL_CLOSED_PRESERVED = PASS
PRODUCTION_BUSINESS_SOURCE_CHANGED = NO
ACCEPTANCE_SOURCE_PRESERVED = PASS
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
DISPOSABLE_CLONE_DROPPED = PASS
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
GOLD_RUNTIME_1500_2500_PRESERVED = PASS
GOLD_PROVIDER_CALL_ECONOMY = PASS
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO
RUNTIME_ENV_CHANGED = NO
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
CGP_RUNTIME_DISPATCH_ENV = inherited backend/.env value true; not changed
GLOBAL_DISPATCHER_EFFECTIVE_STATE = OFF; not changed
CGP_DISPATCHER_MUTATED_THIS_BATCH = NO
MANUAL_RUNTIME_RESTART_THIS_BATCH = NO
NEXT_DEV_STARTED_OR_RESTARTED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
TARGETED_FINANCIAL_MAPPING_TESTS = PASS
TARGETED_MAPPING_AMBIGUITY_TESTS = PASS
TARGETED_COMPANY_BRANCH_SCOPE_TESTS = PASS
TARGETED_SUPPLIER_POSTING_TESTS = PASS
TARGETED_CLONE_GUARD_TESTS = PASS
TARGETED_IDEMPOTENCY_TESTS = PASS
TARGETED_GOLD_BAR_NONREGRESSION_TESTS = PASS
TARGETED_SUPPLIER_PAYABLE_NONREGRESSION_TESTS = PASS
TARGETED_CGP_ISOLATION_TESTS = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
HANDOFF_CLONE_FINANCIAL_MAPPING_RESOLUTION_ACCURATE = YES
SUPPLIER_CLONE_BRANCH_FINANCIAL_MAPPING_RESOLUTION_01_GATE = PASS_CONFIRMED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = SUPPLIER-GOLD-BAR-RECEIPT-PRICING-E2E-CLOSEOUT-01-RERUN_IF_PASS
```
