# DARFUS ERP — OWNER CONFIGURATION FREEZE 01D-R1

Batch: `DARFUS-INVENTORY-OWNER-CONFIGURATION-FREEZE-01D-R1`  
Mode: `READ_ONLY_OWNER_CONFIGURATION_AND_PROFILE_PREREQUISITE_FREEZE`  
Observation date: `2026-08-17`  

## Executive Summary

تم تنفيذ فحص R1 للقراءة فقط. لم يحدث تعديل على Product/Frontend/Backend/Test/Config، ولم تُنفذ أي كتابة على قاعدة البيانات، ولم تُشغّل Migration أو Clone أو Restart أو Git mutation.

ما تم إثباته:

- متطلبات Gold By Weight الخمسة ملفاتها موثقة بالكامل: 299 صفحة، و`VISUAL_VERIFICATION=COMPLETE`، و`TOTAL_UNMAPPED_REQUIREMENTS=0`.
- قاعدة GBW المالية مغلقة من 01B: المصنعية على `NET_GOLD_WEIGHT`، واختبار 01B الحالي نجح 6/6.
- سلطة Asset/Profile/Master Data موجودة في المصدر، لكن قيم `profile_master_data` و`pearl_size_master_data` وbarcode configuration وlocations وsettings غير موجودة في official DB بعد reset.
- Financial mappings موجودة ومكتملة عدديًا للفرع الحالي، لكن لا توجد معاملات فعلية بعد reset لإثبات runtime posting.
- `darfus_erp` الحالي يقرأ `SequelizeMeta=82`، بينما آخر handoff/manifest المعتمدين يذكران 81، وmanifest لا يحتوي Migration 82. هذه حالة drift يجب reconciliate قبل أي production promotion.
- Gold Center configured في قاعدة البيانات كـ`LIVE_PROVIDER/GOLDAPI_IO/AED`، لكن quote الحالي stale، و`/api/health/gold` يرجع 503، والـscheduler يسجل `GOLDAPI_IO_NETWORK_ERROR`. مفتاح المزود غير موجود داخل backend container؛ ملف `.env` المحلي يحتوي اسمًا به trailing space، ولم يتم تعديل ذلك.

النتيجة: يمكن تثبيت تصميم ومتطلبات GBW، لكن Gate هذه الدفعة **محجوب** بسبب source/migration baseline غير المتطابق وGold runtime configuration/provider evidence. لا يبدأ تنفيذ GBW الكامل قبل Owner review وإغلاق هذه الفجوات.

## Safety Confirmation

| Check | Actual | Evidence |
|---|---|---|
| Product code files changed by R1 | 0 | Read-only source inspection; report output only |
| Frontend files changed by R1 | 0 | No frontend edit |
| Backend business files changed by R1 | 0 | No backend edit |
| Test files changed by R1 | 0 | Existing tests only; no test edit |
| Migrations created/executed by R1 | 0 | No migration command run by R1 |
| Official DB writes by R1 | 0 | SELECT/read-only health checks only |
| Clone provisioned | NO | No clone command run |
| Settings/VAT/location writes | 0 | No mutation endpoint/SQL used |
| Browser mutation | NOT RUN | No browser mutation |
| Git add/commit/reset/restore/clean/stash | 0 | Read-only Git status only |

The report file itself is the only artifact written by this R1 task and is not Product/runtime/config code.

## Official DB Read-only Baseline

Read-only verification used the Docker PostgreSQL service with `SELECT current_database()` first. It returned `darfus_erp`.

| Entity | Count / state | Expected minimum | State | Notes |
|---|---:|---|---|---|
| Database | `darfus_erp` | exact official DB | OBSERVED | Correct target; protected from writes |
| PostgreSQL | 16.15 | supported | READY | Container healthy |
| SequelizeMeta | 82 | handoff/manifest says 81 | DRIFT | Migration 82 is present in DB |
| Companies | 1 | 1 | READY | Current single-company baseline |
| Branches | 1 | 1 | READY | Current single-branch baseline |
| Users | 1 | 1 | READY | Bootstrap identity exists |
| Roles / Permissions | 5 / 136 | RBAC baseline | READY | `user_roles=1`, `role_permissions=427` |
| Customers / Branch customers | 0 / 0 | not required for GBW intake | EMPTY_EXPECTED | No customer data after reset |
| Suppliers | 0 | supplier receive needs one configured supplier | MISSING_RUNTIME_DATA | No supplier fixture/master record |
| Products | 0 | not physical authority | READY_FOR_NO_QUANTITY_AUTHORITY | Zero is safe for serialized scope |
| Assets | 0 | zero before intake | EMPTY_EXPECTED | No physical stock after reset |
| `inventory_asset_movements` | 0 | zero before intake | EMPTY_EXPECTED | Canonical V2 movement table exists |
| `stock_movements` | 0 | zero before intake | EMPTY_EXPECTED | Legacy table empty |
| Purchase orders/items/Asset links | 0 / 0 / 0 | zero before intake | EMPTY_EXPECTED | No supplier transaction |
| Asset origins | 0 | zero before intake | EMPTY_EXPECTED | No source document |
| Purchase cost revisions | 0 | zero before intake | EMPTY_EXPECTED | No historical acquisition rows |
| Invoices/items/payments | 0 / 0 / 0 | zero after reset | EMPTY_EXPECTED | No sale data |
| Journal entries / Journal lines | 0 / 0 | zero after reset | EMPTY_EXPECTED | No posted business transaction |
| Cash transactions / cash sessions | 0 / 0 | zero after reset | EMPTY_EXPECTED | Treasury runtime not proven |
| Reservations | 0 | zero after reset | EMPTY_EXPECTED | No reservation data |
| CGP documents/items | 0 / 0 | zero after reset | EMPTY_EXPECTED | Separate acquisition path; no data |
| `profile_master_data` | 0 | controlled values before intake | MISSING_BOOTSTRAP | 01D source authority exists; official rows absent |
| `pearl_size_master_data` | 0 | 39 approved initial values | MISSING_BOOTSTRAP | No official values |
| Barcode inventory/item codes | 0 / 0 | approved code taxonomy | MISSING_BOOTSTRAP | No official code rows |
| Barcode sequences | 0 | runtime-generated | READY_EMPTY | Must not be manually seeded |
| Inventory locations | 0 | owner-defined values | OWNER_CONFIG_PENDING | Table exists; no value may be guessed |
| Settings | 0 | owner-defined operational values | OWNER_CONFIG_PENDING | Service defaults are currently used |
| Accounts | 36 active | branch finance authority | READY_BASELINE | All 36 observed active |
| Branch financial mappings | 11 active | receive/sale mappings | READY_FOUNDATION | Includes inventory/payable/VAT/payment roles |
| System account roles | 12 | semantic role authority | READY_FOUNDATION | Includes inventory/payable/VAT/payment roles |
| Gold market settings | 1 | one company scope | CONFIGURED_BUT_UNAVAILABLE | LIVE_PROVIDER/GOLDAPI_IO/AED/enabled |
| Gold market quotes | 5 | current fresh quote for runtime | STALE | Latest valid quote is from 2026-08-16 23:55:10 UTC |
| Gold pricing policies | 2 | policy rows as needed | PRESENT | No GBW UI mutation performed |

