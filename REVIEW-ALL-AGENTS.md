# VisionHack Submission Portal — Comprehensive Codebase Review

> **Generated:** 2026-06-22  
> **Reviewers:** 8 independent subagents across 2 model architectures  
> **Methodology:** Each agent read relevant files line-by-line across 6 focus areas (security, performance, architecture, redundancy/code-quality, database schema, frontend/UI, API/routes, auth/rules)

---

## EXECUTIVE SUMMARY

**Project scale:** ~24 users, ~7 teams, single-node PocketBase  
**Overall assessment:** Well-architected for a production SaaS, but substantially overbuilt for current scale. Strong security foundations with 7 critical/high findings that need attention. Performance is adequate but has scalability ceilings.

| Category | Total Findings | Critical | High | Medium | Low |
|----------|---------------|----------|------|--------|-----|
| Security — Auth & CSRF | 15 | 4 | 3 | 4 | 4 |
| Security — PB Rules | 5 | 3 | 1 | 1 | 0 |
| Performance | 19 | 6 | 4 | 6 | 3 |
| Architecture & Over-engineering | 18 | — | 3 | 8 | 7 |
| Redundancy & Code Quality | 40 | — | — | 6 categories | 6 categories |
| Database Schema | 18 | 0 | 4 | 5 | 9 |
| Frontend & UI | 15 | — | — | — | 10 action items |
| API Routes & Data Flow | 16 | 1 | 3 | 5 | 7 |
| **TOTAL** | **146** | **14** | **14** | **29** | **30+** |

---

## 🔴 CRITICAL FINDINGS (14)

### C1. admin/export.tsx — No Auth Check, Superuser Client, Undefined Variable
**Sources:** SecAuth, SecPB, Perf, ApiRoutes  
**Files:** `app/routes/admin/export.tsx:35-58`  
**Impact:** Any authenticated user (not just admin) can access the export page's data. The loader uses `getAdminClient()` directly without calling `requireRole()`. The `user` variable is returned but never defined (ReferenceError on access). The CSV endpoint IS properly gated — only the UI page is exposed.

```typescript
export async function loader({ request }: LoaderFunctionArgs) {
  const pb = await getAdminClient();  // No requireRole call!
  // ... loads ALL teams with expanded institution/leader info ...
  return { user, teams, memberCounts, totalMembers }; // user is undefined!
}
```

**Fix:** Add `const { user, pb } = await requireRole(request, ["admin"]);` as the first line of the loader.

---

### C2. Questionnaire Responses — Unauthenticated Read/Write via `?=` Null Bypass
**Sources:** SecPB  
**Files:** `scripts/setup-pb.ts:245-258`  
**Impact:** All questionnaire responses (PII including age, gender, education, skills, challenges, experience, etc.) are publicly readable and writable.

**Root cause:** `userId ?= @request.auth.id` evaluates to `true` when `@request.auth.id` is null/empty (unauthenticated). The `?=` operator returns true when either operand is null.

**Fix:** Wrap with `@request.auth.id != "" && (...)` guard:
```
listRule: '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "coordinator" || userId ?= @request.auth.id)'
```

---

### C3. Admin Client Deadlock on Auth Failure
**Sources:** SecAuth  
**Files:** `app/lib/pocketbase.server.ts:118-135`  
**Impact:** If `initAdminClient()` throws (network error, PB down), the rejected promise is cached permanently. Every subsequent call returns the same rejection. All admin-dependent operations fail until server restart.

**Fix:** Add `.catch()` that resets `_adminInitPromise`:
```typescript
_adminInitPromise = initAdminClient().then(
  (pb) => { _adminClient = pb; _adminInitPromise = null; return pb; },
  ()  => { _adminInitPromise = null; throw err; }
);
```

---

### C4. Login Action — No CSRF Token Validation
**Sources:** SecAuth  
**Files:** `app/routes/login.tsx:88-121`  
**Impact:** The login form doesn't include a CSRF token, and the action doesn't validate one. An attacker can CSRF-login a victim into their account.

**Same issue applies to:** `forgot-password.tsx:12-33` and `api/auth/logout.ts:6-20`

---

