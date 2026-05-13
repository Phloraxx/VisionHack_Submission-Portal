# VisionHack Submission Portal

A hackathon submission portal for **Vision Hack 2026** — built with Next.js 16 + Appwrite (BaaS). It manages the full lifecycle from bulk campus lead creation to team registration, questionnaire submission, idea submission, and coordinator oversight.

---

## Architecture Overview

The portal implements a **cascade inviting system** with four hierarchical roles:

```
Admin → creates Campus Leads → creates Team Leads → register teams → submit ideas
```

| Role | Appwrite Label | Dashboard | Responsibility |
|------|---------------|-----------|---------------|
| Admin | `admin` | `/admin/dashboard` | Create campus leads in bulk via CSV, toggle config, view/edit all teams, export |
| Coordinator | `coordinator` | `/coordinator/dashboard` | View teams and institutions across districts |
| Campus Lead | `institution` | `/institution/dashboard` | Invite team leads, approve/shortlist teams (max 5) |
| Team Lead | `lead` | `/team/dashboard` | Register team, fill questionnaire, submit idea |

### Team Status Lifecycle

```
waitlisted → registered → questionnaire_submitted → shortlisted → idea_submitted → selected
```

---

## System Architecture

### Frontend — Next.js 16 App Router (Client Components)

All pages are client-side React components using the App Router:

- **`/auth/login`**, **`/auth/register`** — Authentication and public team registration
- **`/admin/*`** — Admin hub, campus lead creation, config toggles, team management, CSV export
- **`/institution/dashboard`** — Campus lead invite/approve workflows
- **`/team/*`** — Team registration, long-form questionnaire, idea submission with file upload
- **`/coordinator/*`** — District/institution filtered views, team detail with CSV download

**UI Layer:** Radix UI primitives (shadcn/ui style), Tailwind CSS v4, Framer Motion animations, Lucide icons, Sonner toasts.

### Backend — Appwrite (self-hosted BaaS)

- **Auth:** Email/password sessions with role labels
- **Database:** 7 collections — `institutions`, `teams`, `members`, `config`, `questionnaire_responses`, `themes`, `gallery`
- **Storage:** 2 buckets — `submissions` (PDF/PPT, 10MB) and `assets` (images, 5MB)
- **Users:** Managed server-side via API key

### API Routes (Next.js Route Handlers)

| Route | Purpose |
|-------|---------|
| `POST /api/auth/login` | Create Appwrite session |
| `GET|DELETE /api/auth/session` | Read or destroy session |
| `POST /api/admin/create-campus-leads` | Bulk-create campus leads from CSV |
| `GET|POST /api/admin/config` | Read/write config toggles |
| `POST /api/institution/create-team-leads` | Campus lead invites team leads |
| `GET /api/institutions/list` | List active institutions (for registration dropdown) |
| `POST /api/team/register` | Team lead registers team with members |
| `POST /api/team/public-register` | Public team registration (creates user + team) |
| `POST /api/team/submit-idea` | Submit idea with file upload |
| `GET /api/coordinator/teams` | List all teams with stats |
| `GET /api/coordinator/teams/[id]` | Single team detail + questionnaire |
| `GET /api/coordinator/institutions` | List institutions with team stats |

### Core Services (`src/lib/`)

- **`appwrite.ts`** — Client-side Appwrite SDK init, auth helpers, role detection
- **`appwrite-server.ts`** — Server-side client with API key
- **`auth-service.ts`** — User account creation, password generation, bulk operations
- **`email-service.ts`** — Nodemailer-based email with HTML templates (credentials delivery)
- **`server-auth.ts`** — Server-side session validation from cookie

---

## Data Flow

```
[Browser] ──→ Next.js Client Components
                │
                ├── Direct Appwrite SDK calls (reads: listDocuments)
                └── fetch() → Next.js API Routes → Appwrite SDK (writes: secured by API key)
                                                    │
                                                    └── Appwrite (self-hosted)
                                                        ├── Auth (sessions)
                                                        ├── Database (7 collections)
                                                        ├── Storage (2 buckets)
                                                        └── Users API (create accounts)
```

Write operations (team registration, campus lead creation, config changes) are routed through API handlers to keep the API key server-side. Read operations (team lists, institution data) often use the client SDK directly.

---

## Key Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.1 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Backend | Appwrite (self-hosted) |
| UI Components | Radix UI — shadcn/ui style |
| Animations | Framer Motion |
| Email | Nodemailer (Gmail SMTP) |
| Icons | Lucide React |
| Notifications | Sonner |
