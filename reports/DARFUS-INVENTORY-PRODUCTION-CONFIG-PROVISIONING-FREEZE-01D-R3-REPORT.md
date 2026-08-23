# DARFUS ERP — PRODUCTION CONFIGURATION & PROVISIONING FREEZE 01D-R3

تم فحص `darfus_erp` قراءة فقط، ثم إنشاء Disposable Clone مضبوط على Migration 82، وتشغيل provisioning للـevidence-backed master dataset على الـClone فقط. نجح dry-run، والـfirst run، والـreplay، ونجحت دورة disable/reactivate/history، ونجح Supplier V2 Gold By Weight fixture حتى Asset/Barcode/Movement/Cost/Payable/Journal، ونجح POS Asset search. لم تحدث أي كتابة على `darfus_erp`، ولم تُنشأ أو تُشغّل Migration، ولم يتغير Product/Frontend/Backend/Test/Config/Git. Gold runtime بقي `HEALTHY` قبل وبعد الـClone.

الـGate ليس Full Production Ready لأن Owner values الخاصة بالـLocations وVAT/Tax وPayment enablement وInstallment/Deposit وMinimum Making وOverride assignment ما زالت غير مجمدة. لذلك النتيجة هي code-ready فقط مع Production Values Pending.

## Executive Summary

| Area | Result | Evidence | Impact |
|---|---|---|---|
| Official DB identity | PASS | `SELECT current_database()` = `darfus_erp` | Official DB remained protected |
| Official baseline | PASS | `SequelizeMeta=82`; all requested reset/config/business counts captured | No reset drift introduced by R3 |
| Gold runtime | PASS | `/api/health/gold` returned 200, `HEALTHY`, live `GOLDAPI_IO`, AED, fresh, no mock fallback before and after clone | Gold no longer blocks code-ready gate |
| Master dataset | PASS on Clone | 297 profile rows, 39 Pearl Size rows, 6 inventory codes, 19 item codes | Evidence-backed subset rehearsed |
| Provisioning replay | PASS | Second execute created 0 rows and produced no duplicates | Idempotency proven |
| Supplier V2 | PASS on Clone | 1 Asset, 1 active Barcode, origin, cost revision, movement, payable journal | GBW runtime contract proven with test fixture |
| POS | PARTIAL PASS | Barcode search returned Asset only, `isProduct=false` | Checkout/payment not run because production enablement is pending |
| Production configuration | PENDING OWNER | Official `settings=0`, `locations=0`; service defaults are fallbacks | Blocks official provisioning, not GBW code implementation |

`GATE = PASS_01D_R3_GBW_IMPLEMENTATION_READY_PRODUCTION_VALUES_PENDING`.

## Safety Confirmation

- Official database: `darfus_erp`; no official `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, migration, seed, provisioning, settings write, location write, fixture write, or barcode configuration write was performed.
- Clone mutations were limited to the exact Disposable Clone `darfus_erp_master_data_01d_r3_20260817_092500` and its test-only rehearsal data.
- The Clone was verified by `SELECT current_database()` before provisioning and was dropped after evidence with zero active connections.
- One initially proposed `darfus_erp_prod_config_01d_r3_20260817_092500` Clone was created and immediately removed after the existing provisioner rejected its name. No provisioning ran against it. The accepted equivalent name matched the existing guard prefix `darfus_erp_master_data_01d_`.
- No Git reset/restore/clean/stash/checkout/commit/push occurred.
- No secrets or API key values were printed.
- The R3 report is the only artifact written by this Batch. It is not Product/runtime/config code.

## Official DB Read-only Baseline

Official target and runtime baseline:

| Entity / service | Count or state |
|---|---:|
| Database | `darfus_erp` |
| PostgreSQL | 16.15 |
| SequelizeMeta | 82 |
| Companies / Branches / Users | 1 / 1 / 1 |
| Roles / Permissions / Role permissions | 5 / 136 / 427 |
| Accounts | 36 |
| Branch financial mappings | 11 active |
| System account roles | 12 |
| Profile master data | 0 |
| Pearl Size master data | 0 |
| Barcode inventory/item codes | 0 / 0 |
| Barcode sequences | 0; runtime-generated only |
| Inventory locations | 0 |
| Settings | 0 |
| Gold market settings / quotes / policies | 1 / 6 / 2 |
| Suppliers / Assets / Products | 0 / 0 / 0 |
| Purchase orders / Invoices / Payments | 0 / 0 / 0 |
| Journal entries | 0 |

The official company currency is `AED`; the active branch is `B-1` / `Branch-1`. Zero business rows are expected after reset and were not treated as defects where they represent runtime-generated or Owner-configurable state.

Required active financial roles are present in the branch mapping: `INVENTORY_ASSET`, `SUPPLIER_PAYABLE`, `VAT_PAYABLE`, `CASH_TREASURY`, `BANK_ACCOUNT`, `SALES_REVENUE`, `COST_OF_GOODS_SOLD`, and related receivable/deposit roles. Account codes `1400` and `2210` exist and are active, but settings authority is still absent and must not be inferred from code fallback.

## Gold Runtime Baseline

Read-only `GET http://localhost:8000/api/health/gold` before and after Clone rehearsal:

| Field | Before | After |
|---|---|---|
| HTTP | 200 | 200 |
| status / healthStatus | `UP` / `HEALTHY` | `UP` / `HEALTHY` |
| provider / mode | `GOLDAPI_IO` / `LIVE_PROVIDER` | same |
| configured | true | true |
| currency / unit | `AED` / `PER_GRAM` | same |
| fresh / stale | true / false | true / false |
| isMockFallback | false | false |
| quality | `OFFICIAL_RESPONSE` | `OFFICIAL_RESPONSE` |
| quote | provider quote present | same quote remained fresh during rehearsal |

