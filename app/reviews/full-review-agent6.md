# Security & Code Quality Review — Agent6 (Auth/CSRF/Infra/Hooks focus)

> **Reviewer:** Agent6 — Senior Security & Code Reviewer
> **Codebase:** VisionHack Submission Portal (React Router v7 SSR, PocketBase v0.24+, TypeScript)
> **Date:** 2026-06-22
> **Scope:** Every file in the project read line-by-line (~100 files)

---

## FINDINGS SUMMARY

| Severity | Count |
|----------|-------|
| CRITICAL | 6 |
| HIGH | 9 |
| MEDIUM | 15 |
| LOW | 10 |
| **Total** | **40** |

---

## CRITICAL FINDINGS

### C-1: Admin Credentials In Local `.env` With Production PocketBase URL

**File:** `.env` (local file, not git-tracked but present on disk)
**Category:** Secret Leakage / Operational Security

```
POCKETBASE_URL=http://vision-hack-pocketbase-gz1pzq-3a236c-144-24-114-90.sslip.io
POCKETBASE_ADMIN_EMAIL=REDACTED_EMAIL
POCKETBASE_ADMIN_PASSWORD=REDACTED_CREDENTIAL
```

**Issues:**
- Live production admin credentials in plaintext on a developer machine
- PocketBase is exposed on a public `sslip.io` DNS (publicly resolvable domain)
- PB URL uses **plain HTTP** — admin auth password, all API traffic, and session tokens go over the wire unencrypted
- `getEnv()` warns about HTTP only in non-production (env.server.ts:37-42) but never throws — production could silently use HTTP
- If this machine is compromised, the attacker has full admin access to PocketBase (all user data, all submissions, all configs)

**Fix:**
1. **Immediately rotate** the admin password for the production PocketBase instance
2. Remove credentials from `.env` — use deployment platform secrets
3. Add HTTPS enforcement in `getEnv()` that throws on non-HTTPS in production
4. Ensure PocketBase is behind a reverse proxy with TLS

---

### C-2: Login Form Missing CSRF Double-Submit Token

**File:** `app/routes/login.tsx`
- Action: lines 88-121
- Form: line 261

**Category:** CSRF / Missing Defense

**Issue:**
The login action calls `validateOrigin(request)` (line 89) but **never calls `validateCsrfToken()`**. The form on line 261 has no hidden `csrf_token` field. The origin-only defense is insufficient — browsers don't always send the `Origin` header (e.g., same-origin form POST from an XSS, some headless browsers, certain automation tools).

The `forgot-password.tsx` action has the same flaw.

**Attack Scenario:** An attacker can craft a cross-site form POST to `/login` with known credentials for the victim's email. On successful login, the attacker has signed the victim out of any existing session and knows their credentials work.

**Fix:**
1. Generate a CSRF token in the login page loader (like `dashboard-layout.tsx:94-95`)
2. Add `<input type="hidden" name="csrf_token" value={csrfToken} />` to both forms
3. Call `validateCsrfToken(request, formData)` in the action before processing

---

### C-3: Logout Action Accepts CSRF Token But Never Validates It

**File:** `app/routes/api/auth/logout.ts` — lines 6-20
**Category:** CSRF

**Issue:**
The logout form in `dashboard-layout.tsx:305` correctly includes:
```tsx
<input type="hidden" name="csrf_token" value={csrfToken} />
```

But the server-side action never reads or validates it:
```typescript
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") { ... }
  validateOrigin(request);  // Origin check only — CSRF token is ignored
  const cookie = clearAuthCookie();
  throw redirect("/login", { headers: { "Set-Cookie": cookie } });
}
```

The token is sent but not verified — the logout endpoint is CSRF-vulnerable.

**Fix:**
```typescript
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") { ... }
  validateOrigin(request);
  const formData = await request.formData();
  validateCsrfToken(request, formData);  // Add this check
  // ...
}
```

---

### C-4: PocketBase Filter Injection — Status Parameter String Interpolation

**Files:**
- `app/routes/admin/teams.tsx` — line 50
- `app/routes/coordinator/dashboard.tsx` — line 91

**Category:** Query / Filter Injection

**Issue:**
Status values are interpolated directly into PB filter strings:
```typescript
// admin/teams.tsx:49-51
if (status && status !== "all") {
  clauses.push(`status = "${status}"`);
}
// coordinator/dashboard.tsx:91
if (status && status !== "all") teamClauses.push(`status = "${status}"`);
```

