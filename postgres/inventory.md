# PocketBase call-site inventory (raw)

Backing data for `docs/PG_PORT_PLAN.md` §3. Every row is a literal
`pb.collection("<name>")` call site in `app/` or `server.ts`, with the SDK
method it invokes and the PocketBase feature it depends on.

Generated from the working tree at branch `pg-port`, commit `72c40af`.

## How this was produced

```bash
grep -rn "collection(" app server.ts          # 81 matching lines
grep -rho 'collection("[a-z_]*")' app server.ts | sort | uniq -c
```

`grep -c "collection(" app server.ts` as written in the task returns `0` for
both operands: `app` is a directory (GNU grep prints `grep: app: Is a
directory` and exits non-zero for it) and `server.ts` contains no match. The
recursive equivalent is the number that matters:

| Measure | Count |
| --- | --- |
| `grep -rn "collection(" app server.ts \| wc -l` | **81** |
| `grep -ro "collection(" app server.ts \| wc -l` (occurrences) | 81 |
| Rows in the CRUD tables below | **80** |
| Deliberately excluded | **1** — `app/lib/loader.server.ts:40` |

### The one excluded line

`app/lib/loader.server.ts:40` is inside the JSDoc block for `secureLoader`:

```ts
 *     const items = await pb.collection("...").getList(1, 10);
```

It is documentation, not a call site (`"..."` is not a collection name). It is
the only line matching `collection(` that is not executable code, so
**81 − 1 = 80** CRUD rows below.

### Collection-name tally (80 call sites)

| Collection | Call sites |
| --- | --- |
| `teams` | 25 |
| `users` | 15 |
| `institutions` | 13 |
| `members` | 13 |
| `questionnaire_responses` | 7 |
| `status_transitions` | 4 |
| `config` | 3 |
| **Total** | **80** |

---

## 1. `app/lib/` — shared server helpers

| # | file:line | collection | method | PB feature | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | `app/lib/auth.server.ts:83` | `users` | `authWithPassword` | auth (email/password) | `login()`. Returns `{ token, record }`; token goes into `__Host-pb_jwt`. |
| 2 | `app/lib/auth.server.ts:179` | `users` | `authRefresh` | authRefresh | Near-expiry rotation inside `resolveAuth`; reads `pb.authStore.model` + `.token` afterwards (lines 183–186). |
| 3 | `app/lib/auth.server.ts:192` | `users` | `getOne` | get | Healthy-token path: loads the live `role`/`institutionId` once per request. |
| 4 | `app/lib/config.server.ts:18` | `config` | `getList` | list | Page 1, perPage 100. Builds the `Record<string, boolean>` flag map; skips `schema_version` and `_`-prefixed keys. |
| 5 | `app/lib/team.server.ts:29` | `teams` | `getFirstListItem` | getFirstListItem + filter | `leaderUserId = {:userId}`; optional `fields`/`expand` passthrough. |
| 6 | `app/lib/team.server.ts:43` | `institutions` | `getFirstListItem` | getFirstListItem + filter | `campusLeadId = {:id}`. |
| 7 | `app/lib/team.server.ts:57` | `members` | `getFullList` | getFullList + filter | OR-chain `teamId = {:t0} \|\| …`; `fields: "teamId"`. |
| 8 | `app/lib/team.server.ts:103` | `teams` | `getOne` | get | `fields: "id,status,institutionId"` before a transition. |
| 9 | `app/lib/team.server.ts:124` | `teams` | `update` | update + optimistic lock | Writes `status` + `status_changed_at`; `query.expectedStatus` is enforced by the PB `updateRule`; `$autoCancel: false`. |
| 10 | `app/lib/team.server.ts:146` | `status_transitions` | `create` | create | Audit row; wrapped in try/catch, never fails the transition. |
| 11 | `app/lib/team.server.ts:251` | `institutions` | `create` | create | Campus-lead flow step 1 (`campusLeadId: null`). |
| 12 | `app/lib/team.server.ts:262` | `users` | `create` | create | `password` + `passwordConfirm` = random UUID; `role: "institution"`. |
| 13 | `app/lib/team.server.ts:273` | `institutions` | `update` | update | Back-links `campusLeadId`. |
| 14 | `app/lib/team.server.ts:280` | `users` | `delete` | delete | Best-effort rollback of a partially created campus lead. |
| 15 | `app/lib/team.server.ts:286` | `institutions` | `delete` | delete | Best-effort rollback. |
| 16 | `app/lib/team.server.ts:294` | `users` | `requestPasswordReset` | password-reset email | Best-effort; failure is logged only. |