No count of zero is treated as a defect by itself. It is classified above as expected empty runtime state, missing bootstrap/master data, or owner-configurable state.

## Migration 82 Status

### Source and database evidence

- Source file exists: `backend/migrations/20260817010000-barcode-replacement-status-foundation.js`.
- Current source migration count is 82.
- Current official `SequelizeMeta` count is 82 and includes `20260817010000-barcode-replacement-status-foundation.js`.
- The approved source-freeze manifest records `FINAL_MIGRATION_SOURCE_COUNT = 81` and has no Migration 82 entry.
- The current handoff records `PERSISTENT_MIGRATIONS = 81`.
- Docker backend startup logs show `npm run db:migrate` followed by “No migrations were executed, database schema was already up to date”; this proves the current container found 82 already applied, but does not prove who or which prior batch applied it.
- This R1 did not run `sequelize db:migrate`, did not promote Migration 82, and did not change the database.

### Exact disposition

| Token | R1 result |
|---|---|
| `MIGRATION_82_SOURCE_READY` | YES |
| `MIGRATION_82_CLONE_REHEARSAL` | Prior 01D evidence says PASS; no clone recreated in R1 |
| `MIGRATION_82_OFFICIAL_PROMOTION` | `NOT_AUTHORIZED_THIS_BATCH`; actual DB state is `APPLIED` |
| `MIGRATION_82_REQUIRED_BEFORE_GBW_UI_IMPLEMENTATION` | NO, not for UI contract design |
| `MIGRATION_82_REQUIRED_BEFORE_GBW_RUNTIME_ACCEPTANCE` | YES for full barcode/status runtime acceptance; initial field UI can be designed independently |
| `MIGRATION_82_REQUIRED_BEFORE_BARCODE_REPLACEMENT_USE` | YES |

This is a safety/source reconciliation blocker, not evidence that R1 itself mutated the official DB.

## Source Authority / Drift Reconciliation

| Check | Actual | Evidence |
|---|---|---|
| Current branch | `main` | read-only `git rev-parse` |
| HEAD | `1657b0e9ba580faef69be48f04637835c201b521` | read-only Git |
| Current worktree status | 86 non-untracked status paths, 226 untracked paths, 312 total status paths | read-only `git status --porcelain` |
| Stashes | 11 | read-only `git stash list` |
| Accepted source model | `WORKTREE_CONTENT_PLUS_APPROVED_MANIFEST` | AGENTS/handoff/manifest |
| Manifest present | YES | `backend/reports/local-final-source-freeze-manifest-01-20260815T150848+0300.md` |
| Manifest SHA in handoff | `DF1F9651466240296B282C14B6C62532A2EBC74719C0AE8B93CCA8FD9B1838F7` | handoff/manifest |
| Observed manifest SHA | `E387A0BCB552217C6965659906AEF1EADC3B129AEC6A64BE9CA32A0F02E2B585` | read-only SHA-256 |
| Manifest hash match | NO | observed versus expected mismatch |
| Source migration set versus manifest | NO MATCH | current source has 82; manifest records 81 and omits 82 |
| Current implementation source authority | `WORKTREE_CONTENT_PLUS_APPROVED_MANIFEST`, subject to reconciliation | HEAD alone is not authority |
| Reconciliation before production promotion | YES | current target and manifest disagree |

Classification: `SOURCE_DRIFT / MIGRATION_STATE / ENVIRONMENT_CONFIG`. No cleanup, reset, restore, stash, or source normalization was performed.

## Inventory Location Forensic

The source schema creates `inventory_locations` with `company_id`, `branch_id`, unique `(company, branch, code)`, `location_type`, and `is_active`, and adds nullable `assets.location_id`. V2 movement rows preserve from/to location IDs.

Current evidence:

- Table exists and is empty.
- No dedicated `InventoryLocation` model/service/owner-value dataset was found in the current source set.
- Supplier UI currently presents `Location (optional)` as a free-text/input identity rather than a demonstrated active location master selector (`app/[locale]/(dashboard)/suppliers/purchases/page.tsx`).
- V2 policy treats `locationId` as optional for GBW and the Asset model allows it nullable.

| Finding | Expected | Actual | Impact | Classification / severity |
|---|---|---|---|---|
| Location architecture | branch/company-scoped active master | table/FK architecture exists | design can target a server-backed selector | NO_ISSUE / P2 |
| Location values | Owner-approved code/name/type | 0 rows | no production receive/readiness proof | MISSING_MASTER_DATA / HIGH |
| Location caller | active master authority | free-text optional UI evidence | could accept non-authoritative values | ACCEPTANCE_GAP / P2 |

Decision: `LOCATION_MODEL_READY = YES_FOUNDATION`; `LOCATION_VALUES_STATUS = OWNER_CONFIG_PENDING`; `GBW_UI_CAN_BE_IMPLEMENTED_WITH_CONFIGURABLE_LOCATIONS = YES`, but `GBW_PRODUCTION_PROVISIONING_READY` remains NO until approved values exist.

