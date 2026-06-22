# VisionHack Submission Portal — Full Codebase Review

**Reviewer:** Mimo5 (Senior Security & Code Reviewer)
**Date:** 2026-06-22
**Scope:** Every source file — lib/, routes/, components/, hooks/, tests/, scripts/, config files

---

## CRITICAL

### C-1 | Authorization Bypass — Admin export page missing role check
**File:** `app/routes/admin/export.tsx:35-59`
**Issue:** The loader uses `getAdminClient()` directly without calling `requireRole(request, ["admin"])`. The dashboard layout only enforces `requireAuth()`, not role-based access. Any authenticated user (lead, institution, coordinator) who navigates to `/admin/export` receives admin-level data: all teams with institution names, leader emails, team codes, and aggregate member counts.
**Fix:** Replace `const pb = await getAdminClient()` with `const { user, pb } = await requireRole(request, ["admin"])` and return `user` in the loader data.

### C-2 | Undefined `user` variable — runtime crash in export loader
**File:** `app/routes/admin/export.tsx:54`
**Issue:** The loader returns `{ user, teams, ... }` but `user` is never declared in the function scope. This causes a `ReferenceError` at runtime whenever the export page loads. The page is completely broken.
**Fix:** Same as C-1 — add `requireRole(request, ["admin"])` which destructures `user`.

### C-3 | Production PocketBase credentials on disk
**File:** `.env:4-5`, `.dev.vars:1-2`
**Issue:** Both files contain the production PocketBase admin email (`REDACTED_EMAIL`) and a plaintext password (`REDACTED_CREDENTIAL`). While both files are `.gitignore`-d (lines 4-6 of `.gitignore`), they exist on the developer's machine with real credentials. If this machine is compromised, the entire PocketBase instance is compromised.
**Fix:** Use environment variable injection (CI secrets, `.env.local` with different credentials for local dev). Rotate the production password immediately if this machine has been shared or backed up to cloud storage.

---

## HIGH

### H-1 | PB API rule IDOR — institution users can update ANY team
**File:** `scripts/setup-pb.ts:210-213` (TEAMS_RULES.updateRule)
**Issue:** The teams `updateRule` is:
```
'@request.auth.role = "admin" || @request.auth.role = "institution" || (leaderUserId ?= @request.auth.id && @request.auth.role = "lead")'
```
This allows ANY institution user to update ANY team, regardless of which institution the team belongs to. The `institutionId` scope check exists in `listRule` and `viewRule` but is absent from `updateRule`. While the application code adds IDOR guards (e.g., `transitionTeamStatus` checks `institutionId`), a direct PB API call with a leaked institution JWT could modify teams from other institutions.
**Fix:** Add institution scope to the updateRule:
```
updateRule:
    '@request.auth.role = "admin" || ' +
    '(institutionId ?= @request.auth.institutionId && @request.auth.role = "institution") || ' +
    '(leaderUserId ?= @request.auth.id && @request.auth.role = "lead")',
```

### H-2 | JWT signature not verified
**File:** `app/lib/jwt.server.ts:1-11`
**Issue:** The comment explicitly states "We do NOT verify the signature here." The token is decoded without cryptographic verification. PocketBase's `authRefresh()` validates the signature, but only when the token is "expiring soon" (within 5 minutes of expiry). For the majority of a token's 5-day lifetime, the decoded-but-unverified claims are trusted. An attacker with knowledge of the JWT structure could forge a token that passes local validation.
**Fix:** Verify the JWT signature using PocketBase's JWT secret. This is defense-in-depth against token forgery.

### H-3 | PB filter injection via search parameters
**File:** `app/routes/admin/teams.tsx:46-47`, `app/routes/coordinator/dashboard.tsx:88-89`
**Issue:** Both files use regex escaping for search input but do NOT escape double quotes before interpolation into PB filter strings:
```ts
const safe = search.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
clauses.push(`(name ~ "${safe}" || teamCode ~ "${safe}")`);
```
An attacker can inject `foo" || role = "admin" || name ~ "x` to break out of the string context and modify the filter logic.
**Fix:** Use PB's parameterized filter bindings:
```ts
clauses.push(pb.filter('(name ~ {:q} || teamCode ~ {:q})', { q: search }));
```

### H-4 | Status filter injection via search parameters
**File:** `app/routes/admin/teams.tsx:50`, `app/routes/coordinator/dashboard.tsx:91`
**Issue:** The `status` query parameter is interpolated directly into PB filter strings without validation:
```ts
if (status && status !== "all") {
  clauses.push(`status = "${status}"`);
}
```
While `TEAM_STATUSES.includes()` is used in `csv.ts` (line 34), the admin/teams and coordinator/dashboard routes do NOT validate that `status` is a legitimate `TeamStatus` value before interpolation. A crafted `status` parameter could inject arbitrary filter clauses.
**Fix:** Validate against the known status list before interpolation:
```ts
import type { TeamStatus } from "~/lib/types";
const TEAM_STATUSES: TeamStatus[] = ["invited","registered","shortlisted","submitted","selected","rejected","withdrawn"];
if (status && status !== "all" && TEAM_STATUSES.includes(status as TeamStatus)) {
  clauses.push(`status = "${status}"`);
}
```

