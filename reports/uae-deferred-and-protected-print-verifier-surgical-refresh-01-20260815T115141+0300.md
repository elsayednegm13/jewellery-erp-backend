# UAE Deferred and Protected Print Verifier — Surgical Refresh 01

## Executive summary

تم تنفيذ إصلاح محدود في verifierين فقط. لم يتغير Product code أو Print template أو schema أو business data. السبب الأول كان أن `verify-invoices-search-print.js` اعتبر كل ملف تحت `backend/` ملف Product source، فقرأ تقريرًا موروثًا يحتوي عبارة UAE E-Invoicing. السبب الثاني كان أن `verify-barcode-tag-print-layouts.js` كان يفرض wiring قديمًا لصفحة Inventory، رغم أن الصفحة الحالية Asset-only ومعتمدة على `useInventoryV2List` وAsset identity.

بعد الإصلاح:

- كلا verifierين يحددان source scope صريحًا ومحدودًا.
- guard الخاص بـUAE لم يُحذف ولم يُعمل له bypass.
- verifier يفشل في negative control عند وجود token حقيقي داخل Product source.
- تقارير evidence التي تحتوي UAE/ASP/Peppol/UBL لا تسبب false positive.
- current Asset architecture والـbarcode/tag contracts تم التحقق منها.
- Persistent وAcceptance بقيا بلا كتابة أو migration.

## Owner policy decision

UAE E-Invoicing ما زال `DEFERRED_FUTURE_UPDATE`. هذا التقرير لا يدّعي compliance أو production readiness. أي إطلاق مستقبلي يحتاج قرار قانوني/تشغيلي منفصل وتحديث policy/verifier مخصص.

## Safety boundary

- `MODE = SURGICAL_VERIFIER_ONLY`.
- التغيير مسموح فقط في `scripts/verify-invoices-search-print.js` و`scripts/verify-barcode-tag-print-layouts.js`، والتقرير، وhandoff بعد اكتمال PASS.
- لا Product runtime، لا Print template، لا API، لا DB، لا migration، لا seed، لا fixture business، لا restart، لا deploy، لا Git history operation.

## Worktree baseline

Branch `main`; HEAD `1657b0e9ba580faef69be48f04637835c201b521`. الـworktree inherited/dirty مع تغييرات كثيرة من batches سابقة، 11 stash، ولا staged files في بداية الدفعة. لم أستخدم reset/restore/checkout/clean/stash/add/commit/push.

Versions: Node `v22.22.0`, npm `10.9.4`, Next `v16.2.9`. Known inherited `next-env.d.ts` drift remained untouched. `backend/package.json` و`backend/package-lock.json` remained inherited modified files; لم يتغيرا في هذه الدفعة.

## Persistent/Acceptance baseline

Read-only identity checks:

| Database | Initial migrations | Final migrations | Delta |
|---|---:|---:|---:|
| `darfus_erp` | 81 | 81 | 0 |
| `darfus_erp_inventory_rehearsal_20260804_160500z` | 80 | 80 | 0 |

No INSERT/UPDATE/DELETE/DDL/migration/seed/fixture was executed. The direct catalog query returned `current_database()` matching the exact database on each connection.

## Pre-fix verifier reproduction

### Invoice Search & Print verifier

Command: `node scripts/verify-invoices-search-print.js`.

Exit `1`. First assertion: `no UAE E-Invoicing code added` at `scripts/verify-invoices-search-print.js:183`. The old implementation joined all changed and untracked files matching `app|components|features|lib|backend`, including `backend/reports/**`. The inherited post-migration report was the proven text match. This was deterministic and skipped the remaining checks after the first assertion.

### Barcode/tag verifier

Command: `node scripts/verify-barcode-tag-print-layouts.js`.

Exit `1`. First assertion: `generic/product label flow preserved on the inventory page` at `scripts/verify-barcode-tag-print-layouts.js:51`. The current inventory route is intentionally Asset-only and no longer owns Product quantity label wiring. The generic `BarcodePrintTemplate`, client tag template, tag faces, mapper, and scanner still exist.

## Root cause confirmation — Invoice verifier

Old assumption: every changed file under broad application/backend roots was implementation evidence.

