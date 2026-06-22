# Security & Code Review Report — Agent2 (Senior Security & Code Reviewer)

**Project:** VisionHack Submission Portal V2
**Date:** 2026-06-22
**Scope:** All ~100 source files read line-by-line (routes, lib, components, schemas, scripts, tests, config)

---

## EXECUTIVE SUMMARY

The codebase demonstrates strong security awareness overall — CSRF double-submit pattern, parameterized PocketBase queries, role-scoped PB rules, optimistic locking on status transitions, file magic-byte validation, and a reasonable CSP/security-headers setup. However, several **CRITICAL** and **HIGH** severity issues remain, notably: PB filter injection via unsanitized URL query parameters, a CSRF gap on the logout endpoint, cookie `Secure` flag tied to the wrong origin, no app-level rate limiting on authentication endpoints, admin credentials committed in `.env`, and several over-engineering / dead-code patterns.

---

## CRITICAL

### C-1: PocketBase Filter Injection via URL Query Parameter (`admin/teams.tsx:50`, `coordinator/dashboard.tsx:91`)

**File:** `app/routes/admin/teams.tsx` line 50
**File:** `app/routes/coordinator/dashboard.tsx` line 91

```ts
clauses.push(`status = "${status}"`);
```

The `status` query parameter from `url.searchParams.get("status")` is interpolated directly into a PB filter string **without any validation**. An attacker can inject arbitrary filter operators:

```
/admin/teams?status=selected" || 1=1
```

This becomes `status = "selected" || 1=1` — PocketBase evaluates the full expression, potentially exposing all team records regardless of status.

**Fix:** Validate `status` against the known `TeamStatus` union before interpolation:

```ts
const ALLOWED_STATUSES: string[] = ["invited","registered","shortlisted","submitted","selected","rejected","withdrawn"];
const status = url.searchParams.get("status") ?? "";
const cleanStatus = ALLOWED_STATUSES.includes(status) ? `"${status}"` : undefined;
if (cleanStatus) clauses.push(`status = ${cleanStatus}`);
```

Or use `pb.filter()` parameterization which naturally escapes values.

---

### C-2: Admin Superuser Credentials Committed in `.env` (Root)

**File:** `.env` (committed to repository)

The `.env` file contains `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD` for the PocketBase superuser account. This file is **not** in `.gitignore` (verify) and is committed, giving every developer who clones the repo superuser-level database access to any PocketBase instance pointed at by `POCKETBASE_URL`.

**Fix:** 
1. Add `.env` to `.gitignore`.
2. Rotate the credentials immediately.
3. Use `.env.example` for template values and load real secrets via environment variables in production.

---

### C-3: Logout Endpoint Missing CSRF Token Validation (`api/auth/logout.ts:6-19`)

**File:** `app/routes/api/auth/logout.ts`

The logout action calls `validateOrigin(request)` but **never calls `validateCsrfToken`**. While the dashboard sidebar form *does* include `csrf_token` as a hidden input (dashboard-layout.tsx:305), the server never reads or validates it. A CSRF attack can force-logout any authenticated user via a cross-origin POST.

```ts
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  validateOrigin(request);  // ← validates Origin, but not CSRF token
  // ...
}
```

**Fix:** Parse formData and call `validateCsrfToken(request, formData)` before clearing the cookie.

---

## HIGH

### H-1: Cookie `Secure` Flag Logic Bound to Wrong Origin (`auth.server.ts:56-69,75-87`)

**File:** `app/lib/auth.server.ts` lines 58-60, 76-78

```ts
const secure =
  getEnv().POCKETBASE_URL?.startsWith("https") ||
  process.env.NODE_ENV === "production";
```

The `Secure` flag is determined by whether the **PocketBase** URL uses HTTPS, not whether the **application** server uses HTTPS. The `Set-Cookie` header is sent by the application server (Node.js on whatever port). If the app is behind an HTTPS reverse proxy but PB is on HTTP, the cookie won't get `Secure`. Conversely, if PB is HTTPS but the app is HTTP in dev, the cookie gets `Secure` and won't be sent by the browser over HTTP.

**Fix:** Check the application's own protocol, not PocketBase's:

```ts
const secure = process.env.NODE_ENV === "production"; // or check X-Forwarded-Proto
```

---

### H-2: JWT Signature Not Verified — Full Reliance on HttpOnly Cookie (`jwt.server.ts:1-12`)

