# PostgreSQL inventory

What the app stores, and which module owns each table. The schema itself is
`postgres/schema.sql`; this file is the map, not the source of truth.

## Tables

| Table | Rows are | Written by |
| --- | --- | --- |
| `users` | one account per person, `role` in `admin`/`coordinator`/`institution`/`lead` | `users` repository, `auth.server.ts` (hash upgrade), `password-reset.server.ts` |
| `institutions` | one campus, unique `code`, `max_teams` capacity | `institutions` repository |
| `teams` | one team per lead, `status` drives the whole event flow | `teams` repository, `team.server.ts` (transitions) |
| `members` | the roster of a team, unique on `(team_id, email)` | `members` repository |
| `questionnaire_responses` | one response per team, unique on `team_id` | `questionnaireResponses` repository |
| `status_transitions` | append-only audit log of team status changes | `statusTransitions` repository |
| `config` | one boolean row per event phase flag | `config` repository |

## Layers

```
routes/*.tsx            loaders + actions (secureLoader / secureAction)
  └── app/lib/team.server.ts        cross-route helpers: transitions, emails, campus-lead creation
        └── app/lib/db.server.ts    repositories; every query is parameterised and
                                    carries the §6.2 scope predicate in SQL
              └── pg Pool           one process-wide pool (max 10, 20 s statement timeout)
```

- **Scope predicates** live in `db.server.ts` (`teamScope`, `institutionScope`,
  `questionnaireScope`, `memberCreateScope`, `memberWriteScope`). They are the
  only authorization the database layer applies; route loaders never trust a
  client-supplied id.
- **Transactions** come from `withTransaction`. Repository calls made inside the
  callback join it through an `AsyncLocalStorage` client, so a multi-write
  sequence is all-or-nothing without threading a client parameter through every
  signature.
- **Migrations** are plain DDL: apply `postgres/schema.sql` to a fresh database.
  Every statement is idempotent, so re-running it is safe.

## Not in the database

- Session state — sessions are app-issued HS256 JWTs (`app/lib/jwt.server.ts`).
- Submission files — stored on the volume at `$UPLOADS_DIR/teams/<team id>/`;
  `teams.submission_file` holds the filename only.
