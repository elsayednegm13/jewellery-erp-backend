# UAE E-Invoicing and Protected Print Verifier — Forensic 01

## Executive summary

هذه دفعة قراءة فقط. لم يتغير Product code أو أي verifier، ولم تُشغّل migration أو seed أو fixture، ولم تُكتب أي قاعدة بيانات. تم إثبات فشل verifier الخاص ببحث/طباعة الفواتير وفشل أقرب verifier لحماية طباعة الباركود، لكن لا يوجد من الدليل الحالي عطل Product في طباعة الفواتير أو Invoice Snapshot. فشل UAE ناتج عن sentinel/نطاق فحص قديم يقرأ تقريرًا موروثًا داخل `backend/reports` كأنه ملف code. فشل Protected Print ناتج عن baseline قديم لا يعترف بتغيير Batch 7 المعتمد في صفحة المخزون إلى Asset-only؛ القالب العام ما زال موجودًا.

النتيجة القانونية لا يمكن حسمها من مستودع الكود: انطباق UAE eInvoicing على DARFUS يحتاج قرار Owner موثقًا عن النشاط، نطاق B2B/B2G، الاستثناءات، الإيراد/المرحلة، وASP. لذلك لا توجد أي إضافة eInvoicing في هذه الدفعة.

## Supplier closure/entry state

`SUPPLIER_RECEIVE_RUNTIME_STREAM = CLOSED` كما هو في handoff وآخر تقرير Supplier. لم أعد فتح Supplier، ولم أستخدم مسارات mutation.

## Safety boundary

- `FORENSIC_MODE = READ_ONLY`.
- Persistent `darfus_erp`: SELECT/قراءة فقط.
- Acceptance `darfus_erp_inventory_rehearsal_20260804_160500z`: قراءة فقط.
- لا migration، seed، fixture، upload، print submission، أو business transaction.
- لم يحدث تعديل في handoff، env، Git، verifier، print template، Invoice Snapshot، POS، Customer، Accounting، Inventory، Payment، VAT، أو Gold.

## Worktree baseline

`main`, HEAD `1657b0e9ba580faef69be48f04637835c201b521`. الـworktree موروث ومتسخ؛ لا يوجد staged file في بداية الدفعة، وتوجد تغييرات tracked/untracked كثيرة من batches سابقة، و11 stash، ولا توجد remotes ظاهرة في `git remote -v`. لم أستخدم reset/restore/checkout/clean/stash/add/commit/push.

Relevant hashes:

| File | SHA-256 | Classification |
|---|---|---|
| `backend/package.json` | `231A19D0A81C2579F4D1B8E4D676A7085BA6811516630B811627B58A5CB3A86B` | inherited modified |
| `backend/package-lock.json` | `A2E65BF8D4EBBFF9CE559532130DC896433A931C5B6515102FC48149FE602551` | inherited modified |
| `next-env.d.ts` | `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` | known inherited drift; untouched |
| `scripts/verify-invoices-search-print.js` | `8A7CD75C2FDAF5FE19240DBE44A7A62509D259131A1F0F75C4755D634A38CA60` | verifier untouched |
| `scripts/verify-barcode-tag-print-layouts.js` | `2468E5226922FAB6BCEC4F3A4E26E0A6817DBFD192188CB22E6F26C670D4F14A` | verifier untouched |

Toolchain: Node `v22.22.0`, npm `10.9.4`, Next `v16.2.9`; repository package manager is npm. `.next` and `node_modules` existed before the audit. No cleanup was done.

## Verifier inventory table

