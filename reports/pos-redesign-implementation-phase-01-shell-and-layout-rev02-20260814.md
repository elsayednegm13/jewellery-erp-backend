# POS Redesign — Phase 1 Shell and Layout REV02

## 1. Executive summary

Phase 1 implemented the approved cashier-first POS shell without changing search semantics, API contracts, pricing, payment, checkout, accounting, inventory, or security behavior. The live POS now presents a physical left-to-right three-region desktop layout: Customer, Search/workspace + invoice items, and Payment + totals. The Owner visual-review checkpoint is ready; Phase 2 was not started.

## 2. Phase boundary

- Universal Search was not implemented.
- No new endpoint, debounce, lookup source, pricing call, payment flow, return flow, negative line, fullscreen mode, or keyboard binding was added.
- `PosPage` remains the state and handler owner.

## 3. Files changed

Product/localization files touched by this batch:

- `app/[locale]/(dashboard)/pos/page.tsx` — layout composition, header context strip, customer repositioning, invoice-items terminology, sticky payment region.
- `messages/ar.json` — visible empty/clear labels changed from basket wording to invoice-items wording.
- `messages/en.json` — same visible terminology update in English.

Evidence/report artifacts:

- `backend/reports/pos-redesign-implementation-phase-01-shell-and-layout-rev02-20260814.md`
- `backend/reports/pos-phase-01-1440x900.png`
- `backend/reports/pos-phase-01-1280x800.png`
- `backend/reports/pos-phase-01-tablet-768x800.png`

No new component was required; no unrelated source file was intentionally edited.

## 4. Business logic freeze confirmation

All existing handlers remain in `pos/page.tsx`: customer selection, DataToolbar query/filter/reset, item selection/add, remove, draft actions, payment controls, totals/pricing state, validation, and checkout/reservation actions. No backend or hook authority moved into a layout component.

## 5. Header implementation

The existing `PageHeader` remains the title/context authority. A compact context strip now shows POS, new-sale invoice context, active branch, and the already-loaded cashier name. No new request or fabricated context was introduced.

## 6. Customer region

The existing customer `<select>` and `setCustomerId` handler were repositioned into the left column. No customer API, selection semantics, tier behavior, points behavior, or data flow changed.

## 7. Center workspace

The current `DataToolbar` search/filter and existing product/asset cards remain in the center. The existing invoice-items list (internal `cart` state retained for compatibility) is now a separate center card below the workspace. No universal search behavior was added.

## 8. Invoice-items terminology

Visible labels now use `أصناف الفاتورة` / `Invoice items`, `تفريغ أصناف الفاتورة`, `لا توجد أصناف في الفاتورة`, and `Add to invoice`. Internal variable/function names remain unchanged deliberately to avoid business-logic risk. No visible Cart/Basket/السلة wording remains on the POS surface.

## 9. Payment region

Existing payment methods, split allocation, installment controls, making charge, stone value, discount, notes, VAT, totals, journal preview, draft actions, reservation-deposit action, and checkout button were moved into the right column without handler or calculation changes.

## 10. Sticky decision/result

The payment card uses `xl:sticky xl:top-5`, so it is sticky only at desktop layout widths. It is static when the regions stack below the desktop breakpoint; no nested sticky or scroll trap was introduced.

## 11. Responsive baseline

- Desktop: three physical columns with center as the largest workspace.
- Tablet: the same three regions stack vertically; measured document width stayed within the viewport (`scrollWidth=760`, viewport width `768`).
- The grid uses `direction:ltr` for physical region order while each region preserves RTL content direction.

## 12. Current handler preservation

Read-only DOM proof showed the customer select, current search field, type filter/reset, invoice-items heading, clear/resume/save draft controls, remove controls, payment method buttons, totals, and disabled checkout button all present after the refactor. No sale was submitted.

## 13. API/network non-regression

No API source or hook was changed. Static inspection found no new endpoint. Browser observation used only page-load/read behavior; no write endpoint was called. No duplicate request or changed payload was observed in the available browser console/runtime surface.

## 14. Gold provider economy

No GoldAPI/Gold Center code or request path changed. The layout refactor does not introduce additional quote consumers.

## 15. TypeScript/lint/tests

- `npx tsc --noEmit` — PASS.
- `npx eslint --no-ignore -- app/[locale]/(dashboard)/pos/page.tsx` — PASS with 3 pre-existing hook-dependency warnings, 0 errors.
- Focused POS/gold contract tests — 7/7 PASS (`cgp-asset-pos-selling-price-and-editable-metadata.test.cjs`, `supplier-gold-bar-acquisition-current-pricing-pos-ux.test.cjs`).

## 16–18. Browser proof

Chrome real-browser proof used exact CSS viewport calibration:

| Viewport | Result | Evidence |
| --- | --- | --- |
| 1440×900 | PASS — three columns, no overlap/clipping, center dominant | `pos-phase-01-1440x900.png` |
| 1280×800 | PASS — three columns remain usable; center measured 465px | `pos-phase-01-1280x800.png` |
| 768×800 tablet | PASS — safe vertical stacking; no horizontal overflow | `pos-phase-01-tablet-768x800.png` |

