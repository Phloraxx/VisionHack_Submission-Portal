# VisionHack Submission Portal v2 — Full Codebase Audit

**Date:** 2026-06-23  
**Scope:** Every file in `app/`, `server.ts`, and supporting infrastructure  
**Agents:** 8 parallel reviewers covering entry/root, auth/security, server/network, admin routes, public/team routes, shared components, lib utilities, and UI/hooks/APIs  
**Total Findings:** ~180

---

## Severity Legend

| Level | Count | Meaning |
|-------|-------|---------|
| 🔴 Critical | ~12 | Exploitable vulnerability, data loss, or crash |
| 🟠 Major | ~45 | Significant security gap, performance bottleneck, or maintainability liability |
| 🟡 Minor | ~80 | Best-practice violation, style inconsistency, or low-impact concern |
| 🔵 Info | ~43 | Observation, suggestion, or future concern |

---

## 1. Security Findings

### 🔴 1.1 Nonce Generated But Never Used in CSP

**Files:** `app/entry.server.tsx:14-17`, `app/root.tsx:40`  
**Agent:** Audit1-Entry

A random `nonce` is generated per-request and passed to `<ServerRouter>`, but the CSP header uses `'unsafe-inline'` for script-src. The nonce is only passed to React Router's internal `StreamTransfer` component, NOT to `<Scripts />` in root.tsx (which is called with no props). The inline theme script in root.tsx also lacks a nonce attribute.

**Impact:** The nonce generation is wasted compute. Any XSS vulnerability allows arbitrary script execution because `'unsafe-inline'` permits all inline scripts.

**Fix:** Wire nonce through FrameworkContext to `<Scripts />`, add nonce to the theme script and the custom patch script, then replace `'unsafe-inline'` with `'nonce-${nonce}'` in the CSP.

---

### 🔴 1.2 CSP Uses `'unsafe-inline'` — No Script Restriction

**File:** `app/entry.server.tsx:99`  
**Agent:** Audit1-Entry

`script-src 'self' 'unsafe-inline'` allows every inline script to execute. Combined with finding 1.1, the entire CSP script-src directive provides no protection against XSS.

---

### 🔴 1.3 Email Subject Header Injection in `sendStatusChangeEmail`

**File:** `app/lib/team.server.ts:202`  
**Agent:** Audit7-Lib

`sendStatusChangeEmail` interpolates `args.teamName` directly into the email subject without sanitizing CRLF characters. If teamName contains `\r\n`, this enables email header injection (adding BCC headers, redirecting emails).

**Fix:** Strip CRLF characters: `.replace(/[\r\n]/g, '')`.

---

### 🔴 1.4 File Validation Depends on Client-Controlled MIME Type

**File:** `app/lib/file-validation.server.ts:35-46`  
**Agent:** Audit7-Lib

`validateFileSignature` branches on `file.type` and `file.name`, both client-supplied and trivially spoofable. A malicious user can set `file.type` to `'application/vnd.ms-powerpoint'` on any file to enter the PPT validation branch.

**Fix:** Check all magic-byte signatures against the raw bytes regardless of stated MIME type.

---

### 🔴 1.5 Logout Endpoint Missing CSRF Token Validation

**File:** `app/routes/api/auth/logout.ts:6-21`  
**Agent:** Audit8-UI

The logout action calls `validateOrigin(request, true)` but never validates the CSRF token. The dashboard form includes a hidden `csrf_token` field, but the server ignores it entirely. The `validateOrigin` check can be bypassed when the Origin header is omitted.

**Impact:** Attacker can force-logout any authenticated user via cross-origin POST, enabling session persistence attacks.

**Fix:** Parse formData and validate CSRF token before clearing the cookie.

---

### 🔴 1.6 `configUpdateSchema` Does Not Whitelist Valid Keys

**File:** `app/lib/schemas/config.ts:3-4`  
**Agent:** Audit7-Lib

The schema accepts any key (`z.string().min(1)`). The admin route manually checks `FEATURE_FLAG_KEYS`, but the reusable schema provides no protection. Any future consumer that skips the manual check could update arbitrary config keys.

**Fix:** Add `z.enum(FEATURE_FLAG_KEYS)` or a `.refine()` directly in the schema.

---

### 🔴 1.7 Missing Null Check on Team Lookup — Runtime Crash

**File:** `app/routes/teams.team-id.tsx:115-131`  
**Agent:** Audit5-Routes

In the admin/coordinator branch, `pb.collection('teams').getOne(teamId)` can return null. The result is used on line 131 (`team.status`) without a null guard, causing a TypeError crash. The lead and institution branches correctly check for missing data.

**Impact:** Visiting a nonexistent team URL as admin crashes the request instead of showing a 404.

