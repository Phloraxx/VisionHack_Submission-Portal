#!/usr/bin/env node
/**
 * Deterministic fixtures for `tests/test-idor.mjs`.
 *
 * Purges the app tables in `$SQLITE_PATH` and re-inserts one fixed fixture
 * set: two institutions, an admin, a coordinator, two campus leads, three team
 * leads with one team each, their members, one questionnaire response, and one
 * submitted team whose submission file is written to the uploads volume. The
 * second institution exists so cross-campus denial can be asserted.
 *
 * Usage:
 *   npm run seed:test
 *
 * Environment:
 *   SQLITE_PATH   – target database (required; must look like a test target)
 *   UPLOADS_DIR   – volume root; the submitted team's file is written to
 *                   `$UPLOADS_DIR/teams/<team id>/submission.pdf` (required)
 *   FIXTURES_PATH – where the fixture map is written
 *                   (default `/tmp/visionhack-test-fixtures.json`)
 *
 * The fixture map (ids + emails) is printed as JSON on stdout and written to
 * `FIXTURES_PATH`, so the IDOR suite never has to guess an id.
 *
 * Idempotent: every run deletes the fixture rows before inserting, and every
 * id is a fixed uuid, so a re-run leaves the database in the same state.
 *
 * DESTRUCTIVE: this deletes every row in `users`, `institutions`, `teams`,
 * `members`, `questionnaire_responses` and `status_transitions`. Point it at a
 * test database — never at production.
 *
 * Passwords are hashed with `hashPassword()` from `app/lib/password.server.ts`,
 * the same helper the app uses for every new hash (argon2id). `verifyPassword`
 * also accepts the bcrypt hashes carried over from the legacy backend, so a
 * seeded account logs in through the real `/login` action.
 *
 * The shared password comes from `SEED_TEST_PASSWORD`, or a random value when
 * that is unset; either way it is written into the fixture map so the suite
 * can log in. The script refuses to run against production.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { hashPassword } from "../app/lib/password.server";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Shared password for every fixture account.
 *
 * Taken from `SEED_TEST_PASSWORD` when set, otherwise a random value — never a
 * literal, so a leaked fixture map cannot be replayed against another
 * environment.
 */
const PASSWORD = process.env.SEED_TEST_PASSWORD || crypto.randomUUID();

/**
 * Fixed uuids.
 *
 * Deterministic ids are what make the suite re-runnable: the seed and the test
 * agree on them, and the fixture map below is the single source of truth the
 * test reads.
 */
const ID = {
	institution: "11111111-1111-4111-8111-111111111111",
	institutionB: "11111111-1111-4111-8111-111111111112",
	admin: "22222222-2222-4222-8222-222222222222",
	coordinator: "33333333-3333-4333-8333-333333333333",
	campusLead: "44444444-4444-4444-8444-444444444444",
	campusLeadB: "44444444-4444-4444-8444-444444444445",
	priya: "55555555-5555-4555-8555-555555555555",
	meera: "66666666-6666-4666-8666-666666666666",
	asha: "66666666-6666-4666-8666-666666666667",
	priyaTeam: "77777777-7777-4777-8777-777777777777",
	meeraTeam: "88888888-8888-4888-8888-888888888888",
	ashaTeam: "88888888-8888-4888-8888-888888888889",
	priyaMember1: "99999999-9999-4999-8999-999999999991",
	priyaMember2: "99999999-9999-4999-8999-999999999992",
	meeraMember1: "99999999-9999-4999-8999-999999999993",
	meeraMember2: "99999999-9999-4999-8999-999999999994",
	questionnaire: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
} as const;

/** Lowercase emails — `users.findByEmail` matches on `lower(email)`. */
const EMAIL = {
	admin: "admin@test.local",
	coordinator: "coordinator@test.local",
	campusLead: "campus@test.local",
	campusLeadB: "campus.b@test.local",
	priya: "priya@test.local",
	meera: "meera@test.local",
	asha: "asha@test.local",
} as const;

const INSTITUTION = {
	name: "Test Institute of Technology",
	district: "Ernakulam",
	code: "TEST-001",
	maxTeams: 10,
	status: "active",
} as const;

/** A second campus, so cross-institution denial can be asserted end-to-end. */
const INSTITUTION_B = {
	name: "Other Institute of Science",
	district: "Thrissur",
	code: "TEST-002",
	maxTeams: 10,
	status: "active",
} as const;

