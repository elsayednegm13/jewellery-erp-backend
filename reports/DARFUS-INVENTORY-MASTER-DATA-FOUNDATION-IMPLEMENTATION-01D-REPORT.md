# DARFUS ERP — MASTER DATA FOUNDATION IMPLEMENTATION 01D

Batch: `DARFUS-INVENTORY-MASTER-DATA-FOUNDATION-IMPLEMENTATION-01D`  
Mode: `MINIMUM_SAFE_MASTER_DATA_AUTHORITY_AND_PROVISIONING_WITH_RUNTIME_PROOF`

## Executive Summary

تم تنفيذ أساس Master Data server-authority وprovisioning آمن للـdisposable clone فقط. نجح تصنيف الاستراتيجيات التسع الداخلية، ونجح provisioning المتكرر دون duplicates، ونجحت دورة disable/reactivate والحفاظ على التاريخ. لم تحدث أي كتابة على `darfus_erp`، ولم تُنشأ migration جديدة، ولم تُنفذ شاشات العميل.

الفشل/الحد المتبقي: قاعدة `darfus_erp` بعد reset لا تحتوي قيم master/config التشغيلية؛ locations وsettings/VAT/POS/payment ما زالت Owner-configurable وغير مزروعة، ولا توجد قاعدة ثانية لإثبات cross-company/branch runtime. لذلك Gate هو `PASS_01D_AUTHORITY_FOUNDATION_VALUES_PARTIALLY_OWNER_CONFIGURABLE` وليس اكتمال قيم Production.

Official DB risk: لا يوجد خطر بيانات ناتج عن هذا batch؛ official DB بقيت read-only عند migration 81 وبنفس counts السابقة.  
Next step: Owner review لقيم locations/settings/VAT/POS/payment والـremaining profile-specific policy values، ثم قرار صريح قبل أي provisioning رسمي أو Profile UI.

## Pre-change Baseline

| Item | Actual | Evidence |
|---|---:|---|
| Official database | `darfus_erp` | `SELECT current_database()` |
| Official migrations | 81 | `SequelizeMeta` read-only |
| Companies / Branches / Users | 1 / 1 / 1 | read-only SQL |
| `profile_master_data` | 0 | read-only SQL |
| `pearl_size_master_data` | 0 | read-only SQL |
| `barcode_inventory_codes` / `barcode_item_codes` | 0 / 0 | read-only SQL |
| `barcode_sequences` | 0 | read-only SQL |
| `inventory_locations` / `settings` | 0 / 0 | read-only SQL |
| Assets / Products | 0 / 0 | read-only SQL |
| Source | branch `main`, HEAD `1657b0e9ba580faef69be48f04637835c201b521` | git read-only |
| Source freeze | manifest present; observed SHA `E387A0BCB552217C6965659906AEF1EADC3B129AEC6A64BE9CA32A0F02E2B585`; handoff expected `DF1F9651466240296B282C14B6C62532A2EBC74719C0AE8B93CCA8FD9B1838F7` | `SOURCE_FREEZE_HASH_MATCH=NO`, read-only drift evidence |

Pre-existing worktree drift was preserved: 84 tracked-diff paths, 695 untracked paths, 11 stashes at the final observation. No reset/restore/clean/stash/add/commit/push was run.

The source-freeze hash mismatch is recorded as `SOURCE_DRIFT` only. It did not prevent identifying the intended 01D files, so implementation proceeded within the explicit candidate set.

## Master Data Inventory Matrix