**Fix:** Add `if (!team) throw new Response('Team not found', { status: 404 });` before line 119.

---

### 🟠 1.8 Path Traversal in Static File Serving — Symlink Escape Possible

**File:** `server.ts:48-59`  
**Agent:** Audit3-Server

The path traversal defense checks `resolved.startsWith(clientDir)` but doesn't account for symlinks. `path.resolve` does not resolve symlinks — `fs.realpathSync` is needed.

---

### 🟠 1.9 Fragile `</body>` String Injection in TransformStream

**File:** `app/entry.server.tsx:60`  
**Agent:** Audit1-Entry

The inject target `'</body>'` is case-sensitive (`</BODY>`, `</Body>` fail), and user content containing `</body>` could inject at the wrong position.

---

### 🟠 1.10 CSS Injection via `'unsafe-inline'` in style-src

**File:** `app/entry.server.tsx:100`  
**Agent:** Audit1-Entry

`style-src 'self' 'unsafe-inline'` allows CSS injection attacks (data exfiltration via attribute selectors, UI redressing).

---

### 🟠 1.11 Missing `upgrade-insecure-requests` in CSP

**File:** `app/entry.server.tsx:97`  
**Agent:** Audit1-Entry

HTTP resources are not automatically upgraded to HTTPS, risking mixed-content issues.

---

### 🟠 1.12 Custom Script Injection Lacks Nonce

**File:** `app/entry.server.tsx:55`  
**Agent:** Audit1-Entry

The manually injected `<script type="module" async="">` tag has no nonce attribute. Works only because CSP uses `'unsafe-inline'`.

---

### 🟠 1.13 IP Rate-Limit Header Prioritizes Spoofable Header

**Files:** `app/routes/login.tsx:80-83`, `app/routes/forgot-password.tsx:28-31`  
**Agent:** Audit5-Routes

Both login and forgot-password check `X-Forwarded-For` before `CF-Connecting-IP`. `X-Forwarded-For` is trivially spoofable, allowing rate limit bypass.

---

### 🟠 1.14 URL Path Traversal in Submission File Download Link

**File:** `app/components/shared/team-detail.tsx:213`  
**Agent:** Audit6-Shared

`team.id` is not URL-encoded in the file download href. While team IDs are UUIDs currently, a future schema change could introduce path characters.

---

### 🟠 1.15 Blob URL Revoked Before Download May Initiate

**File:** `app/components/shared/team-detail.tsx:106`  
**Agent:** Audit6-Shared

`URL.revokeObjectURL(url)` runs immediately after `a.click()`. The browser may not have started the download yet, causing silent download failure.

---

### 🟠 1.16 Health Endpoint Exposes PocketBase Status to Unauthenticated Users

**File:** `app/routes/api/health.ts:1-22`  
**Agent:** Audit8-UI

The `/api/health` endpoint reveals PB connectivity status and timestamps without auth. Attackers can probe to time attacks during PB downtime.

---

### 🟠 1.17 Institutions API Enumerates All Institutions to Any Auth User

**File:** `app/routes/api/institutions.ts:5-36`  
**Agent:** Audit8-UI

Any authenticated user (including leads) can fetch up to 1000 institutions with codes. The institution code field could be sensitive (used as a joining code).

---

### 🟠 1.18 CSV Export Silently Truncates at 500 Rows

**File:** `app/routes/api/export/csv.ts:33-44`  
**Agent:** Audit8-UI

The export silently truncates data when `totalItems > MAX_SAFE_LIST (500)` with only a `console.warn`. Admin receives incomplete CSV with no indication.

---

### 🟠 1.19 File Proxy Does Not URL-Encode Filename

**File:** `app/routes/api/files.ts:69-70`  
**Agent:** Audit8-UI

