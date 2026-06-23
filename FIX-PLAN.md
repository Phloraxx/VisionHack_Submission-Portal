# Comprehensive Fix Plan — VisionHack Submission Portal

> **Source:** Cross-referenced review of 16 independent agents (8 DeepSeek, 8 Mimo).  
> **Consensus:** 13 critical, 20 high, ~30 medium/low findings.  
> **Order:** By severity × confidence. **Phase 1** = fix now (~2-3 hrs), **Phase 2** = this sprint (~1 day), **Phase 3** = tech debt / polish.

---

## PHASE 1 — IMMEDIATE (Stop the bleeding)

### 1.1 Rotate admin credentials + remove from repo (C1) 🚨 16/16

**What:**
- `.env` and `.dev.vars` contain production PB admin creds `REDACTED_EMAIL` / `REDACTED_CREDENTIAL`
- Creds transit over **plain HTTP** (sslip.io has no TLS on port 80)
- `POCKETBASE_SUPER_TOKEN` was already removed in earlier fix — but the email/password pair is equally dangerous

**Files:** `.env`, `.dev.vars`, git history (entirely)

**Steps:**
1. **Immediately rotate PB admin password** via PocketBase Admin UI → Settings → Admins → change password
2. `git rm --cached .env .dev.vars`
3. Add both to `.gitignore` (verify they're listed)
4. Update `.env.example` to use placeholder values only
5. Optionally scrub git history: `git filter-repo` (use `--invert-paths`)
6. Add [POCKETBASE_ADMIN_EMAIL/ADMIN_PASSWORD] to GitHub Actions secrets / deploy platform secrets

**Effort:** 30 min ops + git history rewrite (longer if history needs preserving)

---

### 1.2 Add CSRF token validation to login action (C2) 🚨 16/16

**What:** Login action calls `validateOrigin()` but NEVER validates the double-submit CSRF token. Login page isn't behind dashboard-layout, so no CSRF cookie is set.

**Files:** `app/routes/login.tsx` (loader + action)

**Loader fix — set CSRF cookie:**
```ts
// In login.tsx loader, before returning
import { generateCsrfToken, setCsrfCookie } from "~/lib/csrf.server";

// Generate CSRF token and set cookie (same pattern as dashboard-layout.tsx)
const csrfToken = generateCsrfToken();
const headers = new Headers();
headers.append("Set-Cookie", setCsrfCookie(csrfToken));
return { teamCount, institutionCount, ..., csrfToken, headers };
// Return data with headers
return data({ ... }, { headers });
```

**Action fix — validate CSRF:**
```ts
// In login.tsx action, after validateOrigin
import { validateCsrfToken } from "~/lib/csrf.server";
validateCsrfToken(request, formData);
```

**Form fix — send CSRF token:**
```tsx
// In login.tsx JSX, add hidden input inside <Form>
<input type="hidden" name="csrf_token" value={loaderData.csrfToken} />
```

**Effort:** 20 min

---

### 1.3 Add CSRF validation to logout action (C14) 🚨 15/16

**What:** `/api/auth/logout` already has `<input type="hidden" name="csrf_token" value={csrfToken} />` in the form, but the server NEVER reads/validates it.

**Files:** `app/routes/api/auth/logout.ts`

**Fix:**
```ts
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  validateOrigin(request);

  const formData = await request.formData();
  validateCsrfToken(request, formData); // ← ADD THIS

  const cookie = clearAuthCookie();
  throw redirect("/login", { headers: { "Set-Cookie": cookie } });
}
```

**Effort:** 5 min

---

### 1.4 Fix PB filter injection — use parameterized bindings (C3) 🚨 14/16

**What:** `admin/teams.tsx:50` and `coordinator/dashboard.tsx:91,125` interpolate raw URL params into PB filter strings. `status` parameter unsanitized; `institution` parameter unsanitized.

**Files:** `app/routes/admin/teams.tsx`, `app/routes/coordinator/dashboard.tsx`

**Fix — admin/teams.tsx line 49-51:**
```ts
// BEFORE
if (status && status !== "all") {
  clauses.push(`status = "${status}"`);
}

// AFTER
const VALID_STATUSES = ["invited", "registered", "submitted", "shortlisted", "selected", "rejected", "withdrawn"];
if (status && status !== "all" && VALID_STATUSES.includes(status)) {
  clauses.push(pb.filter("status = {:status}", { status }));
}
```

**Fix — coordinator/dashboard.tsx lines 91, 125:**
```ts
// Line 91 — validate status
if (status && status !== "all" && VALID_STATUSES.includes(status)) {
  teamClauses.push(pb.filter("status = {:status}", { status }));
}

// Line 125 — use parameterized binding for institution
if (institution && institution !== "all") {
  teamClauses.push(pb.filter("institutionId = {:id}", { id: institution }));
}
```

**Effort:** 20 min

---

### 1.5 Fix statsCache race condition (C4) 🚨 14/16

**What:** `statsCache` is a module-level mutable global. Concurrent requests see stale/mixed data. No LFU/LRU eviction.

**Files:** `app/routes/login.tsx`

**Fix — promise-based dedup pattern (same as `getAdminClient()` in pocketbase.server.ts):**
```ts
let statsCache: LoginStats | null = null;
let statsPromise: Promise<LoginStats> | null = null; // ← ADD
const STATS_TTL_MS = 60_000;

// In loader body:
const now = Date.now();
if (statsCache && now - statsCache.cachedAt < STATS_TTL_MS) {
  return { ...statsCache, csrfToken };
}

// Deduplicate concurrent cache-miss requests
if (!statsPromise) {
  statsPromise = (async () => {
    const [cfg, adminPb] = await Promise.all([getConfig(createPocketBaseClient()), getAdminClient()]);
    const [teams, institutions] = await Promise.all([
      adminPb.collection("teams").getList(1, 1, { fields: "id" }),
      adminPb.collection("institutions").getList(1, 1, { fields: "id" }),
    ]);
    const result = { teamCount: teams.totalItems, institutionCount: institutions.totalItems, ... };
    statsCache = result;
    statsPromise = null;
    return result;
  })();
}
const stats = await statsPromise;
```

**Effort:** 15 min

---

### 1.6 Remove coordinator `getAdminClient()` escalation (C5) 🚨 13/16

**What:** `teams.team-id.tsx:174` gives coordinator a superuser admin client when PB updateRule doesn't permit coordinator writes. This bypasses PB access control entirely.

**Files:** `app/routes/teams.team-id.tsx`, `scripts/setup-pb.ts` (TEAMS_RULES)

**Fix — Two changes needed:**

**A) Update PB rules** to allow coordinator status transitions:
```ts
// In scripts/setup-pb.ts TEAMS_RULES.updateRule:
updateRule:
  '@request.auth.role = "admin" || ' +
  '@request.auth.role = "coordinator" || ' +           // ← ADD
  '@request.auth.role = "institution" || ' +
  '(leaderUserId ?= @request.auth.id && @request.auth.role = "lead")',
```

