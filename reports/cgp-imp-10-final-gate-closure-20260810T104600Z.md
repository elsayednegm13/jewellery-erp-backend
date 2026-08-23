# CGP-IMP-10 final gate closure

## Scope and lock forensics

- Batch: `CGP-IMP-10-FINAL-GATE-CLOSURE`.
- No Product Code, migration, original-acceptance fixture, or persistent-data mutation was performed in this closure.
- `pg_stat_activity` found one inherited idle acceptance session (PID `2676`, user `postgres`, no transaction, `ClientRead`) and no blocking PIDs or granted blocking locks. The previous timeout was therefore not an active PostgreSQL lock at closure time.
- No external process or PostgreSQL backend was terminated.

## IMP01 isolated regression

- `verify-cgp-imp-01.js` writes only inside a transaction and rolls that transaction back; it creates no migration and expects an exact target database.
- A narrow test-only override accepts only the original acceptance database or `darfus_erp_cgp_imp10_regression_*` clones.
- Clone: `darfus_erp_cgp_imp10_regression_imp01_1786348681592_f6a3a6`.
- Clone assertions: exact clone target, migrations `77`, and finalized `CGPD-000071` evidence.
- IMP01 result: PASS (`CGP_M1_BACKFILL_EXACT`, draft/governance compatibility, pricing snapshot immutability, transaction cleanup).
- The clone was dropped after its result; no IMP10 regression clones remain.

## Final read verification

- Original acceptance remained at 77 migrations. `verify-cgp-imp-10.js --verify-existing` and `verify-cgp-imp-10a.js --verify-existing` passed.
- `CGPD-000071` remains `REVERSED`; its reversal request is `COMPLETED`; its linked Asset is `REVERSED`.
- Exactly one final `CustomerGoldPurchaseReversedEvent v1`, one balanced reversal Accounting Journal, one Gold compensation event, and zero reversal Treasury rows are retained.
- Same-batch evidence already proved the unpaid, partial, full, and mixed payment cases plus Accounting/Gold/finalizer/CRM retry behavior.
- Acceptance and persistent read checks found no unbalanced journals, orphan journal lines, or unlinked Treasury. Persistent remains `darfus_erp`, migrations `61`, Assets `52`, Products `3`.

## Tooling and worktree

- `npx tsc --noEmit`: PASS.
- `git diff --check`: PASS (only inherited CRLF warnings).
- `next-env.d.ts` SHA-256 remains `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`; it was not changed.
- No Git staging, commit, push, reset, restore, clean, or stash operation was performed.

## Gate

`CGP_IMP_10_FINAL_REGRESSION_GATE = PASS`

`CGP_IMP_10_GATE = PASS_CONFIRMED`