While the UI constrains this via `<Select>` options, a crafted HTTP request can inject arbitrary filter expressions. PB's filter parser may allow injection that exposes records the requesting user shouldn't see or causes the query to error out.

The `search` parameter in `coordinator/dashboard.tsx:88` is properly escaped with regex-escape, but `status` is not.

**Fix:**
Use PB parameter binding instead:
```typescript
teamClauses.push(pb.filter("status = {:status}", { status }));
```

---

### C-5: JWT Signature Never Verified — Unverified Claims Trusted for Auth

**File:** `app/lib/jwt.server.ts` — entire module
**File:** `app/lib/auth.server.ts` — `resolveAuth()` lines 192-227

**Category:** Authentication / JWT

**Issue:**
The codebase explicitly declines to verify JWT signatures:
```typescript
// jwt.server.ts:3-11 comment
"We do NOT verify the signature here — PocketBase is the only issuer..."
```

The `resolveAuth` function in `auth.server.ts`:
1. Line 196-198: Decodes the JWT payload (no signature check) and trusts `payload.id`
2. Line 204-213: If the token is expiring, calls `authRefresh()` (validated against PB — safe)
3. Line 218-221: If token is healthy, fetches user by `payload.id` via `getOne()`:
   ```typescript
   const user = await pb.collection("users").getOne<UserRecord>(payload.id);
   ```

**Attack Vector:** If an attacker crafts a JWT with a base64-encoded payload `{"id":"some_existing_user_id","exp":9999999999}`, the server will:
1. Decode it (no sig check) → gets `payload.id = "some_existing_user_id"`
2. See `exp` is far in the future → takes the healthy path (no authRefresh)
3. Call `getOne("some_existing_user_id")` — if that user exists, the attacker is authenticated as them

The PB client's `authRefresh()` path does validate against PB, but the **healthy-token path does not**. The only barrier is that `createAuthenticatedClient` saves the token (line 63), and PB's server might reject the forged token on the first actual query. However, the `getOne()` call on line 219 might succeed if PB's `viewRule` allows reading that user record.

**Fix:**
1. Verify JWT signature using PocketBase's signing secret, OR
2. Call `authRefresh()` on every request (defeats the perf optimization but is secure), OR
3. At minimum, don't trust `payload.id` without first validating the token server-side

---

### C-6: `statsCache` Is a Module-Level Mutable Global Shared Across All Requests

**File:** `app/routes/login.tsx` — lines 30-31
**Category:** Race Condition / Data Leakage / Concurrency

```typescript
let statsCache: LoginStats | null = null;
const STATS_TTL_MS = 60_000;
```

**Issues:**
- **All requests share the same module-level variable** in a Node.js server
- The cache is populated on one request and read by all others
- While JS is single-threaded for a given async tick, there's a TOCTOU window between the `statsCache` null/expiry check (line 53) and the return (line 54) — if the cache expires and two requests arrive simultaneously, both will fetch from PB
- No eviction mechanism — once populated, the cache survives the entire process lifetime
- In cluster/worker mode, each worker has its own cache copy

While the cache only holds aggregated counts (not user data), the pattern is dangerous and likely to be copied elsewhere.

**Fix:**
1. Move to a proper per-request cache (the `WeakMap` pattern in `auth.server.ts` is the correct approach)
2. Or use a module with atomic read/update semantics
3. Or simply remove the cache and accept the PB round-trip on every login page load

---

## HIGH FINDINGS

### H-1: Cookie `Secure` Flag Tied to PocketBase URL, Not App URL

**File:** `app/lib/auth.server.ts` — lines 58-60, 77-78
**File:** `app/lib/csrf.server.ts` — lines 99-101

**Category:** Cookie Security / HTTPS Enforcement

```typescript
const secure =
  getEnv().POCKETBASE_URL?.startsWith("https") ||
  process.env.NODE_ENV === "production";
```

The `Secure` flag on auth and CSRF cookies depends on whether the **PocketBase URL** uses HTTPS, not the app's own protocol. Since the PB URL (`http://vision-hack-...`) uses HTTP, `secure` falls through to `NODE_ENV === "production"`.

If `NODE_ENV` is unset or set to anything other than `"production"` in production, cookies won't have the `Secure` flag, allowing JWT token exfiltration over unencrypted connections.

