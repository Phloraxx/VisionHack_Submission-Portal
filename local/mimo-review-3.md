# VisionHack Submission Portal — Comprehensive Code Review (Mimo3)

**Reviewer:** Mimo3 — Senior Security & Code Reviewer  
**Date:** 2026-06-22  
**Files reviewed:** ~65 source files (every .ts/.tsx in app/, scripts/, config files)

---

## Summary

The codebase is well-structured with strong security fundamentals (CSRF double-submit, origin validation, role-scoped PB rules, input validation via Zod, CSP headers, JWT dedup cache). The issues below are organized by severity. Most critical items are security; others are correctness, performance, or architectural.

---

## CRITICAL

### C1. Missing CSRF token validation in `forgot-password` action
**Category:** Security — CSRF  
**File:** `app/routes/forgot-password.tsx:12-33`  
**Issue:** The `forgot-password` action calls `validateOrigin(request)` but does NOT call `validateCsrfToken()`. The form renders a hidden `csrf_token` input and sets the cookie, but the server never validates the token. An attacker can submit a cross-site POST with only a valid Origin header (e.g., from a same-origin subpage) to trigger password-reset emails for arbitrary accounts, causing email spam and user annoyance.  
**Fix:** Parse formData, then call `validateCsrfToken(request, formData)` after `validateOrigin()`, exactly as `secureAction` does.

### C2. Missing CSRF token validation in `login` action
**Category:** Security — CSRF  
**File:** `app/routes/login.tsx:88-121`  
**Issue:** Same as C1. The login action validates the Origin header but skips CSRF token validation. While login CSRF is lower-impact than account takeover, an attacker can log a victim into the attacker's account (login CSRF), potentially capturing data the victim enters. The login page form includes a hidden `csrf_token` field but the server never checks it.  
**Fix:** Add `validateCsrfToken(request, formData)` to the login action.

### C3. Missing CSRF token validation in `logout` action
**Category:** Security — CSRF  
**File:** `app/routes/api/auth/logout.ts:6-19`  
**Issue:** The logout action validates Origin but does NOT validate the CSRF token. The form in `dashboard-layout.tsx:304-313` includes a hidden `csrf_token` field, but the server ignores it. An attacker can force-logout a victim by triggering a cross-origin form submission to `/api/auth/logout`. While less severe than other CSRF issues, it degrades UX and could be combined with phishing.  
**Fix:** Parse formData and call `validateCsrfToken(request, formData)`.

### C4. PocketBase admin credentials in plaintext on disk
**Category:** Security — Secrets Management  
**File:** `.env:4-5`  
**Issue:** The `.env` file contains the PocketBase superuser password in plaintext: `POCKETBASE_ADMIN_PASSWORD=REDACTED_CREDENTIAL`. While `.env` is properly gitignored (not committed to the repo), the same credentials also appear in `.dev.vars:1-2` which is also gitignored. The password is weak (random lowercase letters only) and the admin email is the production email. If any developer's machine is compromised, the entire PocketBase instance is compromised.  
**Fix:** Use a secrets manager (e.g., Cloudflare Workers secrets for production). Rotate the current password immediately since it has been in plaintext on disk. Use a stronger password (16+ chars, mixed case + digits + symbols).