| Domain | Classification | Current authority | Current rows | 01D result | Gap |
|---|---|---|---:|---|---|
| Final profile strategies | BUSINESS MASTER DATA | server `inventory-master-policy.service.js` + 01D policy | 9 internal strategies | READY | none for classification |
| Gold item descriptions/colors | BUSINESS MASTER DATA | company-scoped `profile_master_data` | 0 official | CLONE-PROVISIONED | official values not provisioned |
| Diamond/Gem/Pearl controlled attributes | BUSINESS MASTER DATA | company-scoped `profile_master_data` | 0 official | CLONE-PROVISIONED | official values not provisioned |
| Pearl sizes | BUSINESS MASTER DATA | `pearl_size_master_data`, MM numeric identity | 0 official | CLONE-PROVISIONED 39 values | official values not provisioned |
| Certificate authorities | BUSINESS MASTER DATA | `profile_master_data.CERTIFICATE_AUTHORITY` | 0 official | CLONE-PROVISIONED | official values not provisioned |
| Karat policy | BUSINESS MASTER DATA / SYSTEM POLICY | server fixed policy | no table | READY/PARTIAL | no editable UI registry added |
| Barcode inventory/item codes | OPERATIONAL CONFIGURATION | company-scoped barcode tables | 0 official | CLONE-PROVISIONED 6/19 | official values not provisioned |
| Barcode sequences | RUNTIME GENERATED STATE | `barcode_sequences` runtime allocator | 0 | PRESERVED | never manually seeded |
| Locations | OPERATIONAL CONFIGURATION | `inventory_locations` | 0 | NOT SEEDED | no evidence-backed default location |
| VAT/settings/POS/payment | OPERATIONAL CONFIGURATION | existing Settings/services | 0 settings rows | NOT SEEDED | Owner configuration required |
| Assets, history, movements | RUNTIME GENERATED STATE | Asset/V2 workflow | 0 official | PRESERVED | created only by business workflows |

Frontend hardcoded business duplicates found in the existing inventory form and Gold Center karat fallback. They were not made authoritative and were not broadly refactored in 01D; final profile screens remain out of scope.

## Client Controlled-Field Mapping

The five official DOCX files were read in full and the prior visual register was reused as document authority: 299 total pages, `VISUAL_VERIFICATION=COMPLETE`, `TOTAL_UNMAPPED_REQUIREMENTS=0`, no missed tables/text boxes/shapes, and the Gold By Weight formula image mapped.

| Profile | Server category mapping implemented | Evidence-backed values in 01D dataset | Not seeded / deferred |
|---|---|---|---|
| Gold By Weight | `GOLD_ITEM_DESCRIPTION`, `GOLD_COLOR`; karat remains fixed server policy | 17 item descriptions, 3 colors | profile-specific cost/VAT/settings |
| Gold By Piece | `GOLD_ITEM_DESCRIPTION`, `GOLD_COLOR`; condition/pricing remain policy-owned | same | profile-specific pricing configuration |
| Diamond | Diamond type/color/clarity/cut/shape/treatment/origin + certificate category | document-backed lists for type, treatment, color, clarity, cut, shape | complete screen and component rules |
| Gem Stone | gemstone name/type/shape/color/tone/tone-level/saturation/optical-effect/origin + certificate | document-backed lists | treatment/setting values requiring further owner validation |
| Pearl | pearl type/color/overtone/orient/shape/luster/surface/nacre/origin/description + certificate; Pearl Size separate | 10 Pearl Types, 39 Pearl Sizes, certificate authorities | remaining profile policy/config |

No value was inferred from a label alone; values included in the initial dataset have source strings in `inventory-master-data-policy.service.js`.

## Authority Classification

| Classification | Domains | Rule |
|---|---|---|
| BUSINESS MASTER DATA | profile attributes, Pearl sizes, certificate authorities, item descriptions/colors | company-scoped, active-only for new use, historical snapshot retained |
| SYSTEM POLICY | final profile registry, karat list, one-piece Asset rule | server-owned; frontend cannot widen it |
| OPERATIONAL CONFIGURATION | barcode taxonomy, locations, VAT/POS/payment/settings | owner/admin-configurable; no random defaults |
| RUNTIME GENERATED STATE | sequences, Asset/barcode/history/movements | generated by canonical runtime; never manually seeded |

## Profile Master Data Design

`profile_master_data` remains the canonical company-scoped category/value table. 01D extended the server category registry and mapping for all nine internal strategies without adding a table or migration. Existing service behavior remains: normalized uniqueness, active-only resolution, permission-gated create/update, used-value identity edit rejection, disable/reactivate, no delete route, and immutable Asset reference snapshots.

## Pearl Size Authority

Existing `pearl_size_master_data` was reused. Unit is `MM`, identity is normalized numeric value, initial Owner-approved values are 1.0–20.0 at 0.5 increments (39 rows), and no Pearl Size row was placed in `profile_master_data`. Runtime proof created/replayed the values only in the disposable clone.