---

## MEDIUM

### M-1 | Login action missing CSRF double-submit validation
**File:** `app/routes/login.tsx:88-121`
**Issue:** The login action validates Origin (`validateOrigin(request)`) but does NOT validate the CSRF token (`validateCsrfToken`). The `secureAction` wrapper provides CSRF protection, but the login action uses a manual handler. The `SameSite=Lax` cookie policy provides primary CSRF defense for the auth cookie, but the missing CSRF token means a sophisticated attacker could potentially forge login requests from the same origin.
**Fix:** Add `validateCsrfToken(request, formData)` after parsing formData.

### M-2 | Forgot-password action missing CSRF double-submit validation
**File:** `app/routes/forgot-password.tsx:12-33`
**Issue:** Same as M-1. An attacker on the same origin could trigger password reset emails for arbitrary addresses, causing email spam.
**Fix:** Same as M-1.

### M-3 | Institution invite-lead bypasses registration_open feature flag
**File:** `app/routes/institution/dashboard.tsx:132-221`
**Issue:** The `invite-lead` intent creates new users and teams without checking if `registration_open` is true. This means institutions can continue inviting leads even when registration is "closed" via the admin config panel.
**Fix:** Add a feature flag check at the start of the invite-lead intent:
```ts
case "invite-lead": {
  const flags = await getConfig(pb);
  if (!flags.registration_open) {
    return fail({ error: "Registration is currently closed", status: 403 });
  }
  // ... rest of handler
}
```

### M-4 | Race condition in team registration (lead/register.tsx)
**File:** `app/routes/lead/register.tsx:162-230`
**Issue:** The register action performs a check-then-act sequence: it checks for an existing team, then creates/updates it, then deletes old members and creates new ones. Two concurrent form submissions could:
1. Both see `existingTeam = null` and create duplicate teams
2. Both delete old members and create new ones, leading to orphaned records
There is no optimistic locking or transaction wrapping.
**Fix:** Use PocketBase's `filter` in the update to add optimistic concurrency (check current status matches expected), or use a unique constraint on `(leaderUserId, institutionId)`.

### M-5 | Race condition in questionnaire upsert
**File:** `app/routes/lead/questionnaire.tsx:188-218`
**Issue:** The upsert pattern (`getFirstListItem` -> create/update) is not atomic. Two concurrent submissions could both see no existing record and both create, resulting in duplicate questionnaire responses.
**Fix:** Use PB's `getFirstListItem` + update with a filter, or add a unique constraint on `teamId` in the questionnaire_responses collection.

