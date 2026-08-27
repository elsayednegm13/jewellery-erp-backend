# CGP-SETTLEMENT-POST-PAYMENT-LIABILITY-UI-FORENSIC-01

## 1. Execution and safety

- Mode: strict read-only forensic.
- Persistent target verified with `SELECT current_database()`: `darfus_erp`.
- No settlement retry, reversal, Treasury write, Liability write, Journal write, CGP write, Asset write, policy/permission change, migration, restart, or source modification was performed.
- Read-only browser navigation/reload was used for `/ar/sales/customer-gold/drafts`; the settlement form was not opened and no mutation control was invoked.
- `MIGRATION_81_CREATED = NO`.

## 2. User-observed inconsistency

The canonical screen for `CGPD-000007` shows the posted purchase and a successful bank settlement, but displays both paid and remaining as `5,182.4854 AED`. A fresh reload and fresh selection reproduced the same display. The screen also shows `تمت التسوية بالكامل` and does not render the settlement form.

## 3. CGPD-000007 identity

| Field | Value |
|---|---|
| Document number | `CGPD-000007` |
| Document ID | `CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:eb23a813-a06c-4d79-924d-f91ab6390a63` |
| Company | `COMP-1384c23f-18ee-405f-8675-8e87746be72c` |
| Branch | `BR-cf387f66-0904-471e-85b8-9346ac3dbb03` (Main Branch) |
| Customer | `CUS-0001` |
| Currency | AED |
| Business status | `POSTED` |
| Governance status | `APPROVED` |
| Posted at | `2026-08-12 09:56:10.995+03` |
| Total / payable | `5182.4854` |

## 4. Liability truth

`CustomerFinancialLiability` `CFL:8aa573bc-f9b1-4a61-907a-b2fe5fd4624e` is linked by `source_document_id` and `source_event_id` to this document:

- `original_amount = 5182.4854`
- `settled_amount = 5182.4854`
- `outstanding_amount = 0.0000`
- `status = SETTLED`
- `currency = AED`
- `journal_entry_id = JE-1786526284004` (purchase-recognition Journal)
- `recognized_at = 2026-08-12 12:18:04.017+03`

This is database truth, not a frontend inference.

## 5. Settlement truth

There is exactly one settlement linked to `CGPD-000007`:

- Settlement: `FST-7a213d3e-544f-4f50-a9b6-5c446eefd989`
- `operation_type = CUSTOMER_PAYOUT`
- `status = EXECUTED`
- `total_amount = 5182.4854 AED`
- `idempotency_key = 963eb71b-5544-4fde-b9ea-1fcc28fa94f9`
- `executed_at = 2026-08-12 15:18:29.627+03` (displayed as `12/08/2026 16:18` in Asia/Dubai)
- `executed_by = USR-f8fcdf95-ec4f-4046-84c8-3f0ba3221d93`
- external bank reference: `1013`

Settlement allocation:

- allocation `FSA-6a5fce10-fa4e-4d5c-85ce-d17f37ece721`
- Liability `CFL:8aa573bc-f9b1-4a61-907a-b2fe5fd4624e`
- allocation amount `5182.4854`

## 6. Payment Journal and purchase Journal separation

Payment Journal:

- `JE-FST-7a213d3e-544f-4f50-a9b6-5c446eefd989`
- source `FINANCIAL_SETTLEMENT`
- debit account `2500` Customer Creditor: `5182.4854`
- credit account `SYS-BANK`: `5182.4854`
- posted and balanced (`total_debit = total_credit = 5182.48540000`)

Purchase-recognition Journal remains separate:

- `JE-1786526284004`
- source `CUSTOMER_GOLD_PURCHASE_ACCOUNTING_RECOGNITION`
- debit `SYS-INVENTORY`: `5182.4854`
- credit `2500` Customer Creditor: `5182.4854`

`PURCHASE_AND_PAYMENT_JOURNALS_SEPARATED = PASS`.

## 7. Bank/Treasury movement

Exactly one Treasury/CashTransaction row is linked to the settlement:

- `CT-f87c12ed-2bb6-45dd-94d9-9798c897a067`
- `type = cash_out`, `account = bank`, `status = posted`
- amount `5182.4854`
- reference `FST-7a213d3e-544f-4f50-a9b6-5c446eefd989`
- bank reference carried by the settlement leg: `1013`
- Journal link: `JE-FST-7a213d3e-544f-4f50-a9b6-5c446eefd989`

