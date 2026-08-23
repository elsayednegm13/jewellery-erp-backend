# CGP-PENDING-POSTED-EVENTS-CONTROLLED-RECOVERY-01

## 1. Owner authorization

This is the explicitly authorized local Persistent recovery batch. Scope was limited to the exact four Phase-A protected `CustomerGoldPurchasePostedEvent` v1 rows. No generic pending scan, repost, synthetic business data, settlement, governance action, migration, or configuration change was used.

## 2. Backup

- Backup: `backend/backups/darfus_erp_development_2026-08-12T09-10-54-172Z.dump`
- SHA-256: `1ABF09A9C3B1683A6F0C2A10E69AB2E9090670D75A8065896F1FBF20A7BBB567`
- `pg_restore -l` exit code: `0`
- Backup gate: `PASS`

## 3. Database and runtime safety

- Persistent target verified in the same recovery process: `darfus_erp`
- Persistent migrations before/after: `80 -> 80`
- Acceptance DB was not opened or mutated.
- Watermark remained exactly `2026-08-12T08:32:21.028Z`.
- Scoped runtime config remained enabled with the exact watermark; generic Global Dispatcher remained off.
- Gold settings remained `GOLDAPI_IO / LIVE_PROVIDER / refresh 1500 / stale 2500`.
- No Gold provider HTTP request was made by recovery.

## 4. Protected event set and Phase-A matrix

| Event | Document | Created UTC | Items | business_status | voided_at | snapshots | pre-existing effects | eligibility |
|---|---|---:|---:|---|---|---:|---|---|
| `...:4c4aac3c-11a6-4efb-b1d0-a3bd9fd2efc6` | CGPD-000004 | 2026-08-11T21:45:53.970Z | 1 | POSTED | null | 1/1 | none | PASS |
| `...:0c14fbd5-5c39-44c4-9b73-15b5c90a38f5` | CGPD-000005 | 2026-08-11T21:50:36.463Z | 3 | POSTED | null | 3/3 | none | PASS |
| `...:1a5d276f-54b5-4408-9f85-4517b527da0a` | CGPD-000006 | 2026-08-12T05:58:03.352Z | 1 | POSTED | null | 1/1 | none | PASS |
| `...:eb23a813-a06c-4d79-924d-f91ab6390a63` | CGPD-000007 | 2026-08-12T06:56:11.008Z | 1 | POSTED | null | 1/1 | none | PASS |

All four were exact protected IDs from the activation Phase-A report, pre-watermark, `PENDING`, attempt `0`, immutable payloads, and had no asset, journal, liability, Gold Center, CRM, settlement, treasury, processed-event, integration, or legacy inventory-pool effect. No event was blocked.

## 5. Recovery method

Added a narrowly gated internal path:

- `backend/src/services/outbox.service.js`: `claimProtectedEventById` uses one atomic `FOR UPDATE SKIP LOCKED` claim and requires exact event ID/type/version, pre-watermark creation, `PENDING`, attempt `0`.
- `backend/src/services/cgp-runtime-dispatcher.service.js`: `processProtectedEvent` reuses the canonical registry and completion semantics.
- `backend/scripts/recover-cgp-pending-posted-events-controlled.js`: requires the exact four IDs, exact Persistent database, migration baseline 80, fixed watermark, and rechecks every guard immediately before the claim. It supports one event per invocation only.

Consumer order was the canonical order: `INVENTORY -> ACCOUNTING -> GOLD_CENTER -> AVAILABILITY -> CRM`.

## 6. Per-event results

### CGPD-000004

- Recovery: `PASS`; one physical item -> one Asset and one unique Barcode.
- Asset became `AVAILABLE` after hard gates.
- Journal: 1, debit=`5157.663`, credit=`5157.663`.
- Customer liability: 1 OPEN, outstanding=`5157.663`.
- Gold Center: 1 `CUSTOMER_GOLD_ACQUISITION_RECORDED`.
- CRM: 1 transaction history + 1 timeline.
- Receipts/integrations: 4/4 succeeded.
- Treasury/Settlement: 0/0.

### CGPD-000005