### C5. Login action uses plain formData parsing, not `secureAction` wrapper
**Category:** Security — Architecture  
**File:** `app/routes/login.tsx:88-121`  
**Issue:** The login action manually parses FormData and validates origin, but doesn't use the `secureAction` wrapper or validate CSRF tokens. This creates an inconsistency: every other form action in the app goes through `secureAction` (which enforces Origin + CSRF + auth), but login is a hand-rolled action that skips CSRF. This was likely an oversight when `secureAction` was introduced.  
**Fix:** Either migrate login to `secureAction` (with special handling since it doesn't need auth) or add explicit CSRF validation.

---

## HIGH

### H1. `server.ts` — Event listener registration inside `server.listen` callback
**Category:** Correctness / Reliability  
**File:** `server.ts:29-36`  
**Issue:** The `process.on("uncaughtException")` and `process.on("unhandledRejection")` handlers are registered INSIDE the `server.listen()` callback. If an error occurs during server startup (before the callback fires), those handlers won't be active. The `console.log` is also inside the callback, indented incorrectly — it's after the `process.on` calls but the indentation suggests it should be part of the listen callback.  
**Fix:** Move the `process.on` calls to module scope (before `server.listen`), alongside the existing `SIGTERM`/`SIGINT` handlers. Fix indentation.

### H2. `server.ts` — `gracefulShutdown` doesn't handle server close timeout
**Category:** Reliability  
**File:** `server.ts:42-48`  
**Issue:** `server.close()` waits indefinitely for all connections to drain. If a connection is stuck (e.g., a long-polling request), the process hangs forever. There's no timeout to force `process.exit(1)`.  
**Fix:** Add a fallback timeout (e.g., 10 seconds) that calls `process.exit(1)` if the server hasn't closed.

### H3. `config` update action doesn't validate `value` field correctly
**Category:** Security — Input Validation  
**File:** `app/routes/admin/config.tsx:39-41`  
**Issue:** The action reads `key` from formData but bypasses the `configUpdateSchema` Zod validation (which has `value: z.coerce.boolean()`). Instead, it does manual `formData.get("value") === "true"`. While functionally equivalent, the schema exists but is unused, and the manual check is fragile: sending `value=1` or `value=yes` would be treated as `false`, which is a semantic mismatch from what the schema would enforce.  
**Fix:** Use the schema: pass `schema: configUpdateSchema` to `secureAction` and read from `ctx.validated`.

### H4. `institution/dashboard.tsx` — invite-lead creates team without checking if lead already has a team via a different institution
**Category:** Authorization / Business Logic  
**File:** `app/routes/institution/dashboard.tsx:166-218`  
**Issue:** When an institution creates a new lead user, the code checks if a team already exists for that lead at THIS institution. But if the lead's email already exists as a `lead` role user (from a different institution), the code reuses the existing user (`leadUserId = existingUser.id`) and creates a new team. However, the PB `teams` createRule allows any lead to create teams (`leaderUserId ?= @request.auth.id`). This means a lead could theoretically be associated with teams at multiple institutions if the institution lookup misses the cross-institution check. The code only checks for an existing team at the current institution, not globally.  
**Fix:** After finding the existing user, also check if they already have ANY team (not just at this institution), and reject if so. Or, when reusing an existing lead, verify they don't already belong to a different institution.

### H5. `teams.team-id.tsx` action — coordinator uses admin client to update teams
**Category:** Security — Least Privilege  
**File:** `app/routes/teams.team-id.tsx:174-176`  
**Issue:** When a coordinator performs a status transition, the code switches to the admin client (`getAdminClient()`) because the PB `teams.updateRule` doesn't allow coordinator writes. This grants the coordinator full superuser-level access to ALL PB operations during the transition, not just the specific team update. If the coordinator's JWT is compromised, the attacker gets full admin access through this code path.  
**Fix:** Add a coordinator-specific update rule to the PB teams collection (e.g., `@request.auth.role = "coordinator"`) rather than escalating to superuser. Alternatively, create a PB function/hook that restricts coordinator writes to specific fields.

### H6. `forgot-password.tsx` — No CSRF token validation (duplicate of C1)
**Category:** Security  
Already covered in C1.

### H7. `login.tsx` — statsCache is a module-level singleton shared across all users
**Category:** Security — Information Leakage  
**File:** `app/routes/login.tsx:30-31,71-85`  
**Issue:** The `statsCache` variable is a module-level singleton. In a multi-worker or serverless environment, this cache is shared across all requests. While the data itself (team count, institution count, feature flags) is public information displayed on the login page, the cache leaks the `cachedAt` timestamp to all users via the module scope. More importantly, if the Node.js process handles concurrent requests, the cache could serve stale data to User A while User B triggered a refresh. This is a minor issue for public stats but represents a pattern that could become problematic if the cache is extended to include private data.  
**Fix:** This is acceptable for now since the data is public. Document this as intentional. Consider using a simple TTL approach rather than storing the full cache object.

### H8. No rate limiting on forgot-password endpoint
**Category:** Security — Abuse  
**File:** `app/routes/forgot-password.tsx:12-33`  
**Issue:** The forgot-password action has no application-level rate limiting. While PB has server-side rate limits, the action catches and swallows all errors from `requestPasswordReset`, meaning PB rate limits would be silently consumed without the user knowing. An attacker could spam the endpoint to exhaust PB's rate limit for all users (denial-of-service on password reset).  
**Fix:** Add application-level rate limiting (e.g., 5 requests per IP per minute) or at minimum, check the PB response status before swallowing errors.

---

## MEDIUM

### M1. `admin/teams.tsx` — PB filter injection via user search input
**Category:** Security — Injection  
**File:** `app/routes/admin/teams.tsx:45-48`  
**Issue:** The search input is used to build a PB filter string. The code escapes regex special characters with `replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`, but PB filter syntax uses `~` for substring match and `"..."` for string literals. If a user enters a double-quote character, it could break out of the filter string. For example, searching `foo" || name = "admin` could manipulate the filter. The regex escape doesn't handle quotes.  
**Fix:** Escape double quotes in the search input before inserting into the filter string, or use PB's parameterized filter bindings (`pb.filter("name ~ {:search}", { search })`) instead of string interpolation.

### M2. `coordinator/dashboard.tsx` — Same PB filter injection risk
**Category:** Security — Injection  
**File:** `app/routes/coordinator/dashboard.tsx:88-89`  
**Issue:** Same as M1. The coordinator dashboard builds PB filter strings with user-provided search and status values using string interpolation. The `safe` variable escapes regex chars but not quotes. Additionally, `status` and `institution` values are interpolated directly into filter strings without validation.  
**Fix:** Use `pb.filter()` parameterized bindings for all user-provided filter values.

### M3. `admin/campus-leads.tsx` — Same PB filter injection risk  
**Category:** Security — Injection  
**File:** `app/routes/admin/campus-leads.tsx:50`  
**Issue:** The status filter in admin/teams is interpolated: `clauses.push(`status = "${status}"`)`. While the status comes from a search param, it's not validated against the allowed list before being inserted into the filter string.  
**Fix:** Validate `status` against `TEAM_STATUSES` before using it in a filter string, or use parameterized bindings.

### M4. `forgot-password.tsx` — Uses unauthenticated PB client for password reset
**Category:** Security / Correctness  
**File:** `app/routes/forgot-password.tsx:22`  
**Issue:** The forgot-password action creates an unauthenticated PB client (`createPocketBaseClient()`) and calls `requestPasswordReset()`. However, this PB call goes over plain HTTP (`http://vision-hack-pocketbase-gz1pzq-3a236c-144-24-114-90.sslip.io`). The password reset token is transmitted in the clear, making it interceptable via MITM.  
**Fix:** Ensure PocketBase is behind TLS in production (the `env.server.ts` already warns about this). The production URL should use HTTPS.

### M5. `login.tsx` — authRefresh() called without error isolation for token rotation
**Category:** Reliability  
**File:** `app/routes/login.tsx:36-45`  
**Issue:** The login loader calls `pb.collection("users").authRefresh()` to validate an existing token. If PB returns a network error (not a 401), the catch block silently proceeds to the login page, which is correct behavior. However, the `authRefresh()` is called without a timeout. If PB is slow/unresponsive, the login page loader hangs indefinitely. Other parts of the codebase use a 20-second timeout via `fetchWithTimeout`, but this call doesn't benefit from it because `createAuthenticatedClient` creates a fresh PB instance with the custom fetch wrapper. This is actually fine — but the login page itself has no timeout protection for the initial page load if PB is down.  
**Fix:** Add `AbortSignal.timeout()` to the authRefresh call, or rely on the global 20s timeout in `fetchWithTimeout`.

### M6. `institution/dashboard.tsx` — invite-lead doesn't validate email format
**Category:** Input Validation  
**File:** `app/routes/institution/dashboard.tsx:133-141`  
**Issue:** The invite-lead intent validates that email is non-empty and passes `isEmail()`, but `isEmail` is a very basic regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`). While adequate for basic validation, more specific checks (e.g., max length, common typos) could prevent accidental abuse.  
**Fix:** Low priority. The existing validation is functional. Consider adding `z.string().email()` from the schemas for consistency.

### M7. `lead/register.tsx` — Email validation missing in member emails
**Category:** Input Validation  
**File:** `app/routes/lead/register.tsx:129-156`  
**Issue:** The register action validates member names, phones, genders, and roles, but does NOT validate that member emails are valid email addresses. The `isEmail()` helper exists but isn't used here. A user could submit `not-an-email` as a member email.  
**Fix:** Add `isEmail(email)` check in the member validation loop.

### M8. `admin/export.tsx` — Loader fetches ALL teams and members without auth check
**Category:** Security — Authorization  
**File:** `app/routes/admin/export.tsx:35-58`  
**Issue:** The export page loader uses `getAdminClient()` instead of the user's own PB client. While the route requires admin role, using the admin client means the loader bypasses PB's role-scoped rules. If the admin role check is ever bypassed (e.g., a future route change), the data would still be accessible.  
**Fix:** Use the user's own PB client (`pb` from `requireRole`) instead of `getAdminClient()`, since the admin's role-scoped rules already allow full access.

### M9. `config.server.ts` — `getFullList` without pagination limit
**Category:** Performance / DoS  
**File:** `app/lib/config.server.ts:16-30`  
**Issue:** `getConfig()` calls `getFullList()` which fetches all records from the `config` collection. While the config collection is expected to be small (4 records), there's no explicit limit. If a malicious admin adds thousands of config records, this could cause memory/performance issues.  
**Fix:** Add `requestKey: null` and a `page` limit, or use `getList(1, 100)` instead.

### M10. `csv.ts` — Streaming response may lose data on connection drop
**Category:** Reliability  
**File:** `app/routes/api/export/csv.ts:117-136`  
**Issue:** The CSV export uses a `ReadableStream` with synchronous `start()`. If the connection drops mid-stream, the controller's error is unhandled. While the `TextEncoder` and `ReadableStream` are safe, there's no `cancel()` handler to clean up resources.  
**Fix:** Add a `cancel()` callback to the ReadableStream to log the disconnection.

### M11. `auth.server.ts` — `authCache` WeakMap uses Request as key
**Category:** Correctness / Memory  
**File:** `app/lib/auth.server.ts:26`  
**Issue:** The `authCache` WeakMap uses `Request` objects as keys. In React Router 7's server-side rendering, a new `Request` object is created for each navigation. The WeakMap allows entries to be GC'd when the request is garbage collected. However, if the server holds a reference to the request (e.g., in a closure that outlives the request lifecycle), the cache entry won't be cleaned up. The current code is correct, but the pattern is fragile.  
**Fix:** This is acceptable. The WeakMap semantics are correct for the current usage. Add a comment noting the lifecycle dependency.

### M12. `lead/questionnaire.tsx` — Questionnaire upsert creates duplicate records
**Category:** Correctness  
**File:** `app/routes/lead/questionnaire.tsx:189-226`  
**Issue:** The upsert logic uses `getFirstListItem` to find an existing response, then updates or creates. However, `getFirstListItem` can throw if no record is found (the `.catch(() => null)` handles this). The issue is that if two concurrent submissions happen (e.g., double-click), two records could be created because the `getFirstListItem` check and the `create` are not atomic.  
**Fix:** Use PB's `upsert` if available, or add a unique constraint on `teamId` in the PB collection to prevent duplicates at the database level.

---

## LOW

### L1. `server.ts` — Sentry initialized before environment validation
**Category:** Correctness  
**File:** `server.ts:1-7`  
**Issue:** Sentry is initialized at module load time, before `dotenv/config` runs. The `dotenv/config` import is on line 1, but Sentry reads `process.env.SENTRY_DSN` immediately on line 4. Since `dotenv/config` runs synchronously on import, this is actually fine. However, the `@ts-expect-error` on the dynamic import (line 17) is a code smell.  
**Fix:** Minor. The code works but the `@ts-expect-error` could be replaced with a proper type assertion.

### L2. `types.ts` — `QuestionnaireResponseRecord` has `[field: string]: unknown`
**Category:** Type Safety  
**File:** `app/lib/types.ts:87-94`  
**Issue:** The `QuestionnaireResponseRecord` interface has an index signature `[field: string]: unknown`. This makes TypeScript unable to type-check access to known fields (e.g., `response.age` returns `unknown` instead of `string`). The known fields (`id`, `teamId`, `userId`, `created`, `updated`) are typed, but any additional fields are `unknown`.  
**Fix:** Consider making the known fields explicit and using a more specific type for the dynamic fields, or document that this is intentional for schema flexibility.

### L3. `admin/config.tsx` — configUpdateSchema not used via secureAction
**Category:** Code Quality  
**File:** `app/routes/admin/config.tsx:37-60`  
**Issue:** The `configUpdateSchema` Zod schema exists but is not passed to `secureAction`. The action manually reads and validates `key` and `value`. This means the schema's validation logic is duplicated (manual check vs. schema).  
**Fix:** Pass `schema: configUpdateSchema` to `secureAction` and use `ctx.validated` for the typed values.

### L4. `components/shared/team-detail.tsx` — CSV download uses `document.createElement`
**Category:** Accessibility  
**File:** `app/components/shared/team-detail.tsx:117-123`  
**Issue:** The CSV download function creates an `<a>` element, clicks it programmatically, then removes it. This works but doesn't provide accessible feedback to screen readers (no announcement that a file was downloaded).  
**Fix:** Consider adding a `toast` notification or ARIA live region to announce the download.

### L5. `login.tsx` — Role dashboard map used without fallback for empty roles
**Category:** Edge Case  
**File:** `app/routes/login.tsx:41`  
**Issue:** When redirecting an authenticated user, `ROLE_DASHBOARD_MAP[user.role]` could be `undefined` if `user.role` is an empty string (legacy users). The code at line 102-103 has a `?? "/login"` fallback, but line 41 does not. If a legacy user with `role=""` logs in, they'd be redirected to `undefined`, causing a navigation error.  
**Fix:** Add the same fallback: `throw redirect(ROLE_DASHBOARD_MAP[user.role] ?? "/login")`.

### L6. `form.server.ts` — `isEmail` regex is permissive
**Category:** Input Validation  
**File:** `app/lib/form.server.ts:44-46`  
**Issue:** The `isEmail` regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) accepts emails like `a@b.c` which are technically valid but very minimal. This is fine for basic validation but won't catch common user mistakes like `user@gmail.con` (typo).  
**Fix:** Acceptable for current use. The Zod schemas use `.email()` which is more thorough for critical paths.

### L7. `lead/submit-idea.tsx` — File validation only checks first 8 bytes
**Category:** Security — File Upload  
**File:** `app/routes/lead/submit-idea.tsx:58-81`  
**Issue:** The `validateFileSignature` function reads only the first 8 bytes of the uploaded file. While this catches most renamed executables, a sophisticated attacker could craft a file with valid PDF magic bytes followed by executable content. However, PB's file storage doesn't execute uploaded files, so this is defense-in-depth only.  
**Fix:** Acceptable for the threat model. The magic bytes check is a reasonable defense-in-depth measure.

### L8. `entry.server.tsx` — CSP nonce not applied in development mode
**Category:** Security  
**File:** `app/entry.server.tsx:56-76`  
**Issue:** CSP headers are only set in production mode. In development, no CSP is applied, which means any injected script would execute freely. While this is standard practice for dev environments (Vite HMR needs inline scripts), it means developers can't test CSP compliance during development.  
**Fix:** Consider adding a `Content-Security-Policy-Report-Only` header in development to catch CSP violations without blocking.

### L9. `api/files.ts` — Content-Disposition filename not sanitized
**Category:** Security — Header Injection  
**File:** `app/routes/api/files.ts:89-93`  
**Issue:** The `Content-Disposition` header uses the raw `filename` from the URL path. While the filename is validated to not contain `..`, `/`, or `\`, it's not validated against characters that could cause header injection (e.g., newlines, semicolons). However, modern browsers handle this gracefully and the filename comes from PB's file storage (which sanitizes filenames), so exploitation is unlikely.  
**Fix:** Sanitize the filename for Content-Disposition (remove/control characters).

### L10. `team-detail.tsx` — Submission file link assumes single file
**Category:** Correctness  
**File:** `app/components/shared/team-detail.tsx:246-262`  
**Issue:** The download link for `submission_file` is rendered as a single link using `team.submission_file`. However, the file proxy validates against a comma-separated list of filenames. If `submission_file` contains multiple comma-separated filenames, the link would break (the URL would contain commas). The codebase appears to only allow one file upload per submission, but the data model supports multiple.  
**Fix:** Either constrain the UI to handle multiple files or ensure the data model enforces single-file uploads.

### L11. `admin/campus-leads.tsx` — Bulk CSV import has no rate limiting
**Category:** Abuse  
**File:** `app/routes/admin/campus-leads.tsx:138-214`  
**Issue:** The bulk CSV import processes each row sequentially with individual PB calls. A large CSV (up to 1MB) could trigger hundreds of PB operations. While the 1MB limit bounds the input, the processing time is unbounded.  
**Fix:** Add a maximum row count (e.g., 100 rows) to the bulk import.

### L12. `lead/register.tsx` — Race condition on team creation
**Category:** Concurrency  
**File:** `app/routes/lead/register.tsx:162-201`  
**Issue:** The register action checks for an existing team, then creates one if none exists. If two concurrent requests from the same lead both pass the check, two teams could be created. PB doesn't enforce uniqueness on `leaderUserId` in the `teams` collection.  
**Fix:** Add a PB filter or unique constraint to prevent duplicate teams per leader.

### L13. `login.tsx` — `createAuthenticatedClient` is imported but unused in action
**Category:** Dead Code  
**File:** `app/routes/login.tsx:12`  
**Issue:** `createAuthenticatedClient` is imported from `pocketbase.server` but only used in the loader (line 36), not in the action. The import is correct for the loader but could be confusing.  
**Fix:** No action needed — the import is used.

---

## LOW-PRIORITY / INFORMATIONAL

### I1. `use-action-toast.ts` — Missing `useCallback` / memoization
**Category:** Performance  
**File:** `app/hooks/use-action-toast.ts:22-37`  
**Issue:** The hook re-fires the toast on every render where `actionData` changes reference (which React Router provides on every action). This is correct behavior but could cause duplicate toasts if React re-renders the component while `actionData` is the same reference.  
**Fix:** The `useEffect` dependency array includes `actionData`, which should be a new object reference on each action result. This is fine.

### I2. `app.css` — Large CSS file (20.8KB)
**Category:** Performance  
**File:** `app/app.css`  
**Issue:** The CSS file is 20.8KB, which is large for a Tailwind-based project. While Tailwind v4 with the Vite plugin handles tree-shaking, custom CSS rules may be contributing to the size.  
**Fix:** Review and remove unused custom CSS rules.

### I3. `vite.config.ts` and `vitest.config.ts` — Separate config files
**Category:** Architecture  
**Files:** `vite.config.ts`, `vitest.config.ts`  
**Issue:** Vitest has its own config file. Since Vite and Vitest share the same config format, Vitest can inherit from `vite.config.ts`.  
**Fix:** Merge `vitest.config.ts` into `vite.config.ts` using the `test` key.

### I4. No E2E tests in CI
**Category:** Testing  
**Files:** `tests/` directory  
**Issue:** There are E2E test files (`e2e-playwright-suite.mjs`, etc.) but no evidence they run in CI (the `.github/workflows/` directory is gitignored).  
**Fix:** Add a CI workflow that runs Playwright tests against a test instance.

### I5. `setup-pb.ts` — 1400-line monolith
**Category:** Maintainability  
**File:** `scripts/setup-pb.ts`  
**Issue:** The setup script is a single 1400-line file. While well-organized with clear function boundaries, it would benefit from being split into smaller modules.  
**Fix:** Consider splitting into `collections/`, `rules/`, and `seeds/` modules.

---

## Architecture Observations (Not Bugs)

1. **`secureAction` wrapper is excellent.** It centralizes CSRF, auth, and error handling. The only gaps are the login/forgot-password/logout actions that bypass it.

2. **PocketBase role-scoped rules are well-designed.** The layered defense (app-level checks + PB rules) is the right pattern.

3. **The `CsrfContext` pattern works** but could be simplified by using PB's built-in CSRF protection instead of the custom double-submit pattern.

4. **The JWT validation without signature verification** (jwt.server.ts) is documented and acceptable given the threat model (token comes from HttpOnly cookie set by our server).

5. **The `fetchWithTimeout` wrapper** on the PocketBase client is a good defensive measure against PB downtime.

---

## Priority Fix Order

1. **C1 + C2 + C3 + C5** (CSRF gaps) — Add CSRF validation to login, forgot-password, and logout actions. ~1 hour.
2. **H1** (server.ts event listeners) — Move process.on calls to module scope. ~5 minutes.
3. **H2** (graceful shutdown timeout) — Add fallback timeout. ~10 minutes.
4. **M1 + M2 + M3** (PB filter injection) — Use parameterized bindings. ~1 hour.
5. **H5** (coordinator admin escalation) — Add PB update rule for coordinator. ~30 minutes.
6. **H4 + M4 + M12** (institution invite + HTTPS) — Fix cross-institution check, enforce HTTPS. ~1 hour.
7. **M7** (member email validation) — Add isEmail check. ~10 minutes.
8. **H8** (forgot-password rate limiting) — Add app-level rate limit. ~30 minutes.
9. **L5** (login redirect fallback) — Add null coalesce. ~2 minutes.
10. **Remaining M/L items** — Address in follow-up PRs.