**B) Remove admin client fallback in teams.team-id.tsx:**
```ts
// BEFORE (line ~174)
const actionPb = user.role === "coordinator"
  ? await getAdminClient()
  : pb;

// AFTER — always use the user's own authenticated client
const actionPb = pb;
```

**C) Re-run setup-pb.ts** to apply rule changes to live PB.

**Effort:** 1 hr (mostly rule testing)

---

### 1.7 Fix Cookie Secure flag (C6) 🚨 12/16

**What:** `setCsrfCookie` derives `Secure` from `POCKETBASE_URL.startsWith("https")` instead of checking whether the app itself is served over HTTPS.

**Files:** `app/lib/csrf.server.ts` (setCsrfCookie function)

**Fix:**
```ts
export function setCsrfCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production"; // ← ALWAYS Secure in prod
  return [
    `csrf_token=${token}`,
    ...(secure ? ["Secure"] : []),
    "SameSite=Lax",
    "Path=/",
    "Max-Age=3600",
  ].join("; ");
}
```

Similarly fix `setAuthCookie` in `auth.server.ts` if it has same issue.

**Effort:** 5 min

---

### 1.8 Add CSRF + rate limiting to forgot-password (C7) 🚨 12/16

**What:** `forgot-password.tsx` validates Origin only. No CSRF. No app-level rate limiting.

**Files:** `app/routes/forgot-password.tsx`

**Fix — same pattern as login:**
```ts
// In action:
import { validateOrigin, validateCsrfToken, generateCsrfToken, setCsrfCookie } from "~/lib/csrf.server";

validateOrigin(request);
const formData = await request.formData();
validateCsrfToken(request, formData); // ← ADD
```

**Effort:** 20 min

---

### 1.9 Fix admin/export.tsx loader — add requireRole (C9) 🚨 11/16

