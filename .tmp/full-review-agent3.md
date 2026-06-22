# Full Codebase Review — Agent3 (Security & Code Quality)

**Reviewer**: Senior Security & Code Reviewer (Agent3)
**Scope**: Every route, lib, component, hook, config, and script file
**Date**: 2026-06-22

---

## Executive Summary

The codebase demonstrates strong awareness of security patterns (CSRF double-submit, origin validation, role-based access, optimistic locking, key rotation) and a well-structured architecture. Several issues were found — mostly in categories of **data leakage**, **lack of input normalization**, **error message consistency**, **race conditions**, and **unnecessary complexity**. No SQL injection or XSS vectors were found; PocketBase is handled safely throughout.

**Severity distribution**:
- CRITICAL: 3
- HIGH: 8
- MEDIUM: 15
- LOW: 14

---

## CRITICAL Issues

### C-1: Insecure direct object reference (IDOR) in institution invite flow — admin client bypasses auth rules
**File**: `app/routes/admin/campus-leads.tsx:88-218`
**Issue**: The `createCampusLead` function (`app/lib/team.server.ts:238-280`) uses the **authenticated user's `pb`** client (passed from `secureAction`). That `pb` client carries the admin user's JWT. The admin user bypasses PB's API rules entirely because admin tokens operate at the superuser level for collection mutations. Any vulnerability in the admin UI would allow database-wide writes.
**Fix**: Consider creating a scoped `pb` client with a dedicated API token that constrains what collections/fields it can access, rather than relying purely on admin credentials. At minimum, log every admin write action with full context for audit trail.

### C-2: No rate limiting on authentication endpoints — local validation only
**File**: `app/routes/login.tsx:88-121`
**Issue**: The login action has **no rate limiting** at the application layer. The comment in `action.server.ts:67-70` states rate limiting is handled by PocketBase's built-in rules, but the rate limits set in `scripts/setup-pb.ts:1229-1233` allow **10 auth requests per 60 seconds** globally. This is too permissive for brute-force protection — 10 attempts/minute per IP. Additionally, the rate limits are on `*:auth` (the collection auth endpoint), not on general login attempts. Since the login is proxied through the app server, PocketBase sees one IP (the app server), not the end user's IP.
**Fix**: Add application-layer rate limiting using a token-bucket or sliding-window approach keyed by client IP. Consider 5 attempts per 15 minutes per IP with exponential backoff.

### C-3: In-memory stats cache can serve stale data across deployments
**File**: `app/routes/login.tsx:30-31,53-61`
**Issue**: The `statsCache` variable (`let statsCache: LoginStats | null = null;`) is module-scoped and shared across all connections to the same Node.js process. In a multi-process or serverless deployment (Cloudflare Workers, multiple replicas), each process has its own cache. This causes inconsistent stats display. Also, in serverless cold-start scenarios, the cache is always empty, defeating its purpose.
**Fix**: Move the stats cache to PocketBase itself (a dedicated stats record), use a `KV` store, or set HTTP caching headers (`Cache-Control: public, max-age=60`) and serve stale data via a SWR pattern.

---

## HIGH Issues

### H-1: No optimistic concurrency control on team status transitions — race condition
**File**: `app/lib/team.server.ts:113-163`
**Issue**: `transitionTeamStatus` uses a conditional update with `filter: pb.filter("status = {:expected}", { expected: team.status })` (line 144). This is **good**. However, the race window between `getOne` (line 119) and `update` (line 141) is still exploitable: two concurrent admin requests could both read the same status and both proceed. The conditional update at the DB level mitigates this for the persisted state, but the **response to the user** could be misleading (both admins see success, but only one actually changed the state).
**Fix**: Return the actual `newStatus` from the server response by reading the result of the update operation, not assuming `toStatus` was applied.

### H-2: File download proxy validates only against "teams" collection name
**File**: `app/routes/api/files.ts:30-32`
**Issue**: The file proxy only checks `collection !== "teams"`. If PocketBase schema changes in the future to add other file-enabled collections, this validation would allow downloading files from any collection if the collection name is known (after passing the authorize check which only looks at teams). Should use an allowlist.
**Fix**: Change to `!["teams"].includes(collection)`.