Gold settings in the official DB are `LIVE_PROVIDER`, `GOLDAPI_IO`, `AED`, refresh `1500` seconds, stale threshold `2500` seconds, enabled. No Gold formula or provider change was made.

## Owner Configuration Freeze Matrix

`SOURCE_DEFINED` means the contract or vocabulary exists in source. `OWNER_CONFIGURABLE_PENDING` means no production literal was invented.

| Config domain | Exact authority | Current value | Source-defined? | Owner-configurable? | Required before GBW UI | Required before runtime | Required before production | Frozen result |
|---|---|---|---|---|---|---|---|---|
| Inventory Locations | `inventory_locations` + location service | 0 rows | YES | YES | NO | YES for location proof | YES | `OWNER_CONFIGURABLE_PENDING` |
| VAT rate | `settings.vatRate` via settings service | DB absent; fallback 5 | YES | YES | NO | YES | YES | `OWNER_CONFIGURABLE_PENDING` |
| Purchase VAT rate | `settings.purchaseVatRate`, falls back to VAT rate | DB absent; effective fallback 5 | YES | YES | NO | YES | YES | `OWNER_CONFIGURABLE_PENDING` |
| VAT enabled | `settings.vatEnabled` | DB absent; fallback true | YES | YES | NO | YES | YES | `OWNER_CONFIGURABLE_PENDING` |
| Purchase tax included | `purchaseTaxIncludedDefault` | DB absent; fallback false | YES | YES | NO | YES | YES | `OWNER_CONFIGURABLE_PENDING` |
| Purchase VAT recoverable | `purchaseVatRecoverableDefault` | DB absent; fallback true | YES | YES | NO | YES | YES | `OWNER_CONFIGURABLE_PENDING` |
| Input VAT account | `inputVatAccountCode` + financial mapping | DB absent; fallback `1400`; account exists | YES | YES | NO | YES | YES | `OWNER_CONFIGURABLE_PENDING` |
| RCM output VAT account | `rcmOutputAccountCode` + account | DB absent; fallback `2210`; account exists | YES | YES | NO | YES | YES | `OWNER_CONFIGURABLE_PENDING` |
| POS currency | Company currency/settings service | Company `AED` | YES | YES | NO | YES | YES | `AED_SOURCE_READY` |
| Payment methods | settings service vocabulary | DB absent; source supports cash/card/transfer/split/installment/deposit | YES | YES | NO | YES | YES | `ENABLEMENT_PENDING_OWNER` |
| Installment enablement | flat/nested installment settings | DB absent; fallback enabled | YES | YES | NO | YES | YES | `ENABLEMENT_PENDING_OWNER` |
| Deposit behavior | canonical deposit routes/settings | source contract exists; no Owner row | YES | YES | NO | YES | YES | `OWNER_CONFIGURABLE_PENDING` |
| Gold selling method | profile strategy + Gold pricing service | source strategies present | YES | YES | YES | YES | YES | `SOURCE_POLICY_READY_VALUE_PENDING_IF_CHANGED` |
| Minimum selling making/gram | Asset pricing policy fields | parameterized; no Owner threshold row | YES | YES | YES | YES | YES | `OWNER_VALUE_PENDING` |
| Gold cost/current-value override | settings + permission service + audit | fallback permits override; no DB setting and no matching `goldCost.override` permission row | YES | YES | NO | YES | YES | `ASSIGNMENT_PENDING` |
| Gold refresh interval | `gold_market_settings` | 1500 seconds | YES | YES | NO | YES | YES | `FROZEN_CURRENT_RUNTIME_VALUE` |
| Gold stale threshold | `gold_market_settings` | 2500 seconds | YES | YES | NO | YES | YES | `FROZEN_CURRENT_RUNTIME_VALUE` |
| Barcode inventory codes | `barcode_inventory_codes` | 0 official; clone dataset 6 including provisional Watch | YES | YES | YES | YES | YES | `GBW_READY; NONCLIENT_PROVISIONAL_REVIEW` |
| Barcode item codes | `barcode_item_codes` | 0 official; clone dataset 19 including provisional WCH | YES | YES | YES | YES | YES | `GBW_READY; NONCLIENT_PROVISIONAL_REVIEW` |
| GBW item descriptions | `profile_master_data.GOLD_ITEM_DESCRIPTION` | 0 official; 17 clone rows | YES | YES | YES | YES | YES | `EVIDENCE_BACKED_CLONE_READY` |
| Gold colors | `profile_master_data.GOLD_COLOR` | 0 official; 3 clone rows | YES | YES | YES | YES | YES | `EVIDENCE_BACKED_CLONE_READY` |
| Certificate authorities | `profile_master_data.CERTIFICATE_AUTHORITY` | 0 official; 14 clone rows | YES | YES | Profile-dependent | Profile-dependent | YES if used | `EVIDENCE_BACKED_CLONE_READY` |

`FALLBACK_DEFAULT_IS_PRODUCTION_AUTHORITY = NO` for every settings service fallback. The only current source-owned currency value is the company `AED` field and the Owner-frozen Gold currency.

## Inventory Locations Decision

The source contract is company/branch-scoped, uses stable location identity, active/inactive lifecycle, and supports `location_id` references. No official row is Owner-approved after reset. The Supplier V2 fixture correctly proved branch scope but carried `locationId=null` and the legacy display location `Showroom`; that is test evidence, not a production location decision.