**What:** `admin/export.tsx:36` uses `getAdminClient()` directly. If the layout's role check ever regresses, this route has no defense.

**Files:** `app/routes/admin/export.tsx`

**Fix:**
```ts
// BEFORE
export async function loader({ request }: LoaderFunctionArgs) {
  const pb = await getAdminClient();
  ...

// AFTER
export async function loader({ request }: LoaderFunctionArgs) {
  const { pb } = await requireRole(request, ["admin"]);
  ...
```

**Effort:** 5 min

---

## PHASE 2 — SPRINT (Solidify)

### 2.1 Call `ensureRateLimiting()` in main() (C10) 10/16

**What:** Function exists in `scripts/setup-pb.ts` but is never called from `main()`.

**File:** `scripts/setup-pb.ts`

**Fix — add to main() before the final log:**
```ts
// In main(), before the "Setup complete" log
await ensureRateLimiting(token);
```

**Effort:** 2 min

---

### 2.2 Add app-level rate limiting on login (C11) 10/16

**What:** PB's built-in rate limiting (`*:auth`, 10/min) helps, but the app needs per-IP + per-account limiting at the application layer.

**Files:** Create `app/lib/rate-limiter.server.ts` OR add inline to `login.tsx`

**Implementation sketch:**
```ts
// app/lib/rate-limiter.server.ts
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxAttempts = 5, windowMs = 60_000): void {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry && now < entry.resetAt) {
    if (entry.count >= maxAttempts) {
      throw new Response("Too many attempts. Try again later.", { status: 429 });
    }
    entry.count++;
  } else {
    loginAttempts.set(key, { count: 1, resetAt: now + windowMs });
  }
}
```

Use in login action:
```ts
checkRateLimit(ip);        // per-IP
checkRateLimit(email, 3);  // per-account, stricter
```

**Effort:** 30 min

---

### 2.3 Fix `toStatus` cast without validation (H2) 9/16

**What:** `coordinator/dashboard.tsx` and `admin/teams.tsx` cast URL params directly to `TeamStatus` type without runtime validation. A random string passes compile-time.

**Files:** `app/routes/admin/teams.tsx`, `app/routes/coordinator/dashboard.tsx`

**Fix:** Create a type guard or Zod enum:
```ts
const TEAM_STATUSES = ["invited", "registered", "submitted", "shortlisted", "selected", "rejected", "withdrawn"] as const;
type TeamStatus = typeof TEAM_STATUSES[number];

function parseTeamStatus(s: string): TeamStatus | null {
  return TEAM_STATUSES.includes(s as TeamStatus) ? (s as TeamStatus) : null;
}
```

**Effort:** 10 min

---

### 2.4 Fix `validateOrigin` — reject missing Origin when no CSRF present (H3) 7/16

**What:** `validateOrigin()` silently returns when `Origin` header is missing, relying on CSRF double-submit. But login/forgot-password don't validate CSRF tokens, so missing Origin = no CSRF protection.

**File:** `app/lib/csrf.server.ts`

**Fix — add optional enforce flag:**
```ts
export function validateOrigin(request: Request, requireOrigin = false): void {
  const origin = request.headers.get("Origin");
  if (!origin) {
    if (requireOrigin) {
      throw new Response("Missing Origin header", { status: 403 });
    }
    return; // CSRF token covers this case when used
  }
  // ... existing validation
}
```

Use in login/forgot-password: `validateOrigin(request, true)`

**Effort:** 10 min

---

### 2.5 Fix `server.ts` error handler placement (H1) 8/16

**What:** `process.on("uncaughtException")` and `process.on("unhandledRejection")` are registered *inside* `server.listen()` callback. If the server fails to bind (port in use, permissions), handlers never fire.

**File:** `server.ts`
```ts
// BEFORE — wrong:
server.listen(port, () => {
  process.on("uncaughtException", ...); // Too late!
  ...
});

// AFTER — move to module scope, before server.listen:
process.on("uncaughtException", (err) => {
  Sentry.captureException(err);
});
process.on("unhandledRejection", (reason) => {
  Sentry.captureException(reason);
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
```

**Effort:** 5 min

---

### 2.6 Fix `getStr()` edge case — `String(null)` → `"null"` (H4) 7/16

**File:** `app/lib/form.server.ts` (the `getStr` function)

**Fix:** Verify the null-coalescing guard `?? ""` is present:
```ts
export function getStr(formData: FormData, key: string): string {
  return String(formData.get(key) ?? ""); // ← keep the ?? ""
}
```