## VAT / Tax Forensic

### Authority and formulas

The server authority is `backend/src/services/settings.service.js` plus `gold-valuation.service.js` and the canonical purchase/sale routes. The setting keys include `vatRate`, `purchaseVatRate`, `vatEnabled`, `purchaseTaxIncludedDefault`, `purchaseVatRecoverableDefault`, `inputVatAccountCode`, and `rcmOutputAccountCode`.

The source-backed GBW rules are mapped as follows:

- Jewellery purchase VAT base = `gold value + making total`, multiplied by VAT rate.
- Gold Bar 24K purchase VAT base = certificate cost only; gold value is not the taxable base.
- Current jewellery VAT base = `current gold value + current making value`.
- Gold Bar 24K current VAT base = certificate cost only.
- 01B closes making basis as net weight; no 01B defect is reopened here.

### Actual state

- Official `settings` rows = 0.
- `settings.service.js` therefore returns fallback defaults, including `vatRate=5`, `purchaseVatRate` falling back to `vatRate`, and default payment methods. These are documented in source as fallbacks, but they are not Owner-frozen rows in the reset DB.
- The canonical setting route is read-only at `GET /settings` and guarded by `settings.view`; mutations are permission guarded, but were not called.
- Branch mapping has an active `VAT_PAYABLE` role and account; this is accounting authority, not proof of the correct business VAT rate/basis for each future client profile.

| Finding | Expected | Actual | Impact | Classification / severity |
|---|---|---|---|---|
| VAT authority | one server setting/config contract | service contract exists | implementation can consume it | NO_ISSUE / P2 |
| VAT value | Owner-configured rate, not guessed fallback | no settings rows; runtime fallback 5 observed by source contract | production financial acceptance cannot be trusted | ENVIRONMENT_CONFIG / FINANCIAL / P1 |
| GBW profile bases | jewellery and bar bases distinct | canonical valuation source distinguishes both | formula authority is known | NO_ISSUE / P2 |
| VAT permissions | settings update/RBAC | route uses `settings.update`; no new permission required | owner admin path is identifiable | READY / P2 |

Tokens: `VAT_AUTHORITY_READY = YES_FOUNDATION`; `VAT_OWNER_CONFIG_PENDING = YES`.

## POS Configuration Forensic

POS reads system settings through `useAppSettings` and uses server `/settings` values for VAT, currency, installment behavior, and payment method availability. The server checkout route also reads `settingsService.getCompanySettings` and recomputes financial totals.

Confirmed source behavior:

- Physical asset search/sale authority remains Asset in canonical POS paths; Product is not the authority for final serialized scope according to 01A source evidence.
- Frontend payment options are a presentation projection of settings, but include a fallback list when settings are absent.
- Frontend provisional display calculation in `app/[locale]/(dashboard)/pos/page.tsx` still contains a gross-weight making display expression. It is not financial server authority, but it is a profile-screen/UX mismatch to be handled in the later GBW/UI regression stream.
- No POS settings rows exist in official DB.

| POS concern | Authority | Actual | State |
|---|---|---|---|
| Asset search and availability | server POS/Asset routes | source authority present | READY_FOUNDATION |
| VAT/currency | server settings | settings table empty; fallback path active | OWNER_CONFIG_PENDING |
| Payment options | settings `paymentMethods` | no row; fallback list in UI/service | OWNER_CONFIG_PENDING |
| Installments | settings installment keys | no row; fallback enabled contract | OWNER_CONFIG_PENDING |
| Final serialized Product fallback | 01A server guards | source guard evidence present; no runtime mutation test in R1 | STATIC_READY_RUNTIME_UNPROVEN |
| UI GBW making preview | server should be authority | frontend display code still uses gross in one preview path | ACCEPTANCE_GAP / P2 |

Tokens: `POS_CONFIGURATION_AUTHORITY_READY = YES_FOUNDATION`; `POS_OWNER_CONFIG_PENDING = YES`.

## Payment Method Authority

Canonical payment-method vocabulary in source/settings is:

`cash`, `card`, `transfer`, `split`, `installment`, `deposit`.

The financial approval service normalizes the core settlement methods to `CASH`, `BANK_TRANSFER`, and `MIXED`; the settlement service resolves cash/bank accounts through branch mappings and requires bank references where applicable. This is a server authority chain, not a production enablement decision.

Actual post-reset state:

- `settings=0`; no company-specific payment method enablement row exists.
- Branch financial mappings include `CASH_TREASURY`, `BANK_ACCOUNT`, and customer-deposit liability roles, all active in the current one-branch scope.
- No payment record exists to prove posting.

`PAYMENT_METHOD_AUTHORITY_READY = YES_FOUNDATION`  
`PAYMENT_METHOD_ENABLEMENT_STATUS = OWNER_CONFIG_PENDING_FALLBACK_ONLY`.

## Financial Prerequisites

| Prerequisite | Evidence | Status |
|---|---|---|
| Company/branch context | 1 company, 1 branch; server branch-scoped resolvers | READY |
| Inventory asset role | active branch mapping `INVENTORY_ASSET`; semantic role present | READY_FOUNDATION |
| Supplier payable role | active branch mapping `SUPPLIER_PAYABLE`; semantic role present | READY_FOUNDATION |
| VAT payable role | active branch mapping `VAT_PAYABLE`; semantic role present | READY_FOUNDATION |
| Cash/bank settlement roles | active `CASH_TREASURY` and `BANK_ACCOUNT` mappings | READY_FOUNDATION |
| Chart of accounts | 36 active accounts; 12 system roles | READY_FOUNDATION |
| Supplier payable runtime | no suppliers, POs, origins, revisions or journals | NOT_PROVEN |
| VAT amount/rate | no settings rows; fallback service values | OWNER_CONFIG_PENDING |
| Balanced existing journals | zero journals after reset | EMPTY_EXPECTED |