## 8. Payment effect matrix

| Effect | Expected | Actual | Result |
|---|---:|---:|---|
| FinancialSettlement | 1 | 1 | PASS |
| SettlementAllocation | 1 | 1 | PASS |
| Payment Journal | 1 | 1 | PASS |
| Bank/Treasury movement | 1 | 1 | PASS |
| Liability settled amount | 5182.4854 | 5182.4854 | PASS |
| Liability outstanding | 0.0000 | 0.0000 | PASS |
| Liability status | SETTLED | SETTLED | PASS |
| Settlement history | present | present | PASS |
| Idempotency record | succeeded | `succeeded`, HTTP 201 | PASS |

`CGPD_000007_PAYMENT_EFFECT_MATRIX = COMPLETE`.

## 9. Full-payment and duplicate-payment checks

The exact Decimal equation is:

`5182.4854 - 5182.4854 = 0.0000`.

`FULL_PAYMENT_RECONCILIATION = PASS` and `FULLY_SETTLED_LIABILITY_STATUS = SETTLED`.

The canonical settlement service locks the Liability and rejects `outstanding_amount <= 0` or a non-`OPEN`/`PARTIALLY_SETTLED` status with `CUSTOMER_FINANCIAL_LIABILITY_NOT_OPEN`; it also rejects over-settlement and idempotency conflicts before durable effects. Therefore a second payment is fail-closed without issuing a POST in this batch.

`FULLY_PAID_DOUBLE_SETTLEMENT_GUARD = PASS`.

## 10. UI/read-model trace and exact root cause

### Paid source

`backend/src/services/cgp-business-view.service.js` loads settlement rows and computes:

`paid = SUM(financial_settlement_legs.amount)`.

The response field is `settlementSummary.paidAmount = paid.toFixed(4)`. For this document it is `5182.4854`.

### Remaining source

The same service emits:

`remainingAmount: payable?.outstandingAmount || serialized.totalPayableToCustomer || "0.0000"`.

The Sequelize database configuration parses DECIMAL values as JavaScript numbers. Consequently a correct `0.0000` becomes numeric `0`, which is falsy in the `||` expression. The read model therefore falls back to the original document payable `5182.4854` even though the Liability is `SETTLED`.

The frontend then renders `businessView.settlementSummary.remainingAmount` first, so it faithfully displays the already-wrong read-model value. The frontend is not the primary source of the incorrect number.

`POST_PAYMENT_REMAINING_ROOT_CAUSE = BACKEND_READ_MODEL_WRONG_FIELD` (zero-value truthiness fallback to the original amount).

### Fresh-read result

After a full browser reload and reopening `CGPD-000007`, the screen still showed:

- purchase: `AED 5,182.4854`
- paid: `AED 5,182.4854`
- remaining: `AED 5,182.4854`
- settlement history: bank transfer, `1013`, `12/08/2026 16:18`
- fully settled message: present
- settlement form: absent

`POST_PAYMENT_REMAINING_AFTER_FRESH_READ = WRONG_VALUE_REPRODUCED`.

This rules out a stale browser cache as the primary cause.

`CGP_POST_PAYMENT_API_READMODEL = COMPLETE` (source contract, DB truth, and fresh UI projection all traced).

## 11. Current actionability and payment-status authority

- Current form condition is `POSTED && canSettle && payable exists && Number(payable.outstandingAmount) > 0` in `GoldPurchaseDraftWorkspace.tsx`.
- Current fully-settled banner condition is `POSTED && payable exists && Number(payable.outstandingAmount) <= 0`.
- The browser confirmed the form was hidden and the fully-settled banner was visible.
- Payment summary is currently split: paid is derived from settlement legs, remaining/status come from the Liability with a defective fallback. The next batch should expose one server-backed summary with explicit Decimal-safe zero handling and a derived payment status.

`CURRENT_SETTLEMENT_ACTIONABILITY_SOURCE = payable.outstandingAmount > 0`.

`PAYMENT_SUMMARY_AUTHORITY = CustomerFinancialLiability + settlement allocations/legs cross-check; one server-backed read-model summary should be canonical in the next batch`.