| Field | Decision |
|---|---|
| Company scope | Required by source contract |
| Branch scope | Required by source contract |
| Code format | Source-owned contract; literal production codes pending Owner |
| Name | Owner-configurable pending |
| Location type vocabulary | Source/service contract exists; exact production vocabulary pending |
| Active/inactive lifecycle | Supported by model/service |
| Required on GBW intake | Workflow decision pending; active selector can be built now |
| Optional on GBW intake | Not approved as production policy |
| Required for transfer | Existing transfer contract requires authoritative branch/location context |
| Required for audit | Historical reference must remain readable |
| Default location | No approved default; do not use `Showroom` as production authority |

`GBW_UI_BLOCKED_BY_LOCATION_VALUES = NO`.
`LOCATION_PRODUCTION_VALUES_READY = NO_OWNER_APPROVAL`.
`LOCATION_RUNTIME_PROOF = BLOCKED_BY_OWNER_VALUE_NOT_CODE`.

## VAT / Tax Decision

The canonical settings service owns the listed keys and merges safe fallbacks when no row exists. Official `settings=0`, so the current effective values are fallbacks, not production approvals:

| Setting | DB row | Effective current value | Fallback used? | Production approved? |
|---|---|---|---|---|
| `vatEnabled` | No | `true` | Yes | No |
| `vatRate` | No | `5` | Yes | No |
| `purchaseVatRate` | No | `5` via `vatRate` | Yes | No |
| `purchaseTaxIncludedDefault` | No | `false` | Yes | No |
| `purchaseVatRecoverableDefault` | No | `true` | Yes | No |
| `inputVatAccountCode` | No | `1400` | Yes | No |
| `rcmOutputAccountCode` | No | `2210` | Yes | No |

The clone Supplier V2 fixture used these test fallback values and posted a balanced VAT/payable journal. It proves the contract only; it does not freeze the production tax policy. The approved formula rules remain unchanged: GBW Jewellery VAT base is gold value plus making total; Gold Bar 24K VAT base is certificate cost only.

`VAT_AUTHORITY_READY = YES`.
`VAT_PRODUCTION_VALUES_READY = NO_OWNER_VALUES_PENDING`.
`FALLBACK_DEFAULT_IS_PRODUCTION_AUTHORITY = NO`.

## POS Configuration Decision

POS source authority is server settings/company context plus Asset pricing/search. Company currency `AED` is present. The server-side final-profile filter returns Asset results and removes final-profile Product fallback. The clone search by barcode returned one Asset with `isProduct=false`, correct branch, `AVAILABLE` state, and barcode identity.

Payment enablement, receipt/printer configuration, and terminal/device settings are not persisted in approved official rows. No speculative values were added.

`GBW_POS_CONFIG_READY = PARTIAL_CURRENCY_READY_PAYMENT_AND_DEVICE_OWNER_PENDING`.

## Payment Method Decision

The canonical source vocabulary is verified as `cash`, `card`, `transfer`, `split`, `installment`, and `deposit`. The settings service fallback lists all six, but no official enablement row exists.

| Method | Source supported | Enabled for production | Accounting mapping ready | Owner decision |
|---|---|---|---|---|
| cash | YES | PENDING | YES, `CASH_TREASURY` | Explicit enablement required |
| card | YES | PENDING | Contract/source path exists | Explicit enablement and processor policy required |
| transfer | YES | PENDING | YES, bank/cash resolution exists | Explicit enablement required |
| split | YES | PENDING | Source contract exists | Explicit enablement required |
| installment | YES | PENDING | Source contract/receivable path exists | Enablement and terms required |
| deposit | YES | PENDING | Customer deposit role exists | Deposit behavior/enablement required |

`PAYMENT_METHOD_SOURCE_AUTHORITY_READY = YES`.
`PAYMENT_METHOD_PRODUCTION_ENABLEMENT_READY = PENDING_OWNER`.

## Financial Mapping Readiness

The official branch has 11 active branch mappings and 12 system account roles. The required mappings for Inventory Asset, Supplier Payable, VAT Payable, Cash Treasury, Bank Account, Sales Revenue, COGS, Accounts Receivable, and Customer Deposit Liability are present. Accounts `SYS-INVENTORY`, `SYS-AP`, `SYS-CASH`, `SYS-BANK`, `1400`, and `2210` are active.

No official transaction exists after reset, so official posting cannot be proven by business data. The clone fixture posted a purchase journal with debit `3812.61000000` and credit `3812.61000000`, and no orphan origin/revision/movement rows.

`GBW_FINANCIAL_MAPPING_FOUNDATION = READY_FOUNDATION_TO_BE_REHEARSED_ON_CLONE`.
`ACCOUNTING_MAPPING_RUNTIME_PROOF = PASS_TEST_FIXTURE_ONLY`.

## Gold Selling / Override Policy

- Selling method and profile strategy are source-owned and parameterized.
- Making-per-gram economics use the approved net-weight formula; 01B focused tests passed 6/6 and no formula was changed by R3.
- `minimumMakingPerGram` is supported by the pricing policy/runtime contract, but no Owner production threshold row exists.
- Gold cost/current-value override is supported by settings, permission, reason, and audit contracts. The effective fallback is `allowGoldCostOverride=true` and `goldCostOverridePermission=goldCost.override`; no matching permission named `goldCost.override` was found in the official permission rows.
- This combination is not a production approval. It requires explicit Owner assignment or a separately approved permission/configuration decision.

`SELLING_METHOD_POLICY_READY = YES_SOURCE_POLICY`.
`MINIMUM_MAKING_POLICY_READY = PARAMETERIZED_OWNER_VALUE_PENDING`.
`GOLD_OVERRIDE_POLICY_READY = CONTRACT_READY_ASSIGNMENT_PENDING`.

## Master Data Production Dataset

The 01D evidence-backed policy contains source-backed values from the accepted five client documents and accepted barcode policy. It is not a complete Owner provisioning decision for every future profile value.