### C5. Plaintext Admin Credentials + HTTP Transit to PocketBase
**Sources:** SecAuth  
**Files:** `.env:3-5`  
**Impact:** Admin email and password are stored in plaintext on disk. The PocketBase connection uses HTTP (not HTTPS), exposing all credentials and data to network MITM.

**Fix:** Route PB through TLS-terminating reverse proxy. Rotate admin password after deploying HTTPS.

---

### C6. Team/Institution Institution-Role `?=` — Null institutionId Exposes All Teams
**Sources:** SecPB  
**Files:** `scripts/setup-pb.ts:194, 199, 224, 230`  
**Impact:** If an `institution`-role user has `institutionId: null`, the `?=` operator matches all records — exposing ALL teams/members to that user.

**Fix:** Add `@request.auth.institutionId != ""` guard:
```
'(@request.auth.institutionId != "" && institutionId ?= @request.auth.institutionId && @request.auth.role = "institution")'
```

---

### C7–C12. Performance (6 Critical)
**Sources:** Perf  
**Summary:**

| ID | Issue | File | Impact |
|----|-------|------|--------|
| CRIT-1 | Export loads ALL teams + members (double full-table scan) | `admin/export.tsx:38-48`, `api/export/csv.ts:42-61` | Thousands of records loaded twice independently |
| CRIT-2 | Admin dashboard `getFullList` on teams (unbounded) | `admin/dashboard.tsx:29-35` | For 5000 teams: 25 sequential HTTP requests |
| CRIT-3 | Coordinator 1000-row count scan + full institutions fetch | `coordinator/dashboard.tsx:76-149` | Runs on every page navigation, no caching |
| CRIT-4 | Stats cache has no invalidation mechanism | `login.tsx:30-31,53-61` | Stale counts for up to 60s, per-process singleton |
| CRIT-5 | Admin client singleton — no re-auth on 401, no connection pooling | `pocketbase.server.ts:80-135` | Single point of failure for all admin queries |
| CRIT-6 | Export route missing auth check (`user` undefined) | `admin/export.tsx:35-58` | Crashes before data return, but data is still fetched from PB first |

---

### C13–C14. Other Critical

| ID | Issue | Source | File |
|----|-------|--------|------|
| C13 | `status_transitions` audit log always fails silently (NO_RULES + user client) | SecPB | `team.server.ts:150`, `setup-pb.ts:1366-1374` |
| C14 | `getStr` returns `"null"` string for missing fields (`String(null)` → `"null"`) | ApiRoutes | `form.server.ts:26` |

---

## 🟠 HIGH FINDINGS (14)

### H1. Members DB Schema — 5 Text Fields Unbounded
**Sources:** DbSchema  
**Files:** `scripts/setup-pb.ts` members collection definition  
**Impact:** `fullName`, `email`, `phone`, `gender`, `role` have `max: null` — any length accepted. Form validation has limits but DB has no enforcement. Also: `gender` is free-text (inconsistent with questionnaire_responses which uses `select`), `(teamId, email)` has no UNIQUE index.

### H2. Coordinator Dashboard ErrorBoundary — Wrong Signature
**Sources:** ApiRoutes  
**Files:** `coordinator/dashboard.tsx:581-593`  
**Impact:** The ErrorBoundary receives `error` as a prop but RR7 provides it via `useRouteError()`. The error message will never display.

### H3. Logout Action — No CSRF Token Validation
**Sources:** ApiRoutes  
**Files:** `api/auth/logout.ts:6-20`  
**Impact:** The logout form sends a CSRF token but the server never validates it. An attacker could forge a logout POST.

### H4. CSRF Cookie Lacks `__Host-` Prefix
**Sources:** SecAuth  
**Files:** `csrf.server.ts:98-109`  
**Impact:** Without `__Host-` prefix, any subdomain of `mulearn.org` can read/set the CSRF cookie.

### H5. Auth Cookie TTL May Exceed JWT Expiry
**Sources:** SecAuth  
**Files:** `auth.server.ts:12, 204-210`  
**Impact:** Cookie Max-Age is 5 days but JWT may expire earlier (PB default: 72h). The refresh mechanism handles this, but stale cookie persists.