## Karat Authority

The source-backed fixed policy is `24,22,21,18,14,12,10,9`; `24K Gold Bar` is a display/context label, not a new arbitrary numeric karat. No editable frontend-only karat table and no new schema were created. Existing 01B Gold Bar/Gold By Weight behavior was regression-tested.

## Gold / Diamond / Gem / Pearl Attribute Authority

The server category registry now covers Gold item/color, Diamond type/color/clarity/cut/shape/treatment/origin, existing Gemstone categories, existing Pearl categories, and certificate authority. Values are normalized in one company-scoped table. No final profile form or dynamic grid was implemented.

## Certificate Authority

Certificate authority uses the existing profile master category with the document-backed set: `AGS`, `AIGS`, `Bellerophon`, `EGL`, `GCAL`, `GIA`, `GIT`, `GRS`, `Gubelin`, `HRD`, `ICA`, `IGI`, `Lotus Gemology`, `SSEF`. Historical certificate snapshots remain asset-owned; no certificate schema redesign was made.

## Barcode Configuration Authority

Existing 01C/previous barcode tables and runtime allocator remain authoritative. The clone provisioner inserts the accepted 6 inventory codes and 19 item codes idempotently. It creates zero `barcode_sequences`; sequences remain runtime-generated. Used-code lifecycle rules remain in the existing barcode service/routes. No barcode replacement implementation was added in 01D.

## Inventory Location Authority

`inventory_locations` is already company/branch scoped with stable identity and active state. No row was invented because the official source has no owner-approved default location value. New transaction behavior must continue to reject or require a valid active location where the existing workflow requires it.

## Settings / VAT / POS / Payment Assessment

No settings were seeded. The official database has zero Settings rows. VAT, POS, payment methods, and financial mappings therefore remain `OWNER_CONFIG_REQUIRED` / `MISSING_RUNTIME_CONFIG` for a clean post-reset launch. No accounting redesign or fallback default was introduced.

## Provisioning Strategy

Implemented `backend/scripts/provision-master-data-01d.js` with three safety gates: exact `SELECT current_database()`, clone name prefix `darfus_erp_master_data_01d_`, and `ALLOW_01D_MASTER_DATA_PROVISIONING=YES` for mutation. Default mode is dry-run. It is not startup code and never targets `darfus_erp`. Provisioning uses insert-on-conflict replay semantics and reports counts. Locations/settings/sequences are deliberately not seeded.

## Initial Evidence-Backed Dataset

The clone run provisioned 297 profile rows, 39 Pearl Size rows, 6 barcode inventory codes, and 19 barcode item codes for the existing company. All profile values were taken from the five DOCX sources or the already accepted barcode policy. There are no Production rows from this batch.

## Permissions

Existing `settings.view`, `settings.update`, `inventory.view`, and `inventory.adjust` guards remain the authority for master-data routes. No new permission or migration was required. Used-value rename is blocked in the service; deactivate/reactivate is allowed through the existing write guard.

## Validation Contract

New use must resolve an active row in the same company and correct category. IDs/codes are stable. Values are normalized for uniqueness. Pearl Size requires an active MM master row. Historical Asset references store value/label snapshots. Cross-company/branch runtime proof was not possible because the official baseline contains one company and one branch.

## Disabled / Historical Value Rules

Disposable-clone runtime proof: one Gold Color value was referenced by a fixture Asset, deactivated, disappeared from active list, was rejected by active resolution, remained readable with inactive listing, was reactivated, and rejected identity rename after use. The fixture and all rows were removed with the clone.

## Frontend Hardcode Review

Existing generic Inventory UI still contains display/fallback arrays (profile labels, statuses, item-type labels, Gold Center karat fallback). They are presentation/compatibility paths and were not promoted to business authority. Removing them safely requires the final profile screen/config integration batch and was not widened into 01D.

## Files Changed

Intentional 01D files:

- `backend/src/services/profile-master-data.service.js` — added server category/profile mappings and Diamond field mapping. This file was already untracked before 01D; only the listed additions are in scope.
- `backend/src/services/inventory-master-data-policy.service.js` — new central policy and evidence-backed dataset.
- `backend/scripts/provision-master-data-01d.js` — new clone-only, target-aware, idempotent provisioner.
- `backend/tests/master-data-foundation-01d.test.cjs` — focused classifier/dataset/safety tests.
- `backend/reports/DARFUS-INVENTORY-MASTER-DATA-FOUNDATION-IMPLEMENTATION-01D-REPORT.md` — this report.

All other worktree changes were pre-existing and preserved.

## Migration Assessment

`01D_NEW_SCHEMA_MIGRATION=NO`. No migration was created. The disposable clone migrated official baseline 81 to source migration 82 (`20260817010000-barcode-replacement-status-foundation.js`) only; official `darfus_erp` remained at 81.

## Focused Tests

`master-data-foundation-01d.test.cjs`: 4/4 PASS.  
Combined 01A/01C/01D focused contract run: 14/14 PASS.  
Existing 01A/01B/01C regression evidence remains accepted; no regression was observed in the focused rerun.

## Regression Tests

01A authority classifier, Supplier V2 boundary, POS Product fallback isolation, frontend final-profile legacy toggle isolation, and 01C barcode/status contracts all passed. Gold By Weight formula and barcode replacement/status schema were not changed by 01D.

## Disposable Clone Setup

Clone: `darfus_erp_master_data_01d_20260817_01`  
Source: read-only dump of `darfus_erp`  
Migration: 81 → 82  
Final state: exact clone was dropped after evidence; no clone remains.

## Provisioning Runtime Proof

PASS on disposable clone: dry-run, first execute, and replay. First execute created 297 profile rows, 39 Pearl Size rows, 6 inventory codes, and 19 item codes. Replay created 0 rows. No sequence, location, or settings rows were created.

## Provisioning Idempotency Proof

PASS: all `(company,category,canonical_value)`, `(company,value,unit)`, and barcode `(company,code)` uniqueness counts matched row counts; second execute returned zero creations.

## Disable / Historical Runtime Proof

PASS: active-only list excluded disabled value; active resolution rejected it; inactive listing retained it; reactivation restored active resolution; used identity rename was rejected; reference snapshot remained present.

## Cross-Company / Branch Proof

BLOCKED/NOT RUN: current official baseline has exactly one company and one branch. SQL and service predicates are company-scoped; a second scope fixture was not invented merely to manufacture proof.

## DB Assertion Matrix

| Assertion | Result |
|---|---|
| Clone identity exact | PASS |
| Clone migrations | 82 |
| Profile duplicates | 0 |
| Pearl-size duplicates | 0 |
| Barcode inventory/item duplicates | 0 |
| Orphan profile references | 0 |
| Inactive referenced rows | 0 after reactivation; disable behavior separately PASS |
| Manual barcode sequences created | 0 |
| Locations/settings invented | 0 |
| 01C history table | present; fixture history rows cleaned with clone |
| Official DB mutation | 0 |

## Provisioning Counts

| Scope | Profile Master | Pearl Size | Barcode Inventory | Barcode Item | Sequences | Locations | Settings |
|---|---:|---:|---:|---:|---:|---:|---:|
| Official `darfus_erp` after batch | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Disposable clone first execute | 297 | 39 | 6 | 19 | 0 | 0 | 0 |
| Disposable clone replay | 0 new | 0 new | 0 new | 0 new | 0 | 0 | 0 |

## Official DB Non-Mutation Proof

Read-only recheck after clone drop: `darfus_erp`, migrations 81, companies 1, branches 1, users 1, profile/pearl/barcode/location/settings/assets/products all unchanged at their pre-change counts. `PERSISTENT_WRITES_OFFICIAL_DB=0`.

## Deferred / Missing Owner Data Values

- Company/branch-specific active inventory locations.
- VAT rate and profile-specific VAT bases/toggles.
- POS/payment method operational configuration.
- Complete owner-approved profile-specific editability and requiredness matrix for final screens.
- Financial readiness values dependent on settings, not random defaults.
- Second company/branch scope fixture for runtime isolation proof.

## Regressions

No P0/P1 regression introduced. Existing client requirements remain out of final-screen implementation scope. Gold By Weight net-vs-gross making basis remains the known deferred financial issue; 01D did not modify it.