| Dataset class | Current authority | Clone result | Production classification |
|---|---|---:|---|
| Gold item descriptions | `GOLD_ITEM_DESCRIPTION` | 17 | Evidence-backed |
| Gold colors | `GOLD_COLOR` | 3 | Evidence-backed |
| Certificate authorities | `CERTIFICATE_AUTHORITY` | 14 | Evidence-backed |
| Diamond/Gemstone/Pearl controlled subset | 01D policy categories | remaining 263 profile rows | Evidence-backed subset; complete production scope still Owner-reviewed |
| Pearl Size | `pearl_size_master_data`, MM | 39 | Evidence-backed accepted initial set |
| Barcode client codes | barcode tables | 5 inventory client codes plus 18 client item codes | Evidence-backed |
| Watch / WCH | source marks provisional and not client-approved | 1 + 1 | Not production-intended without Owner decision |
| Barcode sequences | runtime allocator | 0 | Runtime-generated; never provision manually |
| Assets/movements/journals | canonical runtime | 0 in dataset phase | Runtime-generated; never provision manually |

`UNSUPPORTED_GUESSED_VALUES = 0` for the evidence-backed rows. Provisional Watch/WCH values are explicitly labeled provisional, not silently treated as client-approved production data.

`MASTER_DATA_PRODUCTION_DATASET_READY = GBW_EVIDENCE_BACKED_SUBSET_READY; FULL_PRODUCTION_DATASET_PENDING_PROVISIONAL_REVIEW`.

## Exact Dataset Manifest

| Domain | Code / value | Scope | Source | Active | Production-intended? |
|---|---|---|---|---|---|
| GBW item descriptions | 17 values | Company | Gold By Weight / Gold By Piece approved mapping and 01D policy | Yes on clone | Yes for evidence-backed GBW subset |
| Gold colors | Yellow/White/Rose Gold | Company | Gold By Weight / Gold By Piece approved mapping | Yes on clone | Yes |
| Certificate authorities | 14 values | Company | accepted Diamond/Gem/Pearl documents | Yes on clone | Yes when certificate workflow is enabled |
| Pearl sizes | 1.0–20.0 mm in 0.5 steps, 39 values | Company | 01D accepted Pearl Size authority | Yes on clone | Yes for accepted initial set |
| Barcode inventory | GW, GP, DD, GS, PL | Company | accepted barcode policy | Yes on clone | Yes |
| Barcode inventory | WT | Company | Source marks provisional Watch extension | Yes on clone | NO until Owner confirms |
| Barcode items | ANK, BGL, BAR, BRC, BRH, CHN, CHK, CON, CRW, ERG, FST, LOS, NCK, PND, PCH, RNG, TRN, WRN | Company | accepted barcode policy | Yes on clone | Yes |
| Barcode item | WCH | Company | Source marks provisional Watch extension | Yes on clone | NO until Owner confirms |

The exact first-run counts were 297 / 39 / 6 / 19. No row was created without a source label in the provisioner dataset. No settings or locations are part of this manifest because their literal values are not Owner-approved.

## Provisioning Tool Safety

`backend/scripts/provision-master-data-01d.js` was read fully and tested:

- Default mode is dry-run.
- `--execute` requires `ALLOW_01D_MASTER_DATA_PROVISIONING=YES`.
- Exact `SELECT current_database()` must equal the expected `DB_NAME`.
- Official `darfus_erp` is explicitly rejected.
- Target must begin with `darfus_erp_master_data_01d_` and contain only safe lowercase name characters.
- Provisioning is company-aware and runs inside one transaction.
- Profile/Pearl/Barcode identity uses conflict-safe replay behavior.
- It deliberately creates zero locations, settings, and barcode sequences.
- It is not startup code.

The proposed R3 prefix `darfus_erp_prod_config_01d_r3_` is not accepted by the current guard. The equivalent accepted R3 Clone prefix was used; no source patch was made.

`PROVISIONING_TOOL_SAFE = YES_FOR_EXISTING_GUARDED_PREFIX_ONLY`.

## Disposable Clone Setup

| Step | Result |
|---|---|
| Official source | `darfus_erp`, read-only dump stream |
| Temporary failed-name Clone | Created, rejected by provisioner name guard, dropped without provisioning |
| Rehearsal Clone | `darfus_erp_master_data_01d_r3_20260817_092500` |
| Clone identity | Verified by `SELECT current_database()` |
| Clone migrations | 82; no migration rerun |
| Clone source company count | 1 |
| Clone cleanup | Dropped after assertions, 0 active connections |

`PROVISIONING_RUNTIME_TARGET = DISPOSABLE_CLONE_ONLY`.

## Clone Master Provisioning

First dry-run and first execute:

| Domain | Planned | Created first run | Created replay |
|---|---:|---:|---:|
| `profile_master_data` | 297 | 297 | 0 |
| `pearl_size_master_data` | 39 | 39 | 0 |
| `barcode_inventory_codes` | 6 | 6 | 0 |
| `barcode_item_codes` | 19 | 19 | 0 |
| `barcode_sequences` | 0 | 0 | 0 |
| `inventory_locations` | 0 | 0 | 0 |
| `settings` | 0 | 0 | 0 |

All four uniqueness checks returned zero duplicate keys. The clone contained no Asset or business transaction until the separate test fixture rehearsal.

## Clone Owner Config Provisioning

No production Owner-config values were provisioned. This is intentional:

- Locations: no approved literal rows.
- VAT/tax: no approved literal settings.
- Payment enablement: no approved settings row.
- Installment/deposit: no approved terms/settings row.
- Minimum making threshold: no approved production value.
- Override permission assignment: no approved permission assignment/value.

