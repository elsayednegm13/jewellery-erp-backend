# SUPPLIER-GOLD-BAR-24K-PROFILE-SWITCH-PREVIEW-RUNTIME-FIX-01

## 1. Scope and safety

- Runtime/browser acceptance performed against the existing local runtime at `http://localhost:3000/ar/suppliers/purchases`.
- No Next restart, no migration, no `.env` edit, no submit from the browser, no Persistent/Acceptance business mutation.
- The existing closeout runner was rerun only against a disposable clone created from Acceptance; it dropped the clone in its `finally` path.
- Persistent `darfus_erp` and Acceptance `darfus_erp_inventory_rehearsal_20260804_160500z` were inspected with SELECT-only queries after the run.

## 2. Pre-fix reproduction

Before the source change, the real browser was configured with a valid supplier, `GOLD_BY_WEIGHT_JEWELLERY`, 10g, and 21K, then switched to `GOLD_BAR_24K`.

- Profile selected: `GOLD_BAR_24K`.
- Karat select became disabled while its value remained `21` immediately and after 700ms.
- The summary remained `غير متاح` and the server-summary card showed no canonical total.
- The same behavior was reproduced from Gold By Weight 21K and was consistent with the user screenshot. This was not inferred from static source only.

## 3. Root cause

The profile-switch effect reset `karat` to `21` after the Gold Bar lock effect scheduled `24`; the render therefore exposed a stale 21K state for the new profile. Preview construction also read the raw `karat` state, so a transient invalid request could be built. The server correctly rejects non-24K Gold Bar input, but the client state machine was not atomic.

## 4. Repair

Changed only `app/[locale]/(dashboard)/suppliers/purchases/page.tsx`:

- Added synchronous `effectiveKarat = is24kGoldBar ? "24" : karat`.
- Used `effectiveKarat` for the preview payload, receive payload, local read model, Gold Center rate lookup, override-reference tracking, and select value.
- Profile switching now resets to `24` for `GOLD_BAR_24K` and resets Gold Bar purchase/current-rate reference to the active 24K Gold Center rate.
- The Gold Bar select remains disabled; its value is now atomically 24 in the render that follows the profile change.
- Server validation and server-derived totals remain authoritative; no endpoint or schema was changed.

## 5. Browser post-fix evidence

Clean browser tab, no console warnings/errors in the final run:

| Scenario | Immediate karat | Settled karat | Disabled | Result |
|---|---:|---:|---|---|
| Weight 21K → Gold Bar | 24 | 24 | yes | PASS |
| Piece 21K → Gold Bar | 24 | 24 | yes | PASS |
| Weight 18K → Gold Bar | 24 | 24 | yes | PASS |
| Gold Bar → Weight 21K | 21 | 21 | no | PASS |
| Weight 21K → Gold Bar (back) | 24 | 24 | yes | PASS |
| Piece 22K → Gold Bar | 24 | 24 | yes | PASS |

Rapid eight-step alternating Weight/Piece/Gold Bar switching produced 24 immediately on every Gold Bar step and no clean-tab console errors. A valid 10g Gold Bar preview with explicit 7.25% VAT showed Gold Center 24K rate `517.00867088`, gold value `5,170.09`, certificate `100.00`, VAT `7.25`, and total `5,277.34` in the UI. No `21K` Gold Bar state or stale unavailable state was observed after valid fields were supplied.

The browser harness exposes DOM/dev-log inspection but not POST-body interception. Request-body evidence is therefore tied to the live rendered result plus the inspected `previewItems` source builder; exact wire-body capture is recorded as a harness limitation, not fabricated.

## 6. Disposable-clone receipt acceptance

`supplier-gold-bar-receipt-pricing-e2e-closeout-01.js` returned `{"result":"PASS"}` on clone `darfus_erp_supplier_gold_closeout_202608130722` and dropped it. It verified Gold Bar 24K receipt/read-back, historical purchase freeze, current valuation separation, 7.25% certificate-only VAT, unauthorized rejection, tamper rejection, idempotency, Gold By Weight 14/18/21/22/24, Gold By Piece 14/18/21/22/24, journal balance, and no orphan journal lines.

## 7. Verification

- `npx tsc --noEmit`: PASS.
- `npx eslint --no-cache app/[locale]/(dashboard)/suppliers/purchases/page.tsx`: PASS.
- `node --test backend/tests/supplier-gold-bar-receipt-pricing-e2e-closeout-01.test.cjs`: 3/3 PASS.
- Persistent: `current_database()=darfus_erp`, migrations 80, Assets 62, Products 3; duplicate/blank barcodes 0, orphan RFID 0, orphan profile references 0.
- Acceptance: `current_database()=darfus_erp_inventory_rehearsal_20260804_160500z`, migrations 80, Assets 475, Products 3; duplicate/blank barcodes 0, orphan RFID 0, orphan profile references 0.
- Next-env remained inherited drift SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`; it was not changed or repaired because this task did not authorize a protected-file repair.
- No clone databases remain.

## 8. Gate

The user-observed stale 21K defect was reproduced and the atomic client invariant is fixed and verified in a clean browser. Exact POST-body interception is unavailable in the current browser harness, so the request-payload gate is reported honestly as source-backed/runtime-result evidence rather than claimed as intercepted wire evidence.

FINAL_GATE = BLOCKED
BLOCKER = The current browser harness exposes DOM and console evidence but no POST-body/network interception; the required exact runtime preview payload evidence cannot be claimed honestly.
HANDOFF_UPDATED = NO
NEXT_TASK = LOCAL-PRODUCTION-SMOKE-01-RETRY-STRICT-RUNTIME
