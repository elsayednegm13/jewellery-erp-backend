# SYSTEM-DATE-CONTROLS-COMPLETION-01

## Execution

- Presentation/input-normalization scope only; no business, API, database, migration, timezone, posting, Gold, CGP, POS, or inventory semantics changed.
- Inherited services were reused; Next was not started or restarted.

## Date and numeral standards

- Date: `DD/MM/YYYY`; DateTime: `DD/MM/YYYY HH:mm`; Time: `HH:mm`.
- Existing `lib/dates/dates.ts`, `components/ui/date-input.tsx`, and `lib/formatters/numbers.ts` remain the authorities.
- `DateInput` and `DateTimeInput` now normalize Arabic-Indic and Persian digits with `toEnglishDigits` before parsing.
- Invalid input is rejected/reverted on blur; canonical payloads remain `YYYY-MM-DD` and `YYYY-MM-DDTHH:mm`.
- Date-only parsing remains calendar-based (no timezone shift); timestamp display continues to use branch timezone semantics.

## Fresh control inventory

- Native date/time controls before: `31` production-reachable occurrences across Accounting, Gold Center policy, Suppliers, POS, Sales/Reservations, Customers, and search/report filters.
- Native date/time controls after: `0` in `app`, `features`, `components`, `hooks`, and `lib`.
- All migrated controls use the existing `DateInput`/`DateTimeInput`; required/disabled/name/value behavior and raw filter/sort values were preserved.
- No approved exceptions.

## Files changed by this batch

- `components/ui/date-input.tsx`
- `app/[locale]/(dashboard)/accounting/page.tsx`
- `app/[locale]/(dashboard)/accounting/reports/page.tsx`
- `app/[locale]/(dashboard)/customers/[id]/page.tsx`
- `app/[locale]/(dashboard)/employees/[id]/page.tsx`
- `features/gold-center/components/GoldMarketAdminPanels.tsx`
- `app/[locale]/(dashboard)/pos/page.tsx`
- `app/[locale]/(dashboard)/reports/exports/page.tsx`
- `app/[locale]/(dashboard)/sales/gift-vouchers/page.tsx`
- `app/[locale]/(dashboard)/sales/installments/page.tsx`
- `app/[locale]/(dashboard)/sales/reservations/page.tsx`
- `app/[locale]/(dashboard)/sales/search-print/page.tsx`
- `app/[locale]/(dashboard)/suppliers/[id]/page.tsx`
- `app/[locale]/(dashboard)/suppliers/purchases/page.tsx`
- `features/assets/components/AttachmentsPanel.tsx`
- `features/assets/components/CertificatePanel.tsx`
- `features/printing/components/ReceiptPrintTemplate.tsx`
- `features/sales/components/ReceiptPreview.tsx`
- `scripts/verify-local-runtime-dashboard-numeral-date-fix.js`

Inherited worktree changes were preserved; no unrelated files were reset or restored.

## Raw presentation audit

- Accounting journal dates and Reservation expiry/audit/extension dates that were still rendered as raw ISO were switched to `formatDate`/`formatDateTime`.
- Certificate, attachment, receipt, installment, voucher, export-job, employee-log, and POS reservation date displays use centralized formatters.
- Browser representative sweep reported zero ISO date leaks and zero Arabic/Persian output digits.
- Machine/API/export contracts remain unchanged; only visible display tokens changed.

## Browser acceptance

Authenticated existing session was used read-only on Dashboard, Inventory, Gold Center, Supplier Purchases, POS, Reservations, Customers, Accounting, and Financial Reports. Every page reported zero native date/time inputs, no ISO date text, and no Arabic/Persian output digits. Date controls showed `DD/MM/YYYY`; policy controls showed `DD/MM/YYYY HH:mm`. Arabic RTL remained intact.

Edge checks: Persian `۲۹/۰۲/۲۰۲۴` displayed `29/02/2024`; leap day displayed `29/02/2024`; invalid `31/02/2024` was rejected/reverted; datetime `٢٩/٠٢/٢٠٢٤ ٢٣:٥٩` displayed `29/02/2024 23:59`.

## Verification

- `node scripts/verify-local-runtime-dashboard-numeral-date-fix.js` — PASS.
- `npx tsc --noEmit` — PASS.
- `git diff --check` — PASS (only inherited CRLF normalization warnings).
- Gold runtime/health/feed/policy/legacy sync suite — 27/27 PASS.
- Gold making-charge contract — PASS.
- CGP IMP-11 contract and CONT53 D01/D11 contract — PASS.
- `/api/v1/health/gold` remained canonical `GOLDAPI_IO` / `LIVE_PROVIDER`, fresh under stale `2500`, `isMockFallback=false`; settings remained refresh `1500`, stale `2500`, CGP `BID/NONE/0`.

## Persistent safety

Read-only persistent verification remained `darfus_erp`, migration `80`, Assets `53`, Products `3`, Customers `1`, CGPs `2`, Invoices `13`, Journals `67`, JournalLines `176`, CashTransactions `50`. Gold quote count moved only by the inherited natural scheduler (`98` before → `100` after); no business counts changed. Duplicate/empty barcodes, unbalanced journals, orphan journal lines, unlinked treasury, duplicate journal sources, and duplicate treasury links were all zero.

`next-env.d.ts` SHA remained the inherited known drift `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`; it was not mutated or auto-repaired.

## Gate

`SYSTEM_DATE_CONTROLS_COMPLETION_01_GATE = PASS_CONFIRMED`

Next action is owner fresh-login verification, then `LOCAL-PRODUCTION-SMOKE-01-RETRY` if separately approved. No next batch was started automatically.