## 2. `app/routes/lead/`

| # | file:line | collection | method | PB feature | Notes |
| --- | --- | --- | --- | --- | --- |
| 17 | `app/routes/lead/register.tsx:86` | `members` | `getList` | list + filter | `teamId = {:teamId}`, perPage 500. |
| 18 | `app/routes/lead/register.tsx:156` | `teams` | `update` | update + optimistic lock | Re-register path; `query.expectedStatus`, `$autoCancel: false`. |
| 19 | `app/routes/lead/register.tsx:187` | `institutions` | `getFirstListItem` | getFirstListItem + filter | `id = {:id}`, `fields: "id,maxTeams"` (capacity check). |
| 20 | `app/routes/lead/register.tsx:191` | `teams` | `getList` | list + filter | Count query, perPage 1, `fields: "id"`. |
| 21 | `app/routes/lead/register.tsx:202` | `teams` | `create` | create | New team, `status: "registered"`. |
| 22 | `app/routes/lead/register.tsx:212` | `status_transitions` | `create` | create | `fromStatus: ""` on self-registration. |
| 23 | `app/routes/lead/register.tsx:256` | `members` | `create` | create | Inside `Promise.allSettled`, one per member. |
| 24 | `app/routes/lead/register.tsx:268` | `members` | `delete` | delete | Rollback of created members on partial failure. |
| 25 | `app/routes/lead/register.tsx:278` | `members` | `getFullList` | getFullList + filter | `teamId = {:teamId}`, `fields: "id"`. |
| 26 | `app/routes/lead/register.tsx:282` | `members` | `delete` | delete | Deletes old members after all creates succeed. |
| 27 | `app/routes/lead/questionnaire.tsx:97` | `questionnaire_responses` | `getFirstListItem` | getFirstListItem + filter | `teamId = {:teamId}`; `.catch(() => null)`. |
| 28 | `app/routes/lead/questionnaire.tsx:149` | `questionnaire_responses` | `getFirstListItem` | getFirstListItem + filter | Upsert probe, `fields: "id"`. |
| 29 | `app/routes/lead/questionnaire.tsx:174` | `questionnaire_responses` | `update` | update | Existing response. |
| 30 | `app/routes/lead/questionnaire.tsx:176` | `questionnaire_responses` | `create` | create | First response. |
| 31 | `app/routes/lead/questionnaire.tsx:182` | `teams` | `update` | update | Denormalizes `questionnaire_completed: true`. |
| 32 | `app/routes/lead/dashboard.tsx:62` | `members` | `getList` | list + filter | Count only, perPage 1, `fields: "id"`. |
| 33 | `app/routes/lead/dashboard.tsx:70` | `institutions` | `getOne` | get | `fields: "id,campusLeadId"`. |
| 34 | `app/routes/lead/dashboard.tsx:85` | `users` | `getOne` | get | `fields: "name,email"` for the campus-lead card. |
| 35 | `app/routes/lead/submit-idea.tsx:130` | `teams` | `update` | update + **file upload** + optimistic lock | Multipart `FormData` carrying `submission_file`; `query.expectedStatus`; `$autoCancel: false`. |
| 36 | `app/routes/lead/submit-idea.tsx:143` | `status_transitions` | `create` | create | Audit row for `→ submitted`. |
| 37 | `app/routes/lead/submit-idea.tsx:160` | `teams` | `update` | update + optimistic lock | Text-only re-submit when a file already exists. |
| 38 | `app/routes/lead/submit-idea.tsx:182` | `status_transitions` | `create` | create | Audit row for the text-only path. |

## 3. `app/routes/institution/`