`GBW_FINANCIAL_PREREQUISITES_READY = PARTIAL_OWNER_VAT_AND_RUNTIME_PROOF_PENDING`.

No accounting redesign or financial write was performed.

## Gold Center Prerequisites

### Source contract

| Contract | Source authority | Actual |
|---|---|---|
| Provider abstraction | `gold-market-provider-registry.service.js` | `GOLDAPI_IO` adapter registered |
| Runtime mode | `GoldMarketSetting.pricingMode` | `LIVE_PROVIDER` |
| Provider | `activeProvider` | `GOLDAPI_IO` |
| Currency/unit | `marketCurrency`, normalized quote | `AED / PER_GRAM` |
| Refresh/stale | `refreshIntervalSeconds`, `staleAfterSeconds` | DB `10000 / 10500`, not source defaults 30/120 |
| Quote semantics | provider contract and pricing policy | SPOT/BID/ASK supported; policy rows exist |
| Snapshot/cache | `gold_market_quotes` plus Redis/BullMQ runtime | 5 DB quotes; scheduler registered |

### Runtime/config evidence

- Official `gold_market_settings` row is enabled and LIVE_PROVIDER.
- Latest quote is `GOLDAPI_IO`, `AED`, `PER_GRAM`, valid official response, timestamp `2026-08-16 23:55:10 UTC`.
- At the read-only health observation, the quote was older than the configured 10500-second stale threshold; health classified it unavailable/stale.
- `GET /api/health/gold` returned HTTP 503.
- Backend logs repeatedly report `GOLDAPI_IO_NETWORK_ERROR` on scheduled refresh.
- Local `.env` has a nonempty provider value, but the key name has one trailing space (`key length 40`, trimmed length 39). The backend container has neither the canonical `GOLD_MARKET_PROVIDER_GOLDAPI_IO_API_KEY` nor legacy `GOLD_API_KEY` present. No secret value was printed.
- This makes the current provider failure a combined `ENVIRONMENT_CONFIG / PROVIDER_EXTERNAL` finding. It is not a source formula defect.

| Layer | Expected | Actual | Impact | Classification | Severity |
|---|---|---|---|---|---|
| Source | one canonical GoldAPI adapter | present | architecture is usable | NO_ISSUE | P2 |
| DB setting | live provider with valid intervals | enabled, but 10000/10500 | policy exists; stale window is owner/config state | ENVIRONMENT_CONFIG | P1 |
| Secret injection | canonical key available to backend | absent in container; local key name malformed | refresh cannot be proven | PROVIDER_EXTERNAL / ENVIRONMENT_CONFIG | P1 |
| Network | successful provider refresh | recurring network errors | fresh Gold rate unavailable | PROVIDER_EXTERNAL | P1 |
| Snapshot | fresh quote under threshold | latest quote stale | GBW runtime pricing acceptance blocked | GOLD_SNAPSHOT_STATE / FINANCIAL | P1 |

Tokens: `GOLD_CENTER_SOURCE_AUTHORITY = READY`; `GOLD_CENTER_RUNTIME_STATUS = UNAVAILABLE_STALE`; `GOLD_CENTER_ROOT_CAUSE = PROVIDER_RUNTIME_CONFIG_AND_NETWORK_PATH`; `GBW_GOLD_CENTER_PREREQUISITES_READY = NO_RUNTIME_PROVIDER_PROOF`.

No API key was printed or changed, and no provider-setting mutation was attempted.

## Gold By Weight Field Authority Matrix

The official GBW document contains the following complete field/rule surface. The prior exhaustive DOCX/visual register is the document authority: Gold By Weight 36 pages, Pearl 74, Diamond 82, Gem Stone 73, Gold By Piece 34; all 299 pages checked; the only non-text requirement was the GBW embedded pure-gold formula image.

