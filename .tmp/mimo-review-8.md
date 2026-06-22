# VisionHack Submission Portal — Independent Code Review (Mimo8)

**Reviewer:** Mimo8 — Senior Security & Code Reviewer
**Date:** 2026-06-22
**Scope:** Complete independent review of all source files — security, correctness, architecture, edge cases

---

## Summary

The codebase is well-structured for a hackathon submission portal. The security posture is strong: CSP with nonces, CSRF double-submit cookie pattern, role-gated actions via `secureAction()`, parameterized PocketBase filters, and defense-in-depth headers. That said, I identified **4 CRITICAL**, **6 HIGH**, **9 MEDIUM**, and **6 LOW** issues across the stack.

---

## CRITICAL Issues

### CRIT-1: PocketBase Filter Injection via Unescaped Double Quotes in Search Parameters
**Severity:** CRITICAL | **Category:** Security — Injection | **Files:** `app/routes/admin/teams.tsx:46-47`, `app/routes/coordinator/dashboard.tsx:88-89,91,99,125`

The search term is regex-escaped but **double quotes are NOT escaped** before interpolation into PocketBase filter strings:

```ts
// admin/teams.tsx:46-47
const safe = search.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
clauses.push(`(name ~ "${safe}" || teamCode ~ "${safe}")`);
```

An attacker searching for `x" || true || name ~ "x` produces the filter:
```
(name ~ "x" || true || name ~ "x" || teamCode ~ "x" || true || name ~ "x")
```

This matches ALL teams regardless of status filters. In `coordinator/dashboard.tsx`, the same pattern applies to `institution` (line 125), `status` (line 91), and `district` (lines 99) parameters from URL search params — all interpolated directly into filter strings without escaping.

**Impact:** Filter bypass → data exfiltration beyond intended scope (e.g., coordinator sees teams from other districts).

**Fix:** Use `pb.filter()` with parameterized bindings for every user-supplied value:
```ts
if (search) {
  const safe = search.slice(0, 100);
  clauses.push(pb.filter("(name ~ {:q} || teamCode ~ {:q})", { q: safe }));
}
if (status && status !== "all") {
  clauses.push(pb.filter("status = {:s}", { s: status }));
}
```

---

### CRIT-2: Coordinator Actions Execute as Admin Client — Privilege Escalation
**Severity:** CRITICAL | **Category:** Security — Authorization Bypass | **File:** `app/routes/teams.team-id.tsx:174-176`

```ts
const actionPb = user.role === "coordinator"
  ? await getAdminClient()
  : pb;
```

When a coordinator performs a team status transition, the action uses the **server-side admin PB client** instead of the coordinator's own token. This means all PocketBase operations inside `transitionTeamStatus` (and the audit log write) execute with **full admin privileges**. 

If `canTransition()` or `transitionTeamStatus()` has any bug, a coordinator could mutate any team record — update any field, not just `status`. The coordinator's own PB token would be rejected by PocketBase's update rules, but the admin client bypasses those entirely.

**Impact:** Any coordinator-level bug becomes an admin-level exploit.

**Fix:** Remove the admin client bypass. Instead, update PocketBase's `teams` collection `updateRule` to allow coordinator writes scoped to `status` and `status_changed_at` only:
```
@request.auth.role = "admin" || (@request.auth.role = "coordinator" && status != record.status)
```
Or create a dedicated PocketBase endpoint for coordinator transitions.

---

### CRIT-3: Hardcoded Production Credentials in `.env` and `.dev.vars`
**Severity:** CRITICAL | **Category:** Security — Secrets Exposure | **Files:** `.env:5`, `.dev.vars:2`

Both files contain real PocketBase admin credentials:
```
POCKETBASE_ADMIN_PASSWORD=REDACTED_CREDENTIAL
```

While both files are in `.gitignore`, they exist in the working directory. If this repo was ever committed to git (even on a branch that was later force-pushed away), the credentials are in git history forever. The `.dev.vars` file is Cloudflare Workers format, suggesting a deployment may have exposed it.

**Impact:** Full admin access to the PocketBase database if credentials leak.

**Fix:**
1. Rotate the PocketBase admin password immediately.
2. Delete `.env` and `.dev.vars` from the working directory; use only `.env.example` as the template.
3. Audit `git log --all --diff-filter=A -- .env .dev.vars` to verify they were never committed.
4. Use a secrets manager (e.g., GitHub Actions secrets, Cloudflare secrets) for production.

---

### CRIT-4: JWT Signature Not Verified — Forgery Window
**Severity:** CRITICAL | **Category:** Security — Authentication | **File:** `app/lib/jwt.server.ts:1-12`

