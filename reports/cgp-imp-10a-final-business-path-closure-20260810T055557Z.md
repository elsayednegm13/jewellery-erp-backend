# CGP-IMP-10A final business-path closure evidence

- Source Acceptance DB: `darfus_erp_inventory_rehearsal_20260804_160500z`
- Temporary DB: `darfus_erp_cgp_imp10a_race_20260810055543792_a2bafd`
- Clone method: `pg_dump --format=custom` then `pg_restore`; migration count: 76.
- Marker: `CGP_IMP10A_FULL_PATH_TEST`.

## Deterministic barrier

The test harness has no timing-order sleeps.  It wraps the existing exported
`inventoryV2Runtime.transitionAsset` only in the test process and tags its
async caller with `AsyncLocalStorage`.  A test-only `Asset.findByPk` wrapper
signals only after the original `findByPk(..., { lock: FOR UPDATE })` returns.
The holder pauses at that exact central-transition checkpoint.  Hold-wins
starts the real hold consumer, waits for `HOLD_LOCK_ACQUIRED`, starts the real
business path, then releases Hold.  Business-wins does the symmetric sequence
with `BUSINESS_LOCK_ACQUIRED` before starting Hold.  Each contender uses its
own Sequelize transaction/PostgreSQL connection.

## Real paths and results

| Path | Real entrypoint | Hold wins | Business wins | Hold-wins residue |
| --- | --- | --- | --- | --- |
| Reserve | `reservation.service#createReservation` | PASS | PASS | reservation/header/items/payments: 0 |
| Transfer | `erp.routes.js` `POST /transfers` | PASS | PASS | transfer/header/items: 0 |
| Sale | `erp.routes.js` `POST /pos/checkout` | PASS | PASS | invoice/items/movement/journal/treasury: 0 |
| Workshop | `erp.routes.js` `POST /inventory-v2/workshop-orders` | PASS | PASS | order/items/movement: 0 |
| Melting | `erp.routes.js` `POST /inventory-v2/melt-orders` | PASS | PASS | order/inputs/movement: 0 |

All ten scenarios had exactly one durable winner.  A Hold winner ended in
`REVERSAL_PENDING` and request `HELD`; a business winner ended in its canonical
state and the Hold request remained `HOLD_PENDING` (never `HELD`).

## Clone integrity before cleanup

All were zero: orphan reservation links, transfer items, invoice items,
workshop items, manufacturing inputs, duplicate asset movements, unbalanced
journals, and orphan journal lines.

No product-code defect or migration was required.  The only change was the
untracked deterministic test harness.  This report was written before the
temporary database cleanup.