The later GBW fixture used runtime fallbacks only as `TEST_FIXTURE_ONLY` evidence. These values were not production-approved and were removed with the Clone.

## Provisioning Idempotency

`PROVISIONING_IDEMPOTENCY = PASS`.

The second exact `--execute` replay returned zero creations in all four provisioned domains, zero new locations/settings/sequences, and zero duplicate keys. No destructive update or identity rewrite occurred.

## Disable / Historical Proof

On the Clone, a `GOLD_COLOR=Yellow Gold` row was:

1. Disabled using the existing service inside a test transaction.
2. Rejected by active-only resolution.
3. Retained in inactive/historical listing.
4. Reactivated and resolved again as active.
5. Referenced by a `TEST_FIXTURE_ONLY` Asset reference.
6. Rejected when an identity rename was attempted with `PROFILE_MASTER_DATA_USED_VALUE_EDIT_FORBIDDEN`.

The entire fixture transaction was rolled back; after rollback the Clone had 0 Assets and 0 references. No historical production row was modified.

`DISABLED_HISTORICAL_VALUE_PROOF = PASS_CLONE_TEST_FIXTURE_ONLY`.

## Location Runtime Proof

`LOCATION_RUNTIME_PROOF = BLOCKED_BY_OWNER_VALUE_NOT_CODE`.

The source model/service scope and active/inactive contract are understood. No location fixture was invented as production data. The Supplier V2 rehearsal showed that current receive can operate with `locationId=null` and a display fallback, which is acceptable only as test evidence and is not an Owner-approved location policy.

## Settings/VAT Runtime Proof

`VAT_SETTINGS_RUNTIME_PROOF = PASS_CLONE_FALLBACK_CONTRACT_ONLY_NOT_PRODUCTION`.

The clone Supplier V2 fixture consumed the settings service fallback values and posted the corresponding VAT/payable journal. Because the official settings table has zero rows, this proves service consumption and accounting contract wiring, not production tax approval. No settings row was written to the official DB or retained after Clone cleanup.

## Gold Runtime Proof

Gold health remained healthy after the Clone rehearsal:

`HTTP 200 → UP → HEALTHY → GOLDAPI_IO → LIVE_PROVIDER → AED → PER_GRAM → fresh=true → stale=false → isMockFallback=false → quality=OFFICIAL_RESPONSE`.

No provider key, quote, formula, scheduler, or Gold settings value was changed. The current official quote age increased naturally during the run and remained below the configured stale threshold.

## GBW Receive Rehearsal

A controlled `TEST_FIXTURE_ONLY` Supplier V2 receive ran on the Clone:

| Assertion | Result |
|---|---|
| Supplier → Purchase Order | PASS |
| V2/per-piece payload | PASS |
| Gold By Weight profile | `GOLD_BY_WEIGHT_JEWELLERY` |
| Gross/net input | 10 / 8 grams |
| Asset count | 1 |
| Product physical quantity | 0; `productId=null` |
| Barcode/history | 1 Asset barcode + 1 active history row |
| Origin | 1 |
| Purchase cost revision | 1 current row |
| Inventory movement | 1 |
| Supplier payable | Journal credit to `SYS-AP` |
| Journal | Balanced 3812.61 debit/credit |
| Gold source | `gold_center`, 21K snapshot |
| Idempotent replay | Same Asset, no duplicate rows |

The approved 01B net-weight formula remained unchanged; focused 01B tests passed 6/6. The Clone fixture was destroyed with the Clone.

`GBW_RECEIVE_REHEARSAL = PASS_CLONE_TEST_FIXTURE_ONLY`.

## POS / Payment Rehearsal

POS barcode search after the fixture receive returned one Asset result with:

- `isProduct=false`;
- the same Asset barcode;
- the correct branch;
- `AVAILABLE` status;
- no Product fallback row.

No checkout/payment mutation was run. Production payment enablement and deposit/installment policy remain Owner-configurable pending, so running a payment mutation would not prove production readiness.

`POS_PAYMENT_REHEARSAL = PARTIAL_POS_SEARCH_PASS_PAYMENT_NOT_RUN_OWNER_ENABLEMENT_PENDING`.

## Accounting / Journal Proof

The Clone receive posted one balanced purchase journal:

- Debit total: `3812.61000000`.
- Credit total: `3812.61000000`.
- Inventory Asset debit and Input VAT debit were linked to the configured accounts.
- Supplier Payable credit was linked to `SYS-AP`.
- Orphan origin, cost revision, movement, and journal-line checks were zero.

This is a controlled test fixture proof, not an official business transaction or production tax approval.

`ACCOUNTING_JOURNAL_PROOF = PASS_CLONE_TEST_FIXTURE_ONLY`.

## Settings Fallback Matrix

| Production-critical key | DB row present? | Effective source | Effective value | Fallback used? | Production approved? |
|---|---|---|---|---|---|
| `vatRate` | No | settings service fallback | 5 | Yes | No |
| `vatEnabled` | No | settings service fallback | true | Yes | No |
| `purchaseVatRate` | No | fallback to VAT rate | 5 | Yes | No |
| `purchaseTaxIncludedDefault` | No | fallback | false | Yes | No |
| `purchaseVatRecoverableDefault` | No | fallback | true | Yes | No |
| `inputVatAccountCode` | No | fallback | 1400 | Yes | No |
| `rcmOutputAccountCode` | No | fallback | 2210 | Yes | No |
| `paymentMethods` | No | fallback array | six source methods | Yes | No |
| `installmentEnabled` | No | fallback | true | Yes | No |
| `allowZeroDownPayment` | No | fallback | false | Yes | No |
| `installmentDefaultFrequency` | No | fallback | monthly | Yes | No |
| `installmentMaxCount` | No | fallback | 24 | Yes | No |
| `installmentMinDownPaymentPercent` | No | fallback | 0 | Yes | No |
| `allowGoldCostOverride` | No | fallback | true | Yes | No |
| `goldCostOverridePermission` | No | fallback | `goldCost.override` | Yes | No; permission assignment missing |
| `goldCostSource` / `goldCostWeightBasis` | No | fallback | hybrid / net | Yes | No |
| `nonRecoverableVatCapitalization` | No | fallback | true | Yes | No |
| Company currency | Company row | company authority | AED | No settings fallback | Current source/Owner evidence ready |

