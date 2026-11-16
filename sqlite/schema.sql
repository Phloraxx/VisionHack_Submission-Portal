-- =============================================================================
-- VisionHack Submission Portal — SQLite 3.35+ schema
-- =============================================================================
--
-- Dialect translation of `postgres/schema.sql`. Same seven tables, same
-- columns, same CHECK constraints, same indexes, same `updated_at` trigger
-- behaviour and the same config seed. Read the Postgres file for the
-- provenance of every column (PocketBase field names, why some are absent).
--
-- What changed and why
-- --------------------
--   * `uuid`            → `TEXT`. Ids are generated app-side with
--                         `crypto.randomUUID()` (see `app/lib/db.server.ts`);
--                         SQLite has no `gen_random_uuid()`.
--   * `timestamptz`     → `TEXT` holding ISO-8601 UTC with milliseconds
--                         (`2026-11-16T18:09:51.123Z`). Every writer produces
--                         that exact shape — `strftime('%Y-%m-%dT%H:%M:%fZ')`
--                         here, `Date.toISOString()` in the app — so lexical
--                         comparison is chronological and `ORDER BY` works.
--   * `boolean`         → `INTEGER` 0/1 with a CHECK. SQLite has no boolean
--                         type; the db layer maps 0/1 → true/false.
--   * `double precision`→ `REAL` (`questionnaire_responses.age`).
--   * `varchar(n)`      → `TEXT`. SQLite ignores lengths, and the Zod schemas
--                         already enforce every limit before a write.
--   * `COMMENT ON`      → ordinary `--` comments (SQLite has no catalogue).
--   * `CREATE OR REPLACE FUNCTION` + plpgsql trigger → one `AFTER UPDATE`
--                         trigger per table that rewrites `updated_at`.
--                         `recursive_triggers` is OFF by default, so the
--                         trigger's own UPDATE does not re-fire it.
--   * `ALTER TABLE … ADD COLUMN IF NOT EXISTS` → not supported. The additive
--                         `year_of_graduation` migration is folded into the
--                         CREATE TABLE below; the db layer applies the column
--                         to pre-existing databases (see `ensureSchema`).
--
-- Idempotency contract
-- --------------------
-- Every statement is safe to re-run: `CREATE TABLE IF NOT EXISTS`,
-- `CREATE INDEX IF NOT EXISTS`, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`,
-- and a config seed guarded by `ON CONFLICT (key) DO NOTHING`. The db layer
-- applies the whole file inside one transaction, so a failure leaves no
-- partial schema.
--
-- Deliberately absent
-- -------------------
--   * PRAGMAs. `journal_mode`, `synchronous`, `foreign_keys` and
--     `busy_timeout` are per-connection settings owned by
--     `app/lib/db.server.ts`, not properties of the file on disk.
--   * `STRICT` tables. They would reject the numeric/boolean coercions the
--     db layer performs on bind; the CHECK constraints below carry the real
--     invariants.
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. institutions
-- -----------------------------------------------------------------------------
-- `campus_lead_id` references `users`, which is created next. SQLite does not
-- resolve foreign-key targets at CREATE TABLE time, and nothing is inserted
-- until this whole file has run, so the forward reference is safe — and it
-- keeps the constraint inline, which is the only form SQLite supports.

CREATE TABLE IF NOT EXISTS institutions (
	id             TEXT PRIMARY KEY NOT NULL,
	name           TEXT NOT NULL,
	district       TEXT,
	code           TEXT NOT NULL,
	campus_lead_id TEXT REFERENCES users (id) ON DELETE SET NULL,
	max_teams      INTEGER,
	-- Nullable, unlike postgres/schema.sql, because the live database drifted:
	-- 11 of its 24 rows have a NULL status (the column there has no NOT NULL and
	-- no default). The app only ever reads it through `row.status ?? ""`, so
	-- preserving NULL keeps the rendered output identical; forcing a value here
	-- would silently rewrite data during the migration.
	status         TEXT DEFAULT 'active',
	created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- PocketBase institutions.maxTeams (number, onlyInt, min 0). 0 or NULL means
-- unlimited. Enforced here because a negative cap would silently disable the
-- SEC-9 capacity check.

-- -----------------------------------------------------------------------------
-- 2. users
-- -----------------------------------------------------------------------------
-- PocketBase's built-in auth collection. `password_hash` holds a bcrypt hash
-- ($2a$/$2b$) on migration and is rehashed to argon2id ($argon2id$) on the
-- next successful login.

CREATE TABLE IF NOT EXISTS users (
	id               TEXT PRIMARY KEY NOT NULL,
	email            TEXT NOT NULL,
	email_visibility INTEGER NOT NULL DEFAULT 0 CHECK (email_visibility IN (0, 1)),
	verified         INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
	password_hash    TEXT NOT NULL,
	name             TEXT,
	role             TEXT NOT NULL,
	institution_id   TEXT REFERENCES institutions (id) ON DELETE SET NULL,
	created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	CONSTRAINT users_role_check CHECK (role IN ('admin', 'coordinator', 'institution', 'lead'))
);

-- -----------------------------------------------------------------------------
-- 3. teams
-- -----------------------------------------------------------------------------
-- `submission_file` stores the filename of the object under
-- $UPLOADS_DIR/teams/<team_id>/ — the bytes never enter the database.

CREATE TABLE IF NOT EXISTS teams (
	id                      TEXT PRIMARY KEY NOT NULL,
	name                    TEXT NOT NULL,
	institution_id          TEXT NOT NULL REFERENCES institutions (id) ON DELETE RESTRICT,
	leader_user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
	team_code               TEXT,
	status                  TEXT NOT NULL,
	status_changed_at       TEXT,
	questionnaire_completed INTEGER NOT NULL DEFAULT 0 CHECK (questionnaire_completed IN (0, 1)),
	idea_title              TEXT,
	idea_desc               TEXT,
	idea_tech_stack         TEXT,
	submission_file         TEXT,
	created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	CONSTRAINT teams_status_check CHECK (
		status IN (
			'invited',
			'registered',
			'shortlisted',
			'submitted',
			'selected',
			'rejected',
			'withdrawn'
		)
	)
);

-- -----------------------------------------------------------------------------
-- 4. members
-- -----------------------------------------------------------------------------
-- PocketBase cascadeDelete: true on teamId.

CREATE TABLE IF NOT EXISTS members (
	id         TEXT PRIMARY KEY NOT NULL,
	team_id    TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
	full_name  TEXT NOT NULL,
	email      TEXT NOT NULL,
	phone      TEXT,
	gender     TEXT,
	role       TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- -----------------------------------------------------------------------------
-- 5. questionnaire_responses
-- -----------------------------------------------------------------------------
-- One response per team (unique index below). cascadeDelete: true on teamId,
-- false (RESTRICT) on userId.

CREATE TABLE IF NOT EXISTS questionnaire_responses (
	id                 TEXT PRIMARY KEY NOT NULL,
	team_id            TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
	user_id            TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
	age                REAL,
	gender             TEXT,
	education          TEXT,
	college_name       TEXT,
	district           TEXT,
	skills             TEXT,
	interests          TEXT,
	challenges         TEXT,
	experience         TEXT,
	motivation         TEXT,
	team_experience    TEXT,
	expectations       TEXT,
	additional_info    TEXT,
	year_of_graduation TEXT,
	created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- -----------------------------------------------------------------------------
-- 6. status_transitions
-- -----------------------------------------------------------------------------
-- Audit log written after a successful team transition; a failure never fails
-- the transition itself. `from_status` allows '' because self-registration
-- logs fromStatus: "".

CREATE TABLE IF NOT EXISTS status_transitions (
	id            TEXT PRIMARY KEY NOT NULL,
	team_id       TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
	actor_user_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
	from_status   TEXT NOT NULL,
	to_status     TEXT NOT NULL,
	role          TEXT NOT NULL,
	at            TEXT NOT NULL,
	created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	CONSTRAINT status_transitions_from_status_check CHECK (
		from_status IN (
			'',
			'invited',
			'registered',
			'shortlisted',
			'submitted',
			'selected',
			'rejected',
			'withdrawn'
		)
	),
	CONSTRAINT status_transitions_to_status_check CHECK (
		to_status IN (
			'invited',
			'registered',
			'shortlisted',
			'submitted',
			'selected',
			'rejected',
			'withdrawn'
		)
	),
	CONSTRAINT status_transitions_role_check CHECK (
		role IN ('admin', 'coordinator', 'institution', 'lead')
	)
);

-- -----------------------------------------------------------------------------
-- 7. config
-- -----------------------------------------------------------------------------
-- Phase gates read by getConfig(). `value` is NOT NULL DEFAULT 0 because
-- PocketBase's bool field was optional and the app treats a missing value as
-- false.

CREATE TABLE IF NOT EXISTS config (
	id         TEXT PRIMARY KEY NOT NULL,
	key        TEXT NOT NULL,
	value      INTEGER NOT NULL DEFAULT 0 CHECK (value IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- -----------------------------------------------------------------------------
-- 8. Indexes
-- -----------------------------------------------------------------------------
-- Names kept identical to the Postgres/PocketBase names so the migration and
-- the plan can be cross-checked line by line.

CREATE UNIQUE INDEX IF NOT EXISTS idx_institutions_code ON institutions (code);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);
-- Login matches `WHERE email = lower(?)`; this expression index makes the
-- case-insensitive uniqueness a database invariant, so two registrations
-- differing only in case cannot both exist (audit N-10).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_institution ON users (institution_id);

CREATE INDEX IF NOT EXISTS idx_teams_institution ON teams (institution_id);
CREATE INDEX IF NOT EXISTS idx_teams_leader ON teams (leader_user_id);
CREATE INDEX IF NOT EXISTS idx_teams_status ON teams (status);

-- idx_members_team is redundant with the leading column of the unique index;
-- kept for 1:1 parity with setup-pb.ts.
CREATE INDEX IF NOT EXISTS idx_members_team ON members (team_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_team_email ON members (team_id, email);

-- idx_qr_team is redundant with idx_qr_team_unique; kept for 1:1 parity.
CREATE INDEX IF NOT EXISTS idx_qr_team ON questionnaire_responses (team_id);
CREATE INDEX IF NOT EXISTS idx_qr_user ON questionnaire_responses (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_team_unique ON questionnaire_responses (team_id);

CREATE INDEX IF NOT EXISTS idx_st_team ON status_transitions (team_id);
CREATE INDEX IF NOT EXISTS idx_st_at ON status_transitions (at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_config_key ON config (key);

-- -----------------------------------------------------------------------------
-- 9. updated_at triggers
-- -----------------------------------------------------------------------------
-- PocketBase's `autodate` fields maintained created/updated automatically;
-- doing it in the database means the db layer cannot forget to bump
-- `updated_at` on an UPDATE. Dropped and recreated on every run so the
-- definition cannot drift, matching the Postgres file.

DROP TRIGGER IF EXISTS trg_institutions_updated_at;
CREATE TRIGGER trg_institutions_updated_at
AFTER UPDATE ON institutions FOR EACH ROW
BEGIN
	UPDATE institutions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_users_updated_at;
CREATE TRIGGER trg_users_updated_at
AFTER UPDATE ON users FOR EACH ROW
BEGIN
	UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_teams_updated_at;
CREATE TRIGGER trg_teams_updated_at
AFTER UPDATE ON teams FOR EACH ROW
BEGIN
	UPDATE teams SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_members_updated_at;
CREATE TRIGGER trg_members_updated_at
AFTER UPDATE ON members FOR EACH ROW
BEGIN
	UPDATE members SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_questionnaire_responses_updated_at;
CREATE TRIGGER trg_questionnaire_responses_updated_at
AFTER UPDATE ON questionnaire_responses FOR EACH ROW
BEGIN
	UPDATE questionnaire_responses
	SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
	WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_status_transitions_updated_at;
CREATE TRIGGER trg_status_transitions_updated_at
AFTER UPDATE ON status_transitions FOR EACH ROW
BEGIN
	UPDATE status_transitions
	SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
	WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_config_updated_at;
CREATE TRIGGER trg_config_updated_at
AFTER UPDATE ON config FOR EACH ROW
BEGIN
	UPDATE config SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- -----------------------------------------------------------------------------
-- 10. Config seed
-- -----------------------------------------------------------------------------
-- The four phase gates from app/lib/feature-flags.ts, seeded exactly as
-- seedConfigRecords() did (all closed).
--
-- `ON CONFLICT (key) DO NOTHING` — not DO UPDATE — is deliberate: re-running
-- this file must never reset a flag an admin has since toggled. The id is
-- built from `randomblob` because SQLite has no UUID function; the shape
-- matches `crypto.randomUUID()` (version 4, RFC 4122 variant) and only the
-- four seed rows ever use it.
--
-- `WHERE true` is required: without it SQLite cannot tell whether the `ON` in
-- `ON CONFLICT` belongs to the upsert or to a join.

INSERT INTO config (id, key, value)
SELECT
	lower(
		hex(randomblob(4)) || '-' ||
		hex(randomblob(2)) || '-4' ||
		substr(hex(randomblob(2)), 2) || '-' ||
		substr('89ab', 1 + abs(random()) % 4, 1) ||
		substr(hex(randomblob(2)), 2) || '-' ||
		hex(randomblob(6))
	),
	key,
	value
FROM (
	SELECT 'registration_open' AS key, 0 AS value
	UNION ALL SELECT 'questionnaire_open', 0
	UNION ALL SELECT 'nomination_open', 0
	UNION ALL SELECT 'submission_open', 0
)
WHERE true
ON CONFLICT (key) DO NOTHING;