| Section / field | Client rule | Server/source authority | R1 disposition |
|---|---|---|---|
| Item Description | required; controlled item descriptions | `profile_master_data` category `GOLD_ITEM_DESCRIPTION`; 01D policy | mapped; official rows missing |
| Gold Karat / KT | required; approved list 24K/22K/21K/18K/14K/12K/10K/9K; 24K Gold Bar context | server profile policy and numeric validation | mapped; policy source exists |
| Gold Color | optional; Yellow/White/Rose/custom wording in document | profile master category `GOLD_COLOR` | mapped; official rows missing |
| Brand Name | optional | Asset metadata `brand` | mapped |
| Model Name | optional | Asset metadata `model` | mapped |
| Model Number | optional | Asset metadata `modelNumber` | mapped |
| Supplier Name | optional in GBW detailed field block; supplier linkage remains server-owned | Supplier/Asset supplier linkage | mapped; no supplier row after reset |
| Purchase Date | required | Asset/purchase-order source date contract | mapped; current generic V2 policy does not expose full final-screen enforcement |
| Item Image | optional | Asset attachments | mapped; UI implementation pending |
| Gross Weight | required physical input | Asset `grossWeight`; V2 weight facts | mapped |
| Stone Weight | required field in source, including zero/no-stone case | V2 weight facts and `calculateGoldWeights` | mapped; conditional zero semantics must be rendered |
| Stone Name | optional/conditional when stone weight exists | Asset metadata/components | mapped |
| Net Gold Weight | calculated `gross - stone` | server `calculateGoldWeights` | mapped; not client authority |
| Pure Gold Weight 999.9 | calculated `net × karat / 24`; image confirms 18K/100g/75g example | server weight/valuation policy | mapped; source formula closed |
| Global Gold Rate at Purchase / gram | required historical input/snapshot | purchase valuation and Gold Center snapshot | mapped; fresh Gold runtime pending |
| Total Gold Value at Purchase | calculated `rate × net gold weight` | `gold-valuation.service.js` | mapped |
| Making Cost per Gram | required for GBW jewellery; not bar strategy | `gold-valuation.service.js` / sale pricing | mapped; net basis closed by 01B |
| Total Making Cost | calculated `making rate × net gold weight` | canonical valuation/pricing services | mapped; 01B closed |
| Purchase VAT | calculated on `(gold + making) × VAT rate` for jewellery | settings + gold valuation | mapped; rate/config pending |
| Total Purchase Cost | calculated purchase components plus VAT | valuation result / purchase cost revision | mapped |
| Current Global Gold Rate | server/current rate; document allows controlled manual override with audit | Gold Center/current valuation authority | mapped; runtime unavailable |
| Current Gold Value | current rate × net | current valuation service | mapped |
| Current Making Cost per Gram | current policy/value | current valuation/policy | mapped; override permission path exists |
| Current Making Value | current making × net | current valuation service | mapped |
| Current VAT | `(current gold + current making) × VAT rate` | current valuation/settings | mapped; rate pending |
| Current Total Cost | current gold + making + VAT | current valuation service | mapped |
| Manual override fields | current rate/value/making/VAT/total require audit record | route override governance, `goldCost.override` configurable permission | mapped; permission/config value must be Owner-frozen |
| Current Selling Gold Rate | calculated/selected according to selling method | Gold Center + sale pricing | mapped |
| Selling Making per Gram | required selling input/policy | sale pricing policy | mapped; client UI pending |
| Minimum Allowed Making per Gram | required protection threshold | sale pricing approval rule | mapped; Owner values pending |
| Selling Method | Retail Gold Rate or Global Gold Rate | sale pricing policy | mapped; Owner choice pending |
| Barcode | system-generated, globally unique, never reused, Asset-linked, reprintable, audited | barcode identity service + Asset | mapped; 82 history state must be reconciled |
| RFID | optional, linked, searchable, auditable; barcode remains primary | RFID assignment/history tables | mapped |
| Asset ID | system-generated, unique, permanent, never edited/reused, read-only | Asset identity | mapped |
| Attachments | images, certificates, supplier documents, other; unlimited/document-linked | Asset attachments/certificates | mapped; full screen pending |
| Status | Available, Reserved, Pending Transfer, Workshop, Returned, Missing, Melted, Sold | operational Asset status transition authority | mapped; full status vocabulary remains separate workflow decision |
| Inventory visibility | each Asset appears according to current status | Asset status/search | mapped |
| Branch | required | server company/branch context and Asset branch | mapped; current branch exists |
| Location | optional | Asset location FK/movement location | mapped; values absent |
| Audit fields | old/new/user/employee/branch/device/date/time/reason | asset events/audit service | mapped; full UI acceptance pending |
| History events | creation, modification, reservation, extension/cancellation, transfer, workshop, sale, return, exchange, audit, status, adjustment, RFID, tag printing, melting, conversion | immutable Asset events plus domain rows | mapped; not all client UI surfaces exist |
| List/grid | dynamic columns, filters, pinning, totals, saved views, smart multi-criteria search, bulk actions/export | inventory list/search/saved-view source | mapped; current UI is partial fixed grid |

`GBW_UNMAPPED_FIELDS = 0` means every document field/rule is represented in this authority matrix. It does not mean the current Product has implemented the final screen.

## GBW Required / Optional Matrix

| GBW area | Required | Optional / conditional | Current enforcement/readiness |
|---|---|---|---|
| Identification | description, karat, purchase date | color, brand, model, model number, supplier, image | server core exists; final form missing |
| Weight | gross, stone-weight field, derived net, derived pure gold | stone name conditional | formula authority exists; final UI missing |
| Purchase | historical gold rate, making rate for jewellery, derived values/VAT/total | certificate fields for 24K bar | valuation contract exists; settings/provider pending |
| Current cost | rate/value/making/VAT/total are server-derived | controlled audited override | override path exists; exact owner permission/config pending |
| Sales | selling rate/making/minimum/selling method | manager approval as threshold requires | sale authority exists; final GBW policy screen missing |
| Tag | Asset ID/barcode | RFID, attachments/certificates | identity services exist; rows/config absent |
| Status | status and branch | location | Asset status authority exists; status acceptance remains separate |
| Audit/history | immutable event record and audit details | domain-specific attachments | schema/services exist; complete final UI missing |

## GBW Editability Matrix

| Field group | Editable by ordinary intake | Server-calculated/read-only | Controlled override |
|---|---|---|---|
| Description/color/brand/model/model number | yes, subject to master/field policy | no | permissioned master data where applicable |
| Karat | select from server policy; not arbitrary client authority | normalized server value | no free-form widening |
| Gross/stone weight | input/scale value | net and pure gold derived | correction must be audited; no silent client net override |
| Purchase gold rate | input/snapshot subject to provider/manual policy | total gold value | override governed by source/policy |
| Making per gram | input for GBW jewellery | total making | approval/permission for below minimum selling value |
| VAT rate | not a free financial authority in final client UI | VAT amount/total | settings/admin authority only |
| Current rate/values | no ordinary free mutation | current calculations | `allowGoldCostOverride` + configured `goldCost.override` + reason + audit |
| Selling method/rates | policy-controlled | selling totals | approval when below minimum |
| Asset ID/barcode | no | server-generated identity | barcode replacement only under reconciled 82 policy |
| RFID | optional permissioned assignment | history | audited replacement |
| Status/branch/location | command/permission/context controlled | visibility derived | status transition and branch/location authority only |
| Audit/history | append through canonical commands | read-only history | no deletion/rewrite |

`GBW_EDITABILITY_READY = YES_CONTRACT_MAPPED`; `OWNER_CONFIG_PENDING` applies to values and permissions, not an unknown business rule.

## GBW Master-Data Consumer Matrix