`SETTINGS_FALLBACK_PRODUCTION_CRITICAL_COUNT = 17_SETTINGS_KEYS_PLUS_COMPANY_CURRENCY_SOURCE`.

## DB Assertion Matrix

| Assertion | Result |
|---|---|
| Clone migration count | 82 |
| Master-data unique keys | 0 duplicates |
| Assets after master phase | 0 |
| Assets after fixture receive | 1 |
| Barcode history after fixture receive | 1 active |
| Duplicate Asset barcodes | 0 |
| Duplicate history barcodes | 0 |
| Product rows created for final profile | 0 |
| Origin rows | 1, no orphan |
| Purchase cost revisions | 1, no orphan |
| Inventory movements | 1, no orphan |
| Journal entries / lines | 1 / 3 |
| Unbalanced journals | 0 |
| Idempotent replay duplicates | 0 |
| Clone cleanup | Complete |

## Official DB Non-Mutation Proof

Official before/after read-only comparison remained:

| Entity | Before | After | Delta |
|---|---:|---:|---:|
| SequelizeMeta | 82 | 82 | 0 |
| profile master data | 0 | 0 | 0 |
| Pearl Size master data | 0 | 0 | 0 |
| Barcode inventory/item codes | 0 / 0 | 0 / 0 | 0 / 0 |
| Barcode sequences | 0 | 0 | 0 |
| Inventory locations | 0 | 0 | 0 |
| Settings | 0 | 0 | 0 |
| Suppliers | 0 | 0 | 0 |
| Assets | 0 | 0 | 0 |
| Products | 0 | 0 | 0 |
| Purchase orders | 0 | 0 | 0 |
| Invoices / Payments | 0 / 0 | 0 / 0 | 0 / 0 |
| Journal entries | 0 | 0 | 0 |

Gold market quotes remained at 6 in the comparison. The scheduler was already active and Gold health remained healthy; any background quote activity would be classified separately from R3-initiated provisioning. `R3_INITIATED_OFFICIAL_WRITES = 0`.

## Source Drift

| Field | Actual |
|---|---|
| Branch | `main` |
| HEAD | `1657b0e9ba580faef69be48f04637835c201b521` |
| Worktree status | Pre-existing dirty worktree; 86 tracked modified and 226 untracked paths in the observed baseline |
| Stashes | 11 |
| Authority | `WORKTREE_CONTENT_PLUS_HISTORICAL_MANIFEST_PLUS_R2A_RECONCILIATION` |
| Source files changed by R3 | 0 |
| Test files changed by R3 | 0 |
| Config/manifest/handoff changed by R3 | 0 |
| Git mutations | 0 |

The R3 report artifact is not counted as Product/backend/test/config change. No cleanup or ownership of unrelated worktree drift was taken.

## Production Promotion Plan

Design only; nothing below was executed:

| Item | Future approved action |
|---|---|
| Target DB | `darfus_erp` only after new explicit Owner promotion approval |
| Starting migration | 82 |
| Expected migration after action | 82; no migration rerun |
| Provisioner | `backend/scripts/provision-master-data-01d.js`, exact reviewed worktree version, with an approved target-prefix-compatible invocation |
| Evidence-backed dataset | 297 profile rows, 39 Pearl Size rows, 5 client barcode inventory codes, 18 client barcode item codes; provisional WT/WCH excluded unless separately approved |
| Settings keys | `vatEnabled`, `vatRate`, `purchaseVatRate`, `purchaseTaxIncludedDefault`, `purchaseVatRecoverableDefault`, `inputVatAccountCode`, `rcmOutputAccountCode`, `paymentMethods`, installment keys, Gold override keys, and any Owner-approved POS/receipt keys |
| Location rows | Exact Owner-approved company/branch/code/name/type rows; none may be invented |
| Payment enablement | Exact Owner-approved methods and installment/deposit terms; not the fallback array by default |
| Pre-checks | Fresh backup, exact `current_database()`, Meta=82, schema/catalog fingerprint, source/manifest authority, active-write check, no active business write |
| Rehearsal | Restorable Disposable Clone, exact dataset, replay, scope and financial checks |
| Post-checks | Counts, unique keys, active/inactive behavior, settings readback, branch/company scope, financial mappings, no orphan/duplicate rows, Gold health |
| Active-write check | Immediately before any separately authorized official apply |
| Rollback policy | No migration rollback; provisioning is additive/idempotent. Recovery must use approved backup/Owner action, never automatic restore or broad cleanup |

`PRODUCTION_PROMOTION_PLAN_READY = DESIGN_ONLY_PENDING_OWNER_VALUES_AND_SEPARATE_APPROVAL`.

## Owner Decision Matrix