### H6. `secureAction` Misclassifies 403 as 401
**Sources:** ApiRoutes  
**Files:** `action.server.ts:122-123`  
**Impact:** When `requireRole` throws 403, the catch block's range check `300-399` catches it and returns 401 "Authentication required" instead of 403.

### H7. Institution Dashboard — Member Over-Fetching
**Sources:** Perf  
**Files:** `institution/dashboard.tsx:100-107`  
**Impact:** Fetches ALL fields of ALL members for ALL teams, even when no accordion is expanded. Serial dependency (teams → members).

### H8. Admin Teams — Count Scan Runs on Every Pagination
**Sources:** Perf  
**Files:** `admin/teams.tsx:60-72, 76`  
**Impact:** The 500-row count scan is re-fetched on every page navigation even though it doesn't depend on page number.

### H9. Coordinator Dashboard — Status Count Scan Redundancy
**Sources:** Perf  
**Files:** `coordinator/dashboard.tsx:134-149`, `admin/teams.tsx:60-72`  
**Impact:** Both the admin teams and coordinator dashboard independently scan teams for status counts. The scanned data largely overlaps with the paged data.

### H10. Login Stats Cache — Race Condition (Thundering Herd)
**Sources:** Perf  
**Files:** `login.tsx:30, 71-78`  
**Impact:** Between cache check and cache write, concurrent requests all see a miss and fetch fresh data simultaneously.

### H11. Over-Engineering: Auth WeakMap Cache
**Sources:** Arch  
**Files:** `auth.server.ts:26`  
**Impact:** Optimizes away ~5ms round-trips for a 24-user system. Premature optimization that adds cognitive cost.

### H12. Over-Engineering: CSRF Triple Layering
**Sources:** Arch  
**Files:** `csrf.server.ts`, `action.server.ts`  
**Impact:** SameSite=Lax + Origin validation + double-submit token — three layers of CSRF defense for a login-walled internal tool. Two would suffice.

### H13. `secureAction` Duplicated Handler Body + Dead Generic
**Sources:** Arch, CodeQual  
**Files:** `action.server.ts:87-186`  
**Impact:** The generic type parameter `C extends ActionContext` is never specialized. The schema/no-schema handler paths are nearly identical with duplicated error handling (2x console.error + Sentry).

### H14. `page-transition.tsx` — 19 Lines for a CSS Class
**Sources:** Arch  
**Files:** `components/shared/page-transition.tsx`  
**Impact:** A single-purpose component that adds `page-enter` class to a div. Could be inlined.

---

## 🟡 MEDIUM FINDINGS (29)

### Redundancy (from CodeQual)

| ID | Issue | Files |
|----|-------|-------|
| M1 | Duplicate status-counting loop (3 files) | `coordinator/dashboard.tsx:158-173`, `admin/teams.tsx:78-81`, `admin/dashboard.tsx:37-39` |
| M2 | Duplicate member+questionnaire fetch (3 branches in same file) | `teams.team-id.tsx:66-76, 102-112, 132-142` |
| M3 | Duplicate filter clause construction | `coordinator/dashboard.tsx:86-127`, `admin/teams.tsx:44-51` |
| M4 | Duplicate ErrorBoundary (6+ files) | All route files |
| M5 | Duplicate HydrateFallback (10+ files) | All route files |
| M6 | Duplicate button-with-spinner pattern (4+ places) | `login.tsx:315-332`, `institution/dashboard.tsx:412-429`, etc. |
| M7 | Duplicate form success/error banners (3+ files) | `register.tsx:405-415`, `submit-idea.tsx:345-355`, etc. |

### Code Quality (from CodeQual)

| ID | Issue | Files |
|----|-------|-------|
| M8 | Pervasive `any` in setup-pb.ts (excluded from biome) | `scripts/setup-pb.ts` |
| M9 | Non-uniform error response format (fail helper vs raw data()) | `login.tsx:96`, `forgot-password.tsx:19` |
| M10 | Swallowed promise chain on email errors | `teams.team-id.tsx:216` → `team.server.ts:181-212` → `email.server.ts:51-56` |
| M11 | Magic constants not shared: `COUNT_SCAN_CAP` (1000 vs 500), `PAGE_SIZE` (50 twice), `MAX_FILE_SIZE` (two formats) | Multiple files |
| M12 | Validation limit numbers hardcoded (name=100, phone=20, email=200, etc.) | `lead/register.tsx:121-152`, `lead/submit-idea.tsx:137-141` |