/** Fixed timestamp so `status_changed_at` is stable across runs. */
const STATUS_CHANGED_AT = "2026-01-15T09:00:00.000Z";

/** Filename stored in `teams.submission_file` for the submitted team. */
const SUBMISSION_FILE = "submission.pdf";

/**
 * A distinctive answer value. The IDOR suite asserts it appears on the owning
 * team's detail page and nowhere else.
 */
const QUESTIONNAIRE_MARKER = "Ship a working prototype by demo day";

/** Minimal single-page PDF — the download route only stats and streams it. */
const SUBMISSION_BYTES = Buffer.from(
	[
		"%PDF-1.4",
		"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
		"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
		"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj",
		"trailer<</Root 1 0 R>>",
		"%%EOF",
		"",
	].join("\n"),
	"utf8",
);

interface FixtureUser {
	id: string;
	email: string;
	name: string;
	role: "admin" | "coordinator" | "institution" | "lead";
	institutionId: string | null;
}

const USERS: FixtureUser[] = [
	{ id: ID.admin, email: EMAIL.admin, name: "Ada Admin", role: "admin", institutionId: null },
	{
		id: ID.coordinator,
		email: EMAIL.coordinator,
		name: "Cody Coordinator",
		role: "coordinator",
		institutionId: null,
	},
	{
		id: ID.campusLead,
		email: EMAIL.campusLead,
		name: "Lakshmi Menon",
		role: "institution",
		institutionId: ID.institution,
	},
	{
		id: ID.priya,
		email: EMAIL.priya,
		name: "Priya Raman",
		role: "lead",
		institutionId: ID.institution,
	},
	{
		id: ID.meera,
		email: EMAIL.meera,
		name: "Meera Iyer",
		role: "lead",
		institutionId: ID.institution,
	},
	{
		id: ID.campusLeadB,
		email: EMAIL.campusLeadB,
		name: "Nithin Pillai",
		role: "institution",
		institutionId: ID.institutionB,
	},
	{
		id: ID.asha,
		email: EMAIL.asha,
		name: "Asha Varma",
		role: "lead",
		institutionId: ID.institutionB,
	},
];

interface FixtureMember {
	id: string;
	teamId: string;
	fullName: string;
	email: string;
	phone: string;
	gender: string;
	role: string;
}

const MEMBERS: FixtureMember[] = [
	{
		id: ID.priyaMember1,
		teamId: ID.priyaTeam,
		fullName: "Priya Raman",
		email: EMAIL.priya,
		phone: "9000000001",
		gender: "female",
		role: "lead",
	},
	{
		id: ID.priyaMember2,
		teamId: ID.priyaTeam,
		fullName: "Dev Nair",
		email: "dev.nair@test.local",
		phone: "9000000002",
		gender: "male",
		role: "member",
	},
	{
		id: ID.meeraMember1,
		teamId: ID.meeraTeam,
		fullName: "Meera Iyer",
		email: EMAIL.meera,
		phone: "9000000003",
		gender: "female",
		role: "lead",
	},
	{
		id: ID.meeraMember2,
		teamId: ID.meeraTeam,
		fullName: "Anoop Das",
		email: "anoop.das@test.local",
		phone: "9000000004",
		gender: "male",
		role: "member",
	},
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
	const value = process.env[name] ?? "";
	if (!value) throw new Error(`${name} is not set.`);
	return value;
}

/**
 * Refuse to run anywhere that looks like production.
 *
 * The script deletes every row in six tables, so a stray `SQLITE_PATH` must
 * fail loudly rather than wipe a live event. A path qualifies as a test target
 * when it contains "test" or lives under the OS temp directory.
 */
function assertSafeTarget(sqlitePath: string): void {
	if (process.env.NODE_ENV === "production") {
		throw new Error("seed-test-data refuses to run with NODE_ENV=production");
	}
	if (sqlitePath === ":memory:") return;

	const resolved = path.resolve(sqlitePath);
	const inTempDir = resolved.startsWith(path.resolve(tmpdir()) + path.sep);
	if (!inTempDir && !path.basename(resolved).includes("test")) {
		throw new Error(
			`seed-test-data refuses to run against "${resolved}": the filename must contain "test" or the file must live under ${tmpdir()}`,
		);
	}
}

