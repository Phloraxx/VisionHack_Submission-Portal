# VisionHack Submission Portal — Rebuild Plan

## Tech Stack

- **Framework:** React Router 7 (framework mode) + Vite
- **Deployment:** Cloudflare Pages (via `@react-router/cloudflare` adapter)
- **UI:** React 19, shadcn/ui (Radix primitives, CVA, tailwind-merge, clsx), Tailwind CSS 4, Lucide icons, Sonner toasts, Geist font (`@fontsource/geist-sans`, `@fontsource/geist-mono`)
- **Validation:** Manual form validation with field-level error objects. Zod + `@coji/zodix` deferred — not yet integrated.
- **Backend:** PocketBase (separate service, accessed server-side over HTTP)
- **Email:** PocketBase SMTP via custom JS hook (`pb_hooks/send-invite.pb.js`). No external email service needed — SMTP is configured once in PocketBase Admin UI.
- **Languages:** TypeScript

## Architecture

- React Router 7 (framework mode) handles everything — pages and API (resource routes). No second framework.
- **SSR is app-wide** — RR7 does not support per-route `ssr: false`. We use `ssr: true` globally. Public pages (login, register) render server-side too; they simply don't require auth. If we later need SPA mode for specific routes, we'll handle it via conditional loader logic.
- PocketBase is called server-side only (in loaders/actions). The browser never connects to it directly.
- **PocketBase client:** Use the `pocketbase` JS SDK, but create a **new instance per request** (not a singleton). Workers V8 isolate runtime is compatible — the SDK uses standard Web APIs (`fetch`, `EventSource`, `AbortController`). No Node.js-specific APIs are needed since we don't use realtime subscriptions.
- Auth via httpOnly cookie holding a PocketBase JWT, validated by the server on every request (see [Auth Flow](#auth-flow) below).
- Form validation is manual (if/else checks with field error objects). `@coji/zodix` is documented as a future enhancement but not yet integrated.
- File uploads (idea PDF/PPT): action receives FormData, validates (type, size ≤ 10MB), stores in PocketBase, saves `submission_file` on team record.
- Dev command: `npm run dev` (Vite + HMR).
- **Scaffolding:** `npm create cloudflare@latest -- my-app --framework=react-router`

## PocketBase Instance

- **URL:** `http://vision-hack-pocketbase-gz1pzq-3a236c-144-24-114-90.sslip.io/`
- **Admin credentials:** stored in `.env` (`POCKETBASE_ADMIN_EMAIL`, `POCKETBASE_ADMIN_PASSWORD`)
- A `scripts/setup-pb.ts` script creates all 5 collections (institutions, teams, members, config, questionnaire_responses) from scratch, configures permissions, and seeds config rows. Run once at project setup. The script is idempotent — safe to run multiple times.

### PocketBase REST API Reference

All operations can also be done via raw `fetch` against the REST API (fallback if SDK issues arise):

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Auth user | POST | `/api/collections/users/auth-with-password` |
| Auth refresh | POST | `/api/collections/users/auth-refresh` |
| Auth superuser | POST | `/api/collections/_superusers/auth-with-password` |
| List records | GET | `/api/collections/{collection}/records?filter=...&sort=...` |
| Get record | GET | `/api/collections/{collection}/records/{id}` |
| Create record | POST | `/api/collections/{collection}/records` |
| Update record | PATCH | `/api/collections/{collection}/records/{id}` |
| Delete record | DELETE | `/api/collections/{collection}/records/{id}` |
| File upload | PATCH | `/api/collections/{collection}/records/{id}` (FormData) |

Auth header: `Authorization: <token>` (no "Bearer" prefix needed). Superuser tokens bypass all RLS.

## React Router 7 Gotchas

- **SSR is app-wide** — no per-route `ssr: false`. Config is `ssr: true` or `ssr: false` in `react-router.config.ts`, not per-route.
- **`@react-router/zod` doesn't exist** — use `@coji/zodix` for schema-validated form parsing (`zx.parseForm`, `zx.parseFormSafe`).
- **`json()` and `defer()` deprecated** — return plain objects from loaders/actions, or use `Response.json()`.
- **`CatchBoundary` removed** — use `ErrorBoundary` + `isRouteErrorResponse()`.
- **`formMethod` comparisons must be uppercase** — `navigation.formMethod === "POST"`, not `"post"`.
- **Route config via `routes.ts`** — routes not in `routes.ts` don't exist. No more file-convention routing.
- **`createRemixStub` → `createRoutesStub`** — for integration tests.
- **Cache-Control headers may be silently dropped** in Cloudflare Pages — known issue, set headers in the Pages Function instead of route loaders.
- **Type generation** — `react-router typegen` auto-generates types to `.react-router/` (gitignore this directory).

## PocketBase Collections

All collections are created by `scripts/setup-pb.ts`. All have null API rules (server-side access only via superuser token).

- **institutions** — name, district, code, campusLeadId (relation→users), maxTeams, status
- **teams** — name, institutionId (relation→institutions), leaderUserId (relation→users), teamCode, status (select: 7 values), status_changed_at (autodate, onCreate only), idea_title, idea_desc, idea_tech_stack, submission_file
- **members** — teamId (relation→teams, cascadeDelete), fullName, email, phone, gender, role
- **config** — key/value feature flags (registration_open, questionnaire_open, nomination_open, submission_open). Authenticated read access.
- **questionnaire_responses** — teamId (relation→teams, cascadeDelete), userId (relation→users), age, gender, education, college_name, district, skills, interests, challenges, experience, motivation, team_experience, expectations, additional_info
- **users** — PocketBase built-in auth collection with custom `role` field (admin, coordinator, institution, lead)

## Team Status State Machine

**7 states** (simplified from original 10-state spec — `questionnaire_submitted`, `idea_submitted`, `under_review`, and `ineligible` were merged/removed):

```
invited → registered → shortlisted → submitted → selected
                                               → rejected
any non-terminal state → withdrawn
```

Implemented in `app/lib/types.ts` as `TRANSITION_RULES` with role-gated `canTransition()`.

| From | To | Who can transition |
|------|----|--------------------|
| invited | registered | lead (completes registration) |
| registered | shortlisted | institution / coordinator / admin |
| shortlisted | registered | institution / coordinator / admin (unshortlist) |
| shortlisted | submitted | lead (submits idea) |
| submitted | selected | admin |
| submitted | rejected | admin |
| invited, registered, shortlisted, submitted | withdrawn | lead (self-withdraw) or admin |

**Note:** The questionnaire form (`/lead/questionnaire`) saves responses but does NOT transition team status. There is no `questionnaire_submitted` state in the current implementation.

Each status transition explicitly sets `status_changed_at` in code (not auto-updated by PocketBase). The field is configured as autodate with `onCreate: true, onUpdate: false`.

## Roles

| Role | Scope | Capabilities |
|------|-------|-------------|
| **admin** | System-wide | Full access: manage users, institutions, config, all teams, export data, change any team status |
| **coordinator** | System-wide (read), scoped write | View all teams, change team status (shortlist/reject), view submissions, add review notes. Cannot: create users, modify institutions, change config, export data |
| **institution** | Own institution | View/manage teams within their institution, nominate leads, view institution dashboard |
| **lead** | Own team | Register team, add members, submit questionnaire, submit idea, withdraw team |

Checked server-side in layout loaders via JWT role labels. Route protection uses `throw redirect()` from loaders — RR7 layout loaders run in parallel with child loaders, so auth checks must `throw redirect()` early to prevent child route execution.

## Auth Flow

### Login
```
POST /login (action)
  → const pb = new PocketBase(PB_URL)  // new instance per request
  → const authResult = await pb.collection('users').authWithPassword(email, password)
  → extract JWT from authResult.token
  → Set-Cookie: pb_jwt=<token>; HttpOnly; Secure; SameSite=Lax; Path=/
  → redirect to /dashboard
```

### Every authenticated request (layout loader)
```
Layout loader
  → read pb_jwt from cookie
  → if missing → throw redirect('/login')
  → const pb = new PocketBase(PB_URL)  // new instance per request
  → pb.authStore.save(token, null)
  → await pb.collection('users').authRefresh() (handles expiry, returns new token)
  → extract user.role from JWT claims
  → enforce role-based access
  → return { user, role } to route
  → if token was refreshed → set new cookie with updated JWT
```

### Logout
```
POST /logout (action)
  → Set-Cookie: pb_jwt=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0
  → redirect to /login
```

### Password Reset
```
POST /forgot-password (action)
  → const pb = new PocketBase(PB_URL)
  → await pb.collection('users').requestPasswordReset(email)
  → PocketBase sends reset link via configured SMTP
  → user clicks link → POST /reset-password with new password
```

### CSRF Protection
- All mutation actions validate `Origin` header matches expected domain
- JWT cookie set with `SameSite=Lax`
- For extra safety on status-change actions: add a CSRF token (double-submit cookie pattern or meta tag in form)

## Email Queue Strategy

**Current:** Emails are sent inline via `POST /api/send-invite` — a custom PocketBase JS hook that uses PocketBase's configured SMTP. For bulk operations, this will hit Cloudflare Workers' 30s execution limit.

**Deferred:** Email queue (Cloudflare Queues or PocketBase `email_queue` collection + cron). Not yet implemented. For MVP scale, inline sending is acceptable.

## Research: CI/CD

- **Frontend (Cloudflare Pages):** Official `@react-router/cloudflare` adapter. Use Cloudflare Workers Builds (native CI/CD) → auto-deploy on push to `main`, preview deployments on PRs. Deploy: `npx wrangler pages deploy build/client`.
- **PocketBase:** Already deployed. Updates via GitHub Actions → SSH → pull binary → restart service.

## Research: Testing Strategy

**Stack:**
- **Vitest** — unit tests (reuses Vite config, 10-40x faster than Jest)
- **React Testing Library** — component tests
- **Playwright** — E2E tests

**Layers:**
1. **Unit tests:** Loaders/actions are plain async functions — test directly with Vitest
2. **Integration tests:** Route components with `createRoutesStub` (replaces `createRemixStub`)
3. **E2E tests:** Playwright, real browser. Test SSR hydration explicitly (disable JS)

**Scripts:**
```json
{
  "test": "vitest run",
  "test:e2e": "playwright test",
  "test:coverage": "vitest run --coverage"
}
```

## Research: Rate Limiting

**PocketBase built-in** (Dashboard > Settings > Rate limiting):
- IP-based token bucket
- Rules by collection+action (`users:create`, `*:create`), path, or audience (`@guest`, `@auth`, `all`)
- Skipped for superusers

**Recommended rules:**
- Guest auth endpoints: 10 req/min
- Authenticated API: 100 req/min
- File uploads: 5 req/min

PocketBase's built-in rate limiting is sufficient for this use case. No custom middleware needed initially.

## Migration Strategy

The existing portal (Next.js + Appwrite) has no production data — only the schema needs to be recreated in PocketBase.

1. **Schema recreation** — `scripts/setup-pb.ts` creates all PocketBase collections with the correct fields, types, relations, and rules
2. **Seed data** — Script seeds `config` collection with feature flags and creates the initial admin user
3. **Validate** — Verify collections, relations, and permissions match the spec

## Estimated Monthly Cost

| Service | Cost |
|---------|------|
| PocketBase hosting | Already provisioned |
| Cloudflare Pages | Free |
| Email (SMTP) | $0 (uses PocketBase SMTP) |
| **Total** | **~$0/mo** |