Also audit all callers.

**Effort:** 5 min

---

### 2.7 Fix `secureAction` 403→401 misclassification (H5) 6/16

**What:** When `requireRole` fails, the error is `403 Forbidden` but the semantics are "not authorized for this role." Should be 401 when unauthenticated, 403 when wrong role.

**File:** `app/lib/action.server.ts` (inside `secureAction`)

**Fix:** Distinguish auth vs role failure in `requireRole`, or change `secureAction` to throw 403 directly:
```ts
// In secureAction's catch or the requireRole call handling
try {
  const { user, pb } = await requireRole(request, options.roles);
} catch (err) {
  if (err instanceof Response && err.status === 401) {
    // Already correct — no auth at all
    throw err;
  }
  // Role mismatch — should be 403, not 401
  throw new Response("Insufficient permissions", { status: 403 });
}
```

**Effort:** 15 min

---

### 2.8 Fix `escapeHtml` — add backtick escaping (H6) 6/16

**File:** `app/lib/utils.ts`

**Fix:**
```ts
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/`/g, "&#96;");  // ← ADD
}
```

**Effort:** 2 min

---

### 2.9 Validate email format in login schema (H7) 6/16

**File:** `app/routes/login.tsx` action

**Fix:** Add basic email validation:
```ts
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!email || !emailRegex.test(email)) {
  return data({ error: "Valid email is required." }, { status: 400 });
}
```

**Effort:** 5 min

---

### 2.10 Audit questionnaire rules — add `@request.auth.id != ""` guard (C13) 5/16

**What:** `QUESTIONNAIRE_RULES` uses `userId ?= @request.auth.id` pattern. If `@request.auth` is null (unauthenticated), `?=` matches `null ?= null` = TRUE. Every filter-bound `?=` rule should be prefixed with `@request.auth.id != "" &&`.

**File:** `scripts/setup-pb.ts` (QUESTIONNAIRE_RULES)

**Fix:**
```ts
const QUESTIONNAIRE_RULES = {
  listRule:
    '@request.auth.id != "" && (' +
    '@request.auth.role = "admin" || ' +
    '@request.auth.role = "coordinator" || ' +
    'userId ?= @request.auth.id)',
  viewRule:
    '@request.auth.id != "" && (' +
    '@request.auth.role = "admin" || ' +
    '@request.auth.role = "coordinator" || ' +
    'userId ?= @request.auth.id)',
  createRule:
    '@request.auth.id != "" && (' +
    'userId ?= @request.auth.id || @request.auth.role = "admin")',
  updateRule:
    '@request.auth.id != "" && (' +
    'userId ?= @request.auth.id || @request.auth.role = "admin")',
  deleteRule: '@request.auth.role = "admin"',
};
```

**Also check** `teams` rules — they already use this pattern in members rules but need checking on teams rules too.

**Effort:** 10 min + re-run setup script

---

### 2.11 Magic bytes — read more bytes, block non-PPTX ZIPs (H11, H12) 5/16 & 4/16

**File:** `app/routes/lead/submit-idea.tsx`

**Fix A — read first 16+ bytes instead of 8:**
```ts
const buffer = await file.slice(0, 16).arrayBuffer(); // ← increase from 8
```

**Fix B — validate PPTX more specifically:**
For PPTX (ZIP-based), check for the `[Content_Types].xml` signature. Either:
- Accept OLE2 only (old PPT, stricter), OR
- Re-verify by testing that bytes 30+ contain `[Content_Types].xml`

Simpler approach — just validate the specific OLE2 magic bytes for PPT and reject ZIP-based PPTX unless you can do a deeper check. Or drop PPT entirely and only accept PDF.

**Effort:** 20 min

---

### 2.12 Add `$autoCancel: false` to transitionTeamStatus (H17) 4/16

**What:** `team.server.ts:141-144` calls `pb.collection("teams").update()` without `$autoCancel: false`. If another PB request is in-flight on the same client, this update gets auto-cancelled.

**File:** `app/lib/team.server.ts`

**Fix:**
```ts
await pb.collection("teams").update(teamId, {
  status: to,
  status_changed_at: new Date().toISOString(),
}, {
  filter: pb.filter("status = {:expected}", { expected: team.status }),
  $autoCancel: false,  // ← ADD
});
```

**Effort:** 2 min

---

### 2.13 Add getFullList pagination caps (C12) 10/16

**What:** `admin/dashboard.tsx`, `admin/export.tsx`, `api/export/csv`, `institution/dashboard.tsx`, `lead/register.tsx` call `getFullList()` without limits.

**Files:** Multiple routes (see report)

**Fix pattern** — use `getList()` bounded:
```ts
const MAX_PAGE_SIZE = 500;
const capped = await pb.collection("teams").getList(1, MAX_PAGE_SIZE, { ... });
// If more exist, log warning
if (capped.totalItems > MAX_PAGE_SIZE) {
  console.warn(`[teams] More than ${MAX_PAGE_SIZE} items — pagination needed`);
}
```

**Effort:** 45 min (across 5+ routes)

---

### 2.14 Add `Content-Length` to file proxy (H20) 2/16

**File:** `app/routes/api/files.ts`

**Fix:** Forward `Content-Length` from upstream response:
```ts
const cl = response.headers.get("Content-Length");
if (cl) headers.set("Content-Length", cl);
```

**Effort:** 5 min

---

### 2.15 SendStatusChangeEmail `.catch(() => {})` swallows errors (mentioned in report) 6/16

**File:** `app/lib/team.server.ts` (caller of `sendStatusChangeEmail`)

**Fix:** At minimum, log the error:
```ts
sendStatusChangeEmail(...).catch(err => console.error("[email] Status change email failed:", err));
```

If already logged inside the function, just ensure the `.catch()` isn't bare `() => {}`.

**Effort:** 5 min

---

## PHASE 3 — TECHNICAL DEBT / POLISH

### 3.1 JWT signature verification (C8) 12/16

**What:** `jwt.server.ts` decodes JWT without verifying signature. Comment says "forged token requires compromised server" — correct for current architecture. **BUT** if PB secret key leaks or the app is ever deployed behind a reverse proxy that modifies cookies/headers, this collapses silently.

**File:** `app/lib/jwt.server.ts`, `app/lib/auth.server.ts`

**Fix options (choose one):**
1. **Lightweight:** Keep current approach but `authRefresh()` on every request instead of just expiry-near (adds latency but verifies token)
2. **Better:** Use `jsonwebtoken` library to verify HMAC signature using PB's JWT secret (must expose PB secret in env)
3. **Good enough:** Document the trust boundary clearly and add a check in a future sprint

**Recommendation:** Do (1) for now — it's what `resolveAuth` already does partially. Remove the "no verify" shortcut entirely.

**Effort:** 1-2 hrs

---

### 3.2 Remove dead `secureAction` generic param (H13) 4/16

**File:** `app/lib/action.server.ts`

**Fix:** Remove unused `C extends ActionContext` generic from `secureAction`:
```ts
// BEFORE
export function secureAction<C extends ActionContext = ActionContext>(...)