**File:** `app/lib/jwt.server.ts`

```ts
// We do NOT verify the signature here — PocketBase is the only issuer and
// the token lives in an HttpOnly cookie set by our own server...
```

The code explicitly delegates trust to the HttpOnly + SameSite=Lax cookie properties. If an attacker achieves limited XSS (e.g., via a file-upload MIME bypass) or if a misconfigured subdomain sets cookies, the JWT payload would be trusted without verification. While HttpOnly prevents JS exfiltration, cookie injection via other vectors (subdomain takeover, CDN compromise, wildcard DNS) would bypass this entirely.

**Risk:** If an attacker can write a cookie with any JWT payload to the application domain, they can impersonate any user.

**Fix:** Add HMAC signature verification using PocketBase's secret (configurable via `pb_hooks` or by fetching the secret from PB admin settings). At minimum, the code should verify the token against PB's public API on every critical action.

---

### H-3: No App-Level Rate Limiting on Authentication Endpoints (`login.tsx:88-121`, `forgot-password.tsx:12-33`)

**File:** `app/routes/login.tsx`, `app/routes/forgot-password.tsx`

The setup script (`setup-pb.ts:1229-1233`) configures PB-level rate limiting (`10 auth/min`, `30 create/min`), but:

1. The app makes its own HTTP requests to PB — PB rate limiting applies to **direct** PB API calls, but the app routes that proxy through the Node server are **not** rate-limited at the application layer.
2. An attacker can brute-force login endpoints on the application origin indefinitely (limited only by PB's request-level limits on the app server's IP, which hits all users).
3. Forgot-password has no rate limiting at all — an attacker could spam reset emails for any known email address (though the error message is concealed).

**Fix:** Add in-memory or Redis-backed rate limiting to the Node server for `/login` and `/forgot-password` routes. Use a sliding window with IP + email keys.

---

### H-4: Module-Level Mutable Stats Cache Crosses User Boundaries (`login.tsx:30-31,71-78`)

**File:** `app/routes/login.tsx` lines 30, 71-78

```ts
let statsCache: LoginStats | null = null;
```

The `statsCache` is a module-level global variable. While not a direct security vulnerability (the data is public stats), it is:

- **Unbounded memory** — never evicted except by TTL (60s).
- **Mutable shared state** across all concurrent requests — a race on initial write could produce stale data for some users.
- **Unclear ownership** — no mechanism to invalidate on data change.

**Fix:** Remove the module-level cache. Either query PB on every request (the data is small: `getList(1,1)` for counts), or use a proper cache with TTL invalidation (e.g., `cache-manager` or a simple `Map` with LRU eviction).

---

### H-5: Unvalidated `toStatus` Parameter Cast (`teams.team-id.tsx:171`)

**File:** `app/routes/teams.team-id.tsx` line 171

```ts
const toStatus = formData.get("toStatus") as TeamStatus;
```

The `toStatus` value from the form is cast directly to `TeamStatus` with **no validation** against the known union. While `canTransition()` will reject invalid values (returns `false`), and PB will reject invalid enum values, the application code passes arbitrary strings to `transitionTeamStatus`. If a new status is added to PB but not to the app's `canTransition`, the cast hides a compile-time check.

**Fix:** Validate against the `TeamStatus` union:

```ts
const ALLOWED_STATUSES: TeamStatus[] = ["invited","registered",...];
const rawStatus = formData.get("toStatus") as string;
const toStatus = ALLOWED_STATUSES.includes(rawStatus as TeamStatus) ? rawStatus as TeamStatus : null;
if (!toStatus) return fail({ error: "Invalid status", status: 400 });
```

---

## MEDIUM

### M-1: Missing Content-Length / Size Validation on FormData Reads (`form.server.ts:20-31`)

**File:** `app/lib/form.server.ts`

The `getStr()` helper provides a `max` option for truncation, but callers in action handlers inconsistently use it. The questionnaire action (`questionnaire.tsx:137-149`) always slices after `getStr`, but there is no pre-read size guard. A malicious client could send a multi-gigabyte `FormData` field, causing Node to buffer it entirely in memory (denial of service).