New bounded rule: only files under `app/`, `components/`, `features/`, `lib/`, `backend/src/`, `backend/migrations/`, and `backend/config/` with source extensions (`ts`, `tsx`, `js`, `jsx`, `cjs`, `mjs`) are scanned. Reports, evidence, backups, prompts, docs, generated output, `node_modules`, coverage, and build output are excluded from the implementation scan.

The source guard still fails closed when a forbidden UAE E-Invoicing/UBL token appears in authoritative Product source. It is not an unconditional pass.

## Root cause confirmation — Barcode/tag verifier

Old assumption: the current inventory page must still contain the removed Product label wiring (`BarcodePrintTemplate` and `productToLabelData`).

New bounded rule: verify the approved Asset architecture:

- Inventory entry point uses `useInventoryV2List` and describes one physical Asset per row.
- Asset detail uses `useInventoryV2Detail` and preserves `asset.id`/`asset.barcode` identity.
- `BarcodeLabelPreview` retains permission-gated `handlePrint`, `BarcodePrintTemplate`, and `printHtmlDocument` capability.
- `assetToLabelData` and `assetToTagData` preserve stored barcode identity.
- Generic and client tag templates, faces, scanner, type layouts, and metadata contracts remain present.
- The inventory page does not reintroduce Product/quantity authority.

No Product source was changed to satisfy the obsolete assertion.

## Exact verifier changes

| File | Old assumption | New bounded rule | Protection preserved |
|---|---|---|---|
| `scripts/verify-invoices-search-print.js` | broad changed-file scan included reports | explicit authoritative source roots/extensions; exported scanner for negative control | real source UAE/UBL and event-sourcing tokens still fail |
| `scripts/verify-barcode-tag-print-layouts.js` | old Product wiring required on Inventory page; broad artifact/backend scope | Asset-only architecture assertions; print-scope filtering; bounded source scan; exported pure helpers | generic/client templates, barcode identity, permission, deletion and semantic checks remain |
| `PROJECT_PROGRESS_HANDOFF.md` | no closeout entry for this refresh | records deferred policy and verifier refresh PASS | no Product or legal compliance claim |
| report file | absent | evidence only | no runtime effect |

`VERIFIER_CHANGE_EXPLANATION_TABLE = COMPLETE`.

## UAE deferred-policy semantics

`UAE_EINVOICING_CURRENT_IMPLEMENTATION = DEFERRED`.
`UAE_EINVOICING_CURRENT_SCOPE = FUTURE_UPDATE`.
`UAE_EINVOICING_RELEASE_BLOCKER = NO_FOR_CURRENT_APPROVED_SCOPE`.
`UAE_PRODUCTION_INTEGRATION = NOT_IMPLEMENTED`.
`ASP_INTEGRATION = FUTURE`.
`PEPPOL_UBL_INTEGRATION = FUTURE`.
`REGISTRATION_CERTIFICATION_SANDBOX = FUTURE`.

The guard distinguishes absent/deferred feature from unapproved source introduction. It does not encode legal compliance and does not claim UAE readiness.

## Current Asset wiring semantics

Current `/inventory` is the canonical Asset-only All Items page. Its server-backed list carries Asset ID, stored barcode, RFID relation, profile, operational status, branch, and descriptive fields. The Asset detail page reads the same canonical Asset authority. Barcode/tag rendering remains in the existing shared print components and mapper contracts; the permission-gated label preview retains its print handler and shared generic template. Product quantity is not used as physical inventory authority.

`OLD_INVENTORY_WIRING_REQUIRED_BY_VERIFIER = NO`.
`CURRENT_ASSET_WIRING_VERIFIED = YES`.
`ASSET_PHYSICAL_AUTHORITY_PRESERVED = YES`.

## Negative controls

An isolated temporary directory outside the repository was created and removed in-process:

1. `backend/src/forbidden.js` containing `UAE E-Invoicing` caused the scanner to fail detection (`UAE_VERIFIER_NEGATIVE_CONTROL = PASS`).
2. `backend/reports/evidence.md` containing `UAE E-Invoicing`, `ASP`, `Peppol`, and `UBL` was ignored (`UAE_REPORT_FALSE_POSITIVE_REGRESSION = PASS`).
3. Removing `useInventoryV2List` from an in-memory Asset-page fixture caused the Asset architecture assertion to fail (`BARCODE_TAG_VERIFIER_NEGATIVE_CONTROL = PASS`).