// AFTER
export function secureAction(options: ..., handler: Handler) // simpler
```

**Effort:** 15 min (and update all callers — but they never specialize it)

---

### 3.3 `Object.fromEntries(formData)` destroys File objects (H14) 3/16

**File:** Any route handler using `Object.fromEntries(formData)` before Zod validation

**Fix:** Use `formData.get(name)` for file fields, or don't convert FormData to an object before file handling.

**Effort:** 30 min (audit + fix)

---

### 3.4 Fix `useActionToast` effect firing on every render (H15) 2/16

**File:** `app/hooks/use-action-toast.ts`

**Fix:**
```ts
const prevRef = useRef(actionData);
useEffect(() => {
  if (actionData && actionData !== prevRef.current) {
    // show toast
    prevRef.current = actionData;
  }
}, [actionData]);
```

**Effort:** 10 min

---

### 3.5 Fix `home.tsx` redirect loop edge case (mentioned by Mimo2) 2/16

**File:** `app/routes/home.tsx`

**Fix:** If `ROLE_DASHBOARD_MAP[user.role]` is undefined, show an error page instead of redirecting to `/login` (which would loop):
```ts
const target = ROLE_DASHBOARD_MAP[user.role as keyof typeof ROLE_DASHBOARD_MAP];
if (!target) {
  throw new Response("No dashboard configured for your role", { status: 403 });
}
throw redirect(target);
```

**Effort:** 5 min

---

### 3.6 Duplicate ErrorBoundary/HydrateFallback across routes (H18) 4/16

**Audit** all route files for redundant `ErrorBoundary` / `HydrateFallback` exports. The root `root.tsx` provides these; child routes only need them if they want custom error UIs.

**Effort:** 15 min

---

### 3.7 Config collection public read — document as intentional (H8) 6/16

**File:** `scripts/setup-pb.ts` (CONFIG_RULES)

**Current state:** `listRule: ""` (public read). This is intentional for login page stats.

**Fix:** Add a comment explaining why + the risk:
```ts
// Config is publicly readable (listRule: "") because the login page shows
// event phase flags (registration_open, submission_open) without auth.
// If sensitive values are added to this collection, they MUST be moved
// to a separate collection with role-scoped rules.
const CONFIG_RULES = { ... };
```

**Effort:** 2 min

---

### 3.8 Add backtick escaping to `escapeHtml` (H6) — already listed above

---

### 3.9 Members collection constraints (H9) 5/16

**File:** `scripts/setup-pb.ts` (ensureMembersCollection)

**Fix:** Add `maxLength` constraints to text fields (name, email, phone) to prevent storage abuse:
```ts
{ name: "name", type: "text", required: true, maxLength: 200 },
{ name: "email", type: "email", required: true, maxLength: 320 },
{ name: "phone", type: "text", required: false, maxLength: 20 },
```

**Effort:** 15 min + re-run setup script

---

### 3.10 Standardize field naming (snake_case vs camelCase) (Mimo finding) 3/16

**Current:** PB schema uses `snake_case`; TypeScript types use `camelCase`; form fields mix both.

**Fix:** Pick one convention. Recommend keeping PB as `snake_case` (it can't change without migration) and aligning app code.

**Effort:** 2-4 hrs (across all files — not urgent)

---

### 3.11 Remove deprecated `initEnv()`/`resetEnv()` dead code (L1 from Mimo2)

**File:** `app/lib/env.server.ts`

**Fix:** Remove the no-op functions and audit imports.

**Effort:** 10 min

---

### 3.12 Remove `dotenv` dependency (L5 from Mimo2)

**File:** `package.json`, `server.ts`

**Node 20+** has native `--env-file` support. `dotenv` is redundant.

**Fix:** Remove `dotenv` from dependencies, remove `import "dotenv/config"`, rely on `--env-file` flag in start script.

**Effort:** 10 min

---

### 3.13 Test coverage for security-critical modules (L12 from Mimo2)

**Missing tests:**
- `secureAction` wrapper (the most critical security layer) — untested
- `form.server.ts` helpers — untested
- `config.server.ts` — untested
- `pocketbase.server.ts` admin client — untested
- All route loaders/actions — no integration tests

**Effort:** 1-2 days (spin up test PB instance)

---

### 3.14 `console.error` leaks full errors in production (L13 from Mimo2)

**File:** `app/lib/action.server.ts:149,176`

**Fix:** Use structured logging. Redact request body in production:
```ts
const safeErr = process.env.NODE_ENV === "production" 
  ? { message: err.message, name: err.name } 
  : err;