The JWT payload is decoded but the **signature is never verified**:

```ts
// jwt.server.ts comment: "We do NOT verify the signature here"
```

The justification is that the token lives in an HttpOnly cookie set by the server. However:

1. If an attacker can set cookies on a subdomain (e.g., via XSS on `mulearn.org`), they can forge a JWT with any `id` and `role`.
2. Between token refreshes (up to 5 days — `COOKIE_MAX_AGE = 432000`), a forged token is accepted without question.
3. The `resolveAuth` function (auth.server.ts:218-221) calls `pb.collection("users").getOne(payload.id)` to load the user — this would succeed with a forged `id` if the PB collection's `viewRule` allows authenticated reads.

**Impact:** Account takeover via cookie injection on any subdomain.

**Fix:** Verify the JWT signature using PocketBase's secret or validate via `authRefresh()` on every request (with the per-request cache to avoid N+1). At minimum, validate on state-changing actions.

---

## HIGH Issues

### HIGH-1: `server.ts` — Process Error Handlers Registered Inside `server.listen()` Callback
**Severity:** HIGH | **Category:** Reliability | **File:** `server.ts:30-36`

```ts
server.listen(port, () => {
  process.on("uncaughtException", (err) => {  // ← INSIDE listen callback
    Sentry.captureException(err);
  });
  process.on("unhandledRejection", (reason) => {
    Sentry.captureException(reason);
  });
  console.log(`Server listening on http://localhost:${port}`);
});
```

The `process.on` handlers are registered **inside** the `server.listen` callback. Any `uncaughtException` or `unhandledRejection` during server startup (before the first request) will crash the process with no Sentry reporting.

**Fix:** Move all `process.on` handlers to the module top level, before `server.listen()`.

---

### HIGH-2: Missing Origin Header Not Blocked in CSRF Validation
**Severity:** HIGH | **Category:** Security — CSRF | **File:** `app/lib/csrf.server.ts:46-55`

```ts
export function validateOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return; // ← Missing Origin is ALLOWED
  }
  // ...
}
```

When the `Origin` header is absent, validation passes. The comment says the CSRF token is the primary defense, but some browsers (especially older ones) omit the Origin header on certain request types. An attacker using a tool like `curl` or a browser plugin can easily omit the Origin header and bypass origin validation entirely.

Combined with CRIT-1 (filter injection), this means any form submission without an Origin header bypasses both origin and potentially CSRF token checks if the token mechanism has any weakness.

**Fix:** In production, reject requests with missing Origin headers for state-changing methods (POST, PUT, DELETE, PATCH). Only allow missing Origin for GET requests or specific exceptions (like native form submissions from some browsers, which still send `Referer`).

---

### HIGH-3: `admin/export.tsx` Uses Server-Side Admin Client Instead of User's Token
**Severity:** HIGH | **Category:** Architecture / Availability | **File:** `app/routes/admin/export.tsx:36`

```ts
export async function loader({ request }: LoaderFunctionArgs) {
  const pb = await getAdminClient();
  // ...
}
```

The admin export page loader uses `getAdminClient()` — the server-side admin PB client. But the admin dashboard, teams page, and config page all use `requireRole(request, ["admin"])` which gives the user's own PB token. This means:

1. If the server-side admin credentials are misconfigured or expired, the export page fails even though the admin user is authenticated.
2. The export page has **dual dependency** — it needs both a valid user session AND valid server-side admin credentials.

The CSV API (`api/export/csv.ts`) correctly uses `requireAuthJson` with the user's own token.

**Fix:** Use the user's own PB token for the export page loader. The admin's PB token already has full access to all collections.

---

### HIGH-4: `lead/register.tsx` — Member Records Created Without Error Boundary
**Severity:** HIGH | **Category:** Reliability / Data Integrity | **File:** `app/routes/lead/register.tsx:228-230`

```ts
await Promise.all(
  memberPayloads.map((payload) => pb.collection("members").create(payload)),
);
```

If any one of the member creations fails (e.g., due to a PB validation rule, duplicate email, or network error), `Promise.all` rejects and the entire batch fails. However, earlier in the function (lines 175-180), the team was already updated to "registered" status, and old members were deleted (lines 185-191). This leaves the team in a "registered" state with **zero members**.

**Fix:** Use `Promise.allSettled` and handle partial failures. Or wrap the member creation in a transaction-like pattern (delete old members only after new ones are confirmed created).

---

### HIGH-5: `submit-idea.tsx` — Status Updated Before File Upload Completes
**Severity:** HIGH | **Category:** Reliability / Data Integrity | **File:** `app/routes/lead/submit-idea.tsx:180-183`

```ts
form.append("status", "submitted");
form.append("status_changed_at", new Date().toISOString());
await pb.collection("teams").update(team.id, form);
```

The `status: "submitted"` is set in the same multipart form as the file upload. If PocketBase processes the status update but the file upload fails (e.g., disk full, file too large at PB level), the team is marked as "submitted" without a valid file. The code later (line 187) checks `team.submission_file` to decide if a re-submit is allowed, but if the status was already changed, the team is stuck in "submitted" without a file.

**Fix:** Upload the file first, verify success, then update the team record with the file reference AND status change atomically.

---

### HIGH-6: `institution/dashboard.tsx` — Lead Invitation Has No Rate Limiting Beyond PB
**Severity:** HIGH | **Category:** Security — Abuse | **File:** `app/routes/institution/dashboard.tsx:127-246`

The "invite-lead" intent creates a new user account and sends a password-reset email on each invocation. There is no application-level rate limiting. A malicious institution lead could:
1. Call the invite endpoint rapidly to create many user accounts (spam accounts).
2. Trigger many password-reset emails (email flooding).
3. Exhaust the institution's `maxTeams` capacity by creating users without teams.

While PB has some built-in rate limiting, the user creation + email send is a multi-step operation that bypasses single-endpoint throttling.

**Fix:** Add a cooldown (e.g., 1 invite per 30 seconds per institution) or a CAPTCHA on the invite form.

---

## MEDIUM Issues

### MED-1: `coordinator/dashboard.tsx` — Filter Injection in Institution/District/Status Parameters
**Severity:** MEDIUM | **Category:** Security — Injection | **File:** `app/routes/coordinator/dashboard.tsx:91,99,125`

```ts
if (status && status !== "all") teamClauses.push(`status = "${status}"`);
// ...
const orChain = instIds.map((id) => `institutionId = "${id}"`).join(" || ");
// ...
teamClauses.push(`institutionId = "${institution}"`);
```

The `status`, `institution`, and `district` values come from URL search parameters and are interpolated directly into PocketBase filter strings without escaping or parameterized bindings. An attacker could craft a URL with a malicious `institution` parameter to inject filter syntax.

**Fix:** Use `pb.filter()` with parameterized bindings for all user-supplied values.

---

### MED-2: `login.tsx` — Module-Level Stats Cache Is Not Per-Request
**Severity:** MEDIUM | **Category:** Concurrency | **File:** `app/routes/login.tsx:30-31`

```ts
let statsCache: LoginStats | null = null;
const STATS_TTL_MS = 60_000;
```

`statsCache` is a module-level mutable variable shared across all requests. In a multi-process deployment (e.g., PM2 cluster mode, Kubernetes pods), each process has its own cache. In a single-process Node.js app, this is fine since Node is single-threaded. However, it's a fragile pattern for future scaling.

**Impact:** Minimal in current deployment; future scaling hazard.

---

### MED-3: `auth.server.ts` — Cookie Max-Age of 5 Days Without Re-Auth Requirement
**Severity:** MEDIUM | **Category:** Security — Session Management | **File:** `app/lib/auth.server.ts:12`

```ts
const COOKIE_MAX_AGE = 432000; // 5 days in seconds
```

The auth cookie persists for 5 days. After the JWT expires (PocketBase default is typically 7200 seconds / 2 hours), the `resolveAuth` function calls `authRefresh()` to get a new token. But if the PocketBase account is deactivated or the role is changed, the cached auth (WeakMap per request) uses the stale token until it fails. There is no server-side session revocation mechanism beyond PocketBase's token invalidation.

**Fix:** Consider reducing `COOKIE_MAX_AGE` to match the JWT expiry, or implement a session invalidation mechanism (e.g., check account status on each request, not just token validity).

---

### MED-4: `entry.server.tsx` — CSP Only Enforced in Production
**Severity:** MEDIUM | **Category:** Security — Defense in Depth | **File:** `app/entry.server.tsx:56-76`

```ts
if (isProd) {
  responseHeaders.set("Content-Security-Policy", [...]);
}
```

No CSP is set in development mode. This means local testing never validates CSP compliance, and XSS vulnerabilities introduced during development won't be caught until production.

**Fix:** Add a relaxed CSP for development (e.g., `default-src 'unsafe-inline' 'unsafe-eval'`) so developers get used to working within CSP constraints.

---

### MED-5: `lead/register.tsx:189-191` — N+1 Delete Pattern for Old Members
**Severity:** MEDIUM | **Category:** Performance | **File:** `app/routes/lead/register.tsx:189-191`

```ts
await Promise.all(
  oldMembers.map((m) => pb.collection("members").delete(m.id)),
);
```

Each member is deleted individually via a separate HTTP request. For 5 members, this creates 5 parallel requests. While bounded (max 5 members), this could be improved with a batch API or a single filter-based delete.

**Impact:** Low latency increase; acceptable for ≤5 members.

---

### MED-6: `admin/config.tsx:44` — Error Message Leaks Internal Config Key
**Severity:** MEDIUM | **Category:** Information Leakage | **File:** `app/routes/admin/config.tsx:44`

```ts
return fail({ error: `Unknown config key "${key}"`, status: 400 });
```

The error message echoes back the user-supplied `key` value. While this is admin-only, it could be used for reflected XSS if the error message is rendered without escaping. The admin UI uses React which auto-escapes, so the practical risk is low, but it's a bad practice.

**Fix:** Return a generic error message without echoing the input.

---

### MED-7: `pocketbase.server.ts` — Admin Client `autoCancellation(false)` Set After Auth
**Severity:** MEDIUM | **Category:** Correctness | **File:** `app/lib/pocketbase.server.ts:97`

```ts
pb.autoCancellation(false);
await pb.collection("_superusers").authWithPassword(email, password, { ... });
```

`autoCancellation(false)` is set after the auth call. If the auth call triggers an auto-cancelled request in a concurrent context, this could cause issues. In practice, the admin client is initialized lazily and `autoCancellation` is set before any subsequent calls, so this is unlikely to cause problems.

---

### MED-8: `team.server.ts:144` — Optimistic Locking Relies on PB Filter
**Severity:** MEDIUM | **Category:** Reliability | **File:** `app/lib/team.server.ts:140-147`

```ts
await pb.collection("teams").update(teamId, {
  status: to,
  status_changed_at: new Date().toISOString(),
}, { filter: pb.filter("status = {:expected}", { expected: team.status }) });
```

The optimistic locking uses a PB filter to ensure the status hasn't changed since the read. If two concurrent requests try to transition the same team, one will fail with a 409. However, the error message ("This team's status was changed by another action") is user-friendly but the catch block (line 145) catches ALL errors, not just 409s. A network error would also return this message.

**Fix:** Distinguish between 409 (optimistic lock failure) and other errors.

---

### MED-9: `email.server.ts:53` — Error Response Body Included in Exception
**Severity:** MEDIUM | **Category:** Information Leakage | **File:** `app/lib/email.server.ts:52-56`

```ts
const body = await response.text().catch(() => "(no body)");
throw new Error(`Resend API returned ${response.status}: ${body}`);
```

The Resend API error body is included in the thrown error. If this error propagates to a user-facing error boundary, it could leak the API key or internal details. However, `secureAction` catches handler errors and returns a generic "Something went wrong" message, so the leak is limited to server logs.

**Fix:** Log the full error but only throw a generic error message.

---

## LOW Issues

### LOW-1: `app/root.tsx:91-93` — Error Stack Trace Shown in Development
**Severity:** LOW | **Category:** Information Leakage | **File:** `app/root.tsx:91-93`

```ts
} else if (import.meta.env.DEV && error && error instanceof Error) {
  details = error.message;
  stack = error.stack;
}
```

Error stack traces are rendered in the UI during development. While `import.meta.env.DEV` prevents this in production, if someone runs the dev server on a public network, stack traces are visible to anyone.

**Fix:** Only show stack traces when `NODE_ENV === "development"` AND the request is from localhost.

---

### LOW-2: `ci.yml:26` — `cf-typegen` Script Referenced But Not in `package.json`
**Severity:** LOW | **Category:** CI/CD | **File:** `.github/workflows/ci.yml:26`

```yaml
- name: Generate CF types
  run: npm run cf-typegen