| ID | Domain | Exact decision | Ready? | Blocks GBW code? | Blocks runtime? | Blocks production? |
|---|---|---|---|---|---|---|
| R3-01 | Locations | Do not invent rows; Owner supplies exact location dataset | NO | NO | YES for location proof | YES |
| R3-02 | VAT | Owner supplies VAT enabled/rate | NO | NO | YES for approved finance | YES |
| R3-03 | Purchase VAT | Owner supplies purchase rate/tax-included/recoverable rules | NO | NO | YES | YES |
| R3-04 | POS settings | AED source-ready; receipt/device values pending if required | PARTIAL | NO | PARTIAL | YES if required operationally |
| R3-05 | Payment enablement | Source vocabulary ready; enablement pending | NO | NO | YES for payment proof | YES |
| R3-06 | Installment/deposit | Terms/enablement pending | NO | NO | YES for those flows | YES |
| R3-07 | Selling method | Source profile strategies are frozen | YES_SOURCE_POLICY | NO | NO | Owner confirmation if changed |
| R3-08 | Minimum making threshold | Parameterized; literal threshold pending | NO_VALUE | NO | YES for below-minimum proof | YES |
| R3-09 | Override permission | Permission assignment/value pending; fallback permission not present | NO | NO | YES for override proof | YES / SECURITY |
| R3-10 | Master dataset | GBW evidence-backed subset ready; provisional non-client rows need disposition | PARTIAL | NO | NO for GBW subset | YES for official full dataset |
| R3-11 | Barcode taxonomy | GW/GP/DD/GS/PL and client item codes ready; WT/WCH provisional | PARTIAL | NO | NO for GBW | YES for unapproved provisional rows |
| R3-12 | Gold runtime | Healthy live provider, AED, fresh, no mock | YES | NO | NO | YES prerequisite satisfied |

## Remaining Owner Values

1. Exact company/branch inventory locations, codes, names, types, defaults, and GBW requiredness.
2. VAT rate, purchase VAT rate, VAT enablement, tax-included behavior, and recoverability.
3. Production payment method enablement, installment limits/frequency/down payment, and deposit behavior.
4. Minimum making-per-gram threshold and below-minimum approval policy.
5. Gold cost/current-value override enablement and the exact assigned permission.
6. Disposition of provisional Watch/WCH rows before any official provisioning.

## GBW Implementation Readiness

| Readiness gate | Result | Reason |
|---|---|---|
| GBW UI implementation | YES | Contracts and evidence-backed GBW master subset are available; Owner values can remain configuration-driven |
| GBW backend full profile implementation | YES | V2 Asset authority, net-weight formula, Gold runtime, mappings, and master-data authority are present |
| GBW runtime acceptance | PARTIAL | Clone receive/Accounting/POS search passed; approved settings/location/payment/checkout proof remains pending |
| GBW production provisioning | NO_OWNER_VALUES_PENDING | Official settings/locations/master rows are intentionally still empty |

## Risks / Blockers

| ID | Issue | Classification | Severity | Priority |
|---|---|---|---|---|
| R3-B01 | Official Owner settings and locations are absent; effective values are fallbacks | ENVIRONMENT_CONFIG / MISSING_BOOTSTRAP / FINANCIAL | High | P1 |
| R3-B02 | `goldCost.override` fallback has no matching official permission row and override defaults enabled | SECURITY / ENVIRONMENT_CONFIG | High | P1 |
| R3-B03 | Existing provisioner includes explicitly provisional WT/WCH rows; they require exclusion or Owner disposition before official provisioning | MISSING_MASTER_DATA / ACCEPTANCE_GAP | High | P1 |
| R3-B04 | Checkout/payment mutation was not run because production payment enablement is pending | ACCEPTANCE_GAP / FINANCIAL | Medium | P2 |
| R3-B05 | Proposed R3 Clone prefix differs from existing provisioner prefix guard | DESIGN_LIMITATION / TOOLING | Medium | P2; resolved by equivalent safe prefix without code change |

No P0 loss/corruption/security incident was evidenced. No Product defect was introduced by R3.

## Gate

`GATE = PASS_01D_R3_GBW_IMPLEMENTATION_READY_PRODUCTION_VALUES_PENDING`

Pass basis:

- Official DB remained read-only and exact target was verified.
- Current Gold runtime is healthy and fresh before/after rehearsal.
- Evidence-backed master dataset provisioned successfully on a Disposable Clone.
- Replay was idempotent with no duplicates or destructive rewrites.
- Disable/reactivate/history identity protection passed.
- Supplier V2 GBW Asset/Barcode/Movement/Accounting/Payable path passed on a test fixture.
- POS search preserved Asset authority and excluded Product fallback.
- Unresolved values are safely configuration-driven and do not require changing the GBW architecture or formula.

Full production-ready gate was not claimed because Owner values, official provisioning, and payment/checkout production proof remain pending.

## Next Recommended Step

Owner must freeze R3-01 through R3-11 values, decide the provisional WT/WCH disposition, and explicitly approve the next implementation batch. After explicit `ابدأ`, the next allowed batch is `02 — GOLD BY WEIGHT FULL PROFILE IMPLEMENTATION`. Do not provision `darfus_erp` automatically.

## Final Tokens

