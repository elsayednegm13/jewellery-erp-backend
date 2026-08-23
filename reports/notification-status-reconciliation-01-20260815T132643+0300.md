# Notification Status Reconciliation 01

## Executive decision

This was a strict read-only reconciliation of the current notification source, existing lifecycle tests, passive browser evidence, and database fingerprints. No notification defect is currently proven. The remaining limitation is runtime evidence coverage for scenarios that require logout, invalid Company context, Company switching, focus/reconnect simulation, or direct network instrumentation. Those actions were not executed because they would alter session/context state or require unavailable browser-network hooks.

`NOTIFICATION_STATUS_RECONCILIATION_01_GATE = PASS_ACCEPTANCE_GAP_ONLY_OWNER_REVIEW_READY`

The next step is a separate runtime-only acceptance closeout. No Product fix is authorized or required by this report.

## Safety confirmation

- Mode: `READ_ONLY_NOTIFICATION_FORENSIC`
- Persistent database writes: `0`
- Acceptance database writes: `0`
- Migration/seed/fixture activity: `0`
- Product, backend, frontend, auth, Company, SSE, test, and verifier source changes: `0`
- `PROJECT_PROGRESS_HANDOFF.md`: not modified
- Normal frontend/backend: not restarted or killed
- No business POST/PUT/DELETE action was executed
- Temporary notification browser tab was closed after observation

## Repository identity

- Branch: `main`
- HEAD: `1657b0e9ba580faef69be48f04637835c201b521`
- Stashes: `11`
- Remotes: none
- The worktree was already dirty with inherited changes. No cleanup, reset, restore, checkout, stash, add, commit, push, or deploy was performed.
- `backend/package.json` SHA-256: `231A19D0A81C2579F4D1B8E4D676A7085BA6811516630B811627B58A5CB3A86B`
- `backend/package-lock.json` SHA-256: `A2E65BF8D4EBBFF9CE559532130DC896433A931C5B6515102FC48149FE602551`
- `next-env.d.ts` SHA-256: `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC` (known inherited drift; unchanged)

## Database baseline

Read-only aggregate checks were run against verified database identities:

| Database | Migrations before | Notifications before | Migrations after | Notifications after |
|---|---:|---:|---:|---:|
| `darfus_erp` | 81 | 43 | 81 | 43 |
| `darfus_erp_inventory_rehearsal_20260804_160500z` | 80 | 502 | 80 | 502 |

The broader integrated baseline remained unchanged: persistent integrity checks were clean (unbalanced journals, orphan journal lines, unlinked treasury, duplicate journal sources, duplicate treasury links, duplicate/blank primary barcodes all zero); acceptance remained migration 80 and was also read-only.

## Notification execution evidence chain

The earlier project status report marked notification evidence as needing reconciliation, not as a confirmed Product failure. Current source and tests now provide the authoritative implementation evidence:

1. `hooks/use-notifications.ts` owns the REST list and unread-count queries and uses the canonical API client.
2. `components/realtime-provider.tsx` is the single mounted SSE owner under `components/company/company-dashboard-shell.tsx`.
3. `lib/notifications/company-scoped-lifecycle.ts` defines the shared auth/Company gate, scoped query keys, SSE headers, terminal/transient classification, and toast dedupe window.
4. `app/providers.tsx` owns QueryCache terminal-error notification toasts and applies the shared five-second dedupe policy.
5. `contexts/auth-context.tsx` and `components/auth/auth-session-coordinator.tsx` own logout/terminal-session cleanup.
6. `backend/src/middleware/auth.middleware.js`, `backend/src/routes/erp.routes.js`, and `backend/src/routes/events.routes.js` enforce server-side auth and Company scope.
7. `tests/notification-lifecycle-contract.test.mjs`: 7/7 passed.
8. `scripts/verify-auth-security-containment.js`: passed (`AUTH SECURITY CONTAINMENT PASSED`).

The historical NOTIF-PRE1/NOTIF-FIX labels are referenced by prior handoff history, but no standalone current NOTIF-FIX report was found in the current report/source index. Therefore the implementation is not accepted merely because a prompt claimed it; it is supported by the current source, contract tests, security verifier, and passive browser evidence below.

## Historical finding reconciliation

| Finding | Current status | Evidence |
|---|---|---|
| F002 missing/ambiguous Super Admin Company context | `RESOLVED_CONFIRMED` | shared lifecycle gate, auth middleware 422/403 policy, N4 contract test |
| F004 SSE terminal/reconnect handling | `RESOLVED_CONFIRMED` | 4xx terminal classification, bounded transient reconnect, abort cleanup, contract test |
| F005 duplicate terminal notification toasts | `RESOLVED_CONFIRMED` | QueryCache owner + five-second dedupe, contract test, zero visible browser toasts |