```

The `cf-typegen` script is not defined in `package.json`. This step will fail in CI, causing the build job to fail on every push/PR.

**Fix:** Either add the script to `package.json` or remove this CI step.

---

### LOW-3: `form.server.ts:44` — Email Regex Is Basic
**Severity:** LOW | **Category:** Validation | **File:** `app/lib/form.server.ts:44-46`

```ts
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
```

This regex accepts invalid emails like `a@b.c` and rejects valid ones like `user+tag@example.com`. For a hackathon portal, this is acceptable as a "sanity gate" (as documented), but production apps should use a more robust validation.

---

### LOW-4: `lead/dashboard.tsx:84-95` — Sequential Database Queries Could Be Parallel
**Severity:** LOW | **Category:** Performance | **File:** `app/routes/lead/dashboard.tsx:84-95`

```ts
if (inst?.campusLeadId) {
  const lead = await pb.collection("users").getOne(inst.campusLeadId, { ... });
  // ...
}
```

The campus lead lookup depends on the institution record (needs `campusLeadId`), but the institution query and the member count query are already parallelized. The campus lead query is correctly sequential since it depends on `inst.campusLeadId`.

**Impact:** Negligible — one extra round-trip.

---

### LOW-5: `team-detail.tsx:253` — File Download Link Uses Team Name in URL
**Severity:** LOW | **Category:** Security / UX | **File:** `app/components/shared/team-detail.tsx:253`

```tsx
<a href={`/api/files/teams/${team.id}/${team.submission_file}`} ...>
```

The `team.submission_file` is used directly in the URL. If the filename contains spaces or special characters, the URL may not work correctly in all browsers. The `api/files.ts` endpoint validates against path traversal, so there's no security issue, but the UX could break with unusual filenames.

**Fix:** Use `encodeURIComponent()` on the filename in the link.

---

### LOW-6: `biome.json:6` — `setup-pb.ts` Excluded from Linting
**Severity:** LOW | **Category:** Code Quality | **File:** `biome.json:6`

```json
"ignore": ["node_modules", "build", ..., "scripts/setup-pb.ts"]
```

The setup script is excluded from Biome linting. This 1400-line script has no linting or formatting enforcement.

**Fix:** Remove `scripts/setup-pb.ts` from the ignore list.

---

## Architecture Observations (Non-Blocking)

### ARCH-1: Dual Auth Token Pattern Creates Confusion
The codebase uses two PocketBase client patterns:
1. **User token** (`requireRole()` → `createAuthenticatedClient(token)`) — used by most routes
2. **Admin client** (`getAdminClient()`) — used by login stats, file proxy, coordinator transitions, export page

The inconsistency (some routes use user token, some use admin client for the same role) makes it hard to reason about what permissions each route actually has. The admin client should only be used when the user's token genuinely cannot perform the operation.

### ARCH-2: No Request-Scoped Logging Context
Errors are logged with `console.error` without request ID, user ID, or trace context. Sentry captures exceptions but without structured logging, debugging production issues is harder.

### ARCH-3: `action.server.ts` Schema Validation Duplicates Route Validation
Several routes (register, questionnaire, submit-idea) have manual field validation in the action handler that duplicates what Zod schemas already define. The schemas exist in `app/lib/schemas/` but are passed to `secureAction` via the `schema` option — yet the routes still do their own validation. This creates two sources of truth for validation rules.

### ARCH-4: No CSRF Token on Public Actions
Login and forgot-password actions use `validateOrigin()` but not CSRF token validation. This is acceptable (no session to hijack) but worth documenting as a conscious trade-off.

---

## Positive Observations

1. **Strong CSP implementation** — nonce-based CSP with per-request UUIDs, proper `script-src` and `style-src` nonces.
2. **CSRF double-submit cookie** with `timingSafeEqual` comparison — well-implemented.
3. **Parameterized PocketBase filters** used consistently for user-owned data lookups (`pb.filter()` with named parameters).
4. **File upload validation** — magic byte checking, MIME type validation, file size limits, and filename sanitization in the file proxy.
5. **CSV injection prevention** — `escapeCsv()` neutralizes formula injection characters.
6. **XSS prevention** — `escapeHtml()` used in email templates, React's auto-escaping for UI.
7. **Optimistic locking** for status transitions prevents race conditions.
8. **Audit logging** for status changes (best-effort, non-blocking).
9. **Clean separation** of server/client code with `.server.ts` suffix convention.
10. **Per-request auth cache** with WeakMap — avoids N+1 PocketBase calls while being GC-friendly.

---

## Priority Fix Order

| Priority | ID | Effort | Description |
|----------|-----|--------|-------------|
| 1 | CRIT-3 | Quick | Rotate credentials, remove `.env`/`.dev.vars` |
| 2 | CRIT-1 | Short | Fix filter injection with parameterized bindings |
| 3 | CRIT-2 | Medium | Remove coordinator→admin client bypass |
| 4 | CRIT-4 | Medium | Implement JWT signature verification |
| 5 | HIGH-1 | Quick | Move `process.on` handlers to module top level |
| 6 | HIGH-4 | Short | Fix member creation error boundary |
| 7 | HIGH-5 | Short | Upload file before updating status |
| 8 | HIGH-2 | Short | Reject missing Origin in production |
| 9 | HIGH-3 | Quick | Use user token for export page |
| 10 | MED-1 | Short | Fix remaining filter injections |
| 11 | MED-6 | Quick | Remove reflected input from error messages |