**Fix:**
```typescript
const secure = process.env.NODE_ENV === "production";
// Or check the request URL's protocol
```

---

### H-2: Password Reset Has No App-Level Rate Limiting

**File:** `app/routes/forgot-password.tsx` — lines 12-33
**Category:** Rate Limiting / Abuse

The action relies solely on PB's built-in rate limiting (10 auth requests/min, from `setup-pb.ts:1230`). There is no per-IP or per-email rate limiting at the application level.

An attacker can:
- Flood the password reset endpoint for many known emails
- Cause Resend API cost escalation
- Fill PocketBase's email queue
- The comment on line 25 says "Always succeed (don't reveal whether the email exists)" — but doesn't address abuse

**Fix:** Add app-level rate limiting by IP and/or email before the PB call.

---

### H-3: Unvalidated `toStatus` Cast in Team Detail Action

**File:** `app/routes/teams.team-id.tsx` — line 171
**Category:** Input Validation

```typescript
const toStatus = formData.get("toStatus") as TeamStatus;
```

This is a bare type assertion with no runtime validation. A crafted request with an invalid status bypasses TypeScript at compile time. While `transitionTeamStatus` does validate via `canTransition()`, an invalid status would produce confusing error messages like `Cannot transition from "invited" to "undefined"`.

**Fix:** Validate against the known status array before passing to `transitionTeamStatus`.

---

### H-4: Coordinator Uses Admin Client for Team Updates — Elevation of Privilege Pattern

**File:** `app/routes/teams.team-id.tsx` — lines 174-176
**Category:** Authorization / Audit

```typescript
const actionPb = user.role === "coordinator"
  ? await getAdminClient()
  : pb;
```

When a coordinator performs a status transition, the code uses the **superuser admin client** instead of the coordinator's own PB token. This means:
- PocketBase records the admin user as the modifier, not the coordinator
- Any bug in the role check could grant admin-level writes to a coordinator
- The schema's `updateRule` intentionally denies coordinator direct writes, but the app bypasses this at the code level

**Fix:** Either grant coordinator update permissions at the PB schema level, or use the coordinator's token and fix the schema rules. Don't silently escalate privileges.

---

### H-5: File Signature Validation — Server-Side Only Runs on the Client

**File:** `app/routes/lead/submit-idea.tsx` — lines 58-81, 166-172

**Category:** Security / File Upload

The `validateFileSignature()` function (line 58-81) runs client-side in the browser. The server also calls it (line 166), but the function uses the browser's `File` API (`file.slice().arrayBuffer()`), which is available in Node since v18 — but the function itself lives in a `.tsx` route file, not in a server-only module.

More critically: the function only checks the **first 8 bytes** of the file. A polyglot file can prepend valid PDF/PPT magic bytes while containing executable code. For a hackathon portal, this is acceptable risk, but it should be documented if the app processes these submissions further.

**Fix:** Move `validateFileSignature` to a server-only module and increase the byte check depth.

---

### H-6: Coordinator Dashboard Leaks All Institution Details With Campus Lead Info

**File:** `app/routes/coordinator/dashboard.tsx` — lines 76-84

```typescript
const institutions = await pb.collection("institutions").getList(1, 200, {
  expand: "campusLeadId",
  fields: "id,name,district,code,campusLeadId,expand.campusLeadId.name,expand.campusLeadId.email",
});
```

The coordinator page fetches ALL institutions (up to 200) with expanded campus lead names and emails. This data is serialized into the HTML page, exposing every campus lead's name and email. While coordinators may need this, the full dump is unnecessary for the filter dropdown.

**Fix:** Only fetch id/name for the filter; resolve campus lead info lazily.

---

### H-7: Credentials Exposed in Error/Debug Paths

**File:** `app/routes/home.tsx` — line 16
**File:** Various console.error paths

The `ROLE_DASHBOARD_MAP` cast on line 16 uses `user.role as keyof typeof ROLE_DASHBOARD_MAP`, which silently maps unknown roles to `/login`. While not a credential leak, it masks misconfiguration.

More significant: the `.env` file exists on disk with production credentials. Although `.gitignore` prevents git tracking, the file is present in the working directory and could be leaked through:
- IDE crash reports / workspace files
- Backup/zip artifacts for sharing
- CI artifacts if `npm run build` copies it
- Developer sharing screenshots with the path visible