### Architecture (from Arch)

| ID | Issue | Files |
|----|-------|-------|
| M13 | `CsrfContext` exported from route file (circular dependency risk) | `dashboard-layout.tsx:77` |
| M14 | Dashboard layout does too much (11 concerns, ~439 lines) | `dashboard-layout.tsx` |
| M15 | 3 god-object files | `institution/dashboard.tsx` (792 lines), `lead/register.tsx` (766 lines), `setup-pb.ts` (1391 lines) |
| M16 | State machine split across `types.ts` and `team-status.ts` | `types.ts:96-153`, `team-status.ts` |
| M17 | `feature-flags.ts` duplicates PB config data | `lib/feature-flags.ts` (41 lines) |
| M18 | `schemas/` directory — 8 tiny files for trivial schemas | `lib/schemas/*.ts` |

### Database Schema (from DbSchema)

| ID | Issue | Collection |
|----|-------|-----------|
| M19 | No UNIQUE index on `teamCode` | `teams` |
| M20 | No UNIQUE index on `(teamId, userId)` | `questionnaire_responses` |
| M21 | `age` has `onlyInt: false` (allows decimals) | `questionnaire_responses` |
| M22 | `fromStatus`/`toStatus`/`role` are free-text in audit log | `status_transitions` |
| M23 | `config.value` is only boolean (not extensible) | `config` |
| M24 | Members collection migration is skipped for existing deployments | `scripts/setup-pb.ts:866-869` |

### API Routes (from ApiRoutes)

| ID | Issue | Files |
|----|-------|-------|
| M25 | `getAllStr` lacks trim/lower/max (inconsistent with `getStr`) | `form.server.ts:34-36` |
| M26 | `secureAction` 403→401 mapping bug | `action.server.ts:122-123` |
| M27 | `forgotPasswordSchema` exists but unused (dead code) | `schemas/auth.ts:8-10` |
| M28 | No per-route ErrorBoundary on 6 admin/lead routes | Various admin routes |
| M29 | No HydrateFallback on 3 routes | `admin/export.tsx`, `admin/campus-leads.tsx`, `teams.team-id.tsx` |

---

## 🔵 LOW FINDINGS (Selected)

