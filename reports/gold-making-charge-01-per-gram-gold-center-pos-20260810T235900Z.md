# GOLD-MAKING-CHARGE-01 — Per-Gram Making Charge

## Binding scope and safety

- Batch: `GOLD-MAKING-CHARGE-01` only.
- Persistent database `darfus_erp` was read-only throughout.
- Acceptance database `darfus_erp_inventory_rehearsal_20260804_160500z` was read-only; the only writable proof used an exact disposable clone with prefix `darfus_erp_gold_making_charge_01_rehearsal_`, dropped after the test.
- No migration, GoldAPI request, live-provider activation, server connection, deployment, commit, or push was performed.
- Binding files read: `AGENTS.md`, `PROJECT_PROGRESS_HANDOFF.md`, `CGP_CANONICAL_IMPLEMENTATION_REFERENCE.md`, the current client source requirements, and the relevant Gold Live Feed reports.

## Forensic result

The old Gold Center quote path (`gold.service.quoteItem`) treated the `makingCharge` input as a total and added it directly to the subtotal. The old POS sale path likewise accepted a raw making amount; the gold sale calculator used net-gold weight for the making component. That made `10 g × 100/g` behave as `100`, and allowed the physical-weight authority to be bypassed.

The corrected contract is:

```text
MAKING_CHARGE_INPUT_MEANING = PER_GRAM
TOTAL_MAKING_CHARGE = ACTUAL_PHYSICAL_ITEM_WEIGHT_GRAMS × MAKING_CHARGE_PER_GRAM
```

The canonical Asset physical field is `Asset.grossWeight`. Gold value may continue to use the existing net/fine-weight basis, but making charge uses gross physical weight and never applies purity a second time.

## Implementation

- `backend/src/services/gold-sale-pricing.service.js`: one Decimal-safe `calculateMakingChargeTotal` helper; gold pricing receives trusted `itemWeightGrams` for making while retaining the existing net-weight gold-value calculation.
- `backend/src/services/gold.service.js`: Gold Center quote now accepts `makingChargePerGram`, calculates `grossWeight × rate`, and returns both per-gram and total values (the legacy `makingCharge` response remains a compatibility total).
- `backend/src/routes/erp.routes.js`: POS checkout, pricing preview, and draft paths resolve Asset `grossWeight` server-side and recalculate totals. Client-supplied weight or forged total is not authoritative; Product quantity contributes no jewellery making weight. Existing journal/tax/discount orchestration is preserved.
- `hooks/use-gold.ts` and Gold Center page: input/result labels distinguish `Making Charge / g` from `Total Making Charge`.
- `features/sales/hooks/use-pos.ts` and POS page: payloads use `makingChargePerGram`, preview displays server total, and checkout forwards the explicit per-gram contract.
- `messages/en.json` and `messages/ar.json`: localized labels for per-gram and total making.
- `backend/scripts/verify-client-requirements-batch-2b.js`: prospective Gold By Weight expectation updated to physical gross weight.

No schema change was required; no migration 81 was created. Historical posted invoice/return amounts remain immutable and are not repriced. Stone treatment, VAT base/rules, discount order, CGP acquisition economics, settlement, reversal, and live-price policy were not changed.

## Evidence

- Gold Center contract: `10 × 100 = 1000`, `8.75 × 100 = 875`, zero weight/rate produce zero, and the result is independent of karat/purity for the making component.
- POS disposable-clone proof: sold Asset `grossWeight = 2 g`, `makingChargePerGram = 100`, persisted invoice total making `= 200`; canonical checkout posted one balanced journal. Clone was dropped.
- `npx tsc --noEmit`: PASS.
- JavaScript syntax checks: PASS.
- Gold Live Feed 05, Live Feed 03, CGP IMP-11, and CONT53 D01/D11 contract regressions: PASS.
- `git diff --check`: PASS.
- Persistent read-only observation: database `darfus_erp`, migrations `77`, Assets `53`, Products `3`, unbalanced journals `0`, orphan journal lines `0`, unlinked treasury `0`, blank/duplicate barcodes `0`.
- Acceptance read-only observation: database `darfus_erp_inventory_rehearsal_20260804_160500z`, migrations `80`, Assets `475`, Products `3`; no task-owned synthetic rows were added.
- `next-env.d.ts` remained the inherited known drift SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`; it was not regenerated or repaired.

## Exit gate

`GOLD_MAKING_CHARGE_01_GATE = PASS_CONFIRMED`.

GoldAPI remains unconfigured and no request was made. Gold Live Feed 06 remains blocked pending safe provider-secret configuration and an explicitly authorized rerun.