| Verifier | Purpose | Command | Safe | Relevant result |
|---|---|---|---|---|
| `scripts/verify-invoices-search-print.js` | Search/print read-only contract, scope guard, UAE deferred sentinel | `node scripts/verify-invoices-search-print.js` | Yes, static | FAIL at line 183: `no UAE E-Invoicing code added` |
| `scripts/verify-barcode-tag-print-layouts.js` | Generic/client barcode layout preservation and forbidden-area guard | `node scripts/verify-barcode-tag-print-layouts.js` | Yes, static | FAIL at line 51 before scope guard: generic/product label flow assertion |
| `scripts/verify-invoice-print-view-model.js` | Invoice print view-model source authority | same | Yes | PASS |
| `scripts/verify-print-builder-config.js` | print builder configuration | same | Yes | PASS |
| `scripts/verify-print-template-config.js` | template selection/configuration | same | Yes | PASS |
| `scripts/verify-print-company-info.js` | company information print contract | same | Yes | PASS |
| `backend/tests/customer-invoice-snapshot-implementation-01.test.cjs` | additive nullable snapshot contract | `node --test ...` | Yes | 5/5 PASS |

لا يوجد ملف منفصل اسمه `protected-print-verifier`; أقرب verifier محمي حاليًا هو `verify-barcode-tag-print-layouts.js`.

## UAE verifier failure reproduction

Command: `node scripts/verify-invoices-search-print.js` from repository root. Timestamp `2026-08-15T11:24:27.8425890+03:00` to `2026-08-15T11:24:29.2407937+03:00`; exit code `1`. First assertion:

`AssertionError [ERR_ASSERTION]: no UAE E-Invoicing code added` at `scripts/verify-invoices-search-print.js:183`.

The verifier builds `allChanged` from `git diff --name-only HEAD` plus all untracked files, then classifies every path under `backend/` as a code file. The only matching text-file offender found in the current worktree is the inherited report `backend/reports/customer-invoice-snapshot-post-migration-runtime-observation-and-owner-signoff-01-20260815T064837Z.md`, which contains the phrase while documenting the previous verifier failure. The verifier therefore conflates report evidence with Product code. The check is deterministic and the subsequent documentation checks were skipped.

This is a technical deferred-feature sentinel, not a legal finding and not evidence that structured eInvoicing was implemented.

## Protected Print verifier failure reproduction

Command: `node scripts/verify-barcode-tag-print-layouts.js` from repository root. Timestamp `2026-08-15T11:24:27.8441280+03:00` to `2026-08-15T11:24:27.9290607+03:00`; exit code `1`. First assertion:

`AssertionError [ERR_ASSERTION]: generic/product label flow preserved on the inventory page` at `scripts/verify-barcode-tag-print-layouts.js:51`.

The current `app/[locale]/(dashboard)/inventory/page.tsx` is the approved later Asset-only inventory page and no longer contains the old `BarcodePrintTemplate`/`productToLabelData` path. The generic `features/printing/components/BarcodePrintTemplate.tsx` still exists, as do `ClientBarcodeTagTemplate.tsx`, barcode tag faces, and `ScannableBarcode.tsx`. The verifier fails before its scope/deletion/semantic checks, so this is not proof that a print template was deleted or that print rendering is broken.

## UAE assertion forensic table

| Assertion | Expected by verifier | Current evidence | Classification | Claim type |
|---|---|---|---|---|
| No UAE E-Invoicing/UBL text in changed code | no forbidden token anywhere under changed `app/components/features/lib/backend` | inherited report text is included because `backend/reports` is treated as code | `DEFERRED_FEATURE_SENTINEL` + scope defect | technical guard |
| UAE eInvoicing remains deferred in handoff/docs | explicit deferral text | existing reports/handoff preserve deferral | `VALID_CURRENT_GUARD` | policy guard |
| UAE legal applicability | proven in/out of scope | DARFUS revenue, B2B/B2G mix, exclusions, TRN/ASP onboarding not proven | `LEGAL_SCOPE_UNKNOWN` | legal/business decision |

## Official UAE source revalidation