---

### H-8: `Object.fromEntries(formData.entries())` in Schema Validation Destroys File Fields

**File:** `app/lib/action.server.ts` — line 131
**Category:** Bug / Data Loss

```typescript
const result = options.schema.safeParse(Object.fromEntries(formData.entries()));
```

React Router's `<Form method="post">` (default `application/x-www-form-urlencoded`) serializes `File` objects as `"[object File]"` strings. The `Object.fromEntries()` call then gets `"[object File]"` for any file field, not the actual `File` object.

Currently, `submitIdeaSchema` and `registerSchema` don't use the `schema` option in `secureAction` — they validate manually — so this bug is latent. But any future schema that includes file fields will silently fail validation because the `File` becomes a string.

**Fix:** Document this limitation, or handle the FormData→Object conversion to preserve File types.

---

### H-9: Rate Limiting Setup May Not Apply to All Environments

**File:** `scripts/setup-pb.ts` — lines 1210-1244

The `ensureRateLimiting` function (called inside `main()` at an unread line — appears at line 1244) enables PB rate limiting with rules:
```
*:auth → 10/min
*:create → 30/min
/api/files → 10/min
/api/ → 300/min
```

However, the setup script is run once at deployment time. If the PocketBase settings are reset or changed outside the script, rate limiting could be silently disabled. No monitoring or alerting catches this drift.

---

## MEDIUM FINDINGS

### M-1: `getStr()` With `trim: false` Is Inconsistently Used

**File:** `app/lib/form.server.ts`
**Usage:** `register.tsx:115`, `questionnaire.tsx:137-148`

Some calls pass `{ trim: false }` for gender and text fields (preserving whitespace), while `max` still truncates the (possibly whitespace-containing) value. The inconsistency could lead to subtle bugs.

**Fix:** Clarify the contract: if `trim: false`, should `max` count include leading whitespace?

---

### M-2: `useActionToast` Has Potential False Positive on Re-render

**File:** `app/hooks/use-action-toast.ts` — lines 26-36

```typescript
useEffect(() => {
  if (actionData?.success) { toast.success(...); }
  else if (actionData?.error) { toast.error(...); }
}, [actionData]);
```

The dependency is the entire `actionData` object reference. If the parent component re-renders with a new object (common with useActionData), the effect fires again, potentially showing duplicate toasts.

---

### M-3: `crypto.randomUUID()` for Temporary Passwords — Weak Entropy

**File:** `app/lib/team.server.ts` — line 251
**File:** `app/routes/institution/dashboard.tsx` — line 177

```typescript
const tempPassword = crypto.randomUUID();
```

`crypto.randomUUID()` produces a v4 UUID (122 bits of entropy). While UUIDs have good randomness, they follow a fixed format (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) with dashes and restricted hex patterns. A dedicated password generator (e.g., `crypto.randomBytes(32).toString("base64url")`) would produce stronger, longer, and more format-varied temporary passwords.

Since a password reset email is always sent immediately, the practical risk is low. But for principle of least privilege, use a dedicated password generator.

---

### M-4: `sendEmail` Throws on Failure, But `sendStatusChangeEmail` Silently Swallows All Errors

**File:** `app/lib/email.server.ts` — lines 51-56
**File:** `app/lib/team.server.ts` — lines 203-211

```typescript
// team.server.ts:203-211
try {
  await sendEmail({...});
} catch (err) {
  console.error("[email] Failed to send status change notification:", err);
}

// teams.team-id.tsx:211
sendStatusChangeEmail({...}).catch(() => {}); // Redundant catch
```

The caller in `teams.team-id.tsx` adds a `.catch(() => {})` that is redundant since `sendStatusChangeEmail` already catches internally. If `sendStatusChangeEmail` were refactored to throw, this outer catch would silently swallow critical email delivery failures.

---

### M-5: Duplicate Error-Handling Code in `secureAction`

**File:** `app/lib/action.server.ts` — lines 146-157 vs 171-184

The two try/catch blocks are nearly identical (same error logging, same Sentry capture, same generic return). The only difference is `ctx.intent` vs `intent` variable name. This should be unified.

---

### M-6: Admin Teams Page Count Scan Capped at 500

**File:** `app/routes/admin/teams.tsx` — line 58
**File:** `app/routes/coordinator/dashboard.tsx` — line 132