- Recovery: `PASS`; three physical items -> three Assets and three unique Barcodes.
- All three Assets became `AVAILABLE`.
- Journal: 1, debit=`13538.865`, credit=`13538.865`.
- Customer liability: 1 OPEN, outstanding=`13538.865`.
- Gold Center: 1 event.
- CRM: 1 history + 1 timeline.
- Receipts/integrations: 4/4 succeeded.
- Treasury/Settlement: 0/0.

### CGPD-000006

- Recovery: `PASS`; one item -> one Asset and one unique Barcode.
- Asset became `AVAILABLE`.
- Journal: 1, debit=`5181.305`, credit=`5181.305`.
- Customer liability: 1 OPEN, outstanding=`5181.305`.
- Gold Center: 1 event.
- CRM: 1 history + 1 timeline.
- Receipts/integrations: 4/4 succeeded.
- Treasury/Settlement: 0/0.

### CGPD-000007

- Recovery: `PASS`; one item -> one Asset and one unique Barcode.
- Asset became `AVAILABLE`.
- Journal: 1, debit=`5182.4854`, credit=`5182.4854`.
- Customer liability: 1 OPEN, outstanding=`5182.4854`.
- Gold Center: 1 event.
- CRM: 1 history + 1 timeline.
- Receipts/integrations: 4/4 succeeded.
- Treasury/Settlement: 0/0.

## 7. Final recovery matrix

| Document | Items | Assets | Barcodes | Journal | Liability | Gold | CRM | receipts | Outbox | Availability | Settlement readiness |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| CGPD-000004 | 1 | 1 | 1 | 1 | 1 | 1 | 2 projections | 4 | PUBLISHED | AVAILABLE | READY |
| CGPD-000005 | 3 | 3 | 3 | 1 | 1 | 1 | 2 projections | 4 | PUBLISHED | AVAILABLE | READY |
| CGPD-000006 | 1 | 1 | 1 | 1 | 1 | 1 | 2 projections | 4 | PUBLISHED | AVAILABLE | READY |
| CGPD-000007 | 1 | 1 | 1 | 1 | 1 | 1 | 2 projections | 4 | PUBLISHED | AVAILABLE | READY |

The four events produced 6 Assets and 6 unique Barcodes in total. Persistent Assets moved from 53 to 59; Products remained 3. No unrelated business delta was found.

## 8. Replay/idempotency and blocked-event safety

A second invocation was run in dry-run mode for CGPD-000004. It returned `OUTBOX_NOT_UNTOUCHED_PENDING` and detected existing effects without writing. No replay effects were created. There were no blocked events; therefore all protected events were handled and none were touched outside the controlled path.

## 9. Integrity

- Posted/reversed journals balanced: `0` unbalanced.
- Orphan journal lines: `0`.
- Unlinked Treasury: `0`.
- Blank barcodes: `0`.
- Duplicate barcodes: `0`.
- Orphan Asset origins: `0`.
- Duplicate canonical CGP source journals/liabilities/Gold events: `0`.
- Settlement writes: `0`; outstanding payable total is `29060.3184` and all four liabilities are OPEN.
- No migration 81; SequelizeMeta remains 80.

## 10. Scope exclusions and process safety

- Governance actions: `0`.
- Governance UI changes: `NO`.
- Presentation fixes: `0`.
- Legacy Gold isolation preserved; no CustomerGoldPool was used as a recovery target.
- Financial Arabon and Supplier paths were not changed.
- No `.env` change, no server connection/deployment, no Next dev, no Git staging/commit/push.
- The repository had an inherited nodemon process; a new backend PID was observed after source edits (automatic nodemon reload, not an operator restart). No restart command was issued.
- `next-env.d.ts` remained the inherited known-drift SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` and was not repaired.

## 11. Final gate

`CGP_PENDING_POSTED_EVENTS_CONTROLLED_RECOVERY_01_GATE = PASS_CONFIRMED`

All four protected pre-activation Posted events were recovered exactly once through the canonical consumers. Settlement was intentionally not executed. The next allowed batch is read-only browser settlement closeout only.