| # | file:line | collection | method | PB feature | Notes |
| --- | --- | --- | --- | --- | --- |
| 39 | `app/routes/institution/dashboard.tsx:84` | `teams` | `getList` | list + filter + expand + fields + sort | `institutionId = {:institutionId}`, `expand: "leaderUserId"`, `sort: "-created"`. |
| 40 | `app/routes/institution/dashboard.tsx:105` | `members` | `getList` | list + **relation traversal filter** | `teamId.institutionId = {:instId}` — PB-only syntax, no SQL equivalent without a join. |
| 41 | `app/routes/institution/dashboard.tsx:152` | `teams` | `getList` | list + filter | Capacity count, perPage 1, `fields: "id"`. |
| 42 | `app/routes/institution/dashboard.tsx:159` | `users` | `getFirstListItem` | getFirstListItem + filter | `email = {:email}`, `fields: "id,role"`. |
| 43 | `app/routes/institution/dashboard.tsx:185` | `users` | `create` | create | Invite lead: random password, `role: "lead"`, `institutionId`. |
| 44 | `app/routes/institution/dashboard.tsx:197` | `users` | `requestPasswordReset` | password-reset email | Best-effort invite email. |
| 45 | `app/routes/institution/dashboard.tsx:205` | `teams` | `getFirstListItem` | getFirstListItem + filter | `leaderUserId = {:leaderUserId} && institutionId = {:institutionId}`. |
| 46 | `app/routes/institution/dashboard.tsx:222` | `teams` | `create` | create | `status: "invited"`. |
| 47 | `app/routes/institution/dashboard.tsx:266` | `teams` | `getOne` | get + expand + fields | `expand: "leaderUserId"` for the notification email. |

## 4. `app/routes/admin/`

| # | file:line | collection | method | PB feature | Notes |
| --- | --- | --- | --- | --- | --- |
| 48 | `app/routes/admin/dashboard.tsx:38` | `teams` | `getList` | list + filter | 7 parallel count queries (one per status), perPage 1, `fields: "id"`. |
| 49 | `app/routes/admin/dashboard.tsx:43` | `institutions` | `getList` | list | Count via `totalItems`, `fields: "id"`. |
| 50 | `app/routes/admin/dashboard.tsx:44` | `users` | `getList` | list | Count via `totalItems`, `fields: "id"`. |
| 51 | `app/routes/admin/teams.tsx:50` | `teams` | `getList` | list + filter + expand + fields + sort | Page slice, `expand: "institutionId,leaderUserId"`. |
| 52 | `app/routes/admin/teams.tsx:57` | `teams` | `getList` | list + filter | Count scan capped at 500, `fields: "id,status"`, `$autoCancel: false`. |
| 53 | `app/routes/admin/campus-leads.tsx:61` | `institutions` | `getList` | list + expand + sort | `expand: "campusLeadId"`, `sort: "-created"`, perPage 1000. |
| 54 | `app/routes/admin/campus-leads.tsx:109` | `institutions` | `getFirstListItem` | getFirstListItem + filter | `code = {:code}` uniqueness probe. |
| 55 | `app/routes/admin/campus-leads.tsx:113` | `users` | `getFirstListItem` | getFirstListItem + filter | `email = {:email}` uniqueness probe. |
| 56 | `app/routes/admin/campus-leads.tsx:225` | `institutions` | `getFirstListItem` | getFirstListItem + filter | Bulk CSV path, `code = {:code}`. |
| 57 | `app/routes/admin/campus-leads.tsx:239` | `users` | `getFirstListItem` | getFirstListItem + filter | Bulk CSV path, `email = {:email}`. |
| 58 | `app/routes/admin/config.tsx:42` | `config` | `getFirstListItem` | getFirstListItem + filter | `key = {:key}`. |
| 59 | `app/routes/admin/config.tsx:55` | `config` | `update` | update | Server-authoritative toggle (`value`). |
| 60 | `app/routes/admin/export.tsx:31` | `teams` | `getList` | list + expand + fields + sort | Export page metadata, perPage 500. |
| 61 | `app/routes/admin/export.tsx:37` | `members` | `getList` | list + fields | `fields: "teamId"` only. |

## 5. `app/routes/coordinator/`

