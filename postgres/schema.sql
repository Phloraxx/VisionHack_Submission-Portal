-- =============================================================================
-- VisionHack Submission Portal — PostgreSQL 17 schema
-- =============================================================================
--
-- Replaces `scripts/setup-pb.ts` (PocketBase collections, fields, indexes and
-- API rules) with plain DDL. Derived from:
--
--   * scripts/setup-pb.ts        — field types, max lengths, relations, indexes
--   * app/lib/types.ts           — the record shapes the app actually reads
--   * app/lib/transitions.ts     — the status/role vocabulary used by CHECKs
--   * postgres/inventory.md      — the table/layer map this schema serves
--
-- Idempotency contract
-- --------------------
-- Every statement is safe to re-run: CREATE TABLE IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF
-- EXISTS + CREATE TRIGGER, and a config seed guarded by ON CONFLICT DO NOTHING.
-- The whole file runs in one transaction, so a failure leaves no partial schema.
--
-- Naming
-- ------
-- PocketBase camelCase fields become snake_case columns (institutionId ->
-- institution_id, status_changed_at is already snake_case). The db layer in
-- `app/lib/db.server.ts` owns the mapping; route code keeps reading the
-- camelCase record shapes from `app/lib/types.ts`.
--
-- Deliberately absent
-- -------------------
--   * PocketBase API rules (listRule/viewRule/...). They were a second line of
--     defence behind the route loaders; in Postgres the equivalent scoping is
--     enforced in SQL by the db layer (see docs/PG_PORT_PLAN.md §6).
--   * `users.tokenKey` and `users.avatar` — unused by the app; token
--     invalidation is replaced by short-lived app-issued JWTs.
--   * `config` row `schema_version` — a PocketBase-side migration marker whose
--     value (5) does not fit the boolean `value` column. Postgres schema
--     versioning is the migration tool's job.
--   * CHECK constraints for field-level rules that are not part of the status
--     machine (maxTeams >= 0, teamCode/code patterns, gender/status selects).
--     Those stay in the Zod schemas, which already validate every write.
--
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Shared trigger: keep updated_at honest
-- -----------------------------------------------------------------------------
-- PocketBase's `autodate` fields maintained created/updated automatically.
-- Doing the same in the database means the db layer cannot forget to bump
-- updated_at on an UPDATE.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.updated_at := now();
	RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. institutions
-- -----------------------------------------------------------------------------
-- PocketBase: base collection, created by ensureInstitutionsCollection().
-- `campus_lead_id` is a relation to `users`, which is created below — the
-- foreign key is added in section 3 to break the institutions <-> users cycle.

CREATE TABLE IF NOT EXISTS institutions (
	id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	name           varchar(100) NOT NULL,
	district       varchar(100),
	code           varchar(12)  NOT NULL,
	campus_lead_id uuid,
	max_teams      integer,
	status         varchar(16) NOT NULL DEFAULT 'active',
	created_at     timestamptz NOT NULL DEFAULT now(),
	updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN institutions.campus_lead_id IS
	'PocketBase institutions.campusLeadId (relation -> users, optional). FK added after users exists.';
COMMENT ON COLUMN institutions.max_teams IS
	'PocketBase institutions.maxTeams (number, onlyInt, min 0). 0 or NULL means unlimited.';

-- -----------------------------------------------------------------------------
-- 2. users
-- -----------------------------------------------------------------------------
-- PocketBase: the built-in auth collection, extended by ensureUsersCollection()
-- with `role` (select) and `institutionId` (relation). PocketBase's own auth
-- fields map as:
--
--   id              -> id (uuid)
--   email           -> email
--   emailVisibility -> email_visibility
--   verified        -> verified
--   password        -> password_hash   (bcrypt hashes carried over verbatim)
--   tokenKey        -> dropped (no PocketBase token store any more)
--   name            -> name
--   avatar          -> dropped (never read by the app)
--   created/updated -> created_at / updated_at

CREATE TABLE IF NOT EXISTS users (
	id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	email            varchar(255) NOT NULL,
	email_visibility boolean NOT NULL DEFAULT false,
	verified         boolean NOT NULL DEFAULT false,
	password_hash    text NOT NULL,
	name             varchar(255),
	role             varchar(16) NOT NULL,
	institution_id   uuid REFERENCES institutions (id) ON DELETE SET NULL,
	created_at       timestamptz NOT NULL DEFAULT now(),
	updated_at       timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT users_role_check CHECK (role IN ('admin', 'coordinator', 'institution', 'lead'))
);

COMMENT ON COLUMN users.password_hash IS
	'PocketBase bcrypt hash ($2a$/$2b$) on migration; rehashed to argon2id ($argon2id$) on next successful login.';
COMMENT ON COLUMN users.role IS
	'PocketBase users.role select. Vocabulary shared with app/lib/transitions.ts allowedRoles.';

-- -----------------------------------------------------------------------------
-- 3. institutions.campus_lead_id -> users(id)
-- -----------------------------------------------------------------------------
-- Added separately because institutions is created before users. Guarded so a
-- re-run does not fail on the duplicate constraint.

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'institutions_campus_lead_id_fkey'
			AND conrelid = 'institutions'::regclass
	) THEN
		ALTER TABLE institutions
			ADD CONSTRAINT institutions_campus_lead_id_fkey
			FOREIGN KEY (campus_lead_id) REFERENCES users (id) ON DELETE SET NULL;
	END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. teams