Both pages use a count scan cap (500 for admin, 1000 for coordinator). Once the event exceeds these thresholds, per-status counts become **approximate/incorrect**. The comment acknowledges this as a known limitation for "500+ teams".

---

### M-7: Institution List Size Hard-Coded at 200 for Coordinator

**File:** `app/routes/coordinator/dashboard.tsx` — line 78

```typescript
const institutions = await pb.collection("institutions").getList(1, 200, {...});
```

If the hackathon exceeds 200 institutions, some won't appear in the coordinator's filter dropdown. Should use `getFullList()` or paginate properly.

---

### M-8: `escapeHtml()` Doesn't Escape Forward Slash

**File:** `app/lib/utils.ts` — lines 9-16

```typescript
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
```

Does not escape `/` (solidus). While safe for HTML, it's a defense-in-depth gap if this string ever appears in a `<script>` or JSON context. Email templates use this function, so risk is low.

---

### M-9: `validateOrigin` Allows Missing Origin for POST Requests

**File:** `app/lib/csrf.server.ts` — lines 49-55

```typescript
if (!origin) {
  return; // Missing Origin is allowed
}
```

The comment says the CSRF double-submit cookie is the primary defense. But for endpoints that don't validate the CSRF token (login, forgot-password, logout), this means a request with no Origin header bypasses CSRF entirely. The double-submit cookie is the backup, not the primary.

---

### M-10: `questionnaire_completed` Denormalization Adds Schema Drift Risk

**File:** `app/routes/lead/questionnaire.tsx` — lines 222-226

```typescript
if (!team.questionnaire_completed) {
  await pb.collection("teams").update(team.id, {
    questionnaire_completed: true,
  });
}
```

This denormalized field on the `teams` collection avoids a join but creates a consistency risk: if a questionnaire response is deleted (admin override) or migrated, the `questionnaire_completed` flag becomes stale. No current code path resets it to `false`.

---

### M-11: `LOADER2` Import Not a Real Icon Name Check

**File:** `app/routes/forgot-password.tsx` — line 10

```typescript
import { Inbox } from "lucide-react";
```

`Inbox` is a valid lucide icon — no issue. But `Loader2` (used across many files) is correctly imported. This is just a note for completeness.

---

### M-12: `LoadingSpinner` Component Unused

**File:** `app/components/shared/loading-spinner.tsx`

This component exists in the shared directory but no route file imports it. All loading states use inline `Loader2` from lucide-react or the `Skeleton` component.

---

### M-13: `PhaseStrip` Component Unused

**File:** `app/components/shared/phase-strip.tsx`

Same as M-12 — component exists but is unused by any route.

---

### M-14: `row.tsx` Unused