`DERIVED_PAYMENT_STATUS_FEASIBLE = YES` without adding a persisted CGP `PAID` lifecycle status.

## 12. Read-only browser/network result

- Canonical list/detail opened successfully for `CGPD-000007`.
- Reload and re-open completed without 401/403/404/409/422/500 visible errors.
- Only list/detail/business-view reads were used; no settlement control was clicked and no form was submitted.
- No automatic business mutation was observed or initiated.

`CGPD_000007_READ_ONLY_BROWSER_FORENSIC = PASS`.
`AUTOMATIC_BUSINESS_MUTATION_REQUESTS = 0`.

## 13. Persistent integrity and in-batch fingerprint

Current read-only snapshot:

- migrations `80`; Migration 81 absent
- Assets `61`; Products `3`
- CGP documents `7`; items `11`
- liabilities `5`; settlements `2`; settlement legs `2`; allocations `2`
- Journals `74`; Journal lines `190`; Treasury/CashTransactions `52`
- Cash sessions `6`; ApprovalRequests `0`; financial approval policies `1`; Gold events `5`
- duplicate Journal sources `0`; duplicate Treasury journal links `0`
- unbalanced posted Journals `0`; orphan Journal lines `0`; unlinked posted Treasury `0`
- settlement allocation mismatches `0`; fully-settled liabilities with positive outstanding `0`
- duplicate Barcodes `0`; blank Barcodes `0`; orphan RFID `0`; orphan Asset origins `0`; orphan Asset lineage `0`

Canonical signed ledger snapshot at the end of the read-only inspection:

- `SYS-CASH = 0.0030`
- `SYS-BANK = 10076.2566`
- one OPEN cash session `CRS-1786398745906-vpuq` with counted opening `0.0000`

The increase from earlier handoff counts/balances is classified as Owner concurrent real-data activity already present while this batch began (including additional posted/settled CGP activity at approximately 19:02–19:03), not a task mutation. The first and final read-only snapshots of this batch had the same business counts.

`PERSISTENT_BUSINESS_DATA_PRESERVED = PASS`.
`FINANCIAL_INTEGRITY = PASS`.
`INVENTORY_INTEGRITY = PASS`.

## 14. Gold/runtime and environment safety