| Consumer | Master data / authority | Current DB | Readiness |
|---|---|---:|---|
| Item description | `profile_master_data:GOLD_ITEM_DESCRIPTION` | 0 | source-ready, production missing |
| Gold color | `profile_master_data:GOLD_COLOR` | 0 | source-ready, production missing |
| Karat | fixed server policy | no row table | ready foundation |
| Pearl sizes | not required by GBW | 0 | unrelated to GBW, needed for Pearl later |
| Certificate authorities | profile master category | 0 | needed for bar/certificate extension |
| Barcode inventory/item codes | barcode settings tables | 0 / 0 | needed before actual tag allocation |
| Barcode sequences | runtime allocator | 0 | must remain runtime-generated |
| Inventory locations | branch/company master | 0 | optional GBW field, production pending |
| VAT/settings | settings table/service | 0 | financial prerequisite pending |
| Gold quotes | `gold_market_settings` + `gold_market_quotes` | 1 / 5 | stale/unavailable runtime |
| Financial mappings | branch mappings/system roles | 11 / 12 | ready foundation, no transaction proof |
| Permissions | existing RBAC/settings/update/override/approval | 5 roles / 136 permissions | authority exists; exact assignment/config pending |

## Production Provisioning Dataset

No provisioning occurred in R1. The dataset is classified, not applied.

| Dataset | Classification | Production value status |
|---|---|---|
| Company/branch identity | existing system master | present |
| GBW item descriptions | source-backed 01D dataset | Owner-approved rows not in official DB |
| Gold colors | source-backed 01D dataset | Owner-approved rows not in official DB |
| Karats | fixed server policy | source/policy present |
| Barcode inventory codes | 01C/01D accepted taxonomy | official rows absent |
| Barcode item codes | 01C/01D accepted taxonomy | official rows absent |
| Barcode sequence rows | runtime state | must not be provisioned manually |
| Locations | owner-specific code/name/type per branch | values unknown; do not guess |
| VAT/settings | owner-specific rate/bases/enablement | values unknown; do not guess |
| POS/payment methods | owner-specific enablement | values unknown; do not guess |
| Gold provider runtime config | provider key injection + DB interval policy | container key absent; values need owner/runtime resolution |
| Financial mappings | existing active rows | present for current scope |
| Assets/suppliers/POs | business data | intentionally zero after reset |

`PRODUCTION_PROVISIONING_DATASET_READY = YES_CLASSIFIED_OWNER_VALUES_PENDING`  
`UNSUPPORTED_GUESSED_VALUES = 0`.

## Production Provisioning Order

Design-only order; nothing below was executed:

1. Reconcile source manifest, current worktree, and official Migration 82 state.
2. Owner approves exact company/branch location codes, names, types, and active flags.
3. Owner approves VAT rate, purchase/sales tax bases, inclusive/recoverable/RCM behavior, and financial account semantics.
4. Owner approves POS/payment enablement and installment/deposit rules.
5. Verify GoldAPI canonical secret injection and approved refresh/stale intervals without printing the secret.
6. In a separately authorized safe target, provision source-backed GBW profile masters and barcode taxonomy using idempotent, target-checked tooling.
7. Verify active master resolution, financial mappings, Gold freshness, and barcode allocator readiness.
8. Only then implement and accept the GBW profile screen and its complete server/UI contract.

`PRODUCTION_PROVISIONING_ORDER_READY = YES_DESIGN_ONLY`.

## Migration Promotion Dependency

Migration 82 is not required to design the GBW screen fields or the 01B formula contract. It is required for the full barcode-replacement/status acceptance boundary and must be reconciled before any promotion decision because it is already present in the official DB but absent from the approved manifest/handoff.

Required future evidence:

- exact owner authorization or accepted-state decision for official 81→82;
- current source/manifest hash reconciliation;
- schema fingerprint showing the 82 tables/triggers/indexes match the source file;
- no blind re-run and no rollback/restore;
- then a separately authorized runtime acceptance target.

## Frontend Hardcode Review

Read-only review found the following non-authoritative or incomplete presentation paths:

| File/surface | Finding | GBW impact |
|---|---|---|
| `app/[locale]/(dashboard)/gold-center/page.tsx` | karat fallback array when snapshot absent | must consume server master/policy in final profile UI |
| `features/inventory/components/inventory-item-form-config.ts` | static profile/variant arrays | generic form is not the final GBW screen authority |
| `features/inventory/components/InventoryTypeFields.tsx` | generic/free-form fields including net weight/making | final GBW contract must make net/pure server-calculated |
| `app/[locale]/(dashboard)/inventory/page.tsx` | fixed labels/status/columns | does not satisfy dynamic GBW grid requirements |
| `app/[locale]/(dashboard)/suppliers/purchases/page.tsx` | location optional text input and broad VAT UI | needs final authority-backed selector/contract later |
| `app/[locale]/(dashboard)/pos/page.tsx` | gross-weight making display preview | display-only mismatch; backend remains pricing authority |
| `features/settings/hooks/use-barcode-settings.ts` | reads server barcode settings | correct integration direction, but official rows are empty |

No frontend file was changed in R1.

## Closure / Disposition Impact

`CLOSURE_DISPOSITION_BLOCKS_GBW_PROFILE_IMPLEMENTATION = NO`.

Evidence:

- GBW core intake, purchase/current/sales layers, Asset identity, branch/location, status, barcode/RFID, and audit requirements are independently mapped above.
- Closure/disposition values (`CLOSED`, `REMOVED_FROM_INVENTORY`, `WRITTEN_OFF`, `EXCHANGED_OUT`, `EXCHANGED_IN`, `ARCHIVED_LEGACY_ALIAS`) concern later lifecycle/accounting semantics and are not required to calculate or receive a new GBW Asset.
- They do block full lifecycle/status regression acceptance if their accounting semantics remain unapproved. That is a later workflow gate, not a GBW screen-field unknown.

## Owner Decision Table

| Decision | Why needed | Blocks UI coding? | Blocks production/runtime acceptance? |
|---|---|---:|---:|
| Reconcile official DB 82 versus approved 81 manifest | source safety and promotion authority | YES before implementation target is frozen | YES |
| Exact branch location codes/names/types | no owner-approved value exists | NO; use configurable selector contract | YES |
| VAT rate and profile bases/RCM/inclusive/recoverable policy | financial correctness | NO; consume settings authority | YES |
| POS payment method enablement | settlement behavior | NO; consume settings authority | YES |
| Installment/deposit enablement and limits | POS/reservation contract | NO for GBW intake | YES for POS regression |
| GoldAPI key injection under canonical env name | fresh Gold quote | NO for static UI | YES for pricing/runtime |
| Gold refresh/stale intervals | freshness policy; current 10000/10500 is not the documented default | NO | YES |
| Exact current-value override permission assignment | audited manual overrides | NO if permission is parameterized | YES for override acceptance |
| Final barcode replacement interpretation after Migration 82 | document/source policy conflict | NO for initial barcode display | YES for replacement/history acceptance |
| Additional closure/disposition accounting semantics | later lifecycle | NO | YES for lifecycle regression |

