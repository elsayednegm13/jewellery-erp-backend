# CGP-IMP-10A regression closure evidence

## Scope and safety

- Batch: `CGP-IMP-10A-REGRESSION-CLOSURE` only.
- Product services, routes, state engine, accounting, Gold Center, CRM and migrations were not changed.
- Original acceptance database was used only for `--verify-existing`/read-only evidence.  The two write-capable historical verifiers were executed only in disposable clones.
- Persistent `darfus_erp` was queried read-only only.
- No migration, seed, permanent fixture, commit, push or Next dev command was run.

## IMP04 authorized stage evidence

The verifier's allowlist remains exact and fail-closed: it accepts only the five immutable document/event identities listed in `KNOWN_FIXTURES`.  It still queries all `ACCEPTANCE_TEST_CGP_IMP04:*` posted events not in that exact list and fails if any one is consumed or has Asset-origin evidence.

| Document | Document ID / event ID | Correlation marker | Proven lineage | Classification |
| --- | --- | --- | --- | --- |
| `CGPD-000065` | `CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:19e5eba3-8417-4c97-b7f5-d5dccfbdca38` / `CGP-POSTED:CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:19e5eba3-8417-4c97-b7f5-d5dccfbdca38` | `ACCEPTANCE_TEST_CGP_IMP04:1786302308022:POST` | posted CGP; two line snapshots with approved price `28`; exact two `CGP_IMP_04_EVENT_V1` origins; Assets `CGPA-58a365984371482eae42b57390` / `CGPA-a67de422448d48398914471a1d`; barcodes `GODGOF21000291` / `GODGOF21000292`; `INVENTORY` processed and integration receipts are both `SUCCEEDED`; outbox remains `PENDING`. | `AUTHORIZED_STAGE_EVIDENCE` |
| `CGPD-000072` | `CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:05e98997-0bb1-4f99-a363-ca6f773cf3dd` / `CGP-POSTED:CGPD:COMP-1384c23f-18ee-405f-8675-8e87746be72c:05e98997-0bb1-4f99-a363-ca6f773cf3dd` | `ACCEPTANCE_TEST_CGP_IMP04:1786311934936:POST` | posted CGP; two line snapshots with approved price `29`; exact two `CGP_IMP_04_EVENT_V1` origins; Assets `CGPA-cb11fa0e84df4745b99f2a9b2b` / `CGPA-d70a3618cd7f48cabb4ac27c55`; barcodes `GODGOF21000294` / `GODGOF21000295`; `INVENTORY` processed and integration receipts are both `SUCCEEDED`; outbox remains `PENDING`. | `AUTHORIZED_STAGE_EVIDENCE` |

Verifier change: add only those two exact documents, event IDs, consumers, profiles, Asset IDs and barcodes to `KNOWN_FIXTURES`, and update the corresponding exact five-fixture row/audit assertions.  No range, wildcard, count relaxation, consumer-wide allowance, or unknown-fixture bypass was added.

`node scripts/verify-cgp-imp-04.js --verify-existing`:

```text
CGP_IMP04_VERIFY_EXISTING: PASS
UNKNOWN_IMP04_DEVIATIONS: 0
```

## Isolated write-capable verifier results

Both verifiers now bind model initialization and every verifier transaction to one explicit `TARGET_DATABASE`.  A clone override is accepted only through `CGP_IMP10A_REGRESSION_DB` matching `^darfus_erp_cgp_imp10a_regression_[a-z0-9_]+$`; it clears `DATABASE_URL` before loading models.  `darfus_erp` is rejected before database model initialization.

| Verifier | Clone | Before run | Result | Cleanup |
| --- | --- | --- | --- | --- |
| IMP03 | `darfus_erp_cgp_imp10a_regression_imp03_1786343132986_c0695a` | same-process `current_database()` matched clone; clone migrations `76`; source acceptance remained migrations `76` | posting/idempotency/concurrency/failure-rollback PASS; downstream writes `0`; no Product regression | exact validated clone dropped; absence rechecked |
| IMP02 | `darfus_erp_cgp_imp10a_regression_imp02_1786343171627_51920f` | same-process `current_database()` matched clone; clone migrations `76`; source acceptance remained migrations `76` | transactional outbox/processed event idempotency/claim concurrency/integration status PASS; non-test outbox mutation `0` | exact validated clone dropped; absence rechecked |

IMP02 exact ownership counters:

```text
NON_TEST_PENDING_EVENTS_CLAIMED = 0
NON_TEST_PROCESSING_EVENTS_CHANGED = 0
NON_TEST_OUTBOX_ROWS_UPDATED = 0
```

## Required regression matrix

| Verification | Result |
| --- | --- |
| IMP10A verify-existing | PASS |
| IMP09 verify-existing | PASS |
| IMP09A | PASS (`exercise=false`) |
| IMP08 verify-existing fixture | PASS |
| IMP07 | PASS |
| IMP06 | PASS |
| IMP05 | PASS |
| IMP05A | PASS |
| IMP04 verify-existing / unknown protection | PASS / PASS |
| IMP03 isolated clone | PASS |
| IMP11 stage-aware verifier | PASS |
| IMP02 isolated clone / non-test queue isolation | PASS / PASS |
| IMP01 | PASS |
| `npx tsc --noEmit` | PASS |
| `git diff --check` | PASS |

The ten full business-path race scenarios were not rerun because Product Code was frozen for this closure.  Previously established evidence remains: 10/10 scenarios PASS and `FULL_PATH_DOUBLE_SUCCESS_COUNT=0`.

## Final original acceptance and persistent verification

Original acceptance `darfus_erp_inventory_rehearsal_20260804_160500z`:

```text
migrations = 76
unbalanced journals = 0
orphan journal lines = 0
unlinked Treasury = 0
duplicate barcodes = 0
blank barcodes = 0
orphan Asset origins = 0
duplicate hold movements = 0
final reversed events = 0
CGPD-000071 = POSTED / HELD / REVERSAL_PENDING
accounting compensation = 0
Treasury reversal effect = 0
Gold reversal event = 0
CRM reversal row = 0
```

Persistent `darfus_erp` (read-only):

```text
migrations = 61
assets = 52
products = 3
unbalanced journals = 0
orphan journal lines = 0
unlinked Treasury = 0
```

## Protection and final gate

```text
next-env.d.ts SHA-256 = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
PRODUCT_CODE_CHANGES_THIS_TASK = 0
MIGRATIONS_CREATED_THIS_TASK = 0
ORIGINAL_ACCEPTANCE_MUTATIONS_THIS_CLOSURE = 0
PERSISTENT_DB_MUTATIONS_THIS_BATCH = 0
CGP_IMP_10A_REGRESSION_CLOSURE_GATE = PASS
CGP_IMP_10A_GATE = PASS_CONFIRMED
```