## Current source map

### REST ownership

- Header and Notifications page are two logical consumers of the same hook; this is not a duplicate hook implementation.
- `GET /notifications?limit=20` and `GET /notifications/unread-count` are canonical API-client requests.
- Requests use `skipBranch: true` and an explicit current Company only when the Super Admin context is ready.
- Query keys are Company-scoped when an explicit Company is present.
- Server routes filter by `req.companyId` and require `notifications.view`.

### Auth and Company gating

- `canStartCompanyScopedNotifications` requires resolved auth, authenticated state, no terminal-auth handling, branch-employee readiness, and for Super Admin an explicit normalized Company ID.
- There is no first-active-Company shortcut and no Company fallback.
- Super Admin bootstrap is `GET /auth/accessible-companies`; persisted legacy selection is not authoritative.
- Missing Super Admin Company context is fail-closed (`422 SUPER_ADMIN_COMPANY_CONTEXT_REQUIRED`); invalid scope is fail-closed (`403 COMPANY_SCOPE_INVALID`).
- `X-Company-ID` is produced by the canonical request accessor or the SSE header helper; it is not hardcoded.

### REST retry/refetch policy

- 401/403/422 are terminal and are not retried by the query retry predicate.
- A token refresh is attempted once by the API client; safe GET/HEAD/OPTIONS may replay once, while unsafe mutations are not silently replayed.
- Default query stale time is five minutes; refetch-on-window-focus is disabled; no notification polling interval was found.
- Reconnect behavior is limited to transient failures with a maximum of eight attempts and capped delay.

### SSE policy

- `GET /events/stream` is authenticated and receives `Authorization` plus current `X-Company-ID` when required; token is not placed in the URL.
- 401/403/404/422 are terminal and do not reconnect.
- 5xx/transient failures may reconnect with the bounded backoff.
- AbortController cleanup, reconnect-timeout cleanup, debounce cleanup, and client deregistration are present.
- A 25-second heartbeat revalidates the persisted technical session and closes the stream on failure.

### Toast and logout ownership

- QueryCache owns terminal REST notification error toasts.
- RealtimeProvider owns successful notification-event toasts; these are a separate success channel and do not duplicate terminal error toasts.
- Five-second scoped dedupe prevents repeated terminal toasts.
- AuthSessionCoordinator is the single-flight terminal auth handler; it cancels/clears queries, clears local session state, performs canonical logout, emits one localized toast, and redirects to login.
- AuthContext also clears QueryClient/session/company/branch state on explicit logout.

## Runtime matrix

The browser was already authenticated and loaded `http://localhost:3000/ar/notifications` under Company `DARFUS`. The page rendered 20 notification buttons, no visible toast, and browser console logs were empty (`[]`). The browser tool did not expose network performance entries or raw request events, so exact request counts and headers are marked as not countable rather than inferred.

| Scenario | Result | Evidence/limitation |
|---|---|---|
| N1 initial authenticated load | `PASS_PARTIAL` | page rendered; exact network chronology unavailable |
| N2 terminal unauthenticated gate | `PASS_STATIC` | shared gate + auth coordinator; no logout mutation run |
| N3 non-Super Admin derived scope | `PASS_STATIC` | lifecycle contract test |
| N4 Super Admin without Company | `PASS_STATIC` | 7/7 contract suite; not reproduced by clearing live context |
| N5 valid Company list/unread/SSE | `PASS_PARTIAL` | DARFUS page rendered, static header/source proof; raw network count unavailable |
| N6 invalid/stale Company | `NOT_RUN_SAFETY` | would require changing/bypassing Company context |
| N7 logout cleanup | `PASS_STATIC_NOT_RUNTIME` | source proves cleanup; logout POST not executed |
| N8 refresh/persisted auth | `NOT_AVAILABLE` | no safe instrumented refresh replay in current browser tool |
| N9 focus/reconnect | `NOT_OBSERVED` | no safe network/focus event hook exposed |
| N10 Company switch | `NOT_AVAILABLE` | would alter authenticated Company context |

### N4 expected outputs

- Super Admin without explicit Company: lifecycle does not start REST or SSE.
- REST query keys/request context are not created before the gate passes.
- This is proven by the lifecycle contract test and server middleware, not by a destructive live-context manipulation.

### N5 observed outputs

- `N5_SUCCESS = PASS`
- `N5_COMPANY_HEADER = PASS_STATIC_SOURCE`
- `N5_LIST_REQUESTS = OBSERVED_BOUNDED_1_LOGICAL_OR_UNAVAILABLE_NETWORK_TRACE`
- `N5_UNREAD_REQUESTS = OBSERVED_BOUNDED_1_LOGICAL_OR_UNAVAILABLE_NETWORK_TRACE`
- `N5_SSE_CONNECTIONS = STATIC_ONE_OWNER_RUNTIME_CONNECTION_NOT_COUNTABLE`
- `N5_DUPLICATE_TOAST = NO`