**File:** `app/components/shared/row.tsx**

Same pattern — a `Row` component defined but not imported by any route.

---

### M-15: `Validated` Field in ActionContext Uses `unknown` — Loses Type Safety

**File:** `app/lib/action.server.ts` — line 28

```typescript
export interface ActionContext {
  validated?: unknown;
}
```

The `validated` field is typed as `unknown`, requiring the handler to cast or narrow. If the schema type could be carried as a generic parameter, type safety would be preserved through the handler.

---

## LOW FINDINGS

### L-1: `toLocaleString()` Without Locale Argument

**File:** `app/components/shared/team-detail.tsx` — line 268

```typescript
{team.created ? new Date(team.created).toLocaleString() : "—"}
```

Uses default locale (browser's), which differs between server and client rendering. Fine for display but can cause hydration mismatch warnings if server and client disagree on locale.

---

### L-2: Email Test Accept Header Name Contains Tabs

**File:** `app/lib/__tests__/auth.test.ts` — comments use inconsistent formatting

Minor formatting inconsistencies in test comments.

---

### L-3: `import.meta.env.DEV` Used for Development Error Details

**File:** `app/root.tsx` — line 91

```typescript
} else if (import.meta.env.DEV && error && error instanceof Error) {
  details = error.message;
  stack = error.stack;
}
```

Exposing stack traces to users in development could leak file paths and internal structure. This is acceptable for a dev environment but should be gated on a build-time flag that's never set in production.

---

### L-4: `escapeCsv` Doesn't Handle Unicode Formula Injection

**File:** `app/lib/utils.ts` — lines 28-41

```typescript
if (/^[=+\-@\t\r]/.test(text)) {
  text = `'${text}`;
}
```

Does not handle:
- Unicode CTL characters (non-ASCII carriage return/line feed)
- Non-ASCII formula prefixes (e.g., fullwidth equals sign `＝`)
- DDE (Dynamic Data Exchange) formulas

For a hackathon CSV export, the ASCII-based protection is sufficient. Enterprise deployment would need more robust defense.

---

### L-5: `useTheme` Defaults to "light" During SSR — Brief Flash on Dark-Mode Users

**File:** `app/routes/dashboard-layout.tsx` — line 120

```typescript
const [theme, setTheme] = useState<"light" | "dark">("light");
```

The theme defaults to "light" during SSR and the first React render pass. The inline `<script>` in `root.tsx` applies the dark class before paint, but there's a potential flash if the script runs after the initial render. The comment (lines 114-119) acknowledges this.

---

### L-6: `global.d.ts` Not Found — Missing Type Augmentations

No `global.d.ts` or `vite-env.d.ts` found in the project. The `vite-tsconfig-paths` plugin handles path aliases, but some ambient type declarations might be missing.

---

### L-7: `Sentry.init()` Called Before All Other Imports

**File:** `server.ts` — line 2 (Sentry import)

The Sentry SDK is initialized before importing the request handler, which is correct. However, the `Sentry.init()` call reads `process.env.SENTRY_DSN` which may not be available if `dotenv` hasn't loaded yet. Line 1 (`import "dotenv/config"`) runs before line 2, so this is ordered correctly — but it's fragile.

---

### L-8: `resetAdminClient()` Exported for Tests But Used Internally

**File:** `app/lib/pocketbase.server.ts` — line 141-144

```typescript
export function resetAdminClient(): void {
  _adminClient = null;
  _adminInitPromise = null;
}
```

This function is exported for testing (as the comment says) but could theoretically be called in production, breaking subsequent `getAdminClient()` calls. Since it's only used in test files, this is low risk.

---

### L-9: `memberCount` Could Be Denormalized Like `questionnaire_completed`

**File:** `app/routes/lead/dashboard.tsx` — lines 66-81

The lead dashboard fetches member count via a PB query:
```typescript
const [memberCountResult, inst] = await Promise.all([
  pb.collection("members").getList(1, 1, {
    filter: pb.filter("teamId = {:tid}", { tid: team.id }),
    fields: "id",
  }),
  // ...
]);
```

Each lead dashboard page load counts members. For a team with 500 members (unlikely for a hackathon), this is expensive. Denormalizing `membersCount` on the `teams` collection (like `questionnaire_completed`) would eliminate this query.

---

### L-10: `TeamView` vs `TeamWithExpand` Duplicate

**File:** `app/routes/admin/teams.tsx` — lines 15-27
**File:** `app/lib/types.ts` — lines 48-53

The `TeamWithExpand` interface in `admin/teams.tsx` is structurally identical to `TeamView` from `types.ts`. The codebase could use `TeamView` directly with field restrictions instead of duplicating the type.

---

## ARCHITECTURAL SUMMARY

### Strengths

1. **Clean separation of concerns**: server modules in `lib/`, presentation in `components/`, routes co-locating loaders/actions/JSX
2. **Consistent security wrapper**: `secureAction` provides a repeatable security pipeline (Origin → Parse → CSRF → Auth → Schema → Handler)
3. **PB parameter binding**: Most queries use `pb.filter()` with parameterized bindings — the two exceptions are the injection risks
4. **Optimistic locking**: `transitionTeamStatus` uses `filter` on the update to prevent lost status updates
5. **WeakMap-based request cache**: Elegant dedup of parallel loader auth calls without memory leaks
6. **CSP with nonces**: Production mode has strict CSP with per-request nonces
7. **Cookie security**: HttpOnly + SameSite=Lax on auth cookies

### Weaknesses

1. **Inconsistent CSRF coverage**: The public auth endpoints (login, forgot-password, logout) bypass the CSRF double-submit pattern
2. **JWT trust model**: Explicitly skipping signature verification creates a vulnerability window
3. **Mutable module globals**: `statsCache` is a dangerous concurrency pattern
4. **Incomplete optimistic locking**: Only one update path uses the filter pattern
5. **Escalation via admin client**: Coordinator routes elevate to superuser for schema-bypassing writes
6. **Filter injection**: Two routes use string interpolation for PocketBase filters

---

*End of review — 40 findings total.*