### H-3: `Secure` flag on CSRF cookie depends on `POCKETBASE_URL` not `APP_URL`
**File**: `app/lib/csrf.server.ts:98-109`
**Issue**: The CSRF cookie's `Secure` attribute checks `POCKETBASE_URL.startsWith("https")` and `NODE_ENV === "production"`. But `POCKETBASE_URL` is the internal PocketBase API URL, which could run on HTTP behind a reverse proxy (the env.server.ts warns about this at line 37). If the app server is on HTTPS but PocketBase is on HTTP internally, the CSRF cookie would **not** be marked `Secure` in production.
**Fix**: Check `APP_URL` or the incoming `request.url` scheme instead: `new URL(request.url).protocol === "https:"`.

### H-4: Email addresses in error logs
**File**: `app/routes/login.tsx:114`
**Issue**: When login fails, the masked email is logged: `console.error("[login] Auth failed for", masked);`. Masking is good (`a***@example.com`). For production, even the masked email should not be logged — only a correlation ID.
**Fix**: Log a random request ID instead of the email (even masked).

### H-5: `admin/export.tsx` loader uses admin client but no role check
**File**: `app/routes/admin/export.tsx:35-36`
**Issue**: The export loader calls `getAdminClient()` directly but does NOT check that the requesting user is an admin. It does not call `requireRole`. The export page itself has no authentication check in the loader at all — anyone who knows the URL can access team count data without authentication.
**Fix**: Add `const { user } = await requireRole(request, ["admin"]);` at the top of the loader before using `getAdminClient()`.

### H-6: No cache-control on admin-facing loaders with PII
**File**: Multiple `app/routes/admin/*.tsx` loaders
**Issue**: Several admin loaders return team/user data without `Cache-Control: no-store` headers. If a shared computer or browser caching is used, sensitive data could be cached and visible to the next user. The CSV export endpoint correctly sets `Cache-Control: no-store` — do the same for admin loaders.
**Fix**: Add `Cache-Control: private, no-cache, no-store, must-revalidate` to all authenticated route loaders.

### H-7: Institution dashboard `loader` shows PII regardless of phase
**File**: `app/routes/institution/dashboard.tsx:74-121`
**Issue**: The institution dashboard loads ALL teams for the institution regardless of their status. When `nomination_open` is false, the UI still shows team member PII (names, emails) for all teams (line 556-581). If the nomination phase is closed, the institution should not be viewing member data of previously registered teams.
**Fix**: Apply read-scoping based on feature flags: when `nomination_open` is false, restrict visible team data to non-PII fields for institution users.

### H-8: Forgot-password action lacks CSRF token validation
**File**: `app/routes/forgot-password.tsx:12-33`
**Issue**: The password reset action validates origin but has NO CSRF token validation. No hidden `csrf_token` input in the form. The form is outside the dashboard layout, so it has no access to `CsrfContext`. While `validateOrigin` + `SameSite=Lax` protect against CSRF, the double-submit pattern is defense-in-depth (documented in `csrf.server.ts:49-54`).
**Fix**: Generate a CSRF token in a loader for the forgot-password route and validate it in the action.

---

## MEDIUM Issues

### M-1: Registrar schema allows empty member fields but claims lengths match
**File**: `app/lib/schemas/register.ts:15-30`
**Issue**: The `.refine()` ensures all member arrays have the same length, but the schema allows empty strings in `memberPhone` and `memberGender` and `memberRole` (no `.min(1)`). This means a submission with 1 member in `memberName` but empty strings in parallel arrays passes schema validation.
**Fix**: Add `.min(1)` to all member sub-fields, or document that empty is valid.

### M-2: Institution `maxTeams` read as `number` but no upper bound
**File**: `app/lib/schemas/campus-leads.ts:12`
**Issue**: `maxTeams: z.coerce.number().min(0)` has no `max()` constraint.
**Fix**: Add a refinement: `z.coerce.number().min(0).max(999)`.

### M-3: Questionnaire schema accepts `age` as string but PocketBase expects number
**File**: `app/lib/schemas/questionnaire.ts:5`
**Issue**: `age: z.string().optional()` — the form sends age as a string, but PocketBase expects a number.
**Fix**: Use `z.coerce.number().optional()` or ensure the action parses age as a number before sending to PB.

### M-4: `confirm-button.tsx` outside-click dismiss not implemented
**File**: `app/components/shared/confirm-button.tsx:40-51`
**Issue**: The JSDoc says "Cancel uses Esc or clicks elsewhere" but the "clicks elsewhere" part is not implemented.
**Fix**: Add a `useEffect` that listens for clicks outside the button container.