`OWNER_DECISIONS_BLOCKING_GBW_UI = SOURCE_RECONCILIATION_ONLY`  
`OWNER_VALUES_REQUIRED_BEFORE_PRODUCTION = LOCATIONS + VAT/TAX + POS/PAYMENT + GOLD_RUNTIME + OVERRIDE_ASSIGNMENT`.

## Remaining Owner-Configurable Values

1. Official source/migration state decision for already-applied 82.
2. Active inventory locations for the current branch.
3. VAT rate and profile-specific VAT behavior.
4. POS payment method enablement and installment/deposit settings.
5. Gold Center provider secret injection, canonical key spelling, refresh interval, and stale threshold.
6. Gold selling method, minimum making threshold, and override assignment for GBW.
7. Final production profile master rows and barcode taxonomy rows.
8. Closure/disposition semantics for later lifecycle acceptance.

No value was guessed or inserted.

## GBW Implementation Readiness

| Readiness dimension | Result | Evidence |
|---|---|---|
| Document coverage | READY | 299/299 pages; visual register complete; unmapped 0 |
| GBW formula authority | READY | 01B source/test; net basis 6/6 pass |
| Asset/barcode authority | READY_FOUNDATION | source policy and 01A/01C evidence |
| Server profile/master authority | READY_FOUNDATION | 01D policy/tests; official master rows absent |
| Field mapping | READY | complete authority matrix; unmapped 0 |
| Requiredness | READY_FOR_DESIGN | required/optional/conditional matrix frozen |
| Editability | READY_FOR_DESIGN | server-calculated versus controlled override mapped |
| Location model | READY_FOUNDATION | schema/FK/scoping known; values absent |
| VAT authority | PARTIAL | source authority known; settings rows absent |
| POS/payment authority | PARTIAL | source authority known; enablement rows absent |
| Financial mappings | READY_FOUNDATION | 11 active branch mappings, 12 system roles |
| Gold runtime | NOT_READY | stale quote, 503 health, network error, container key absent |
| Migration/source target | NOT_READY | DB 82 versus manifest/handoff 81 |
| UI implementation | `YES_AFTER_SOURCE_RECONCILIATION` | screen design can use configurable/server authorities |
| Production provisioning | `NO_OWNER_CONFIG_PENDING` | no values may be guessed |

Tokens:

`GBW_TOTAL_FIELDS_MAPPED = COMPLETE_CANONICAL_MATRIX`  
`GBW_UNMAPPED_FIELDS = 0`  
`GBW_REQUIREDNESS_READY = YES_FOR_DESIGN`  
`GBW_EDITABILITY_READY = YES_FOR_DESIGN`  
`GBW_MASTER_DATA_CONSUMERS_READY = PARTIAL_OFFICIAL_ROWS_MISSING`  
`GBW_UI_IMPLEMENTATION_READY = YES_AFTER_SOURCE_RECONCILIATION`  
`GBW_BACKEND_CONTRACT_READY = PARTIAL_FULL_PROFILE_CONTRACT_NOT_YET_IMPLEMENTED`  
`GBW_RUNTIME_ACCEPTANCE_READY = NO`  
`GBW_PRODUCTION_PROVISIONING_READY = NO_OWNER_CONFIG_PENDING`.

## Risks / Blockers

| ID | Finding | Expected | Actual | Impact | Severity | Classification | Confidence |
|---|---|---|---|---|---|---|---|
| R1-01 | Official migration baseline | manifest/handoff 81 and no 82 promotion | official `SequelizeMeta=82` and source 82 present | release/source target is not reconciled | P0 safety gate | MIGRATION_STATE / SOURCE_DRIFT / SECURITY | HIGH |
| R1-02 | Gold provider runtime | fresh live provider quote | 503 health, stale quote, recurring network errors | financial GBW runtime cannot be accepted | P1 | PROVIDER_EXTERNAL / ENVIRONMENT_CONFIG / FINANCIAL | HIGH |
| R1-03 | Gold secret path | canonical key available in backend | absent in container; local key name has trailing space | provider refresh unavailable | P1 | ENVIRONMENT_CONFIG / SECURITY | HIGH |
| R1-04 | Operational settings | Owner rows after reset | settings 0; fallback defaults active | VAT/payment/POS production values not frozen | P1 | MISSING_BOOTSTRAP / ENVIRONMENT_CONFIG / FINANCIAL | HIGH |
| R1-05 | Master data | controlled GBW values selectable | profile/barcode/location rows absent | final intake cannot be runtime-proven | P1 | MISSING_MASTER_DATA / MISSING_BOOTSTRAP | HIGH |
| R1-06 | Location caller | active location authority | optional free text in current supplier UI | non-authoritative location input risk | P2 | ACCEPTANCE_GAP / INVENTORY | HIGH |
| R1-07 | Final screen | all client fields and dynamic grid | generic/fixed UI only | implementation remains incomplete | P1 | PRODUCT_DEFECT / ACCEPTANCE_GAP / UX | HIGH |
| R1-08 | Closure/disposition | canonical lifecycle accounting | deferred semantics | later lifecycle acceptance blocked; GBW intake not blocked | P2 | DESIGN_LIMITATION / ACCEPTANCE_GAP | HIGH |

## Gate

The document and formula gates pass, but the overall R1 gate does not pass because the current source/DB baseline is not reconciled and Gold runtime cannot be proven.

```text
GATE = BLOCKED_SOURCE_DRIFT_MIGRATION_STATE_AND_GOLD_RUNTIME_RECONCILIATION_REQUIRED
```