**Fix:** Set `request.body` size limits (enforced by Node's `--max-http-header-size`) and add explicit `max` to every `getStr()` call site that accepts untrusted input.

---

### M-2: No Input Size Limit on `getAllStr` (`form.server.ts:34-36`)

**File:** `app/lib/form.server.ts` line 34

```ts
export function getAllStr(formData: FormData, key: string): string[] {
  return formData.getAll(key).map((v) => String(v));
}
```

`formData.getAll()` can return an unlimited number of entries for the same key. In the register action (`register.tsx:129-133`), this is used for dynamic member arrays. An attacker could send thousands of `memberName` fields, consuming unbounded memory.

**Fix:** Add a `maxItems` parameter to `getAllStr()`:

```ts
export function getAllStr(formData: FormData, key: string, maxItems = 10): string[] {
  const values = formData.getAll(key);
  return values.slice(0, maxItems).map((v) => String(v));
}
```

---

### M-3: Questionnaire Upsert — No Optimistic Locking (`questionnaire.tsx:189-218`)

**File:** `app/routes/lead/questionnaire.tsx` lines 189-218

The questionnaire upsert reads the existing record, then conditionally creates or updates. Between the read and write, another request could create a second questionnaire for the same team, resulting in duplicate records.

**Fix:** Use PB's `getFirstListItem` with create-or-update pattern, or add a unique constraint on `(teamId)` at the schema level — the `questionnaire_responses` collection has no unique index on `teamId`, allowing duplicates.

**Note:** The status transition in `team.server.ts:144` demonstrates correct optimistic locking — apply the same pattern here.

---

### M-4: `questionnaire_completed` Race Condition (`questionnaire.tsx:222-226`)

**File:** `app/routes/lead/questionnaire.tsx` lines 222-226

```ts
if (!team.questionnaire_completed) {
  await pb.collection("teams").update(team.id, { questionnaire_completed: true });
}
```

The team was fetched at line 183-185. Between fetching and this update, another concurrent request may have already set the flag. This is a non-critical race (the flag is denormalized and idempotent), but it's an unnecessary extra write on every submission after the first.

**Fix:** Always set `questionnaire_completed: true` unconditionally (idempotent write), or use a filter-based update:

```ts
await pb.collection("teams").update(team.id, { questionnaire_completed: true });
```

---

### M-5: CSRF Token Never Rotated (Same Token for Session Duration) (`dashboard-layout.tsx:88-98`)

**File:** `app/routes/dashboard-layout.tsx` lines 88-98

The CSRF token is generated once and reused across all navigations for the entire browser session. If the token is compromised (e.g., via a referrer header leak or XSS), an attacker can forge requests indefinitely until the browser session ends.

**Fix:** Regenerate the CSRF token on every form submission (rotate on use) or at least periodically. The double-submit pattern is most effective with single-use tokens.

---

### M-6: Bulk Campus Lead Creation — Sequential, No Transaction (`campus-leads.tsx:167-211`)

**File:** `app/routes/admin/campus-leads.tsx` lines 167-211

The bulk CSV import processes each row **sequentially** (`for...of` with `await` inside). For 1000 rows, this is 1000 sequential PB API calls (each creating a user + institution relationship). If the process fails mid-way, some institutions are created and some aren't — no atomicity.

**Fix:** 
1. Use `Promise.allSettled()` with a concurrency limit (e.g., 5 at a time) for parallel creation.
2. Add a rollback mechanism or report partial success clearly to the admin.
3. Consider using PB's import API for atomic bulk operations.

---

### M-7: RecordId Regex Too Strict for Future PB Versions (`api/files.ts:36-38`)

**File:** `app/routes/api/files.ts` line 36

```ts
if (!/^[A-Za-z0-9]{15}$/.test(recordId)) {
  return new Response("Not found", { status: 404 });
}
```

PocketBase 0.24+ uses 15-character alphanumeric IDs. If a future PB version changes the ID format, this guard will reject all valid requests.

**Fix:** Minimally validate length and alphanumeric content:

```ts
if (!/^[A-Za-z0-9]{10,30}$/.test(recordId)) {
```

---

### M-8: `members` Collection Missing Unique Constraint (`setup-pb.ts:874-932`)

**File:** `scripts/setup-pb.ts` lines 874-932

The `members` collection has no unique constraint on `(teamId, email)`. A lead could register the same email under multiple member records within the same team, creating duplicate entries.

**Fix:** Add a unique index:

```sql
CREATE UNIQUE INDEX idx_members_team_email ON members (teamId, email);
```

And add a constraint check in the register action to prevent duplicates.

---

### M-9: No XSS Protection on Questionnaire Display (`team-detail.tsx:332-353`)

**File:** `app/components/shared/team-detail.tsx` lines 332-353

Questionnaire responses are rendered via `{String(value)}`. While React's JSX escapes HTML, the data could contain rich text that React does not interpret. If a file upload or questionnaire answer contains malicious content, it will be display-escaped by React.

**Status:** Currently safe due to React's built-in escaping, but if any raw HTML rendering is ever introduced (e.g., `dangerouslySetInnerHTML`), this becomes a high-severity XSS vector.

**Recommendation:** Add a comment or lint rule forbidding `dangerouslySetInnerHTML` on user-supplied questionnaire/team data.

---

### M-10: `escapeHtml` Used Correctly in Email Templates But Not Everywhere (`team.server.ts:190-191`)

**File:** `app/lib/team.server.ts` lines 190-191

The status-change email template correctly calls `escapeHtml()` on user-controlled values (`leadName`, `teamName`, `statusLabel`). The `dashboardUrl` is constructed from `getAppUrl()` (server-controlled) and is also escaped.

**Status:** Correct as implemented. No unescaped user data in the email template.

---

## LOW / CODE QUALITY

### L-1: Over-Engineering — `cn()` Wrapper (`utils.ts:4-5`)

**File:** `app/lib/utils.ts`

```ts
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

The `cn()` helper is used pervasively but is a generic shadcn convention. No issue per se, but it adds unnecessary indirection for simple class merges. Consider whether `twMerge(clsx(...))` is needed on every component or if vanilla Tailwind composition suffices.

---

### L-2: Dead Code — `initEnv()` and `resetEnv()` (`env.server.ts:68-79`)

**File:** `app/lib/env.server.ts` lines 68-79

Both functions are documented as deprecated no-ops kept for backward compatibility. If no imports of these functions remain, delete them to reduce dead code surface.

---

### L-3: `escapeHtml` Defined But Used Only in One Place (`utils.ts:9-16`)

**File:** `app/lib/utils.ts` lines 9-16

The `escapeHtml` function is only used in `team.server.ts`. If the email template is the only HTML-generation path, this is fine. However, the function duplicates what React's `dangerouslySetInnerHTML` would handle. Consider removing if unused elsewhere.

---

### L-4: Type Assertions Mask PB Schema Changes (`types.ts` and throughout)

The codebase uses `as UserRecord`, `as TeamView`, `as TeamStatus`, etc. throughout. If the PocketBase schema drifts from the TypeScript types (manual migration, schema change not applied), these casts will silently produce incorrect data at runtime.

**Fix:** Consider Zod runtime validation for critical paths (already partially done) and add a schema-verification step in CI that compares `types.ts` against PB's live API response.

---

### L-5: `transitionTeamStatus` Optimistic Lock Uses `status = {:expected}` (`team.server.ts:144`)

**File:** `app/lib/team.server.ts` line 144

```ts
{ filter: pb.filter("status = {:expected}", { expected: team.status }) }
```

PB v0.24+ returns a `409 Conflict` when the filter doesn't match on update. The catch block returns a `409` response. However, this behavior is undocumented in PB and could change. The alternative (fetch-and-check with CAS) is heavier.

**Status:** Acceptable risk but should be documented more explicitly and monitored on PB upgrades.

---

### L-6: Hardcoded MAX_TEXT = 2000 in Questionnaire Action (`questionnaire.tsx:129`)

**File:** `app/routes/lead/questionnaire.tsx` line 129

```ts
const MAX_TEXT = 2000;
```

This duplicates the schema max in `setup-pb.ts:1110` (which also uses 2000). If one is changed without the other, they'll diverge. Extract to a shared constant module.

---

### L-7: No Test Coverage for Admin/Coordinator/Institution Actions

**Files:** `app/lib/__tests__/`

Existing tests cover only: `auth.server.ts` (cookie helpers), `csrf.server.ts` (origin validation), `jwt.server.ts` (payload decode), and `types.ts`/`team-status.ts` (transition rules). **Zero tests exist for:**
- Login action handler
- Any `secureAction` route handler
- Institution invite flow
- CSV export
- File proxy
- Admin config/CampusLead operations

---

### L-8: Missing `max` Parameter on `getStr` Calls In Actions

Several action handlers call `getStr()` without the `max` option, then slice the result manually. This works but is inconsistent. Either always pass `max` to `getStr()` for early truncation, or remove the `max` option entirely and rely on explicit `.slice()` calls.

Affected files:
- `questionnaire.tsx:137-149` — no `max` on any field
- `submit-idea.tsx:129-131` — no `max`
- `register.tsx:113-116` — no `max`
- `campus-leads.tsx:91-95` — no `max`

---

### L-9: Potential Node.js Version Mismatch in `import.meta` Usage

**File:** `server.ts` line 19

```ts
return import("./build/server/index.js") as Promise<ServerBuild>;
```

The dynamic import works in Node 18+ ESM contexts. Since `"type": "module"` is set in `package.json`, this is fine. However, the `--env-file` flag (used in `start` script) requires Node 20.6+. Ensure the deployment environment meets this requirement.

---

### L-10: Test Setup Overwrites `process.env.POCKETBASE_URL` Globally (`setup.ts:3`)

**File:** `app/lib/__tests__/setup.ts` line 3

```ts
process.env.POCKETBASE_URL = process.env.POCKETBASE_URL ?? "http://localhost:8090";
```

This sets a global default for all tests. Tests in `auth.test.ts` and `csrf.test.ts` save/restore `process.env` in `beforeEach/afterEach`, but any test that doesn't explicitly set these values inherits the global. This is fragile — test order independence is not guaranteed.

**Fix:** Use `vi.stubEnv`/`vi.unstubEnv` (Vitest's built-in env mocking) instead of mutating `process.env` directly.

---

## ARCHITECTURAL OBSERVATIONS

### A-1: Good — Consistent Use of Parameterized Queries

Every PB query uses `pb.filter("field = {:value}", { value: ... })` with named parameter bindings — except the two filter-injection vectors noted in **C-1**. This is the correct pattern and prevents PB/SQL injection.

### A-2: Good — Role-Scoped PB API Rules

The `setup-pb.ts` script carefully defines `listRule`, `viewRule`, `createRule`, `updateRule`, `deleteRule` for every collection, scoped to the minimum necessary access for each role. The `updateRule` on `users` notably prevents self-role-escalation via `@request.body.role:isset = false`.

### A-3: Good — File Proxy with Ownership Check

The `/api/files/:collection/:recordId/:filename` route performs a server-side authorization check, path traversal prevention, and filename validation before proxying the file from PB. Files are set to `protected: true` in PB, forcing all access through this proxy.

### A-4: Good — CSP + Security Headers in Production

The `entry.server.tsx` sets nonce-based CSP in production (strict `default-src 'self'`, `script-src` and `style-src` with nonce), HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and a restrictive `Permissions-Policy`. The CSP is relaxed in dev (for Vite HMR), which is correct.

### A-5: Concern — `secureAction` Wrapper Monolith

The `secureAction()` function (action.server.ts:87-186) combines CSRF validation, form parsing, authentication, role checking, Zod schema validation, and error handling into a single wrapper. While convenient, this makes it difficult to:
- Override individual checks per handler
- Add per-route rate limiting (noted in the source, but unimplemented)
- Unit test the middleware chain independently

Consider extracting each concern into composable middleware functions.

---

## SECURITY HEADERS CHECKLIST

| Header | Present | Value |
|--------|---------|-------|
| `Content-Security-Policy` | Yes (prod) | Nonce-based, strict |
| `Strict-Transport-Security` | Yes (prod) | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | Yes | `nosniff` |
| `X-Frame-Options` | Yes | `DENY` |
| `Referrer-Policy` | Yes | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Yes | Restricted |
| `X-XSS-Protection` | No | Deprecated but still used by some browsers |

**Recommendation:** Add `X-XSS-Protection: 0` (to disable the legacy IE/Edge XSS filter which can itself be exploited).

---

## SUMMARY

| Severity | Count | Key Issues |
|----------|-------|------------|
| CRITICAL | 3 | PB filter injection in URL params, committed admin creds, logout CSRF |
| HIGH | 5 | Cookie Secure flag logic, JWT trust model, missing app-level rate limiting, mutable global cache, unvalidated toStatus cast |
| MEDIUM | 10 | FormData size limits, no member unique constraint, questionnaire race conditions, etc. |
| LOW | 10 | Dead code, missing test coverage, hardcoded constants, etc. |

**Overall:** The codebase is well-structured with strong security foundations. The critical issues (filter injection, committed secrets, logout CSRF) should be addressed before any production deployment. The high-severity issues (rate limiting, JWT verification, cookie flag logic) represent defense-in-depth improvements that significantly reduce attack surface.