| # | file:line | collection | method | PB feature | Notes |
| --- | --- | --- | --- | --- | --- |
| 62 | `app/routes/coordinator/dashboard.tsx:56` | `institutions` | `getList` | list + expand + sort + fields | `expand: "campusLeadId"`, `sort: "name"`, perPage 200. |
| 63 | `app/routes/coordinator/dashboard.tsx:121` | `teams` | `getList` | list + filter + expand + sort + fields | Page slice; district filter expands to an OR-chain of `institutionId = {:id_N}`. |
| 64 | `app/routes/coordinator/dashboard.tsx:128` | `teams` | `getList` | list + filter + fields | Count scan capped at 1000, `fields: "status,institutionId"`. |

## 6. `app/routes/api/`

| # | file:line | collection | method | PB feature | Notes |
| --- | --- | --- | --- | --- | --- |
| 65 | `app/routes/api/files.ts:45` | `teams` | `getOne` | get | `fields: "id,institutionId,leaderUserId,submission_file"` for the ownership check. |
| 66 | `app/routes/api/export/csv.ts:46` | `teams` | `getList` | list + filter + expand + sort | `expand: "institutionId,leaderUserId"`, `sort: "-created"`, perPage 500. |
| 67 | `app/routes/api/export/csv.ts:62` | `members` | `getList` | list + filter | OR-chain over the exported team ids. |
| 68 | `app/routes/api/institutions.ts:19` | `institutions` | `getList` | list + sort + fields | Admin/coordinator branch, `fields: "id,name,district,code"`. |
| 69 | `app/routes/api/institutions.ts:40` | `institutions` | `getOne` | get | Non-admin branch, `fields: "id,name,district"`. |

## 7. `app/routes/` — auth surfaces

| # | file:line | collection | method | PB feature | Notes |
| --- | --- | --- | --- | --- | --- |
| 70 | `app/routes/login.tsx:32` | `users` | `authRefresh` | authRefresh | Already-logged-in redirect; reads `pb.authStore.model` (33) and `.token` (40). |
| 71 | `app/routes/forgot-password.tsx:45` | `users` | `requestPasswordReset` | password-reset email | Always returns `{ sent: true }`; errors swallowed. |

---

## 8. Non-CRUD PocketBase surface

These are not `collection(...)` lines but must be replaced by the port.

| file:line | PB feature | Notes |
| --- | --- | --- |
| `app/lib/pocketbase.server.ts:36` | `new PocketBase(baseURL)` | Client construction. |
| `app/lib/pocketbase.server.ts:37-41` | `beforeSend` hook | Injects a 20 s `fetch` timeout into every request. |
| `app/lib/pocketbase.server.ts:51` | `getEnv().POCKETBASE_URL` | Base URL from env. |
| `app/lib/pocketbase.server.ts:57` | `authStore.save(token, null)` | Attaches a user token to a fresh client. |
| `app/lib/auth.server.ts:183,185,186` | `authStore.model` / `.token` | Post-refresh user + rotated token. |
| `app/routes/login.tsx:33,40` | `authStore.model` / `.token` | Same, on the login redirect path. |
| `app/routes/api/files.ts:79` | `pb.files.getToken()` | Short-lived protected-file token; the only file-token call site. |
| `app/routes/admin/dashboard.tsx:21` | `pb.autoCancellation(false)` | Disables SDK request de-duplication. |
| `app/routes/institution/dashboard.tsx:73` | `pb.autoCancellation(false)` | Same. |
| `app/routes/coordinator/dashboard.tsx:41` | `pb.autoCancellation(false)` | Same. |
| `app/lib/team.server.ts:132` | `$autoCancel: false` | Per-request opt-out on the transition update. |
| `app/routes/lead/register.tsx:165` | `$autoCancel: false` | Same. |
| `app/routes/lead/submit-idea.tsx:132,171` | `$autoCancel: false` | Same. |
| `app/routes/admin/teams.tsx:60` | `$autoCancel: false` | Same. |
| 36 sites (see below) | `pb.filter("… {:param}", {…})` | Parameterised filter builder. |

### `pb.filter` sites (36)

