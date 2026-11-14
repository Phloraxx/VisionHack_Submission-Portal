# VisionHack Submission Portal

Hackathon submissions for a four-level invite chain: **admin → campus lead → team lead → submission**. Built for VisionHack 2026 and running at [portal.mulearn.org](https://portal.mulearn.org).

Campus leads invite their own team leads, team leads register their team and submit, and admins run the event from a single config screen without touching the database.

## Roles

| Role | Can do |
| --- | --- |
| `admin` | Everything: invite campus leads, shortlist, transition teams, export, open and close phases |
| `coordinator` | Review and shortlist teams across institutions, filterable by district |
| `institution` | Campus-scoped oversight of its own teams and shortlisting |
| `lead` | Invite team leads, register teams, submit ideas, track status |

Every route loader and action checks the role server-side. The team detail route is shared and scoped by loader, not by hiding UI.

## Phases

The event runs as four gated phases, toggled from `admin/config` and enforced server-side:

1. **Registration** — campus leads invite team leads
2. **Questionnaire** — teams submit their questionnaire
3. **Nomination** — campus leads shortlist teams
4. **Submission** — teams submit their idea

A team moves `invited → registered → shortlisted → submitted → selected | rejected | withdrawn`. The allowed transitions and the roles permitted to make them live in one state machine (`app/lib/transitions.ts`), so a lead cannot shortlist their own team and a coordinator cannot submit on a team's behalf.

## Stack

- **React Router v7** in framework mode (SSR, nested layouts, resource routes for the API)
- **React 19**, **Tailwind v4**, Radix UI, `lucide-react`
- **PocketBase** for records, file storage and rules; collection schema is provisioned by script, not by hand
- **Zod** + `react-hook-form` for every form, validated again on the server
- **Sentry** for server errors, **Resend** for status-change email
- **Biome** for lint and format, **Vitest** for unit tests, **Playwright** for end-to-end

## Local setup

You need Node 22 and a PocketBase instance.

```bash
npm ci
cp .env.example .env          # set POCKETBASE_URL and the admin credentials
npm run setup:pb              # create collections, indexes and API rules
npm run dev                   # http://localhost:5173
```

`setup:pb` is idempotent: it creates missing collections, repairs drifted ones, and seeds the `config` record that holds the phase flags.

## Configuration

| Variable | Purpose |
| --- | --- |
| `POCKETBASE_URL` | PocketBase base URL, no trailing slash |
| `POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` | Used only by `setup:pb` |
| `APP_URL` | Public base URL, used to build absolute links in email |
| `ALLOWED_ORIGINS` | Extra allowed `Origin` values beyond the localhost dev ports |
| `RESEND_API_KEY` | Transactional email; skipped with a console warning when unset |
| `SENTRY_DSN` | Optional error reporting |
| `TRUST_PROXY_HEADERS` | Set when running behind a proxy that sets client IP headers |

## Tests

```bash
npm run typecheck     # react-router typegen + tsc -b
npm test              # Vitest
npm run lint          # Biome
npm run test:e2e      # Playwright
```

CI runs typecheck, unit tests, lint and build on every push. Deployment is gated on CI success.

## Deployment

The `Dockerfile` is a three-stage build (deps → build → runtime) producing a Node 22 image that serves the React Router server build. Production deploys are triggered from CI through a Dokploy webhook, so a red build never reaches the live site.

## Security notes

- Sessions are an httpOnly cookie with a one-hour lifetime; PocketBase rules read the role from the JWT claims.
- Every mutating action goes through a `secureAction` wrapper that validates the request origin, parses and validates the form against a Zod schema, and re-checks the session and role before the handler runs.
- Login and password reset are rate-limited per client.
- Uploads are restricted to PDF and PowerPoint, capped at 10 MB, and validated server-side before they reach PocketBase.
- The PocketBase admin credentials are used by the setup script only. They are never read at request time.

## License

[MIT](LICENSE) © 2026 Sourav P Bijoy