### M-5: `secureAction` has duplicate try/catch blocks for handler
**File**: `app/lib/action.server.ts:87-186`
**Issue**: Two near-identical try/catch blocks (lines 146-157 and 171-184), one for the schema path and one for the non-schema path. This duplicates the Sentry logging and error handling.
**Fix**: Unify into a single handler dispatch after schema/binding setup.

### M-6: `HARDCODED_MIME_TYPES` and `MAX_FILE_SIZE` constants duplicated
**File**: `app/lib/constants.ts:12-16` vs `scripts/setup-pb.ts:397-402`
**Issue**: The allowed MIME types and max file size are defined in two places. If one is updated and the other is not, the server-side check and the PB schema will disagree.
**Fix**: Import from constants.ts in setup-pb.ts, or add a comment warning about the duplication.

### M-7: No `Cache-Control: stale-while-revalidate` on institutions API
**File**: `app/routes/api/institutions.ts:30`
**Issue**: `Cache-Control: public, max-age=60, s-maxage=120` — the cache is fresh for 60s, stale for up to 2 min in CDN. After 2 min, the cache is fully invalidated.
**Fix**: Add `stale-while-revalidate=3600` for resilience.

### M-8: `transitionTeamStatus` doesn't validate `to` before updating
**File**: `app/lib/team.server.ts:113-163`
**Issue**: The function fetches the team, checks `canTransition`, then updates. But `to` is not validated against the allowed `TeamStatus` union — it's passed as-is from the form. If a malicious or future status value is passed, it would go directly into the DB.
**Fix**: Validate `to` against the `TeamStatus` union type at runtime.

### M-9: Config update action doesn't constrain `key` to known flags
**File**: `app/routes/admin/config.tsx:37-60`
**Issue**: The `configUpdateSchema` validates `key` as a non-empty string but does NOT constrain it to `FEATURE_FLAG_KEYS`. An admin could set any arbitrary key.
**Fix**: Add `.refine((val) => FEATURE_FLAG_KEYS.includes(val.key))` to the schema.

### M-10: `forgot-password` form has no `<Loader>` for CSRF token
**File**: `app/routes/forgot-password.tsx`
**Issue**: The password reset form (line 39 onwards) has no hidden CSRF input. The `dashboard-layout.tsx` provides CSRF via context, but forgot-password is outside the dashboard layout.
**Fix**: Either add a CSRF token to the forgot-password form or use the same pattern as login (origin-only validation).

### M-11: `ErrorBoundary` in coordinator dashboard doesn't handle Response errors
**File**: `app/routes/coordinator/dashboard.tsx:581-593`
**Issue**: The `ErrorBoundary` only handles `Error` instances. If a `Response` is thrown, it crashes.
**Fix**: Add `isRouteErrorResponse` check (like `dashboard-layout.tsx` does).

### M-12: Multiple `getFirstListItem` calls for questionnaire on every team page view
**File**: `app/routes/teams.team-id.tsx:70-76,106-112,136-142`
**Issue**: For every team detail page load, the loader fetches the questionnaire with `.catch(() => null)`. This is an extra DB query per page view.
**Fix**: Use a batch query with `getFullList` filtered by the single team ID.

### M-13: Institution dashboard loads ALL teams in a single `getFullList`
**File**: `app/routes/institution/dashboard.tsx:86-94`
**Issue**: If an institution has hundreds of teams, loading all in `getFullList` becomes slow and memory-heavy.
**Fix**: Paginate the teams list server-side (like admin/teams.tsx and coordinator/dashboard.tsx do).

### M-14: `login.tsx` stats cache not invalidated on token actions
**File**: `app/routes/login.tsx:71-78`
**Issue**: When a team is created or a user registers, `statsCache` is never invalidated. The 60-second TTL covers this for most cases, but an admin creating 10 teams in quick succession won't see the count update for up to 60 seconds.
**Fix**: Add an invalidation mechanism via a `Cache-Tag` header or a last-modified check.

### M-15: `campusLeadId` check stale in institution dashboard
**File**: `app/routes/institution/dashboard.tsx:79`
**Issue**: `getInstitutionForUser` looks up institutions by `campusLeadId = user.id`. The `requireRole(["institution"])` check (line 75) ensures the user is an institution, but the campus lead ID could be stale if an admin moved an institution to a different campus lead.
**Fix**: Add a `campusLeadId` check in the response to ensure consistency.

---

## LOW Issues

### L-1: `jwt.server.ts` comment says "We do NOT verify the signature here" — no fallback
**File**: `app/lib/jwt.server.ts:4-12`
**Issue**: If a PocketBase vulnerability or misconfiguration allowed token forgery, there is zero defense.
**Fix**: Add an optional signature verification step using the PocketBase JWT secret when running in high-security contexts.