console.error("[secureAction]", safeErr);
```

**Effort:** 10 min

---

## DEPLOYMENT CHECKLIST

After applying all above fixes:

- [ ] Credentials rotated, `.env` removed from git, `.gitignore` confirmed
- [ ] CSRF validated on ALL forms (login, forgot-password, logout, all authenticated actions)
- [ ] PB filter injection eliminated — parameterized bindings everywhere
- [ ] All `getFullList()` calls bounded
- [ ] `ensureRateLimiting()` called from `main()`
- [ ] App-level rate limiter added to login
- [ ] `server.ts` error handlers placed correctly
- [ ] `validateOrigin` requires Origin on unprotected endpoints
- [ ] Questionnaire rules have `@request.auth.id != ""` guard
- [ ] `setCsrfCookie` Secure flag uses `NODE_ENV`
- [ ] Coordinator `getAdminClient()` removed, PB updateRule updated
- [ ] Re-run `scripts/setup-pb.ts` to push all rule changes
- [ ] Add basic unit tests for security modules

## EFFORT TOTALS

| Phase | Items | Est. Time |
|-------|-------|-----------|
| **Phase 1 — Critical** | 1.1–1.9 (9 items) | ~2-3 hours |
| **Phase 2 — Sprint** | 2.1–2.15 (15 items) | ~4-6 hours |
| **Phase 3 — Tech debt** | 3.1–3.14 (14 items) | ~2-3 days |
| **Total** | **~38 items** | **~3 days** |

Recommended order: **Phase 1 → Phase 2 → Phase 3**, with credentials rotation (1.1) being the absolute first action before any code change.