The temporary directory was removed; no repository source was changed by the controls.

## Post-fix verifier runs

- `node scripts/verify-invoices-search-print.js` → exit `0`, `verify-invoices-search-print: ok`.
- `node scripts/verify-barcode-tag-print-layouts.js` → exit `0`, `verify-barcode-tag-print-layouts: ok`.
- `node --check scripts/verify-invoices-search-print.js` → PASS.
- `node --check scripts/verify-barcode-tag-print-layouts.js` → PASS.

CRLF materialization warnings from Git are inherited worktree warnings only; they did not alter files.

## Print/snapshot/barcode regression

- Invoice Snapshot contract tests: 5/5 PASS.
- `verify-invoice-print-view-model.js`: PASS.
- `verify-print-builder-config.js`: PASS.
- `verify-print-template-config.js`: PASS.
- `verify-print-company-info.js`: PASS.
- Existing post-migration runtime evidence confirms old NULL snapshot safety, new immutable snapshot read, print authorization, Company isolation, and no live Customer contact lookup.
- Barcode/tag verifier: PASS with current Asset architecture.

`TARGETED_PRINT_TESTS = PASS`.
`TARGETED_SNAPSHOT_PRINT_TESTS = PASS`.
`TARGETED_PRINT_AUTH_TESTS = PASS`.
`TARGETED_BARCODE_TAG_PRINT_TESTS = PASS`.

## Snapshot and inventory law preservation

`INVOICE_SNAPSHOT_CONTRACT_CHANGED = NO`.
`PRINT_LIVE_CUSTOMER_CONTACT_LOOKUP = NO`.
`INVENTORY_PHYSICAL_AUTHORITY_CHANGED = NO`.
`PRODUCT_QUANTITY_REINTRODUCED_AS_PHYSICAL_AUTHORITY = NO`.
`PRINT_TEMPLATE_CHANGED_THIS_BATCH = NO`.

## TypeScript, lint, syntax

`npx tsc --noEmit --pretty false` exited `0`. Focused ESLint exited `0` with one pre-existing `@next/next/no-img-element` warning in `ReceiptPrintTemplate.tsx` and zero errors. Both verifier syntax checks passed.

## Closed-stream non-regression

Customer Master, POS Customer Summary, Invoice Snapshot, and Supplier Receive were not reopened or modified. Accounting, Inventory, Payment, VAT, Gold, CGP, and runtime APIs were not changed.

`CUSTOMER_MASTER_REGRESSED = NO`.
`POS_CUSTOMER_SUMMARY_REGRESSED = NO`.
`INVOICE_SNAPSHOT_REGRESSED = NO`.
`SUPPLIER_RECEIVE_REGRESSED = NO`.

## Environment/package/Git/runtime safety

`RUNTIME_ENV_CHANGED = NO`; `NEXT_ENV_MUTATED_THIS_BATCH = NO`; `PACKAGE_JSON_CHANGED = NO`; `PACKAGE_LOCK_CHANGED = NO`; normal frontend/backend processes were not restarted or killed; Redis/PostgreSQL were not restarted; no server deployment or Git write occurred.

## Exact changed files

Files owned by this batch:

1. `scripts/verify-invoices-search-print.js`
2. `scripts/verify-barcode-tag-print-layouts.js`
3. `PROJECT_PROGRESS_HANDOFF.md`
4. this report

All other dirty paths are inherited and were preserved.

## Final gate

`UAE_DEFERRED_AND_PROTECTED_PRINT_VERIFIER_SURGICAL_REFRESH_01_GATE = PASS_CONFIRMED`.

The PASS is limited to verifier correctness and evidence. It does not start Government Integration, UAE E-Invoicing implementation, or any other remediation.

## Required tokens