This is not a Product implementation failure in the GBW formula. It is a read-only safety/configuration gate. No fix was executed.

## Next Recommended Step

Owner review only, in this order:

1. Decide and document the actual authority of official DB Migration 82 versus the approved 81 manifest; reconcile the source freeze before any implementation/promotion.
2. Approve exact location, VAT/tax, POS/payment, and Gold runtime values.
3. Restore/prove canonical GoldAPI runtime configuration in a separately authorized batch, without printing the secret.
4. Provision approved master/config data only in a separately authorized safe target, then run read-only and controlled runtime proof.
5. After those gates, start the separate Gold By Weight full-profile implementation batch only after explicit `ابدأ`.

No implementation, provisioning, migration promotion, or runtime mutation is started automatically.

## Final Tokens

```text
CURRENT_BATCH = DARFUS-INVENTORY-OWNER-CONFIGURATION-FREEZE-01D-R1
MODE = READ_ONLY_OWNER_CONFIGURATION_AND_PROFILE_PREREQUISITE_FREEZE

OFFICIAL_DATABASE = darfus_erp
OFFICIAL_DB_MUTATION_AUTHORIZED = NO
PERSISTENT_WRITES = 0

OFFICIAL_DB_MIGRATIONS = 82_OBSERVED
SOURCE_MIGRATIONS = 82_CURRENT_WORKTREE; 81_APPROVED_MANIFEST
MIGRATION_82_SOURCE_READY = YES
MIGRATION_82_OFFICIAL_PROMOTION = NOT_AUTHORIZED_THIS_BATCH; ACTUAL_DB_STATE=APPLIED

SOURCE_DRIFT_STATUS = OBSERVED_MANIFEST_HASH_MISMATCH_AND_MIGRATION_SET_MISMATCH
CURRENT_IMPLEMENTATION_SOURCE_AUTHORITY = WORKTREE_CONTENT_PLUS_APPROVED_MANIFEST_SUBJECT_TO_RECONCILIATION
SOURCE_FREEZE_RECONCILIATION_REQUIRED_BEFORE_PRODUCTION_PROMOTION = YES

GOLD_BY_WEIGHT_MAKING_BASIS = CLOSED_BY_01B

LOCATION_MODEL_READY = YES_FOUNDATION
LOCATION_VALUES_STATUS = OWNER_CONFIG_PENDING
GBW_UI_CAN_BE_IMPLEMENTED_WITH_CONFIGURABLE_LOCATIONS = YES_AFTER_SOURCE_RECONCILIATION

VAT_AUTHORITY_READY = YES_FOUNDATION
VAT_OWNER_CONFIG_PENDING = YES
POS_CONFIGURATION_AUTHORITY_READY = YES_FOUNDATION
POS_OWNER_CONFIG_PENDING = YES
PAYMENT_METHOD_AUTHORITY_READY = YES_FOUNDATION
PAYMENT_METHOD_ENABLEMENT_STATUS = OWNER_CONFIG_PENDING_FALLBACK_ONLY

GBW_FINANCIAL_PREREQUISITES_READY = PARTIAL_OWNER_VAT_AND_RUNTIME_PROOF_PENDING
GBW_GOLD_CENTER_PREREQUISITES_READY = NO_RUNTIME_PROVIDER_PROOF

GBW_TOTAL_FIELDS_MAPPED = COMPLETE_CANONICAL_MATRIX
GBW_UNMAPPED_FIELDS = 0
GBW_REQUIREDNESS_READY = YES_FOR_DESIGN
GBW_EDITABILITY_READY = YES_FOR_DESIGN
GBW_MASTER_DATA_CONSUMERS_READY = PARTIAL_OFFICIAL_ROWS_MISSING

PRODUCTION_PROVISIONING_DATASET_READY = YES_CLASSIFIED_OWNER_VALUES_PENDING
PRODUCTION_PROVISIONING_ORDER_READY = YES_DESIGN_ONLY
UNSUPPORTED_GUESSED_VALUES = 0

MIGRATION_82_REQUIRED_BEFORE_GBW_UI_IMPLEMENTATION = NO
MIGRATION_82_REQUIRED_BEFORE_GBW_RUNTIME_ACCEPTANCE = YES_FOR_FULL_BARCODE_STATUS_ACCEPTANCE
MIGRATION_82_REQUIRED_BEFORE_BARCODE_REPLACEMENT_USE = YES

CLOSURE_DISPOSITION_BLOCKS_GBW_PROFILE_IMPLEMENTATION = NO

OWNER_DECISIONS_BLOCKING_GBW_UI = SOURCE_RECONCILIATION_ONLY
OWNER_VALUES_REQUIRED_BEFORE_PRODUCTION = LOCATIONS_VAT_TAX_POS_PAYMENT_GOLD_RUNTIME_OVERRIDE_ASSIGNMENT

GBW_UI_IMPLEMENTATION_READY = YES_AFTER_SOURCE_RECONCILIATION
GBW_BACKEND_CONTRACT_READY = PARTIAL_FULL_PROFILE_CONTRACT_NOT_YET_IMPLEMENTED
GBW_RUNTIME_ACCEPTANCE_READY = NO
GBW_PRODUCTION_PROVISIONING_READY = NO_OWNER_CONFIG_PENDING

PRODUCT_CODE_FILES_CHANGED = 0
FRONTEND_FILES_CHANGED = 0
BACKEND_FILES_CHANGED = 0
TEST_FILES_CHANGED = 0
MIGRATIONS_CREATED = 0

GATE = BLOCKED_SOURCE_DRIFT_MIGRATION_STATE_AND_GOLD_RUNTIME_RECONCILIATION_REQUIRED
NEXT_RECOMMENDED_STEP = OWNER_REVIEW_RECONCILE_82_SOURCE_FREEZE_THEN_APPROVE_CONFIG_AND_GOLD_RUNTIME
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
```

## Required Ending

01D-R1 OWNER CONFIGURATION FREEZE BLOCKED  
→ DO NOT START GOLD BY WEIGHT IMPLEMENTATION  
→ OWNER DECISION REQUIRED