### N6–N10 safety boundary

N6, N7 runtime action, N8 instrumented refresh, N9 forced reconnect, and N10 Company switch were intentionally not executed. No current request storm, repeated 422 storm, duplicate SSE, or duplicate toast was observed on the safe authenticated page smoke.

## Security checks

- `NOTIFICATION_AUTH_GATING_STATIC = PASS`
- `NOTIFICATION_COMPANY_GATING_STATIC = PASS`
- `NO_COMPANY_FALLBACK = PASS`
- `FIRST_ACTIVE_COMPANY_SHORTCUT = NO`
- `X_COMPANY_ID_CURRENT_SOURCE = PASS`
- `X_COMPANY_ID_STALE_CAPTURE_RISK = NO`
- `REST_TERMINAL_401_403_422_POLICY = PASS`
- `SSE_AUTH_COMPANY_GATING_STATIC = PASS`
- `SSE_401_403_422_TERMINAL_STATIC = PASS`
- `SSE_LOGOUT_CLEANUP_STATIC = PASS`
- `NOTIFICATION_SECURITY_CONTRACT = PASS`
- `CROSS_COMPANY_NOTIFICATION_LEAK_RISK = NO`

## Performance and storm assessment

- `DUPLICATE_QUERY_PRODUCT_DEFECT_STATIC = NO`
- `NOTIFICATION_POLLING_BOUNDED = PASS`
- `SSE_DUPLICATE_CONNECTION_RISK_STATIC = NO`
- `DUPLICATE_TOAST_RISK_STATIC = NO`
- `NOTIFICATION_REQUEST_STORM_CURRENT = NO`
- `NOTIFICATION_PERFORMANCE_STATE = PASS`
- Expected missing-context errors are suppressed before query/SSE startup and terminal errors are deduped.

## UX acceptance

The Arabic Notifications page rendered under the active Company with no console errors/warnings and no visible duplicate toast. Full EN/AR runtime acceptance for logout, refresh, focus/reconnect, Company switch, and direct network chronology remains open because the available browser tool cannot safely or observably perform those cases in this read-only batch.

`NOTIFICATION_UX_ACCEPTANCE_STATUS = OPEN_ACCEPTANCE_ONLY`

## Product-fix and runtime-acceptance status

- `NOTIFICATION_PRODUCT_FIX_STATUS = CLOSED_CONFIRMED`
- `NOTIFICATION_RUNTIME_ACCEPTANCE_STATUS = OPEN_ACCEPTANCE_ONLY`
- `NOTIFICATION_CURRENT_FINDING_COUNT = 0`
- `RELEASE_IMPACT = NON_BLOCKING_ACCEPTANCE_GAP`

This distinction is intentional: current code/tests prove the safeguards, while complete runtime matrix evidence is still incomplete. No Product fix should be started from this report.

## Existing validation

- `tests/notification-lifecycle-contract.test.mjs`: 7/7 pass.
- `scripts/verify-auth-security-containment.js`: pass.
- `npx tsc --noEmit --pretty false`: exit 0.
- Focused ESLint on notification lifecycle, provider, auth, Company context, and notifications page: exit 0.
- Passive browser notification page smoke: pass; browser console errors/warnings: `0`.

## DB before/after and mutation proof

- `PERSISTENT_DB_MUTATIONS_THIS_ROUND = 0`
- `ACCEPTANCE_DB_MUTATIONS_THIS_ROUND = 0`
- Persistent migrations remained `81`; Acceptance migrations remained `80`.
- Persistent notifications remained `43`; Acceptance notifications remained `502`.
- No Invoice, Payment, Journal, Asset, Customer, Company, Branch, or notification business mutation was executed.

## Current findings and exact remaining gap

There is no current proven Product, Auth, Company-scope, SSE, duplicate-query, duplicate-toast, or cross-Company leakage defect. The only open item is evidence completeness: a future controlled runtime-only acceptance batch should instrument request chronology/headers and safely exercise N6–N10 without changing business data. That batch must not assume a browser result that was not captured here.

## Owner decision

Owner review is requested for the acceptance-evidence gap only. No rollback, fix, migration, handoff update, or runtime restart is indicated.

## Final gate

`NOTIFICATION_STATUS_RECONCILIATION_01_GATE = PASS_ACCEPTANCE_GAP_ONLY_OWNER_REVIEW_READY`

## Next step

`NEXT_RECOMMENDED_STEP = NOTIFICATION-RUNTIME-ACCEPTANCE-CLOSEOUT-01`

`NEXT_BATCH_ALLOWED = NO_AUTOMATIC_START`