- `gold_market_settings`: `active_provider = GOLDAPI_IO`, `pricing_mode = LIVE_PROVIDER`, refresh `1500`, stale-after `2500`, enabled.
- CGP runtime watermark remains `2026-08-12T08:32:21.028Z`.
- Scoped CGP dispatcher remains enabled by its existing configuration; generic Global Dispatcher remains OFF.
- No `.env` edit, provider request, dispatcher change, or restart occurred.
- `next-env.d.ts` current SHA is the inherited known drift:
  `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.

`GOLD_RUNTIME_1500_2500_PRESERVED = PASS`.
`CGP_RUNTIME_DISPATCHER_NONREGRESSION = PASS`.
`RUNTIME_WATERMARK_PRESERVED = PASS`.
`GLOBAL_DISPATCHER_ENABLED = NO`.
`RUNTIME_ENV_CHANGED = NO`.
`NEXT_ENV_MUTATED_THIS_BATCH = NO`.

## 15. CGP Modern UX Redesign Requirements (next batch only)

1. **Information hierarchy:** document header → separate purchase/payment statuses → three-card financial summary → lifecycle/payment milestones → integrations → one card per generated physical Asset → settlement history → conditional settlement action → notes/audit/technical details.
2. **Header:** show `CGPD-000007`, purchase status, payment status, customer, branch, purchase date, document number, and compact non-destructive actions. Keep UUIDs secondary.
3. **Separate statuses:** `حالة الشراء: تم الترحيل` and `حالة السداد: مدفوع بالكامل`; never create a persisted CGP `PAID` lifecycle state.
4. **Financial summary:** `قيمة الشراء`, `المدفوع`, `المتبقي` with exact four-decimal AED values; fully paid must show `0.0000 AED`.
5. **Milestone visualization:** presentation-only `تم التحقق → تم الترحيل → تم سداد العميل`; the payment milestone is not a CGP lifecycle state.
6. **Integrations:** localized, accessible badges for Inventory, Accounting, Gold Center, and CRM; never expose raw internal status tokens.
7. **Assets:** one readable card per physical piece with description, Barcode, karat/purity, gross/net/pure weight, and operational status; preserve one-piece/one-Asset identity.
8. **Settlement history:** date/time, localized method, amount, reference, and status; use actual DB values.
9. **Conditional action:** keep the settlement form only for `POSTED`, authorized user, payable present, and exact outstanding `> 0`; fully paid is read-only history/banner.
10. **Technical details:** collapsible secondary section for Journal/event/idempotency identifiers; preserve auditability.
11. **Responsive/RTL:** summary-first RTL layout, tablet-safe wrapping, no horizontal overflow, isolated Latin numeric tokens.
12. **Dates/numerals:** `DD/MM/YYYY`, `DD/MM/YYYY HH:mm`, Asia/Dubai branch policy, Latin digits, four-decimal money precision.
13. **Accessibility:** semantic headings, visible keyboard focus, clear disabled/read-only states, adequate hit areas, accessible status text.
14. **No business-semantic change:** no Posting, Governance, Settlement permission, cash sufficiency, bank, Accounting, Asset, Liability, or migration changes.
15. **No app-shell redesign:** scope is the canonical Customer Gold Purchase workspace only.

Required UX targets:

- `FULLY_PAID_TARGET_COPY = تم ترحيل عملية الشراء وسداد مستحق العميل بالكامل.`
- `PARTIAL_PAYMENT_TARGET_UX = DEFINED` (show purchase value, paid, outstanding; form only when outstanding > 0 and permission exists).
- `UNPAID_TARGET_UX = DEFINED` (show مستحق and exact outstanding; action only under canonical permission/context).
- `FULLY_PAID_SETTLEMENT_FORM_TARGET = HIDDEN_READ_ONLY_HISTORY`.
- `NEXT_UX_REDESIGN_SCOPE = DEFINED`.
- `TARGET_HEADER_INFORMATION_ARCHITECTURE = DEFINED`.
- `TARGET_FINANCIAL_SUMMARY = DEFINED`.
- `PAYMENT_MILESTONE_NOT_CGP_LIFECYCLE = YES`.
- `TARGET_INTEGRATION_SUMMARY = DEFINED`.
- `TARGET_ASSET_CARD_DESIGN = DEFINED`.
- `TARGET_SETTLEMENT_HISTORY = DEFINED`.
- `TARGET_DUPLICATE_LABEL_CLEANUP = DEFINED`.
- `TARGET_RESPONSIVE_RTL = DEFINED`.
- `DATE_PRESENTATION_NONREGRESSION = PASS`.
- `MONEY_PRECISION_TARGET = 4_DECIMALS_CURRENT_POLICY`.
- `PAYMENT_METHOD_LOCALIZATION_TARGET = DEFINED`.
- `STATUS_LOCALIZATION_TARGET = DEFINED`.
- `TARGET_CGP_ACCESSIBILITY_SCOPE = DEFINED`.
- `TARGET_CGP_NAVIGATION_PATTERN = SUMMARY_FIRST_WITH_ANCHORED_SECONDARY_SECTIONS`.
- `GLOBAL_APP_SHELL_REDESIGNED = NO`.
- `UX_REDESIGN_BUSINESS_SEMANTICS_CHANGE = NO`.
- `TARGET_TECHNICAL_DETAILS_PATTERN = DEFINED_COLLAPSIBLE_SECONDARY`.
- `POSTING_PAYMENT_COPY_SEPARATED = YES`.
- `CGP_LIST_PAYMENT_STATUS_TARGET = DEFINED`.

## 16. Decision

The bank settlement, payment Journal, Treasury movement, allocation, and Liability closeout are all correct. The positive remaining amount is a backend read-model zero-value fallback, reproduced after a fresh read. No Liability/Settlement remediation is indicated by current evidence.

`RECOMMENDED_REPAIR_BATCH = CGP-POST-PAYMENT-READMODEL-UX-REDESIGN-01`.

`UX_REDESIGN_HANDOFF_COMPLETE = YES`.
`CGP_SETTLEMENT_POST_PAYMENT_LIABILITY_UI_FORENSIC_01_GATE = PASS_ROOT_CAUSE_PROVEN`.
`NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START`.

