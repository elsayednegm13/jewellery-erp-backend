# CGP-POST-PAYMENT-READMODEL-UX-REDESIGN-01 — PASS_CONFIRMED

## Execution

- Scope was limited to the CGP read model, payment-state presentation, and the
  canonical Customer Gold Purchase workspace. No workflow, permission, policy,
  environment, migration, or settlement authority was changed.
- `darfus_erp` was inspected read-only before and after source validation. The
  acceptance database was also inspected read-only. All durable payment-state
  transition writes were executed only inside a temporary disposable clone,
  which was dropped after the proof.

## Root cause and source changes

- `cgp-business-view.service.js` now composes `buildPaymentSummary` from the
  Liability's `settledAmount` and `outstandingAmount`; numeric zero is retained
  with null/undefined fallback semantics. Legacy `paidAmount`,
  `remainingAmount`, and `status` fields remain additive-compatible.
- `gold-purchase-draft.service.js` adds one batched liability lookup for CGP
  list badges; there is no per-row N+1 lookup.
- `cgp-payment-summary.js` is the single derived read-model payment status
  helper (`UNPAID`, `PARTIALLY_PAID`, `FULLY_PAID`). Payment status is not stored
  as a new durable field.
- `lib/cgp/presentation.ts`, the canonical workspace, approvals view, and
  related types now expose localized payment/settlement labels, a clear
  purchase/payment header, financial cards, milestone presentation, structured
  settlement history, collapsible technical details, and local section links.

## Tests and acceptance

- `npx tsc --noEmit --pretty false`: PASS.
- Focused ESLint on all changed CGP/read-model files: PASS.
- Presentation/localization, settlement-authority, and post-payment read-model
  tests: PASS (3/3, 1/1, 3/3).
- Disposable clone script
  `backend/scripts/verify-cgp-post-payment-readmodel-ux-01.js`: PASS. It proved
  UNPAID → PARTIALLY_PAID → FULLY_PAID, zero outstanding after reload, blocked
  double settlement, no Asset delta, no ApprovalRequest delta, two expected
  settlement/journal/treasury effects, and balanced journals with no orphan
  lines or unlinked Treasury. The clone was dropped.
- Browser read-only acceptance of `CGPD-000007` showed the correct Arabic
  `مدفوع بالكامل` badge, purchase/paid/remaining cards (`AED 0.0000` remaining),
  settlement history with localized method/status, and the full-paid message;
  the settlement form was hidden. Desktop, tablet, and narrow viewport checks
  had no horizontal overflow and all financial/settlement anchors remained
  present.

## Persistent and runtime safety

- Persistent database remained `darfus_erp`, migrations `80`, Assets `61`,
  Products `3`; Migration 81 count remained `0`.
- Signed account balances at final read-only snapshot: `SYS-CASH=0.00300000`,
  `SYS-BANK=10076.25660000`; one open cash session; unbalanced journals,
  orphan journal lines, unlinked posted Treasury, duplicate/blank barcodes,
  orphan RFID, and orphan asset origins were all `0`.
- Gold runtime settings remained `GOLDAPI_IO / LIVE_PROVIDER / 1500 / 2500`;
  the CGP runtime watermark and dispatcher configuration were not changed.
- `next-env.d.ts` remained at inherited known drift SHA
  `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`; no
  Next dev or manual restart was performed.

## Decision

`CGP_POST_PAYMENT_READMODEL_UX_REDESIGN_01_GATE = PASS_CONFIRMED`

Next recommended step is `LOCAL-PRODUCTION-SMOKE-01-RETRY_IF_PASS`; it was not
started automatically.