The page loaded at `http://localhost:3000/ar/pos`; the browser console returned no warning/error entries for the tested page.

## 19. Screenshot/evidence paths

Absolute evidence paths:

- `H:\WORK\jewellery-erp-master\backend\reports\pos-phase-01-1440x900.png`
- `H:\WORK\jewellery-erp-master\backend\reports\pos-phase-01-1280x800.png`
- `H:\WORK\jewellery-erp-master\backend\reports\pos-phase-01-tablet-768x800.png`

## 20. Browser console

`ERROR/WARN console entries = 0` for the final Chrome checks.

## 21. Persistent fingerprint

Read-only persistent verification before/after the batch:

| Object | Before | After |
| --- | ---: | ---: |
| Database | `darfus_erp` | `darfus_erp` |
| Migrations | 80 | 80 |
| Assets | 62 | 62 |
| Products | 3 | 3 |
| Customers | 1 | 1 |
| Invoices | 14 | 14 |
| Invoice items | 20 | 20 |
| Payments | 29 | 29 |
| Journal entries | 79 | 79 |
| Journal lines | 202 | 202 |
| Cash transactions | 56 | 56 |

No acceptance mutation was performed; the acceptance database was read-only verified as `darfus_erp_inventory_rehearsal_20260804_160500z`, migrations `80`.

## 22. DB integrity

Persistent read-only checks: unbalanced journals `0`, orphan journal lines `0`, duplicate barcode groups `0`, blank barcodes `0`, orphan RFID rows `0`. No task-owned data delta was observed.

## 23. Migration/env/git safety

- Persistent writes this batch: `0`.
- Acceptance writes this batch: `0`.
- Migrations created/run: `0`; Migration 81: `NO`.
- Runtime environment changed: `NO`; Next dev was not started or restarted.
- `next-env.d.ts` remained at inherited known-drift SHA `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`; it was not touched.
- No staging, commit, push, deploy, reset, restore, clean, or stash operation was performed.
- Inherited dirty worktree changes and stashes were preserved.

## 24. Change table

| File | Before role | Change | Why | Business logic | API | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| `pos/page.tsx` | Single product + invoice/payment composition | Three-region shell, context strip, customer/invoice/payment repositioning, wording | Approved Phase 1 layout | No | No | Revert layout-only JSX changes |
| `messages/ar.json` | Basket wording | Invoice-items wording | Remove e-commerce terminology | No | No | Restore three labels |
| `messages/en.json` | Basket wording | Invoice-items wording | Remove e-commerce terminology | No | No | Restore three labels |

## 25. Before/after UX table

| Area | Before | After | Behavior changed? | Business logic changed? |
| --- | --- | --- | --- | --- |
| Header | Page title + cashier-open badge | Same plus compact POS/branch/cashier strip | No | No |
| Customer | Embedded below invoice rows | Dedicated left region | No | No |
| Search | Product/asset toolbar in left card | Same toolbar in center workspace | No | No |
| Invoice items | Embedded in combined cart/payment card | Dedicated center invoice-items card | No | No |
| Payment | Same combined card | Dedicated sticky desktop right region | No | No |
| Bottom help | Existing global shell | Unchanged; no shortcuts added | No | No |
| Responsive | Two-column desktop / stacked fallback | Three columns desktop / stacked tablet | Layout only | No |

## 26. Runtime non-regression table

| Check | Before authority | After runtime | Network change | Result |
| --- | --- | --- | --- | --- |
| Customer | `customerId` + existing select | Same handler | None | PASS |
| Search | `DataToolbar`, local filtered list | Same input/filter | None | PASS |
| Item rendering | Existing `filtered.map` | Same cards | None | PASS |
| Remove | `removeFromCart` | Same button | None | PASS |
| Totals | Existing pricing state | Same totals/VAT | None | PASS |
| Payment controls | Existing `method`/split/installment state | Same controls | None | PASS |
| Submit | `completeSale` / draft handlers | Same buttons/disabled guards | None | PASS |
| Auth/company/branch | Existing `useAuth` and API client | Same context | None | PASS |
| Gold quote | Existing hooks/pricing path | No additional consumers | None | PASS |
| Console | Existing page runtime | 0 warn/error entries observed | None | PASS |

## 27. Owner visual review checklist

Owner review is required for:

1. هل الثلاثة أعمدة مناسبة؟
2. هل العمود الأوسط واسع كفاية؟
3. هل بيانات العميل واخدة مساحة مناسبة؟
4. هل الدفع واضح؟
5. هل شكل الشاشة قريب من الاتجاه المطلوب؟
6. هل تسمية `أصناف الفاتورة` مناسبة؟
7. هل نكمل Phase 2 على نفس الهيكل؟

## 28. Gate

`POS_REDESIGN_IMPLEMENTATION_PHASE_01_SHELL_AND_LAYOUT_REV02_GATE = PASS_OWNER_REVIEW_READY`