-- -----------------------------------------------------------------------------
-- PocketBase: ensureTeamsCollection(). `submission_file` was a protected file
-- field (maxSelect 1, 10 MB, PDF/PPT/PPTX); it now stores the filename of the
-- object under $UPLOADS_DIR/teams/<team_id>/.

CREATE TABLE IF NOT EXISTS teams (
	id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	name                    varchar(100) NOT NULL,
	institution_id          uuid NOT NULL REFERENCES institutions (id) ON DELETE RESTRICT,
	leader_user_id          uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
	team_code               varchar(12),
	status                  varchar(16) NOT NULL,
	status_changed_at       timestamptz,
	questionnaire_completed boolean NOT NULL DEFAULT false,
	idea_title              varchar(200),
	idea_desc               varchar(5000),
	idea_tech_stack         varchar(500),
	submission_file         text,
	created_at              timestamptz NOT NULL DEFAULT now(),
	updated_at              timestamptz NOT NULL DEFAULT now(),
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

COMMENT ON COLUMN teams.status IS
	'PocketBase teams.status select. The from->to graph and per-role permissions live in app/lib/transitions.ts, not here.';
COMMENT ON COLUMN teams.status_changed_at IS
	'Plain date in PocketBase (not autodate): the app owns the value on every transition.';
COMMENT ON COLUMN teams.submission_file IS
	'Filename only, relative to $UPLOADS_DIR/teams/<id>/. Replaces the PocketBase protected file field.';

-- -----------------------------------------------------------------------------
-- 5. members
-- -----------------------------------------------------------------------------
-- PocketBase: ensureMembersCollection(). cascadeDelete: true on teamId.

CREATE TABLE IF NOT EXISTS members (
	id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	team_id    uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
	full_name  varchar(200) NOT NULL,
	email      varchar(320) NOT NULL,
	phone      varchar(20),
	gender     varchar(32),
	role       varchar(100),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 6. questionnaire_responses
-- -----------------------------------------------------------------------------
-- PocketBase: ensureQuestionnaireResponsesCollection(). One response per team
-- (unique index), cascadeDelete: true on teamId, false on userId.

CREATE TABLE IF NOT EXISTS questionnaire_responses (
	id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	team_id         uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
	user_id         uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
	age             double precision,
	gender          varchar(16),
	education       varchar(200),
	college_name    varchar(200),
	district        varchar(100),
	skills          varchar(1000),
	interests       varchar(1000),
	challenges      varchar(2000),
	experience      varchar(2000),
	motivation      varchar(2000),
	team_experience varchar(2000),
	expectations    varchar(2000),
	additional_info varchar(2000),
	year_of_graduation varchar(16),
	created_at      timestamptz NOT NULL DEFAULT now(),
	updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Additive migration: databases created before `year_of_graduation` existed
-- get the column here, so re-running this file upgrades them in place.
ALTER TABLE questionnaire_responses
	ADD COLUMN IF NOT EXISTS year_of_graduation varchar(16);

-- -----------------------------------------------------------------------------
-- 7. status_transitions
-- -----------------------------------------------------------------------------
-- PocketBase: ensureStatusTransitionsCollection(). Audit log written after a
-- successful team transition; failures never fail the transition itself.
-- `from_status` allows '' because self-registration logs fromStatus: "".

CREATE TABLE IF NOT EXISTS status_transitions (
	id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	team_id       uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
	actor_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
	from_status   varchar(20) NOT NULL,
	to_status     varchar(20) NOT NULL,
	role          varchar(20) NOT NULL,
	at            timestamptz NOT NULL,
	created_at    timestamptz NOT NULL DEFAULT now(),
	updated_at    timestamptz NOT NULL DEFAULT now(),
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

COMMENT ON COLUMN status_transitions.at IS
	'PocketBase status_transitions.at (date, required). `at` is a non-reserved keyword in PostgreSQL, so it needs no quoting.';

-- -----------------------------------------------------------------------------
-- 8. config
-- -----------------------------------------------------------------------------
-- PocketBase: ensureConfigCollection(). Phase gates read by getConfig().
-- `value` is NOT NULL DEFAULT false because PocketBase's bool field is
-- optional and the app treats a missing value as false.

CREATE TABLE IF NOT EXISTS config (
	id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	key        text NOT NULL,
	value      boolean NOT NULL DEFAULT false,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN config.key IS
	'Feature-flag key. getConfig() skips "schema_version" and any "_"-prefixed key.';

-- -----------------------------------------------------------------------------
-- 9. Indexes
-- -----------------------------------------------------------------------------
-- One block per collection, mirroring the `indexes` arrays in setup-pb.ts.
-- Names are kept identical to the PocketBase index names so the migration and
-- the plan can be cross-checked line by line.

-- institutions: setup-pb.ts -> "CREATE UNIQUE INDEX idx_institutions_code ON institutions (code)"
CREATE UNIQUE INDEX IF NOT EXISTS idx_institutions_code ON institutions (code);

-- users: PocketBase's built-in auth collection enforces a unique email; the
-- institution index backs the institution-scoped user reads (USERS_RULES in
-- setup-pb.ts filtered on institutionId).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);
-- Login queries match WHERE email = lower($1); enforce case-insensitive uniqueness
-- so two registrations differing only in case cannot both exist (audit N-10).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_users_institution ON users (institution_id);

-- teams: setup-pb.ts -> idx_teams_institution, idx_teams_leader, idx_teams_status
CREATE INDEX IF NOT EXISTS idx_teams_institution ON teams (institution_id);
CREATE INDEX IF NOT EXISTS idx_teams_leader ON teams (leader_user_id);
CREATE INDEX IF NOT EXISTS idx_teams_status ON teams (status);

-- members: setup-pb.ts -> idx_members_team, unique idx_members_team_email
-- idx_members_team is redundant with the leading column of the unique index;
-- kept for 1:1 parity with setup-pb.ts.
CREATE INDEX IF NOT EXISTS idx_members_team ON members (team_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_team_email ON members (team_id, email);

-- questionnaire_responses: setup-pb.ts -> idx_qr_team, idx_qr_user, unique idx_qr_team_unique
-- idx_qr_team is redundant with idx_qr_team_unique; kept for 1:1 parity.
CREATE INDEX IF NOT EXISTS idx_qr_team ON questionnaire_responses (team_id);
CREATE INDEX IF NOT EXISTS idx_qr_user ON questionnaire_responses (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_team_unique ON questionnaire_responses (team_id);

-- status_transitions: setup-pb.ts -> idx_st_team, idx_st_at
CREATE INDEX IF NOT EXISTS idx_st_team ON status_transitions (team_id);
CREATE INDEX IF NOT EXISTS idx_st_at ON status_transitions (at);

-- config: setup-pb.ts -> "CREATE UNIQUE INDEX idx_config_key ON config (key)"
CREATE UNIQUE INDEX IF NOT EXISTS idx_config_key ON config (key);

-- -----------------------------------------------------------------------------
-- 10. updated_at triggers
-- -----------------------------------------------------------------------------
-- One trigger per table, recreated on every run so the definition cannot drift.

DO $$
DECLARE
	tbl text;
BEGIN
	FOREACH tbl IN ARRAY ARRAY[
		'institutions',
		'users',
		'teams',
		'members',
		'questionnaire_responses',
		'status_transitions',
		'config'
	]
	LOOP
		EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || tbl || '_updated_at', tbl);
		EXECUTE format(
			'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
			'trg_' || tbl || '_updated_at',
			tbl
		);
	END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. Config seed
-- -----------------------------------------------------------------------------
-- The four phase gates from app/lib/feature-flags.ts, seeded exactly as
-- seedConfigRecords() did (all closed). ON CONFLICT DO NOTHING makes re-runs
-- safe and never overwrites a flag an admin has since toggled.

INSERT INTO config (key, value)
VALUES
	('registration_open', false),
	('questionnaire_open', false),
	('nomination_open', false),
	('submission_open', false)
ON CONFLICT (key) DO NOTHING;

COMMIT;