```text
CURRENT_BATCH = DARFUS-INVENTORY-PRODUCTION-CONFIG-PROVISIONING-FREEZE-01D-R3
MODE = OWNER_CONFIGURATION_FREEZE_AND_DISPOSABLE_CLONE_PROVISIONING_REHEARSAL

OFFICIAL_DATABASE = darfus_erp
OFFICIAL_DB_MIGRATIONS = 82
OFFICIAL_DB_MUTATION_AUTHORIZED = NO
R3_INITIATED_OFFICIAL_WRITES = 0

CURRENT_IMPLEMENTATION_SOURCE_AUTHORITY = WORKTREE_PLUS_HISTORICAL_MANIFEST_PLUS_R2A_RECONCILIATION

GOLD_RUNTIME_BASELINE = HEALTHY
GOLD_RUNTIME_FINAL = HEALTHY
GOLD_PROVIDER = GOLDAPI_IO
GOLD_MODE = LIVE_PROVIDER
GOLD_CURRENCY = AED
GOLD_QUOTE_FRESH = YES
GOLD_MOCK_FALLBACK = NO
GOLD_FORMULA_CHANGE_THIS_BATCH = NO
GOLD_PROVIDER_CHANGE_THIS_BATCH = NO

LOCATION_MODEL_READY = YES
LOCATION_PRODUCTION_VALUES_READY = NO_OWNER_PENDING
VAT_AUTHORITY_READY = YES
VAT_PRODUCTION_VALUES_READY = NO_OWNER_PENDING
POS_AUTHORITY_READY = YES
POS_PRODUCTION_VALUES_READY = PARTIAL
PAYMENT_METHOD_SOURCE_AUTHORITY_READY = YES
PAYMENT_METHOD_PRODUCTION_ENABLEMENT_READY = PENDING_OWNER
GBW_FINANCIAL_MAPPING_FOUNDATION = READY_FOUNDATION_CLONE_REHEARSED

SELLING_METHOD_POLICY_READY = YES_SOURCE_POLICY
MINIMUM_MAKING_POLICY_READY = PARAMETERIZED_OWNER_VALUE_PENDING
GOLD_OVERRIDE_POLICY_READY = CONTRACT_READY_ASSIGNMENT_PENDING

MASTER_DATA_PRODUCTION_DATASET_READY = GBW_EVIDENCE_BACKED_SUBSET_READY_FULL_PRODUCTION_PENDING
UNSUPPORTED_GUESSED_VALUES = 0

PROVISIONING_TOOL_SAFE = YES_FOR_EXISTING_GUARDED_PREFIX_ONLY
PROVISIONING_RUNTIME_TARGET = darfus_erp_master_data_01d_r3_20260817_092500_DROPPED_AFTER_PROOF
PROVISIONING_FIRST_RUN = PASS_297_PROFILE_39_PEARL_6_INVENTORY_19_ITEM
PROVISIONING_REPLAY = PASS_ZERO_CREATIONS
PROVISIONING_IDEMPOTENCY = PASS

PROFILE_MASTER_DATA_CREATED = 297
PEARL_SIZE_ROWS_CREATED = 39
BARCODE_INVENTORY_CODES_CREATED = 6
BARCODE_ITEM_CODES_CREATED = 19
BARCODE_SEQUENCES_MANUALLY_CREATED = 0
LOCATIONS_CREATED = 0_OWNER_PENDING
SETTINGS_ROWS_CREATED = 0_OWNER_PENDING

DISABLED_HISTORICAL_VALUE_PROOF = PASS_CLONE_TEST_FIXTURE_ONLY
LOCATION_RUNTIME_PROOF = BLOCKED_BY_OWNER_VALUE_NOT_CODE
VAT_SETTINGS_RUNTIME_PROOF = PASS_CLONE_FALLBACK_CONTRACT_ONLY_NOT_PRODUCTION
GBW_RECEIVE_REHEARSAL = PASS_CLONE_TEST_FIXTURE_ONLY
POS_PAYMENT_REHEARSAL = PARTIAL_POS_SEARCH_PASS_PAYMENT_NOT_RUN
ACCOUNTING_JOURNAL_PROOF = PASS_CLONE_TEST_FIXTURE_ONLY

SETTINGS_FALLBACK_PRODUCTION_CRITICAL_COUNT = 17_SETTINGS_KEYS_PLUS_COMPANY_CURRENCY_SOURCE
OFFICIAL_DB_NON_MUTATION_PROOF = PASS_ZERO_R3_WRITES

PRODUCTION_PROMOTION_PLAN_READY = DESIGN_ONLY_PENDING_OWNER_VALUES_AND_SEPARATE_APPROVAL
OWNER_VALUES_STILL_PENDING = LOCATIONS_VAT_PURCHASE_VAT_PAYMENT_INSTALLMENT_DEPOSIT_MINIMUM_MAKING_OVERRIDE_PERMISSION_PROVISIONAL_WATCH_DISPOSITION

GBW_UI_IMPLEMENTATION_READY = YES
GBW_BACKEND_FULL_PROFILE_IMPLEMENTATION_READY = YES
GBW_RUNTIME_ACCEPTANCE_READY = PARTIAL
GBW_PRODUCTION_PROVISIONING_READY = NO_OWNER_VALUES_PENDING

PRODUCT_CODE_FILES_CHANGED = 0
FRONTEND_FILES_CHANGED = 0
BACKEND_FILES_CHANGED = 0
TEST_FILES_CHANGED = 0
MIGRATIONS_CREATED = 0
MIGRATIONS_EXECUTED_OFFICIAL_DB = 0

P0_BLOCKERS = 0
P1_BLOCKERS = 3
REGRESSIONS_INTRODUCED = NONE_READ_ONLY_AND_CLONE_ONLY

GATE = PASS_01D_R3_GBW_IMPLEMENTATION_READY_PRODUCTION_VALUES_PENDING
NEXT_RECOMMENDED_STEP = OWNER_FREEZE_REQUIRED_VALUES_THEN_EXPLICIT_02_APPROVAL
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
```

01D-R3 GBW IMPLEMENTATION PREREQUISITES COMPLETE  
→ PRODUCTION VALUES REMAIN OWNER-CONFIGURABLE  
→ OWNER REVIEW  
→ 02 GOLD BY WEIGHT FULL PROFILE IMPLEMENTATION ONLY AFTER EXPLICIT "ابدأ"  
→ NO OFFICIAL PROVISIONING WITHOUT SEPARATE APPROVAL

STOP.
