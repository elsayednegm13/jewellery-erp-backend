# LOCAL-LOGIN-FORENSIC-01 — Blocked evidence report

## Result

`LOCAL_LOGIN_FORENSIC_01_GATE = BLOCKED_BY_SECURE_PASSWORD_INPUT_REQUIRED`

The existing browser session is authenticated and usable, but a fresh direct
credential test was not run because the Owner password was not available to
this task through a secure interactive input. The Gold pre-login guard also
failed at the final check and therefore no login mutation was attempted.

## Runtime and safety

- Frontend: inherited Next development runtime on port 3000 (npm `run dev`,
  Next child processes 23440/25832); not started or restarted by this task.
- Backend: inherited nodemon 26736 with child 9400, port 8000, cwd
  `H:\WORK\jewellery-erp-master\backend`; not touched.
- Redis is reachable and healthy. BullMQ has exactly one Gold scheduler at
  30,000 ms, but recent jobs fail with sanitized `GOLDAPI_IO_AUTH_ERROR`.
- Final `/api/v1/health/gold` state is not healthy: latest valid quote received
  at `2026-08-11T16:14:05.122Z`, age about 361 seconds, status `STALE`.
- The HTTP health route currently returns sanitized HTTP 500; the direct
  read-only canonical health projection reproduces `STALE` with the same quote
  and no mock fallback. This is a Gold-runtime blocker, not an auth fix.
- No password, hash, token, cookie, GoldAPI key, or secret was printed or
  persisted.

## Static authentication inventory

- Login page: `app/[locale]/login/page.tsx`; submits through `useAuth().login`.
- Auth state: `contexts/auth-context.tsx`; API mode posts
  `POST /auth/login` with `{ email, password }`.
- Client: `lib/api/client.ts`; normal local target is
  `http://localhost:8000/api/v1` from `NEXT_PUBLIC_API_URL` and data source
  `api`. Login is context-free and does not require Company/Branch headers.
- Request headers: JSON content type, Accept, correlation ID and language;
  no credential is included in the URL.
- Success response: HTTP 200 with `data.token`, `data.refreshToken`, `user`,
  and `company`. Failure is normalized to a safe API error.
- Access auth: Bearer JWT plus persisted technical session. Refresh uses the
  refresh-token endpoint and rotates the persisted session. Tokens are stored
  by the existing client in localStorage when Remember is selected, otherwise
  sessionStorage; raw values were not inspected.
- Backend: `backend/src/routes/auth.routes.js`,
  `backend/src/controllers/auth.controller.js`,
  `backend/src/services/technical-session.service.js`, and
  `backend/src/middleware/auth.middleware.js`.
- Password verifier is `bcryptjs.compare`; email is trimmed and lower-cased.
- Auth routes use `authMiddlewareWithoutCompanyContext`; operational routes
  retain the explicit Super Admin Company guard.

## Read-only user/context evidence

- `admin@admin.com` exists, is active, not locked, not soft-deleted, and is a
  `super_admin`/Admin account. It is linked to the single DARFUS Company;
  branch assignment is null as expected for the technical account.
- One active `Main Branch` exists for that Company.
- Role linkage and permission linkage are present; no permission was granted or
  changed.
- Browser DOM showed `Local Administrator`, `admin@admin.com`, Company DARFUS,
  and BranchContext `READY` with Main Branch.

## Browser acceptance using inherited session

- Dashboard loaded with the authenticated shell.
- Gold Center, POS, Sales, Sales/CGP, Accounting, and Inventory navigations
  completed without a login redirect loop.
- Inventory page refresh retained the authenticated page and BranchContext
  readiness.
- Logout was not run because it would revoke the current session and a secure
  Owner password input was unavailable for the required re-login.
- A new credential submission was not performed; therefore direct login and
  password-hash matching remain untested.

## CORS / CSRF / cookies

- `OPTIONS http://localhost:8000/api/v1/auth/login` from
  `http://localhost:3000` returned 204 with the exact origin,
  `Access-Control-Allow-Credentials: true`, and the canonical allowed headers.
- CSRF is not applicable to the Bearer-token login contract.
- HTTP-only cookie configuration is not applicable; the API uses JWT and
  refresh tokens in the existing browser storage flow.
- The Super Admin Company guard remains fail-closed and was not weakened.

## Persistent read-only snapshot

`SELECT current_database()` returned `darfus_erp`.

Counts: users 1, roles 5, permissions 135, user_roles 1,
role_permissions 427, technical sessions 66, Assets 53, Products 3,
Customers 1, CGPs 2, Invoices 13, Journals 67, JournalLines 176,
CashTransactions 50, GoldMarketQuotes 90.

Integrity: unbalanced Journals 0, orphan JournalLines 0, unlinked Treasury 0,
duplicate Journal sources 0, duplicate Treasury links 0, duplicate barcodes 0,
empty barcodes 0. Signed GL: Cash `0.003`, Bank `20416.405`. Open cash sessions
observed: 0.

No task-owned user/auth/business mutation occurred. Natural GoldMarketQuote
refreshes remain the only permitted runtime data activity.

## Verification

- Company-context/auth tests: 7/7 passed.
- `verify-auth-security-containment.js`: passed.
- `npx tsc --noEmit`: passed.
- `git diff --check`: passed (inherited LF/CRLF warnings only).
- `next-env.d.ts` remained the inherited known SHA
  `7AD303E40D4FDDF44F156129E397511953A71481C5CFD86B1862649AAAF240CC`.
- No code, migration, configuration, server, or handoff mutation was made.

## Gate and next action

- `GOLD_RUNTIME_PRE_LOGIN_GUARD = FAIL` because the quote is stale and recent
  BullMQ refreshes fail with provider authentication errors.
- `OWNER_PASSWORD_MATCHES_STORED_HASH = NOT_TESTED_SECURE_INPUT_UNAVAILABLE`.
- `DIRECT_LOGIN_API_RESULT = NOT_RUN`.
- `BROWSER_LOGIN = PASS_EXISTING_AUTHENTICATED_SESSION_ONLY`.
- `LOCAL_LOGIN_FORENSIC_01_GATE = BLOCKED_BY_SECURE_PASSWORD_INPUT_REQUIRED`.

Next action is not automatic: restore the already-authorized Gold runtime
health, then rerun this batch with secure interactive Owner-password input for
one bounded direct login proof. Do not reset the password or change permissions.