| File | Count |
| --- | --- |
| `app/routes/teams.team-id.tsx` | 6 |
| `app/routes/institution/dashboard.tsx` | 5 |
| `app/routes/lead/register.tsx` | 4 |
| `app/routes/admin/campus-leads.tsx` | 4 |
| `app/routes/coordinator/dashboard.tsx` | 4 |
| `app/lib/team.server.ts` | 3 |
| `app/routes/api/export/csv.ts` | 3 |
| `app/routes/lead/questionnaire.tsx` | 2 |
| `app/routes/admin/teams.tsx` | 2 |
| `app/routes/lead/dashboard.tsx` | 1 |
| `app/routes/admin/dashboard.tsx` | 1 |
| `app/routes/admin/config.tsx` | 1 |

### `expand` sites (13)

`admin/campus-leads.tsx:75`, `admin/export.tsx:32`, `admin/teams.tsx:52`,
`api/export/csv.ts:48`, `coordinator/dashboard.tsx:57,123`,
`institution/dashboard.tsx:88,267`, `lead/dashboard.tsx:44`,
`teams.team-id.tsx:52,85,125,194`.

### `fields` projections (30)

Used to trim payloads. Every one of them is a column list that maps 1:1 to a
SQL `SELECT` list; `expand.<relation>.<field>` entries become joins.

---

## 9. `scripts/setup-pb.ts` — admin API (not SDK, deleted by the port)

The setup script talks to the PocketBase REST API with raw `fetch`, not the
SDK. It is the schema source of truth for this port and is replaced by
`postgres/schema.sql`.

| file:line | PB feature | Notes |
| --- | --- | --- |
| `scripts/setup-pb.ts:103` | admin auth | `POST /api/collections/_superusers/auth-with-password`. |
| `scripts/setup-pb.ts:122` | collections API | `GET /api/collections/{name}`. |
| `scripts/setup-pb.ts:132` | collections API | `GET /api/collections` (name → id map for relations). |
| `scripts/setup-pb.ts:362` | collections API | `POST /api/collections` (create). |
| `scripts/setup-pb.ts:380` | collections API | `PATCH /api/collections/{name}` (fields, indexes, rules). |
| `scripts/setup-pb.ts:397` | records API | `POST /api/collections/{name}/records` (config seed). |
| `scripts/setup-pb.ts:989` | records API | `GET /api/collections/config/records` (seed check). |
| `scripts/setup-pb.ts:1039` | records API | `GET /api/collections/config/records` (post-seed verify). |
| `scripts/setup-pb.ts:1271` | settings API | `GET /api/settings` (rate limits). |
| `scripts/setup-pb.ts:1282` | settings API | `PATCH /api/settings` (rate limits). |
| `scripts/setup-pb.ts:1411` | records API | `GET /api/collections/config/records?filter=key="schema_version"`. |
| `scripts/setup-pb.ts:1422` | records API | `PATCH /api/collections/config/records/{id}`. |
| `scripts/setup-pb.ts:1430` | records API | `POST /api/collections/config/records`. |

---

## 10. Totals

| Category | Count |
| --- | --- |
| `collection(` lines in `app/` + `server.ts` | 81 |
| Excluded (JSDoc example, `loader.server.ts:40`) | 1 |
| **CRUD call-site rows (tables 1–7)** | **80** |
| Non-CRUD PB surface rows (§8) | 15 + 36 `pb.filter` + 13 `expand` + 30 `fields` |
| Setup-script admin API rows (§9) | 13 |

## Addendum (15 Nov review): the 9 rows pass 1 omitted

Counted in the per-collection tally but missing from the row tables above.
All in app/routes/teams.team-id.tsx. The port covers all 80 sites.

| File:line | Call | Method |
| --- | --- | --- |
| app/routes/teams.team-id.tsx:58 | members | getList |
| app/routes/teams.team-id.tsx:62 | questionnaire_responses | getFirstListItem |
| app/routes/teams.team-id.tsx:83 | teams | getOne |
| app/routes/teams.team-id.tsx:97 | members | getList |
| app/routes/teams.team-id.tsx:101 | questionnaire_responses | getFirstListItem |
| app/routes/teams.team-id.tsx:123 | teams | getOne |
| app/routes/teams.team-id.tsx:131 | members | getList |
| app/routes/teams.team-id.tsx:135 | questionnaire_responses | getFirstListItem |
| app/routes/teams.team-id.tsx:192 | teams | getOne |