The official Ministry of Finance eInvoicing portal is the authoritative source: [UAE eInvoicing portal](https://mof.gov.ae/en/about-us/initiatives/einvoicing/). The current official guideline is Version 1.1 dated 1 June 2026: [UAE Electronic Invoicing Guidelines V1.1](https://mof.gov.ae/wp-content/uploads/2026/06/UAE-Electronic-Invoicing-Guidelines_V-1.1-01June2026.pdf). It describes applicability to persons conducting business in the UAE, separates eInvoicing from the VAT Tax Invoice layer, and gives phased dates (including 1 January 2027 for entities at/above AED 50m and 1 July 2027 for entities below AED 50m). A later official notice extends ASP appointment timing for the larger band without changing the implementation deadline: [MoF targeted amendments](https://mof.gov.ae/en/news/ministry-of-finance-announces-targeted-amendments-to-einvoicing-system-decisions/).

These sources do not establish DARFUS's legal band or exclusions. `UAE_BUSINESS_APPLICABILITY = NOT_PROVEN_OWNER_CONFIRMATION_REQUIRED`.

## Layer separation

- VAT Tax Invoice: existing printable tax-invoice presentation and VAT values; this is not the UAE eInvoicing transport/structured-submission layer.
- UAE eInvoicing: no structured XML/UBL/PINT serialization, ASP adapter, transmission endpoint, acknowledgement lifecycle, certificate/credential handling, webhook, submission state, or eInvoice-specific retry/idempotency implementation was found.
- Print presentation: current read-only invoice/receipt templates and print options remain separate from both layers.

`CURRENT_UAE_EINVOICING_IMPLEMENTATION = NONE`.

## UAE regulatory gap matrix

| Requirement | Official source/date | DARFUS support | Gap / release impact | Owner decision |
|---|---|---|---|---|
| Determine covered Person/scope and exclusions | MoF Guideline V1.1, 2026-06-01 | business facts not in evidence | applicability unknown; no release claim | Required |
| Phase deadline selection | MoF Guideline V1.1 and MoF amendments, 2026 | revenue band/phase unknown | cannot schedule implementation | Required |
| ERP/ASP readiness and testing | MoF Guideline V1.1 | no eInvoicing implementation found | future readiness work, not proven current Product defect | Required |
| Structured submission/acknowledgement | official guideline | none found | future feature if in scope | Required |
| VAT invoice presentation | existing DARFUS print stack | existing templates and view-model pass static/runtime checks | separate layer; no gap proven here | No |

`UAE_EINVOICING_REGULATORY_GAP_MATRIX = COMPLETE`.
`UAE_EINVOICING_RELEASE_CLASSIFICATION = OWNER_LEGAL_SCOPE_CONFIRMATION_REQUIRED`.

## Protected Print guard architecture

`PROTECTED_PRINT_GUARD_TYPE = static architecture + changed-file scope + deletion detection + semantic regex + package/docs assertions`.

`PROTECTED_PRINT_BASELINE = current working tree against HEAD 1657b0e9ba580faef69be48f04637835c201b521 (historical baseline can be supplied by VERIFY_BARCODE_TAG_SCOPE_BASELINE)`.

Protected paths include the generic/client barcode templates, barcode faces, mapper, inventory type fields/form, inventory page, customer page, and forbidden backend/migration/invoice-print-template areas. The verifier also checks that no file is deleted and that UAE/even-sourcing/reset tokens are absent from its broad changed-file set.

| Path | Current evidence | Print impact | Classification |
|---|---|---|---|
| `app/[locale]/(dashboard)/inventory/page.tsx` | current Asset-only page; no old product-label tokens; SHA `3298CBC21E1972F122E0499CB9545D8847C1F6C0A30BFB0395D762B793A7E5C9` | verifier architecture assertion only; no deletion | `STALE_BASELINE_FALSE_POSITIVE` / `APPROVED_CHANGE_NOT_RECOGNIZED` |
| `features/printing/components/BarcodePrintTemplate.tsx` | file exists; SHA `C17B7F290EE981E6EA00D794921F6C78ABF0D648722F7D497D438B610AD12B4E` | generic template preserved | `APPROVED_SHARED_COMPONENT_CHANGE` (inherited) |
| `features/printing/components/ClientBarcodeTagTemplate.tsx` and barcode tag faces | files exist and are wired by current architecture | client tag path retained | `APPROVED_PRINT_CHANGE` (inherited) |

`PROTECTED_PRINT_CHANGED_FILE_TABLE = COMPLETE`.

## Current print architecture map

`/ar/sales/search-print` → `useInvoiceSearchPrint` → read-only invoice endpoint → invoice row/detail → `InvoiceDocument` → `InvoicePrintOptionsDialog` → `renderPrintDocument`/`printHtmlDocument` → selected A4/compact/minimal/thermal/exchange template. Receipt/deposit paths remain in their existing receipt templates. `invoice-print-view-model.ts` is the presentation boundary.

Approved contact authority is unchanged:

- `PRINT_NAME_SOURCE = INVOICE_CUSTOMER_NAME` (`invoice.customerName` / `customer_name`).
- `PRINT_PHONE_SOURCE = INVOICE_PHONE_SNAPSHOT` (`customer_phone_snapshot`).
- `PRINT_ADDRESS_SOURCE = INVOICE_ADDRESS_SNAPSHOT` (`customer_address_snapshot`).
- `PRINT_LIVE_CUSTOMER_CONTACT_LOOKUP = NO`.

Old invoices may contain NULL phone/address snapshots. They remain blank/unavailable; there is no current Customer substitution, address[0] fallback, reconstruction, or backfill. `INV-2026-000001` was opened through the normal read-only route and its NULL snapshot behavior remained safe. `INV-2026-000015` was read with non-NULL snapshots matching its stored sale-time evidence; no POST/PUT was made by this batch.

`OLD_INVOICE_PRINT_NULL_SNAPSHOT_SAFE = PASS`.
`NEW_INVOICE_SNAPSHOT_PRINT_READ = PASS`.
`PRINT_AUTHORIZATION = PASS`.
`PRINT_COMPANY_ISOLATION = PASS`.
`PRINT_PRIVACY_SCOPE = PASS`.
`PRINT_FINANCIAL_SOURCE_TRUTHFULNESS = PASS`.
`PRINT_TEMPLATE_RUNTIME_MATRIX = COMPLETE` (static template checks plus the prior approved runtime report; no physical printer required).

## Browser/runtime evidence

The already-running normal runtime was observed without restart. A read-only browser tab opened `http://localhost:3000/ar/sales/search-print`, rendered the Arabic Search & Print page, listed 17 invoices, opened `INV-2026-000015`, and opened the print-options dialog. The dialog exposed only document/template/language options and no mutation action was executed. Console contained only React DevTools informational output and `[HMR] connected`; no error or warning was observed. The tab was closed and browser tabs returned to an empty list.

The previous post-migration runtime report also records the old NULL-snapshot invoice, natural new snapshot invoice, company/branch/auth isolation, no 500, and no snapshot serialization errors. Existing normal backend/frontend processes on ports 8000/3000 were not restarted.

## Database fingerprints

All reads used direct SELECT/catalog queries and verified identity in the same connection.

| Database | SequelizeMeta | Invoices | Customers | Payments | Journal entries | Journal lines | Assets | Cash transactions | Suppliers | Purchase orders | Snapshot columns |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `darfus_erp` | 81 | 17 | 2 | 32 | 83 | 219 | 62 | 60 | 1 | 6 | present; 2 invoices have non-NULL snapshot data, 15 NULL |
| `darfus_erp_inventory_rehearsal_20260804_160500z` | 80 | 133 | 3 | 122 | 497 | 1423 | 475 | 173 | 1 | 314 | absent |

No before/after delta was introduced by this batch: `PERSISTENT_MIGRATIONS_INITIAL = 81`, `PERSISTENT_MIGRATIONS_AFTER = 81`, `ACCEPTANCE_MIGRATIONS_INITIAL = 80`, `ACCEPTANCE_MIGRATIONS_AFTER = 80`. The natural persistent invoice observed in the previous runtime report was not created by this batch and is not counted as a batch-owned write.

## Closed-stream non-regression

Customer Master, POS Customer Summary, Invoice Snapshot, Supplier Receive, Accounting, Inventory, Payment, VAT, and Gold streams were not reopened or modified. Existing focused snapshot/print tests passed; TypeScript passed; focused ESLint passed with one existing `no-img-element` warning and zero errors. No invoice, payment, journal, asset, customer, or supplier mutation was executed.

## Findings register

### UAE-EINV-F001 — deferred sentinel has an over-broad changed-file scope

Severity: `INFO`. Product defect: No. Verifier defect: Yes (scope classification). Evidence: line 183 failure and inherited report text under `backend/reports`. Safe remediation later: make the sentinel inspect source extensions/approved code roots and exclude reports/evidence, without removing the policy assertion. Owner decision: legal applicability still required separately.

### PRINT-VERIFIER-F001 — protected barcode verifier does not recognize the approved Asset-only inventory architecture

Severity: `INFO`. Product print defect: No. Evidence: line 51 failure before scope guard; generic template and client template remain present; current inventory page is Asset-only. Safe remediation later: surgical verifier baseline/architecture update after Owner approval; do not broaden paths or weaken assertions in this forensic batch.

### UAE-EINV-F002 — business applicability is not proven

Severity: `INFO` pending Owner/legal confirmation, potentially release-relevant only if the Owner confirms in-scope mandatory eInvoicing. Evidence: missing revenue band, transaction scope, exclusions, ASP status, and official applicability decision. No implementation work is authorized by this batch.

## Final decision matrix

| Area | Product defect? | Verifier defect? | Policy/legal gap? | Runtime impact | Release impact | Safe next action |
|---|---|---|---|---|---|---|
| UAE E-Invoicing | No proven defect | Deferred sentinel over-broad | Legal scope unknown | No current runtime change | Owner decision required before any claim | Owner scope decision |
| Protected Print | No proven print regression | Stale architecture/baseline assertion | Baseline maintenance | Existing print runtime passes observed path | Non-blocking INFO | Separate verifier refresh |

`FINAL_DECISION_MATRIX = COMPLETE`.

## Files changed by this batch

Only this forensic report was created. No Product, verifier, package, environment, handoff, migration, or database file was changed by this batch.

| File | Reason | Type | Persistent effect | Runtime/business effect | Expected |
|---|---|---|---|---|---|
| `backend/reports/uae-einvoicing-and-protected-print-verifier-forensic-01-20260815T112435+0300.md` | evidence report required by batch | Report | none | none | Yes |

## Final gate

`UAE_EINVOICING_AND_PROTECTED_PRINT_VERIFIER_FORENSIC_01_GATE = FORENSIC_PASS_OWNER_POLICY_REQUIRED`.

This gate is not a Product-fix approval. It means the forensic work is complete, no Product defect was proven, the protected-print failure is a stale/approved-change verifier mismatch, and the UAE legal scope cannot be accepted or rejected from repository evidence alone.

## Required tokens

CURRENT_BATCH = UAE-EINVOICING-AND-PROTECTED-PRINT-VERIFIER-FORENSIC-01
FORENSIC_MODE = READ_ONLY
SUPPLIER_RECEIVE_RUNTIME_STREAM = CLOSED
PERSISTENT_DB = darfus_erp
PERSISTENT_MIGRATIONS_INITIAL = 81
PERSISTENT_MIGRATIONS_AFTER = 81
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_MIGRATIONS_INITIAL = 80
ACCEPTANCE_MIGRATIONS_AFTER = 80
ACCEPTANCE_WRITES_THIS_BATCH = 0
WORKTREE_BASELINE_CAPTURED = YES
VERIFIER_INVENTORY_TABLE = COMPLETE
UAE_VERIFIER_PATH = scripts/verify-invoices-search-print.js
UAE_VERIFIER_FAILURE_REPRODUCED = YES
UAE_ASSERTION_FORENSIC_TABLE = COMPLETE
VAT_TAX_INVOICE_LAYER_CLASSIFIED = YES
UAE_EINVOICING_LAYER_CLASSIFIED = YES
PRINT_PRESENTATION_LAYER_CLASSIFIED = YES
CURRENT_UAE_EINVOICING_IMPLEMENTATION = NONE
UAE_OFFICIAL_SOURCE_REVALIDATED = YES
UAE_OFFICIAL_SOURCE_AUTHORITY = UAE Ministry of Finance official portal and Guideline V1.1
UAE_OFFICIAL_SOURCE_DATE = 2026-06-01 guideline; 2026-05-10 targeted amendment
UAE_BUSINESS_APPLICABILITY = NOT_PROVEN_OWNER_CONFIRMATION_REQUIRED
UAE_EINVOICING_REGULATORY_GAP_MATRIX = COMPLETE
UAE_EINVOICING_RELEASE_CLASSIFICATION = OWNER_LEGAL_SCOPE_CONFIRMATION_REQUIRED
PROTECTED_PRINT_VERIFIER_PATH = scripts/verify-barcode-tag-print-layouts.js
PROTECTED_PRINT_VERIFIER_FAILURE_REPRODUCED = YES
PROTECTED_PRINT_GUARD_TYPE = STATIC_ARCHITECTURE_SCOPE_DELETION_SEMANTIC_REGEX
PROTECTED_PRINT_BASELINE = HEAD_1657b0e9ba580faef69be48f04637835c201b521_CURRENT_WORKTREE
PROTECTED_PRINT_CHANGED_FILE_TABLE = COMPLETE
CURRENT_PRINT_ARCHITECTURE_MAP = COMPLETE
PRINT_NAME_SOURCE = INVOICE_CUSTOMER_NAME
PRINT_PHONE_SOURCE = INVOICE_PHONE_SNAPSHOT
PRINT_ADDRESS_SOURCE = INVOICE_ADDRESS_SNAPSHOT
PRINT_LIVE_CUSTOMER_CONTACT_LOOKUP = NO
OLD_INVOICE_PRINT_NULL_SNAPSHOT_SAFE = PASS
NEW_INVOICE_SNAPSHOT_PRINT_READ = PASS
PRINT_AUTHORIZATION = PASS
PRINT_COMPANY_ISOLATION = PASS
PRINT_PRIVACY_SCOPE = PASS
PRINT_FINANCIAL_SOURCE_TRUTHFULNESS = PASS
PRINT_TEMPLATE_RUNTIME_MATRIX = COMPLETE
PROTECTED_PRINT_ROOT_CAUSE = STALE_BASELINE_APPROVED_CHANGE_NOT_RECOGNIZED
VERIFIER_WEAKENED_THIS_BATCH = NO
NORMAL_RUNTIME_RESTARTED = NO
RUNTIME_OBSERVATION = PASS_READ_ONLY_BROWSER_ON_EXISTING_RUNTIME
TARGETED_UAE_VERIFIER_RESULT = FAIL_EXPECTED_FORENSIC
TARGETED_PROTECTED_PRINT_VERIFIER_RESULT = FAIL_EXPECTED_FORENSIC
TARGETED_PRINT_TESTS = PASS
TARGETED_SNAPSHOT_PRINT_TESTS = PASS
TARGETED_PRINT_AUTH_TESTS = PASS
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
CUSTOMER_MASTER_REGRESSED = NO
POS_CUSTOMER_SUMMARY_REGRESSED = NO
INVOICE_SNAPSHOT_REGRESSED = NO
SUPPLIER_RECEIVE_REGRESSED = NO
PRODUCT_CODE_CHANGED_THIS_BATCH = NO
VERIFIER_CODE_CHANGED_THIS_BATCH = NO
RUNTIME_ENV_CHANGED = NO
PACKAGE_JSON_CHANGED = NO
PACKAGE_LOCK_CHANGED = NO
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
GIT_PUSHES_THIS_BATCH = 0
SERVER_CONNECTIONS = 0
SERVER_DEPLOYMENTS = 0
FINAL_DECISION_MATRIX = COMPLETE
UAE_EINVOICING_AND_PROTECTED_PRINT_VERIFIER_FORENSIC_01_GATE = FORENSIC_PASS_OWNER_POLICY_REQUIRED
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = OWNER-UAE-EINVOICING-SCOPE-DECISION