Filename containing URL-special characters (?, #, &) could alter the fetch target to PocketBase.

---

### 🟠 1.20 JWT Signature Verification Skipped

**File:** `app/lib/jwt.server.ts:3-25,42-56`  
**Agent:** Audit2-Auth

`decodeJwtPayload` decodes without HMAC verification. Defense-in-depth depends on PB rejecting forged tokens. This coupling is undocumented.

---

### 🟠 1.21 Token Fallback After authRefresh May Return Expiring Token

**File:** `app/lib/auth.server.ts:201`  
**Agent:** Audit2-Auth

`pb.authStore.token || token` falls back to the original near-expiry token if `pb.authStore.token` is falsy after refresh, writing a stale token to the cookie.

---

### 🟠 1.22 Dead Code: `secureAction` 401 Branch Never Fires

**File:** `app/lib/action.server.ts:113`  
**Agent:** Audit2-Auth

`err.status === 401` is unreachable — `requireAuth` throws a 302 redirect, not 401. Misleading dead code.

---

### 🟠 1.23 `ALLOWED_ORIGINS` Env Var Ignored in Non-Production

**File:** `app/lib/origin.server.ts:64-70`  
**Agent:** Audit2-Auth

`NODE_ENV !== 'production'` returns early with localhost-only, bypassing `getAllowedOrigins()`. Staging environments silently ignore the configured origins.

---

### 🟠 1.24 X-Forwarded-For Trusted Without Proxy Verification

**Files:** `app/routes/login.tsx:80-83`, `app/lib/origin.server.ts`  
**Agent:** Audit2-Auth

IP extraction trusts `X-Forwarded-For` directly. Without proxy verification, attackers rotate spoofed IPs to bypass per-IP rate limits.

---

### 🟠 1.25 `loginSchema` Does Not Validate Email Format

**File:** `app/lib/schemas/auth.ts:3-6`  
**Agent:** Audit7-Lib

`loginSchema` uses `z.string().min(1)` while `forgotPasswordSchema` correctly uses `.email()`. Inconsistent validation.

---

### 🟠 1.26 HTML Entity Encoding Corrupts URL in Email

**File:** `app/lib/team.server.ts:187-188`  
**Agent:** Audit7-Lib

`escapeHtml(dashboardUrl)` encodes `/` as `&#47;`, corrupting the URL path in the email's HTML href.

---

### 🟠 1.27 `secureLoader` Converts Auth Redirects to JSON — Breaks SSR Navigation

**File:** `app/lib/loader.server.ts:57-66`  
**Agent:** Audit3-Server

`secureLoader` catches auth redirects and converts them to JSON responses. For initial SSR page load, this prevents the redirect to /login, returning a broken JSON response to the browser.

---

### 🟠 1.28 Error Message Leaks Config Key to Client

**File:** `app/routes/admin/config.tsx:41`  
**Agent:** Audit4-Admin

The attacker-supplied key name is echoed back in the error message: `` Unknown config key "${key}" ``.

---

### 🟠 1.29 Config Toggle Uses Client-Computed State — TOCTOU Race

**File:** `app/routes/admin/config.tsx:85`  
**Agent:** Audit4-Admin

The toggle value is computed client-side from `configMap[key]`. Two admins clicking simultaneously both read the same state and produce the same toggle, causing one admin's action to be silently lost.

---

### 🟠 1.30 Bulk CSV Import No Row-Count Limit — Abuse Vector

**File:** `app/routes/admin/campus-leads.tsx:172-238`  
**Agent:** Audit4-Admin

Each CSV row triggers individual PB calls — a 100-row CSV makes 200+ sequential calls. No row-count limit beyond 1MB file cap.

---

### 🟠 1.31 CSV Export Ignores Search Query — Data Integrity Issue

**File:** `app/routes/admin/export.tsx:162`  
**Agent:** Audit4-Admin

The CSV download only passes `filterStatus`, ignoring `searchQuery`. User sees 10 matching teams but downloads ALL teams for the status filter.

---

### 🟠 1.32 No Shared CSRF Middleware for API Routes

**File:** `app/routes/api/auth/logout.ts` (and login, forgot-password)  
**Agent:** Audit8-UI

Each API POST route must manually validate origin + CSRF. The distributed security pattern has already produced gaps (logout missing CSRF, login/forgot skipping origin).

---

### 🟠 1.33 `getEnv()` Returns Raw Admin Credentials

**File:** `app/lib/env.server.ts:27-62`  
**Agent:** Audit3-Server

`getEnv()` returns `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD` with no protection against accidental logging. If `getEnv()` is called in a logging context, credentials leak.

---

### 🟠 1.34 `config.server.ts` Coerces Non-Boolean Values

**File:** `app/lib/config.server.ts:29`  
**Agent:** Audit7-Lib

`!!record.value` returns `true` for ANY truthy value, including the string `'false'`. If a config record's value is the string `'false'`, the function returns `true` for that flag.

---

## 2. Performance Findings

### 🟠 2.1 Unbounded Buffer Accumulation Defeats Streaming

**File:** `app/entry.server.tsx:65-83`  
**Agent:** Audit1-Entry

The TransformStream IIFE accumulates decoded text in a string buffer until `</body>` is found. For large pages this buffers megabytes before any bytes are sent, defeating streaming entirely and risking OOM.

---

### 🟠 2.2 Dynamic Import of Server Build Creates New Promise on Every Factory Invocation

**File:** `server.ts:31-41`  
**Agent:** Audit3-Server

The `import("./build/server/index.js")` inside the factory function creates a new dynamic import Promise on every invocation. The Promise is never cached, so every request triggers a new module evaluation.

---

### 🟠 2.3 Immutable Cache Headers Applied to ALL Static Files

**File:** `server.ts:63-68`  
**Agent:** Audit3-Server

`Cache-Control: public, max-age=31536000, immutable` is applied to ALL static files matching MIME types, not just hashed `/assets/` files. Unhashed files would be permanently cached.

---

### 🟠 2.4 Dashboard Fetches 1000 Team Records Just for Status Counts

**File:** `app/routes/admin/dashboard.tsx:28`  
**Agent:** Audit4-Admin

`pb.collection("teams").getList(1, 1000, { fields: "status" })` fetches ALL teams just for per-status counts. No aggregation query is used.

---

### 🟠 2.5 Coordinator Dashboard Loads Full Institutions List on Every Navigation

**File:** `app/routes/coordinator/dashboard.tsx:56-60`  
**Agent:** Audit5-Routes

All 200 institutions are fetched on every page load, even when viewing the teams tab.

---

### 🟠 2.6 Coordinator Dashboard Runs Redundant Count Scan + Paginated Query

**File:** `app/routes/coordinator/dashboard.tsx:120-134`  
**Agent:** Audit5-Routes

Every page load runs two team queries: the paginated result AND a 1000-row count scan. Doubles DB load.

---

### 🟠 2.7 `FilterableTeamList` Rows Rebuilt on Every Render Without Memoization

**File:** `app/components/shared/filterable-team-list.tsx:78-89`  
**Agent:** Audit6-Shared

`DataListRow` array is mapped from `teams` on every render with no `useMemo`. Parent re-renders (search keystrokes) cause full list re-rendering.

---

### 🟠 2.8 `renderSecondary` Callback Makes Component Impure

**File:** `app/components/shared/filterable-team-list.tsx:39`  
**Agent:** Audit6-Shared

`renderSecondary` is called during render, preventing row-level memoization. Callers MUST memoize with `useCallback`.

---

### 🟠 2.9 `getConfig()` Called Without Caching Across Routes

**Files:** Multiple lead/institution routes  
**Agent:** Audit5-Routes

`getConfig(pb)` fires a separate DB query in every loader/action. A lead navigating register→questionnaire→submit triggers 3-4 config reads within seconds.

---

### 🟠 2.10 Admin Client Singleton Has TOCTOU Race

**File:** `app/lib/pocketbase.server.ts:110-113`  
**Agent:** Audit3-Server

The `authStore.isValid` check followed by `authRefresh()` has a race window. Two concurrent requests could both pass the check before either refreshes, causing duplicate auth refresh requests.

---

### 🟡 2.11 `fetchWithTimeout` Abort Listener Not Cleaned Up on Success

**File:** `app/lib/pocketbase.server.ts:12-28`  
**Agent:** Audit3-Server

The abort event listener on the existing signal is never removed if the fetch succeeds, causing a memory leak over many requests.

---

### 🟡 2.12 Login Loader Fetches Team/Institution Counts on Every Page Visit

**File:** `app/routes/login.tsx:47-51`  
**Agent:** Audit5-Routes

Two DB queries on every login page load for stat counts that rarely change for a static event.

---

### 🟡 2.13 `getValidTransitions` Allocates Array on Every Call

**File:** `app/lib/team-status.ts:22-30`  
**Agent:** Audit7-Lib

`allStatuses` array is recreated on every invocation. Should be a module-level const.

---

### 🟡 2.14 `email.server.ts` Has No Fetch Timeout

**File:** `app/lib/email.server.ts:37-49`  
**Agent:** Audit7-Lib

Resend API fetch has no explicit timeout. Slow connection blocks request handler indefinitely.

---

### 🟡 2.15 `getAllowedOrigins` Re-Parses Env on Every Request

**File:** `app/lib/origin.server.ts:12-21`  
**Agent:** Audit2-Auth

Env vars are fixed at process start but re-parsed on every request. Should be memoized at module scope.

---

### 🟡 2.16 `useActionToast` Missing `options` in Dependency Array

**File:** `app/hooks/use-action-toast.ts:29-40`  
**Agent:** Audit8-UI

The `useEffect` depends on `[actionData]` but reads `options.success` and `options.error`. Stale closure captures initial options if callers pass inline object literals.

---

### 🟡 2.17 `AnimatedGrid` Recomputes Cells on Every Render

**File:** `app/components/ui/animated-grid.tsx:38-43`  
**Agent:** Audit8-UI

Cell positions are computed inline during render without `useMemo`, creating GC pressure on parent re-renders.

---

## 3. Over-Engineering Findings

### 🟠 3.1 55-Line Manual Script Injection Reimplements React Router Internals

**File:** `app/entry.server.tsx:20-55`  
**Agent:** Audit1-Entry

Bespoke system manually iterates manifest routes, builds import statements, serializes manifest to JSON, and injects via string manipulation. This is a maintenance liability tied to RR7 v7.17 internals. Any upgrade that fixes the bug or changes manifest shape silently breaks this.

---

### 🟠 3.2 `secureAction` Has Near-Complete Code Duplication Between Schema/Non-Schema Paths

**File:** `app/lib/action.server.ts:86-209`  
**Agent:** Audit3-Server

Two nearly identical handler dispatch paths (lines 156-177 and 190-207) differ only by `validated` injection. Should be unified.

---

### 🟠 3.3 `TeamDetail` Is a 260-Line Monolithic Component

**File:** `app/components/shared/team-detail.tsx:117-377`  
**Agent:** Audit6-Shared

Five Card sub-sections, member list, questionnaire, and status transitions are all inlined with no extracted sub-components.

---

### 🟠 3.4 `getLeadSteps` Mixes Status-to-Step Mapping With URL-Based Detection

**File:** `app/components/shared/step-indicator.tsx:54-59`  
**Agent:** Audit6-Shared

URL-based active state override silently overwrites status-based flags. Should separate into two functions for single responsibility.

---

### 🟡 3.5 `fail()` Helper Includes `error` and `fieldErrors` Keys Even When Undefined

**File:** `app/lib/action.server.ts:48-55`  
**Agent:** Audit3-Server

The `fail()` helper returns both keys regardless of which was set, adding noise to JSON response.

---

### 🟡 3.6 `secureLoader` Duplicates Auth/Error Pattern From `secureAction`

**File:** `app/lib/loader.server.ts:45-97`  
**Agent:** Audit3-Server

The auth + error handling pattern in `secureLoader` is a near-copy of `secureAction`'s first ~50 lines. Could share code.

---

### 🟡 3.7 `StrictMode` Wrapping `hydrateRoot` Is Redundant in Production

**File:** `app/entry.client.tsx:8`  
**Agent:** Audit1-Entry

`StrictMode` checks only apply in development. In production it's a no-op passthrough.

---

## 4. Architectural Findings

### 🟠 4.1 No Catch-All/404 Route Defined

**File:** `app/routes.ts`  
**Agent:** Audit1-Entry

No catch-all route (e.g. `route('**', ...)`). 404 handling relies on React Router's default ErrorBoundary behavior.

---

### 🟠 4.2 All Admin Routes Share No Admin Layout Route

**File:** All admin routes  
**Agent:** Audit4-Admin

No `app/routes/admin.tsx` layout. Auth checks are per-route, page padding is inconsistent. A layout route could provide shared breadcrumbs, navigation, and a single auth gate.

---

### 🟠 4.3 `ErrorBoundary` Copy-Pasted Identically Across All 5 Admin Files

**File:** All admin routes  
**Agent:** Audit4-Admin

Every admin route exports an identical 25-line `ErrorBoundary` function. DRY violation.

---

### 🟠 4.4 `types.ts` Exports Runtime Logic Alongside Type Definitions

**File:** `app/lib/types.ts:96-146`  
**Agent:** Audit7-Lib

`canTransition()`, `TRANSITION_RULES`, and other runtime code live in a file named `types.ts`. Misleading about import cost.

---

### 🟠 4.5 Role-Specific Dashboards Show Significant Structural Duplication

**Files:** `app/routes/institution/dashboard.tsx`, `app/routes/lead/dashboard.tsx`, `app/routes/coordinator/dashboard.tsx`  
**Agent:** Audit5-Routes

All three dashboards follow: hero strip → MetricCard grid → action/team list. Page-level composition is duplicated.

---

### 🟠 4.6 Members + Questionnaire Fetch Duplicated Across Three Role Branches

**File:** `app/routes/teams.team-id.tsx:54-64,89-99,119-129`  
**Agent:** Audit5-Routes

The members and questionnaire fetch is copy-pasted across lead, institution, and admin/coordinator branches.

---

### 🟠 4.7 `dashboard-layout` Authenticates But Doesn't Authorize by Role

**File:** `app/routes/dashboard-layout.tsx:100-110`  
**Agent:** Audit5-Routes

Layout calls `requireAuth` but not role-based auth. A lead navigating to `/admin/dashboard` briefly sees admin sidebar before the 403 propagates.

---

### 🟠 4.8 `teams.team-id.tsx` and `lead/dashboard.tsx` Missing `ErrorBoundary`

**Files:** `app/routes/teams.team-id.tsx`, `app/routes/lead/dashboard.tsx`  
**Agent:** Audit5-Routes

Neither file exports an ErrorBoundary. Errors fall through to the parent `dashboard-layout` ErrorBoundary.

---

### 🟠 4.9 `downloadTeamCSV` Is a Pure Utility Exported From a React Component File

**File:** `app/components/shared/team-detail.tsx:45-107`  
**Agent:** Audit6-Shared

Pure data-transformation + DOM utility with no React dependency, but lives in a React component file. Violates separation of concerns.

---

### 🟠 4.10 No Shared CSRF Middleware for API Routes

**File:** Multiple API routes  
**Agent:** Audit8-UI

API POST routes must manually validate origin + CSRF. The distributed pattern has already produced gaps. `secureAction` handles this for route actions; API routes need the same wrapper.

---

### 🟠 4.11 Admin Client Singleton Has TOCTOU Race on `authStore.isValid`

**File:** `app/lib/pocketbase.server.ts:110-113`  
**Agent:** Audit3-Server

Two concurrent requests can both pass `isValid` before either calls `authRefresh()`. Needs mutex or periodic refresh.

---

### 🟠 4.12 `forgot-password` Loader Is a No-Op

**File:** `app/routes/forgot-password.tsx:13-15`  
**Agent:** Audit5-Routes

Loader returns `data({})` with no meaningful content. Component doesn't use `useLoaderData`. Remove entirely.

---

### 🟡 4.13 `config.server.ts` Silently Truncates Beyond 100 Records

**File:** `app/lib/config.server.ts:17-24`  
**Agent:** Audit7-Lib

When `totalItems > MAX_SAFE_LIST (100)`, only the first page is returned. Safe now with 4 flags, but a latent bug.

---

### 🟡 4.14 `resetAdminClient` Silently Does Nothing in Dev

**File:** `app/lib/pocketbase.server.ts:141-151`  
**Agent:** Audit3-Server

In non-test, non-production environments, `resetAdminClient` is a no-op. Silent failure makes debugging difficult.

---

## 5. Redundancy Findings

### 🟠 5.1 `ErrorBoundary` Duplicated Across 5 Admin Files

**File:** All admin routes  
**Agent:** Audit4-Admin

25-line `ErrorBoundary` copied verbatim. Extract shared component.

---

### 🟠 5.2 `shortlistSchema` and `unshortlistSchema` Are Identical

**File:** `app/lib/schemas/institution.ts:3-9`  
**Agent:** Audit7-Lib

Both define exactly `{ teamId: z.string().min(1) }`. Export one schema.

---

### 🟠 5.3 Repeating `Card` + `CardTitle` Pattern 5 Times in `team-detail.tsx`

**File:** `app/components/shared/team-detail.tsx`  
**Agent:** Audit6-Shared

The identical `CardTitle className='flex items-center gap-2 text-base'` is repeated verbatim 5 times.

---

### 🟠 5.4 Members + Questionnaire Fetch Duplicated Across 3 Role Branches

**File:** `app/routes/teams.team-id.tsx`  
**Agent:** Audit5-Routes

Shared helper needed for members+questionnaire fetch.

---

### 🟠 5.5 `CODE_PATTERN` Regex Duplicated From Schema

**File:** `app/routes/admin/campus-leads.tsx:26`  
**Agent:** Audit4-Admin

`/^[A-Z0-9]+$/` duplicated in both schema and component. Should share via constant.

---

### 🟠 5.6 `useLoaderData() as SomeType` Cast Pattern Repeated Everywhere

**Files:** All route components  
**Agents:** Audit4-Admin, Audit5-Routes

Every route uses `useLoaderData() as { ... }` instead of the type-safe `useLoaderData<typeof loader>()` generic.

---

### 🟠 5.7 Local `PhaseIndicator` Duplicates Shared `PhaseStrip`

**File:** `app/routes/login.tsx:122-161`  
**Agent:** Audit5-Routes

Login defines a local `PhaseIndicator` while lead/dashboard uses the shared `PhaseStrip`. Same purpose.

---

## 6. Code Quality Findings

### 🟠 6.1 Unhandled Promise Rejection in Streaming IIFE

**File:** `app/entry.server.tsx:62`  
**Agent:** Audit1-Entry

The async IIFE has no `.catch()` handler. If `reader.read()` throws, the transform writer is never closed, leaving the client hanging until TCP timeout.

---

### 🟠 6.2 `renderToReadableStream` Missing `onError` and `abortDelay`

**File:** `app/entry.server.tsx:16`  
**Agent:** Audit1-Entry

No `onError` callback means rendering errors are silently swallowed server-side. No `abortDelay` means an infinite Suspense blocks the stream forever (defaults to `Infinity`).

---

### 🟠 6.3 Unsafe Type Assertion After Schema Validation

**File:** `app/routes/admin/config.tsx:38`  
**Agent:** Audit4-Admin

`validated as { key: string; value: string }` — the value is already a boolean from the schema transform. Semantically wrong assertion.

---

### 🟠 6.4 Multiple Unsafe `as` Casts for File/Blob Type Discrimination

**File:** `app/routes/admin/campus-leads.tsx:152-159`  
**Agent:** Audit4-Admin

Four `as File`/`as Blob` casts for duck-type checking. Should use `instanceof` for proper TypeScript narrowing.

---

### 🟠 6.5 Unused Variable `creates` in Lead Register Action

**File:** `app/routes/lead/register.tsx:199`  
**Agent:** Audit5-Routes

`const creates = await Promise.all(...)` — result is assigned to a variable that is never referenced.

---

### 🟠 6.6 Redundant `.catch(() => {})` on `sendStatusChangeEmail`

**File:** `app/routes/teams.team-id.tsx:204-209`  
**Agent:** Audit7-Lib

The function already catches all errors internally. Outer `.catch` is dead code that would silently swallow errors if the function were refactored.

---

### 🟠 6.7 `configUpdateSchema` Transform Output Type Contradicts Actual Usage

**File:** `app/lib/schemas/config.ts:5-7` vs `admin/config.tsx:38`  
**Agent:** Audit7-Lib

Schema transforms string → boolean (`ConfigUpdateInput.value = boolean`), but the action handler casts as `{ value: string }`. Type lie masks bugs.

---

### 🟠 6.8 `getLeadTeam` Generic Parameter Allows Unsafe Type Assertion

**File:** `app/lib/team.server.ts:24-25`  
**Agent:** Audit7-Lib

Generic `<T = TeamView>` has no constraint. Caller could pass any type and get it back without runtime verification.

---

### 🟠 6.9 `useLoaderData()` Cast Risk on All Routes

**Files:** All route components  
**Agents:** Audit4-Admin, Audit5-Routes

Manual type casts silently diverge from loader returns. Use `typeof loader` generic.

---

### 🟠 6.10 Error Boundary Error Message Exposure Inconsistent

**Files:** `app/routes/dashboard-layout.tsx:421-423`, `app/routes/coordinator/dashboard.tsx:487-488`, `app/routes/institution/dashboard.tsx:683-685`  
**Agent:** Audit5-Routes

Some boundaries conditionally show messages in DEV only; others unconditionally expose them in production.

---

### 🟠 6.11 Debounce Timer Not Cleaned Up on Unmount

**File:** `app/routes/admin/teams.tsx:126-136`  
**Agent:** Audit4-Admin

`debounceRef` timeout fires `setSearchParams` on unmounted component.

---

### 🟡 6.12 `suppressHydrationWarning` on `<html>` Masks Legitimate Mismatches

**File:** `app/root.tsx:33`  
**Agent:** Audit1-Entry

Suppresses all hydration warnings on `<html>`, not just the class attribute.

---

### 🟡 6.13 `getEnv()` Imported at Module Level But Only Used Conditionally

**File:** `app/entry.server.tsx:5`  
**Agent:** Audit1-Entry

`getEnv` is imported at the top level but only called inside a production conditional block.

---

### 🟡 6.14 ErrorBoundary Leaks `error.stack` in DEV Mode

**File:** `app/root.tsx:80-83`  
**Agent:** Audit1-Entry

`error.stack` is rendered in a `<pre>` tag in DEV mode, leaking internal paths and environment details.

---

### 🟡 6.15 Hardcoded Hex Color in `forgot-password.tsx`

**File:** `app/routes/forgot-password.tsx:132`  
**Agent:** Audit5-Routes

Uses `#2e2a25` hardcoded instead of `var(--sidebar)` (theme-aware). Will diverge on theme changes.

---

### 🟡 6.16 Institution Dashboard Local `TeamWithExpand` Type Drift Risk

**File:** `app/routes/institution/dashboard.tsx:50-62`  
**Agent:** Audit5-Routes

Local type overlaps with central `TeamView` in `~/lib/types`. Creates drift risk.

---

### 🟡 6.17 `escapeHtml` Unnecessarily Escapes Forward Slashes

**File:** `app/lib/utils.ts:17`  
**Agent:** Audit7-Lib

`/` → `&#47;` is not required by OWASP and can break URLs.

---

### 🟡 6.18 `escapeHtml` Uses 7 Chained `.replace()` Calls

**File:** `app/lib/utils.ts:9-17`  
**Agent:** Audit7-Lib

Each `.replace()` creates a new string. Single regex with replacer function would be more efficient.

---

### 🟡 6.19 `escapeCsv` Treats All Falsy Values as Empty String

**File:** `app/lib/utils.ts:31`  
**Agent:** Audit7-Lib

`if (!str) return ''` matches null, undefined, `0`, `false`. Parameter is typed `string` but callers could pass null at runtime.

---

### 🟡 6.20 `TEAM_STATUSES` Duplicates `TeamStatus` Union

**File:** `app/lib/constants.ts:19-27`  
**Agent:** Audit7-Lib

Manually maintained array must stay in sync with `TeamStatus` union type. Silent divergence risk.

---

### 🟡 6.21 `useAutoSave` Cleanup Effect Has Fragile Dependency Chain

**File:** `app/hooks/use-auto-save.ts:69-74`  
**Agent:** Audit8-UI

`clearSaved` changes identity when `storageKey` changes, causing cleanup to re-run and potentially clear data prematurely.

---

## 7. Accessibility & UX Findings

### 🟠 7.1 Status Transition Forms Lack Fieldset/Legend Grouping

**File:** `app/components/shared/team-detail.tsx:320`  
**Agent:** Audit6-Shared

Multiple transition Form buttons have no surrounding fieldset/legend for screen reader grouping.

---

### 🟠 7.2 `ConfirmButton` Uses `role="alertdialog"` Incorrectly

**File:** `app/components/shared/confirm-button.tsx:82-84`  
**Agent:** Audit6-Shared

`alertdialog` requires `aria-describedby` and implies modal overlay, but this is an inline confirmation. Should use `role="group"`.

---

### 🟠 7.3 Global Escape Listener Doesn't Respect Focus Scope

**File:** `app/components/shared/confirm-button.tsx:49`  
**Agent:** Audit6-Shared

`document.addEventListener('keydown', ...)` dismisses confirmation on any Escape press, even in unrelated dialogs.

---

### 🟡 7.4 `ReviewSummary` Collapsible Lacks `aria-expanded` and `aria-controls`

**File:** `app/components/shared/review-summary.tsx:31-35,46-49`  
**Agent:** Audit6-Shared

Toggle button doesn't communicate expanded state to screen readers. Content panel lacks `id` for association.

---

### 🟡 7.5 `ProgressBar` Missing `aria-label`

**File:** `app/components/shared/progress-bar.tsx:46-59`  
**Agent:** Audit6-Shared

`role="progressbar"` with `aria-valuenow/min/max` but no label. Screen readers announce numbers without context.

---

### 🟡 7.6 `EventMark` Label Causes Double Announcement

**File:** `app/components/shared/event-mark.tsx:126-136`  
**Agent:** Audit6-Shared

Visible label text is not `aria-hidden`, but wrapper already has `aria-label`. Screen readers read both.

---

### 🟡 7.7 `Callout` Lacks Semantic Role

**File:** `app/components/shared/callout.tsx:12-20`  
**Agent:** Audit6-Shared

No ARIA role for warning/danger states. Should use `role="alert"` for destructive tones.

---

### 🟡 7.8 `PhaseStrip` List Keyed by `phase.label` — Potential Collision

**File:** `app/components/shared/phase-strip.tsx:31`  
**Agent:** Audit6-Shared

If two phases share the same label, React produces a key collision.

---

### 🟡 7.9 Hardcoded Border Logic Coupled to CSS Grid

**File:** `app/components/shared/phase-strip.tsx:28`  
**Agent:** Audit6-Shared

`needsBottomBorder = phases.length > 2 && idx < 2` assumes exactly 2 columns on mobile. If grid-cols changes, this silently breaks.

---

## 8. Summary by Category

| Category | Critical | Major | Minor/Info |
|----------|----------|-------|------------|
| Security | 7 | 20 | 8 |
| Performance | 0 | 8 | 9 |
| Over-engineering | 0 | 4 | 3 |
| Architecture | 0 | 12 | 4 |
| Redundancy | 0 | 7 | 0 |
| Code Quality | 0 | 11 | 12 |
| Accessibility | 0 | 3 | 6 |

---

## 9. Top 10 Must-Fix Items

| Priority | Finding | File | Effort |
|----------|---------|------|--------|
| 1 | Nonce not wired to CSP or Scripts | `entry.server.tsx`, `root.tsx` | Medium |
| 2 | Email subject header injection | `app/lib/team.server.ts:202` | Quick |
| 3 | File validation uses client MIME type | `app/lib/file-validation.server.ts` | Quick |
| 4 | Logout missing CSRF validation | `app/routes/api/auth/logout.ts` | Quick |
| 5 | Null team lookup crashes admin/coordinator | `app/routes/teams.team-id.tsx:115` | Quick |
| 6 | `configUpdateSchema` doesn't whitelist keys | `app/lib/schemas/config.ts` | Quick |
| 7 | IP rate-limit trusts spoofable header | `app/routes/login.tsx:80` | Quick |
| 8 | Unhandled promise rejection in streaming IIFE | `app/entry.server.tsx:62` | Quick |
| 9 | `secureLoader` converts auth redirects to JSON | `app/lib/loader.server.ts:57` | Medium |
| 10 | `renderToReadableStream` missing onError/abortDelay | `app/entry.server.tsx:16` | Quick |