## Gate

`PASS_01D_AUTHORITY_FOUNDATION_VALUES_PARTIALLY_OWNER_CONFIGURABLE`

Reason: server authority, nine-strategy mapping, idempotent clone provisioning, lifecycle rules, and focused regressions passed; official post-reset master/config values are still absent and cannot be guessed or written without Owner approval.

## Next Recommended Step

Owner review and explicit approval of locations, VAT/settings, POS/payment configuration, and remaining profile-specific master values. After that, run a separate approved provisioning batch or proceed to final profile implementation only after the required gap/owner gate.

## Final Tokens

CURRENT_BATCH = `DARFUS-INVENTORY-MASTER-DATA-FOUNDATION-IMPLEMENTATION-01D`  
MODE = `MINIMUM_SAFE_MASTER_DATA_AUTHORITY_AND_PROVISIONING_WITH_RUNTIME_PROOF`

OFFICIAL_DATABASE = `darfus_erp`  
PERSISTENT_OFFICIAL_DB_MUTATION_AUTHORIZED_THIS_BATCH = `NO`

FINAL_CLIENT_PROFILE_COUNT = `5`  
PHYSICAL_INVENTORY_AUTHORITY = `ASSET`  
PHYSICAL_STOCK_QUANTITY_AUTHORITY = `NOT_ALLOWED`

FINAL_PROFILE_MASTER_AUTHORITY_IMPLEMENTED = `YES`  
PEARL_SIZE_AUTHORITY_IMPLEMENTED = `YES`  
BARCODE_CONFIG_AUTHORITY_PRESERVED = `YES`  
PROVISIONER_IMPLEMENTED = `YES_CLONE_ONLY`  
PROVISIONING_IDEMPOTENCY = `PASS`  
LIFECYCLE_DISABLE_REACTIVATE = `PASS`  
USED_VALUE_RENAME_BLOCK = `PASS`  
LOCATIONS_PROVISIONED = `NO_OWNER_CONFIG_REQUIRED`  
SETTINGS_PROVISIONED = `NO_OWNER_CONFIG_REQUIRED`  
MIGRATIONS_CREATED = `0`  
PERSISTENT_WRITES_OFFICIAL_DB = `0`

FOCUSED_TESTS = `14`  
FOCUSED_TESTS_PASS = `14`  
STATIC_PROOF = `PASS`  
RUNTIME_PROOF = `PASS_DISPOSABLE_CLONE`  
RUNTIME_PROOF_TARGET = `darfus_erp_master_data_01d_20260817_01_DROPPED`  
DB_ASSERTIONS = `PASS_WITH_SINGLE_SCOPE_LIMITATION`  
PERMISSIONS = `EXISTING_GUARDS_REUSED`  
REGRESSIONS_INTRODUCED = `NONE_OBSERVED`

GOLD_BY_WEIGHT_FORMULA_FIX_THIS_BATCH = `NO`  
BARCODE_REPLACEMENT_IMPLEMENTATION_THIS_BATCH = `NO`  
STATUS_SCHEMA_IMPLEMENTATION_THIS_BATCH = `NO`  
MASTER_DATA_PROVISIONING_OFFICIAL_DB_THIS_BATCH = `NO`  
CLIENT_PROFILE_SCREEN_IMPLEMENTATION_THIS_BATCH = `NO`

KNOWN_DEFERRED_P1 = `GOLD_BY_WEIGHT_MAKING_BASIS_AND_MISSING_OWNER_CONFIG_VALUES`  
GATE = `PASS_01D_AUTHORITY_FOUNDATION_VALUES_PARTIALLY_OWNER_CONFIGURABLE`  
NEXT_RECOMMENDED_STEP = `OWNER_REVIEW_AND_EXPLICIT_CONFIGURATION_APPROVAL`  
NEXT_BATCH_ALLOWED = `NO_AUTOMATIC_START`

01D MASTER DATA FOUNDATION COMPLETE
→ OWNER REVIEW
→ GOLD BY WEIGHT FULL PROFILE IMPLEMENTATION ONLY AFTER EXPLICIT "ابدأ"