| ID | Issue | Source |
|----|-------|--------|
| L1 | `validateOrigin` silently accepts missing Origin header | SecAuth |
| L2 | No app-layer rate limiting on login/actions | SecAuth |
| L3 | Auth cookie Secure flag uses PB URL instead of app URL | SecAuth |
| L4 | `requireRole` imported but unused in export.tsx (dead code) | SecAuth |
| L5 | Config public read limits future flexibility | SecPB |
| L6 | Debounce timer not cleared on unmount (admin/teams, coordinator/dashboard) | Perf |
| L7 | No Cache-Control headers on SSR responses | Perf |
| L8 | `FilterableTeamList` — redundant `useMemo` | Perf |
| L9 | `DataList` mapping creates new object array every render | Perf |
| L10 | `canTransitionTo` re-export alias unused (dead code) | CodeQual |
| L11 | Cookie name `csrf_token` not extracted to constant (3 places) | CodeQual |
| L12 | Dead collections: `team_drafts`, `email_outbox`, `email_queue` | DbSchema |
| L13 | Institution accordion missing `role="region"` + `aria-labelledby` | Frontend |
| L14 | FilterableTeamList search input missing visible label | Frontend |
| L15 | Form fields remain editable during submission | Frontend |
| L16 | Admin config — optimistic toast without error recovery | Frontend |
| L17 | Admin teams — no loading indicator during page navigation | Frontend |
| L18 | Inline success banners + toasts fire simultaneously (double notification) | Frontend |
| L19 | Home route component returns `null` (blank page if loader doesn't redirect) | ApiRoutes |
| L20 | `getConfig` called in 7+ places with no request-level caching | ApiRoutes |
| L21 | CSRF cookie Max-Age (1hr) may expire on long-idle forms | ApiRoutes |

---

## ✅ DEFENSE-IN-DEPTH — What's Done Well

### Authentication & Authorization
- **Cookie-based JWT** with HttpOnly + Secure + SameSite=Lax flags
- **`secureAction` wrapper** ensures every action handler gets auth + CSRF + error handling
- **`requireRole` + `requireAuth`** — consistent pattern across all loaders
- **WeakMap auth cache** deduplicates parallel `authRefresh()` calls
- **Token rotation** handled automatically near expiry
- **User collection update rule** prevents self-role-escalation (`@request.body.role:isset = false`)

### PocketBase API Rules
- **All collections start with NO_RULES** (superuser-only) before role-scoped rules are applied
- **Rate limiting** configured: login (10/min), creates (30/min), file proxy (10/min), general (300/min)
- **Institutions API** uses user's own token, not admin client
- **CSV export** properly gated (requireAuthJson + admin role check)
- **File proxy** — collection whitelist, path traversal prevention, ID format validation, ownership re-check
- **Optimistic locking** on status transitions (`filter` parameter on PB update)

### Frontend
- **No flash of wrong theme** — inline script applies dark class before first paint
- **`prefers-reduced-motion`** fully respected
- **Proper ARIA** — `aria-invalid`, `aria-describedby`, `role="alert"`, `role="tab"`, `role="progressbar"`
- **Skip-to-main link** in dashboard layout
- **Responsive** — safe area insets, dynamic viewport units, container queries
- **Magic byte validation** on file uploads (PDF/PPT signature verification)

### Database Schema
- **Unique index** on institution code ✅
- **Proper cascadeDelete** on team-related child records
- **Denormalized `questionnaire_completed`** with documented reasoning
- **Status state machine** — 7 states with valid transitions prevents invalid state changes
- **Audit log** (status_transitions) — even if currently broken, the schema exists

---

## TOP 10 FIXES (Priority Order)

| # | Severity | Fix | Effort |
|---|----------|-----|--------|
| 1 | 🔴 C2 | Add `@request.auth.id != ""` guard to questionnaire_responses rules | 5 min |
| 2 | 🔴 C6 | Add `@request.auth.institutionId != ""` guard to teams/members institution rules | 5 min |
| 3 | 🔴 C1 | Add `requireRole(request, ["admin"])` to admin/export.tsx loader | 5 min |
| 4 | 🔴 C4 | Add CSRF token to login form and validate in action | 30 min |
| 5 | 🔴 C3 | Fix admin client deadlock with `.catch()` reset | 5 min |
| 6 | 🔴 C13 | Either use `getAdminClient()` for audit log or add create rule to status_transitions | 10 min |
| 7 | 🟠 H1 | Add max lengths + UNIQUE indexes to members collection schema | 15 min |
| 8 | 🔴 C7 | Cap admin dashboard team scan, add member count fields limit | 20 min |
| 9 | 🔴 C5 | Deploy TLS for PocketBase connection, rotate admin password | 1 hr ops |
| 10 | 🟠 H2 | Fix coordinator ErrorBoundary to use `useRouteError()` | 5 min |

---

## AGENT REVIEW SUMMARY

| Agent | Focus | Files Read | Findings | Report |
|-------|-------|-----------|----------|--------|
| SecAuth | Auth, Tokens, CSRF, Roles | 12+ | 15 (4C, 3H, 4M, 4L) | Written |
| SecPB | PB Rules & Data Access | 10+ | 5 (3C, 1H, 1M) | Written |
| Perf | Performance | 14+ | 19 (6C, 4H, 6M, 3L) | Written |
| Arch | Architecture & Over-engineering | 25+ | 18 findings | Written |
| CodeQual | Redundancy & Code Quality | 40+ | 40 findings in 12 categories | Written |
| DbSchema | Database Schema & Design | 8+ | 18 (4H, 5M, 9L) | Written |
| Frontend | Frontend & UI | 20+ | 15 findings (10 action items) | Written |
| ApiRoutes | API Routes & Data Flow | 28+ | 16 (1H, 3H, 5M, 7L) | Written |