/** Apply the schema so this script works against a brand-new database file. */
async function applySchema(database: Database.Database): Promise<void> {
	const schema = await readFile(path.join(process.cwd(), "sqlite", "schema.sql"), "utf8");
	database.exec("BEGIN IMMEDIATE");
	try {
		database.exec(schema);
		database.exec("COMMIT");
	} catch (err) {
		database.exec("ROLLBACK");
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const sqlitePath = requireEnv("SQLITE_PATH");
	assertSafeTarget(sqlitePath);
	const uploadsDir = requireEnv("UPLOADS_DIR");
	const fixturesPath =
		process.env.FIXTURES_PATH || path.join("/tmp", "visionhack-test-fixtures.json");

	console.error(`[seed] target ${sqlitePath}`);
	console.error("[seed] purging users, institutions, teams, members, questionnaire_responses");

	// One hash for every account: they share a password, and argon2 is slow.
	const passwordHash = await hashPassword(PASSWORD);

	if (sqlitePath !== ":memory:") {
		await mkdir(path.dirname(path.resolve(sqlitePath)), { recursive: true });
	}
	const database = new Database(sqlitePath);
	database.pragma("journal_mode = WAL");
	database.pragma("foreign_keys = ON");
	database.pragma("busy_timeout = 5000");
	await applySchema(database);

	try {
		database.exec("BEGIN IMMEDIATE");

		// Purge — children first, then the rows they point at. Whole literal
		// statements, so no identifier is ever interpolated into SQL.
		for (const statement of [
			"DELETE FROM questionnaire_responses",
			"DELETE FROM members",
			"DELETE FROM status_transitions",
			"DELETE FROM teams",
			"DELETE FROM institutions",
			"DELETE FROM users",
		]) {
			database.prepare(statement).run();
		}

		// Institution first, with no campus lead yet (the FK points at users).
		const insertInstitution = database.prepare(
			`INSERT INTO institutions (id, name, district, code, max_teams, status)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		);
		insertInstitution.run(
			ID.institution,
			INSTITUTION.name,
			INSTITUTION.district,
			INSTITUTION.code,
			INSTITUTION.maxTeams,
			INSTITUTION.status,
		);
		insertInstitution.run(
			ID.institutionB,
			INSTITUTION_B.name,
			INSTITUTION_B.district,
			INSTITUTION_B.code,
			INSTITUTION_B.maxTeams,
			INSTITUTION_B.status,
		);

		const insertUser = database.prepare(
			`INSERT INTO users (id, email, name, role, institution_id, password_hash, verified)
			 VALUES (?, ?, ?, ?, ?, ?, 1)`,
		);
		for (const user of USERS) {
			insertUser.run(user.id, user.email, user.name, user.role, user.institutionId, passwordHash);
		}

		// Back-link each institution to its campus lead.
		const linkLead = database.prepare("UPDATE institutions SET campus_lead_id = ? WHERE id = ?");
		linkLead.run(ID.campusLead, ID.institution);
		linkLead.run(ID.campusLeadB, ID.institutionB);

		// Priya's team: registered, questionnaire done, no submission yet.
		database
			.prepare(
				`INSERT INTO teams (
					id, name, institution_id, leader_user_id, team_code, status, status_changed_at,
					questionnaire_completed
				 ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
			)
			.run(
				ID.priyaTeam,
				"Team Priya",
				ID.institution,
				ID.priya,
				"TP-001",
				"registered",
				STATUS_CHANGED_AT,
			);

		// Meera's team: submitted, with a submission file on the volume.
		database
			.prepare(
				`INSERT INTO teams (
					id, name, institution_id, leader_user_id, team_code, status, status_changed_at,
					questionnaire_completed, idea_title, idea_desc, idea_tech_stack, submission_file
				 ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
			)
			.run(
				ID.meeraTeam,
				"Team Meera",
				ID.institution,
				ID.meera,
				"TM-002",
				"submitted",
				STATUS_CHANGED_AT,
				"VisionHack Demo",
				"A submission that exists so the file proxy has something to serve.",
				"TypeScript, SQLite",
				SUBMISSION_FILE,
			);

		// Asha's team lives in the second institution — the cross-campus probe.
		database
			.prepare(
				`INSERT INTO teams (
					id, name, institution_id, leader_user_id, team_code, status, status_changed_at,
					questionnaire_completed
				 ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
			)
			.run(
				ID.ashaTeam,
				"Team Asha",
				ID.institutionB,
				ID.asha,
				"TA-003",
				"registered",
				STATUS_CHANGED_AT,
			);

		const insertMember = database.prepare(
			`INSERT INTO members (id, team_id, full_name, email, phone, gender, role)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		);
		for (const member of MEMBERS) {
			insertMember.run(
				member.id,
				member.teamId,
				member.fullName,
				member.email,
				member.phone,
				member.gender,
				member.role,
			);
		}

		// One questionnaire response, owned by Priya on her own team.
		database
			.prepare(
				`INSERT INTO questionnaire_responses (
					id, team_id, user_id, age, gender, education, college_name, district, skills,
					interests, challenges, experience, motivation, team_experience, expectations,
					additional_info
				 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				ID.questionnaire,
				ID.priyaTeam,
				ID.priya,
				21,
				"female",
				"B.Tech",
				INSTITUTION.name,
				INSTITUTION.district,
				"TypeScript, SQLite",
				"developer tooling",
				"keeping the scope small",
				"two hackathons",
				"build something real",
				"yes",
				QUESTIONNAIRE_MARKER,
				"none",
			);

		database.exec("COMMIT");
	} catch (err) {
		try {
			database.exec("ROLLBACK");
		} catch {
			// The transaction may already be gone; the original error is the
			// one worth surfacing.
		}
		throw err;
	} finally {
		database.close();
	}

	// The file lives outside the transaction: a rollback cannot unlink it, and
	// a stale file is harmless because the row is what authorises the download.
	const teamDir = path.join(uploadsDir, "teams", ID.meeraTeam);
	await mkdir(teamDir, { recursive: true });
	await writeFile(path.join(teamDir, SUBMISSION_FILE), SUBMISSION_BYTES);

	const fixtures = {
		password: PASSWORD,
		institution: {
			id: ID.institution,
			name: INSTITUTION.name,
			code: INSTITUTION.code,
			district: INSTITUTION.district,
		},
		institutionB: {
			id: ID.institutionB,
			name: INSTITUTION_B.name,
			code: INSTITUTION_B.code,
			district: INSTITUTION_B.district,
		},
		users: {
			admin: { id: ID.admin, email: EMAIL.admin, role: "admin" },
			coordinator: { id: ID.coordinator, email: EMAIL.coordinator, role: "coordinator" },
			campusLead: { id: ID.campusLead, email: EMAIL.campusLead, role: "institution" },
			priya: { id: ID.priya, email: EMAIL.priya, role: "lead" },
			meera: { id: ID.meera, email: EMAIL.meera, role: "lead" },
			campusLeadB: { id: ID.campusLeadB, email: EMAIL.campusLeadB, role: "institution" },
			asha: { id: ID.asha, email: EMAIL.asha, role: "lead" },
		},
		teams: {
			priya: {
				id: ID.priyaTeam,
				name: "Team Priya",
				status: "registered",
				leaderEmail: EMAIL.priya,
			},
			meera: {
				id: ID.meeraTeam,
				name: "Team Meera",
				status: "submitted",
				leaderEmail: EMAIL.meera,
				submissionFile: SUBMISSION_FILE,
			},
			asha: {
				id: ID.ashaTeam,
				name: "Team Asha",
				status: "registered",
				leaderEmail: EMAIL.asha,
			},
		},
		members: {
			priyaTeam: MEMBERS.filter((m) => m.teamId === ID.priyaTeam).map((m) => ({
				id: m.id,
				fullName: m.fullName,
				email: m.email,
			})),
			meeraTeam: MEMBERS.filter((m) => m.teamId === ID.meeraTeam).map((m) => ({
				id: m.id,
				fullName: m.fullName,
				email: m.email,
			})),
		},
		questionnaire: {
			id: ID.questionnaire,
			teamId: ID.priyaTeam,
			userId: ID.priya,
			marker: QUESTIONNAIRE_MARKER,
		},
		uploadsDir,
	};

	const json = JSON.stringify(fixtures, null, 2);
	await writeFile(fixturesPath, `${json}\n`, "utf8");

	console.error(`[seed] wrote ${fixturesPath}`);
	console.error(`[seed] wrote ${path.join(teamDir, SUBMISSION_FILE)}`);
	console.log(json);
}

main().catch((err) => {
	console.error("[seed] failed:", err);
	process.exitCode = 1;
});