CURRENT_BATCH = UAE-DEFERRED-AND-PROTECTED-PRINT-VERIFIER-SURGICAL-REFRESH-01
OWNER_UAE_DECISION = DEFERRED_FUTURE_UPDATE
UAE_EINVOICING_RELEASE_BLOCKER = NO_FOR_CURRENT_APPROVED_SCOPE
PERSISTENT_MIGRATIONS_INITIAL = 81
PERSISTENT_MIGRATIONS_AFTER = 81
ACCEPTANCE_MIGRATIONS_INITIAL = 80
ACCEPTANCE_MIGRATIONS_AFTER = 80
INVOICES_SEARCH_PRINT_VERIFIER_PATH = scripts/verify-invoices-search-print.js
INVOICES_SEARCH_PRINT_VERIFIER_PRE_FIX = FAIL_REPRODUCED
INVOICES_SEARCH_PRINT_PRE_FIX_ASSERTION = no UAE E-Invoicing code added at line 183
REPORT_FILES_TREATED_AS_PRODUCT_SOURCE = NO
VERIFIER_SOURCE_SCOPE = EXPLICIT_AND_BOUNDED
UAE_DEFERRED_POLICY_REPRESENTED = YES
UAE_VERIFIER_UNCONDITIONAL_BYPASS = NO
UAE_COMPLIANCE_CLAIM_INTRODUCED = NO
BARCODE_TAG_PRINT_VERIFIER_PATH = scripts/verify-barcode-tag-print-layouts.js
BARCODE_TAG_PRINT_VERIFIER_PRE_FIX = FAIL_REPRODUCED
BARCODE_TAG_PRE_FIX_ASSERTION = generic/product label flow preserved on the inventory page at line 51
OLD_INVENTORY_WIRING_REQUIRED_BY_VERIFIER = NO
CURRENT_ASSET_WIRING_VERIFIED = YES
ASSET_PHYSICAL_AUTHORITY_PRESERVED = YES
UAE_VERIFIER_NEGATIVE_CONTROL = PASS
BARCODE_TAG_VERIFIER_NEGATIVE_CONTROL = PASS
UAE_REPORT_FALSE_POSITIVE_REGRESSION = PASS
INVOICES_SEARCH_PRINT_VERIFIER_POST_FIX = PASS
BARCODE_TAG_PRINT_VERIFIER_POST_FIX = PASS
TARGETED_PRINT_TESTS = PASS
TARGETED_SNAPSHOT_PRINT_TESTS = PASS
TARGETED_PRINT_AUTH_TESTS = PASS
TARGETED_BARCODE_TAG_PRINT_TESTS = PASS
VERIFIER_SYNTAX_CHECK = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
INVOICE_SNAPSHOT_CONTRACT_CHANGED = NO
PRINT_LIVE_CUSTOMER_CONTACT_LOOKUP = NO
INVENTORY_PHYSICAL_AUTHORITY_CHANGED = NO
PRODUCT_QUANTITY_REINTRODUCED_AS_PHYSICAL_AUTHORITY = NO
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_WRITES_THIS_BATCH = 0
PRODUCT_CODE_CHANGED_THIS_BATCH = NO
PRINT_TEMPLATE_CHANGED_THIS_BATCH = NO
VERIFIER_CODE_CHANGED_THIS_BATCH = YES
RUNTIME_ENV_CHANGED = NO
PACKAGE_JSON_CHANGED = NO
PACKAGE_LOCK_CHANGED = NO
NORMAL_FRONTEND_RESTARTED = NO
NORMAL_BACKEND_RESTARTED = NO
NORMAL_RUNTIME_PROCESS_KILLED = NO
REDIS_RESTARTED = NO
POSTGRES_RESTARTED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
GIT_PUSHES_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_MUTATIONS = 0
SERVER_DEPLOYMENTS = 0
CUSTOMER_MASTER_REGRESSED = NO
POS_CUSTOMER_SUMMARY_REGRESSED = NO
INVOICE_SNAPSHOT_REGRESSED = NO
SUPPLIER_RECEIVE_REGRESSED = NO
VERIFIER_CHANGE_EXPLANATION_TABLE = COMPLETE
HANDOFF_UPDATED = YES_IF_PASS
UAE_DEFERRED_AND_PROTECTED_PRINT_VERIFIER_SURGICAL_REFRESH_01_GATE = PASS_CONFIRMED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = PROJECT-REMAINING-WORK-STATUS-RECONCILIATION-01