### M-6 | Race condition in campus lead creation
**File:** `app/lib/team.server.ts:238-280`
**Issue:** The `createCampusLead` function performs three sequential operations (create user, create institution, update user's institutionId) without a transaction. A failure between steps 2 and 3 leaves an institution without a linked campus lead.
**Fix:** Wrap in a try-catch with rollback logic, or accept the inconsistency and add a cleanup/reconciliation mechanism.

### M-7 | Race condition in institution invite-lead
**File:** `app/routes/institution/dashboard.tsx:144-218`
**Issue:** The invite-lead action checks team capacity, checks for existing user, creates user, checks for existing team, creates team — all without atomicity. Concurrent requests could exceed the team capacity limit.
**Fix:** Use PB's filter-based create/update for atomic operations, or add a unique constraint.

### M-8 | Coordinator dashboard status filter injection
**File:** `app/routes/coordinator/dashboard.tsx:91`
**Issue:** Same as H-4 — the `status` parameter is interpolated without validation:
```ts
if (status && status !== "all") teamClauses.push(`status = "${status}"`);
```
**Fix:** Same as H-4.

### M-9 | Missing `autoCancellation(false)` on some PB clients
**Files:** `app/routes/admin/dashboard.tsx`, `app/routes/admin/teams.tsx`, `app/routes/lead/dashboard.tsx`, `app/routes/lead/register.tsx`
**Issue:** These loaders create PB clients via `requireRole()` which returns a new client per request, but don't call `pb.autoCancellation(false)`. If a loader makes multiple sequential PB calls on the same client, PocketBase's auto-cancellation could cancel earlier in-flight requests. The institution and coordinator dashboards correctly disable it.
**Fix:** Add `pb.autoCancellation(false)` after `requireRole()` in loaders that make multiple PB calls.

---

## LOW

### L-1 | Sentry captures exceptions with potentially sensitive data
**File:** `server.ts:30-35`, `app/lib/action.server.ts:149-156`
**Issue:** Sentry captures all uncaught exceptions and action handler errors, including the userId and route path. While passwords are not logged, other sensitive data (team names, institution details) may appear in error messages.
**Fix:** Ensure Sentry is configured with data scrubbing rules. Consider adding `beforeSend` to filter sensitive fields.

### L-2 | In-memory stats cache not bounded across workers
**File:** `app/routes/login.tsx:30-31`
**Issue:** The `statsCache` is a module-level singleton with a 60-second TTL. In a long-running server, this is fine since the cache is small and bounded. However, in a multi-worker deployment (e.g., cluster mode), each worker maintains its own cache, potentially causing inconsistent reads.
**Fix:** Acceptable for current deployment. Document that this cache is per-process.

### L-3 | `.env.example` is gitignored
**File:** `.gitignore:39`
**Issue:** `.env.example` is listed in `.gitignore`, which prevents new contributors from seeing the expected environment variables. Convention is to commit `.env.example` as a template.
**Fix:** Remove `.env.example` from `.gitignore` and commit it as a reference template (with placeholder values, not real credentials).

### L-4 | Email validation is minimal
**File:** `app/lib/form.server.ts:44-46`
**Issue:** The `isEmail` regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` accepts many technically invalid emails (e.g., `a@b.c`). However, PocketBase's own validation catches truly invalid addresses.
**Fix:** Acceptable — PB provides server-side validation. The regex is a quick client-side gate.

### L-5 | File proxy doesn't validate PB response MIME type
**File:** `app/routes/api/files.ts:85-93`
**Issue:** The proxy passes through whatever Content-Type PocketBase returns. If PB serves an HTML file (e.g., an error page), the browser could render it. However, `Content-Disposition: attachment` prevents in-browser rendering.
**Fix:** Acceptable — the `attachment` disposition header prevents XSS. Consider adding `X-Content-Type-Options: nosniff` to the response.

### L-6 | Error stack traces exposed in development
**File:** `app/root.tsx:91-93`
**Issue:** In development mode, the error boundary shows the full error stack trace. This is intentional for debugging but could leak implementation details if accidentally enabled in production.
**Fix:** Acceptable — gated behind `import.meta.env.DEV`. Ensure `NODE_ENV=production` in deployment.

### L-7 | No rate limiting on client-side login attempts
**File:** `app/routes/login.tsx:88-121`
**Issue:** The login action has no client-side rate limiting or account lockout. PB's server-side rate limiting (10 auth/min) provides the primary defense.
**Fix:** Acceptable — PB rate limiting is configured in setup-pb.ts. Consider adding exponential backoff on the client for better UX.

### L-8 | `@ts-expect-error` in server.ts
**File:** `server.ts:17`
**Issue:** The `@ts-expect-error` suppresses a type error for the dynamic import of the build output. This is a common pattern in React Router but could hide type drift.
**Fix:** Acceptable — the build output is a plain JS file without types. The comment explains the rationale.

### L-9 | sessionStorage auto-save stores PII
**File:** `app/hooks/use-auto-save.ts`
**Issue:** The auto-save hook stores form data (including names, emails, phone numbers) in sessionStorage. This data persists across page refreshes and is accessible to any same-origin script. However, sessionStorage is cleared on tab close and is not accessible cross-origin.
**Fix:** Acceptable — sessionStorage is the appropriate scope for form drafts. Document that PII is temporarily stored.

### L-10 | Password is not trimmed in login action (intentional)
**File:** `app/routes/login.tsx:93`
**Issue:** `const password = (formData.get("password") as string | null) ?? ""` — the password is not trimmed. This is actually correct behavior (passwords can have intentional leading/trailing whitespace).
**Fix:** No fix needed — this is intentional.

---

## Architecture / Code Quality

### A-1 | Inconsistent admin route authorization pattern
**Observation:** Most admin routes use `requireRole(request, ["admin"])` in their loaders, but `admin/export.tsx` uses `getAdminClient()` directly. This inconsistency led to the C-1 authorization bypass.
**Recommendation:** Standardize all admin route loaders to use `requireRole(request, ["admin"])` for consistent authorization.

### A-2 | `secureAction` wrapper is well-designed but underutilized
**Observation:** The `secureAction` wrapper provides CSRF, auth, and error handling consistently. However, the login and forgot-password actions bypass it, requiring manual CSRF validation. This is the root cause of M-1 and M-2.
**Recommendation:** Either use `secureAction` for public actions (with a `roles: []` option that skips role checks) or document that public actions must manually call `validateCsrfToken`.

### A-3 | Duplicate find-or-create patterns with race conditions
**Observation:** The "check if exists, then create" pattern is repeated in campus-leads, institution invite-lead, and lead register. Each has its own race condition window.
**Recommendation:** Consider a shared utility for atomic "find-or-create" operations using PB's filter-based updates.

### A-4 | PB filter string construction is fragile
**Observation:** Multiple routes construct PB filter strings via template literals with user input. Only some use PB's parameterized bindings (`pb.filter("field = {:param}", { param })`). The inconsistency creates injection risk.
**Recommendation:** Enforce a coding convention: ALL user-derived values in PB filters MUST use parameterized bindings. Add a lint rule or code review checklist.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| HIGH | 4 |
| MEDIUM | 9 |
| LOW | 10 |
| Architecture | 4 |
| **Total** | **30** |

**Top 3 priorities:**
1. **C-1/C-2:** Fix the admin export loader — it's both broken (undefined variable) and a security bypass.
2. **H-1:** Fix the teams updateRule IDOR — add institution scope check.
3. **H-3/H-4:** Fix PB filter injection — use parameterized bindings consistently.