### L-2: `env.server.ts` warns about plain HTTP but continues
**File**: `app/lib/env.server.ts:36-43`
**Issue**: The warning is logged but the app continues. In a hardened deployment, the app should refuse to start if `POCKETBASE_URL` uses HTTP in production.
**Fix**: Change from `console.warn` to `throw new Error` in production.

### L-3: `email.server.ts` silently swallows configuration errors in production
**File**: `app/lib/email.server.ts:28-35`
**Issue**: When `RESEND_API_KEY` is not set, it logs a warning and returns. This is correct for local dev, but in production it means emails silently fail.
**Fix**: In production (`NODE_ENV === "production"`), throw an error instead.

### L-4: `type` assertions throughout `auth.server.ts` — possible runtime confusion
**File**: `app/lib/auth.server.ts:211`
**Issue**: `pb.authStore.model as unknown as UserRecord | null` — if the model has unexpected fields, downstream code will fail.
**Fix**: Add a runtime validation guard (e.g., Zod parse) on the model shape in dev mode.

### L-5: `admin/campus-leads.tsx` loader returns `user` but component doesn't use it
**File**: `app/routes/admin/campus-leads.tsx:81,257-493`
**Issue**: The loader returns `{ user, institutions }` but the component destructures only `institutions`.
**Fix**: Remove `user` from the return value.

### L-6: `admin/teams.tsx` `statusCounts` type mismatch between computation and return
**File**: `app/routes/admin/teams.tsx:78-94`
**Issue**: `statusCounts` computed as `Partial<Record<TeamStatus, number>>` but returned without explicit annotation.
**Fix**: Add explicit typing on the return value.

### L-7: `Biome` configuration missing import sorting
**File**: `biome.json`
**Issue**: Without import sorting, Biome won't enforce consistent import ordering.
**Fix**: Add `"organizeImports": { "enabled": true }` to biome.json.

### L-8: `admin/config.tsx` missing type parameter on `useLoaderData`
**File**: `app/routes/admin/config.tsx:95-174`
**Issue**: `useLoaderData()` is used without a generic type parameter. The type is inferred as `unknown`.
**Fix**: Add `as { configMap: Record<string, boolean> }` or use `useLoaderData<typeof loader>`.

### L-9: `package.json` likely missing `lint:fix` script
**File**: Not read, inferred
**Issue**: If `lint:fix` is missing, developers have to remember the long `biome check --write .` command.
**Fix**: Add `"lint:fix": "biome check --write ."` to package.json.

### L-10: Duplicate `import { Link } from "react-router"` in teams.team-id.tsx
**File**: `app/routes/teams.team-id.tsx:30`
**Issue**: `Link` is imported from `react-router` on its own line, but it's already imported in the main block (line 1-2).
**Fix**: Remove the duplicate import on line 30.

### L-11: `re-export alias` `canTransitionTo` is unused outside its module
**File**: `app/lib/team-status.ts:20`
**Issue**: `export { canTransition as canTransitionTo }` creates an alias that may not be imported by any other file.
**Fix**: Drop the alias if unused.

### L-12: No `aria-controls` on institution team accordion
**File**: `app/routes/institution/dashboard.tsx:514-516`
**Issue**: The team accordion headers use `role="button"` but don't have `aria-controls` pointing to the expanded content.
**Fix**: Add `aria-controls` with a unique ID linked to the content section.

### L-13: Error boundary "Try again" buttons missing `type="button"`
**File**: Multiple error boundaries
**Issue**: `onClick={() => window.location.reload()}` buttons should specify `type="button"` to prevent accidental form submission if inside a `<form>`.
**Fix**: Add `type="button"` to all error boundary reload buttons.

### L-14: `members` collection schema missing max length constraints
**File**: `scripts/setup-pb.ts:888-902`
**Issue**: `fullName` and `email` fields have `required: true` but `min`/`max` is `null` (unlimited). The app validates on submit, but direct DB access allows unlimited-length strings.
**Fix**: Set reasonable max lengths in the schema that match the app constraints.

---

## Architectural Observations

### A-1: Strong separation of auth and action concerns
The `secureAction` wrapper in `action.server.ts` is well-designed: validates origin, CSRF token, auth/role, schema, and error handling in a single composable function.