All Phase 1 boundary, layout, terminology, non-regression, typecheck, focused-test, read-only DB, and browser evidence conditions passed. This is not a declaration that the overall POS redesign or Universal Search is complete.

## 29. Next step

`OWNER_VISUAL_REVIEW_REQUIRED = YES`

Do not start Phase 2 automatically. After explicit Owner approval only, the recommended next batch is `POS-REDESIGN-IMPLEMENTATION-PHASE-02-UNIVERSAL-SEARCH-AND-CUSTOMER`.

## Required tokens

```text
CURRENT_BATCH = POS-REDESIGN-IMPLEMENTATION-PHASE-01-SHELL-AND-LAYOUT-REV02
MODE = PRODUCT_IMPLEMENTATION_LAYOUT_ONLY
PHASE_1_SEARCH_LOGIC_CHANGE = NO
PHASE_1_API_CHANGE = NO
PHASE_1_BUSINESS_LOGIC_CHANGE = NO
POS_PAGE_REMAINS_BUSINESS_STATE_OWNER = YES
NEW_COMPONENTS_PRESENTATIONAL_ONLY = YES
THREE_COLUMN_DESKTOP_LAYOUT = PASS
POS_HEADER_LAYOUT = PASS
CUSTOMER_REGION_REPOSITIONED = PASS
CUSTOMER_LOGIC_CHANGED = NO
CENTER_WORKSPACE_RESTRUCTURED = PASS
CURRENT_SEARCH_BEHAVIOR_PRESERVED = PASS
SHOPPING_CART_TERMINOLOGY_VISIBLE = NO
PAYMENT_REGION_REPOSITIONED = PASS
PAYMENT_LOGIC_CHANGED = NO
PAYMENT_STICKY_RESULT = PASS
NEW_KEYBOARD_BINDINGS_THIS_PHASE = NO
POS_INITIAL_THEME = DARFUS_CURRENT_THEME
POS_RTL_NUMERIC_STANDARD = PASS
CLIENT_AUTHORITY_EXPANSION = NO
POS_GOLD_RUNTIME_LOGIC_CHANGED = NO
POS_VAT_LOGIC_CHANGED = NO
POS_PAYMENT_RUNTIME_LOGIC_CHANGED = NO
NEGATIVE_LINES_IN_NORMAL_POS = NO
POS_SECURITY_LOGIC_CHANGED = NO
PHASE_1_RESPONSIVE_BASELINE = PASS
CASHIER_FIRST_VISUAL_HIERARCHY = PASS
CURRENT_POS_HANDLER_WIRING_PRESERVED = PASS
NEW_API_ENDPOINTS_THIS_PHASE = 0
UNEXPECTED_DUPLICATE_REQUESTS = 0
GOLD_PROVIDER_CALL_ECONOMY_REGRESSION = NO
TYPESCRIPT = PASS
FOCUSED_LINT = PASS
FOCUSED_POS_TESTS = PASS
REAL_BROWSER_VISUAL_PROOF = PASS
DESKTOP_1440_VISUAL = PASS
DESKTOP_1280_VISUAL = PASS
TABLET_BASELINE_VISUAL = PASS
POS_PHASE_1_VISUAL_EVIDENCE = COMPLETE
OWNER_VISUAL_REVIEW_REQUIRED = YES
PHASE_1_FILE_SCOPE_MINIMAL = PASS
PHASE_1_CHANGE_TABLE = COMPLETE
PHASE_1_BEFORE_AFTER_TABLE = COMPLETE
PHASE_1_RUNTIME_NON_REGRESSION_TABLE = COMPLETE
PERSISTENT_BUSINESS_DATA_PRESERVED = PASS
PERSISTENT_WRITES_THIS_BATCH = 0
ACCEPTANCE_SOURCE_WRITES_THIS_BATCH = 0
FINANCIAL_INTEGRITY = PASS
INVENTORY_INTEGRITY = PASS
PERSISTENT_MIGRATIONS_INITIAL = 80
PERSISTENT_MIGRATIONS_AFTER = 80
MIGRATION_81_CREATED = NO
RUNTIME_ENV_CHANGED = NO
NEXT_ENV_CURRENT_SHA = 7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC
NEXT_ENV_MUTATED_THIS_BATCH = NO
UNRELATED_WORKTREE_CHANGES_PRESERVED = YES
GIT_STAGED_THIS_BATCH = 0
GIT_COMMITS_THIS_BATCH = 0
SERVER_DEPLOYMENTS = 0
PHASE_1_HANDOFF_SCOPE_ONLY = YES
POS_REDESIGN_IMPLEMENTATION_PHASE_01_SHELL_AND_LAYOUT_REV02_GATE = PASS_OWNER_REVIEW_READY
NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START
NEXT_RECOMMENDED_STEP = POS-REDESIGN-IMPLEMENTATION-PHASE-02-UNIVERSAL-SEARCH-AND-CUSTOMER_IF_OWNER_APPROVES_PHASE_1
```