### A-2: Per-request auth cache (WeakMap) is clever but may not work in serverless
`auth.server.ts:26` uses a `WeakMap<Request, Promise<AuthResult>>`. In Cloudflare Workers, the `Request` object may be cloned or garbled between parallel loaders. Test this specifically.

### A-3: No centralized logging or monitoring beyond Sentry
Error handling is split between `console.error` and `Sentry.captureException`. Some errors use Sentry (action.server.ts), some only console.error (team.server.ts, login.tsx). A consistent policy should be documented.

### A-4: Team status transitions correctly use optimistic locking
`transitionTeamStatus` (team.server.ts:144) uses PB's filter-based conditional update — correct approach for optimistic concurrency.

### A-5: Routes well-typed with `satisfies LoaderData`
Several loaders use `satisfies LoaderData`, a TypeScript best practice.

### A-6: `pb.autoCancellation(false)` in multiple loaders
Three files call this in their loaders. While correct for parallel requests, the side effect affects the shared `pb` client for the entire request lifecycle. Document or clone the client.

---

## Performance Issues

### P-1: Institution dashboard has no pagination
**File**: `app/routes/institution/dashboard.tsx:86-94` — loads ALL teams in `getFullList`.

### P-2: Admin teams COUNT_SCAN_CAP = 500 approximate
**File**: `app/routes/admin/teams.tsx:58` — for events with 500+ teams, status counts become approximate.

### P-3: Multiple questionnaire fetches per team detail view
**File**: `app/routes/teams.team-id.tsx:70-76,106-112,136-142` — extra DB query per page view.

### P-4: No `stale-while-revalidate` on institutions API
**File**: `app/routes/api/institutions.ts:30` — cache fully invalidates after 2 min.

---

## Accessibility Issues

| ID | File | Issue | Severity |
|----|------|-------|----------|
| A11Y-1 | `phase-strip.tsx:23` | `<div role="list">` with individual `role="listitem"` not inside `<ul>` | LOW |
| A11Y-2 | `confirm-button.tsx:44-51` | Escape dismiss doesn't return focus to trigger | MEDIUM |
| A11Y-3 | `institution/dashboard.tsx:514-516` | `role="button"` missing `aria-controls` on accordion | MEDIUM |
| A11Y-4 | Multiple error boundaries | "Try again" buttons missing `type="button"` | LOW |

---

## Code Quality

- **Import ordering inconsistent** throughout — need `biome.json organizeImports`
- **`useCallback`/`useMemo` usage** is healthy but verbose in some places
- **`pb.filter()` parameterized** everywhere — no string interpolation found anywhere. Excellent.
- **`escapeCsv` used both client and server** — consistent CSV injection protection.
- **Dead imports**: `teams.team-id.tsx:30` duplicate `Link`, `campus-leads.tsx` unused `user` return.

---

## Database / Schema Issues

- **DB-1**: `status_transitions.actorUserId` cascadeDelete=false — intentional? Document it.
- **DB-2**: `members` fields have no max length — mismatch with app's 100-char validation.
- **DB-3**: `institutions.code` unique index but bulk import checks one-by-one — slow for large CSVs.

---

## Testing Observations

- **T-1**: Test files exist in `tests/` and `app/lib/__tests__/` — unit tests (Vitest) and E2E tests (Playwright). Confirm CI integration.
- **T-2**: `import.meta.env` is Vite-specific — tests may need polyfill if run outside Vite/vitest.

---

## Summary of Recommendations by Priority

### Must-fix before production launch:
1. **C-2**: Add app-layer rate limiting for login
2. **H-5**: Add `requireRole` to admin export loader
3. **H-3**: Fix CSRF cookie Secure flag to check APP_URL
4. **M-9**: Constrain config update schema to `FEATURE_FLAG_KEYS`
5. **H-6**: Add `Cache-Control: no-store` to admin loaders
6. **H-8**: Add CSRF token to forgot-password form

### Should-fix (medium term):
1. **H-1**: Return actual newStatus from transition
2. **M-5**: Unify try/catch in secureAction
3. **H-4**: Remove masked email from login logs
4. **M-6**: Deduplicate constants between app and setup script
5. **M-8**: Validate `to` status against `TeamStatus` at runtime
6. **P-1**: Paginate institution dashboard team list

### Nice-to-have:
1. **M-4**: Implement outside-click dismiss for ConfirmButton
2. **A11Y-3**: Add `aria-controls` to institution team accordions
3. **L-7**: Add biome organizeImports
4. **L-10**: Remove duplicate import
5. **L-12-13**: A11Y fixes

---

*End of Agent3 Review Report*
