#!/usr/bin/env node
/**
 * Deterministic fixtures for `tests/test-idor.mjs`.
 *
 * Purges the app tables in `$DATABASE_URL` and re-inserts one fixed fixture
 * set: one institution, an admin, a coordinator, a campus lead, two team leads
 * with one team each, their members, one questionnaire response, and one
 * submitted team whose submission file is written to the uploads volume.
 *
 * Usage:
 *   npm run seed:test
 *
 * Environment:
 *   DATABASE_URL  – target database (required)
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
 * Passwords are hashed with `hashPassword()` from `app/lib/auth.server.ts`,
 * the same helper the app uses for every new hash (argon2id). `verifyPassword`
 * also accepts the bcrypt hashes carried over from PocketBase, so a seeded
 * account logs in through the real `/login` action.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { hashPassword } from "../app/lib/auth.server";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Shared password for every fixture account. Test-only. */
const PASSWORD = "IdorTest!2026";

/**
 * Fixed uuids.
 *
 * Deterministic ids are what make the suite re-runnable: the seed and the test
 * agree on them, and the fixture map below is the single source of truth the
 * test reads.
 */
const ID = {
	institution: "11111111-1111-4111-8111-111111111111",
	admin: "22222222-2222-4222-8222-222222222222",
	coordinator: "33333333-3333-4333-8333-333333333333",
	campusLead: "44444444-4444-4444-8444-444444444444",
	priya: "55555555-5555-4555-8555-555555555555",
	meera: "66666666-6666-4666-8666-666666666666",
	priyaTeam: "77777777-7777-4777-8777-777777777777",
	meeraTeam: "88888888-8888-4888-8888-888888888888",
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
	priya: "priya@test.local",
	meera: "meera@test.local",
} as const;

const INSTITUTION = {
	name: "Test Institute of Technology",
	district: "Ernakulam",
	code: "TEST-001",
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

/** `host:port/db` — enough to identify the target without leaking credentials. */
function describeTarget(connectionString: string): string {
	try {
		const url = new URL(connectionString);
		return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
	} catch {
		return "(unparseable DATABASE_URL)";
	}
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const databaseUrl = requireEnv("DATABASE_URL");
	const uploadsDir = requireEnv("UPLOADS_DIR");
	const fixturesPath =
		process.env.FIXTURES_PATH || path.join("/tmp", "visionhack-test-fixtures.json");

	console.error(`[seed] target ${describeTarget(databaseUrl)}`);
	console.error("[seed] purging users, institutions, teams, members, questionnaire_responses");

	// One hash for every account: they share a password, and argon2 is slow.
	const passwordHash = await hashPassword(PASSWORD);

	const pool = new Pool({ connectionString: databaseUrl, max: 1 });
	const client = await pool.connect();

	try {
		await client.query("BEGIN");

		// Purge — children first, then the rows they point at.
		await client.query("DELETE FROM questionnaire_responses");
		await client.query("DELETE FROM members");
		await client.query("DELETE FROM status_transitions");
		await client.query("DELETE FROM teams");
		await client.query("DELETE FROM institutions");
		await client.query("DELETE FROM users");

		// Institution first, with no campus lead yet (the FK points at users).
		await client.query(
			`INSERT INTO institutions (id, name, district, code, max_teams, status)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[
				ID.institution,
				INSTITUTION.name,
				INSTITUTION.district,
				INSTITUTION.code,
				INSTITUTION.maxTeams,
				INSTITUTION.status,
			],
		);

		for (const user of USERS) {
			await client.query(
				`INSERT INTO users (id, email, name, role, institution_id, password_hash, verified)
				 VALUES ($1, $2, $3, $4, $5, $6, true)`,
				[user.id, user.email, user.name, user.role, user.institutionId, passwordHash],
			);
		}

		// Back-link the institution to its campus lead.
		await client.query("UPDATE institutions SET campus_lead_id = $2 WHERE id = $1", [
			ID.institution,
			ID.campusLead,
		]);

		// Priya's team: registered, questionnaire done, no submission yet.
		await client.query(
			`INSERT INTO teams (
				id, name, institution_id, leader_user_id, team_code, status, status_changed_at,
				questionnaire_completed
			 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				ID.priyaTeam,
				"Team Priya",
				ID.institution,
				ID.priya,
				"TP-001",
				"registered",
				STATUS_CHANGED_AT,
				true,
			],
		);

		// Meera's team: submitted, with a submission file on the volume.
		await client.query(
			`INSERT INTO teams (
				id, name, institution_id, leader_user_id, team_code, status, status_changed_at,
				questionnaire_completed, idea_title, idea_desc, idea_tech_stack, submission_file
			 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			[
				ID.meeraTeam,
				"Team Meera",
				ID.institution,
				ID.meera,
				"TM-002",
				"submitted",
				STATUS_CHANGED_AT,
				true,
				"VisionHack Demo",
				"A submission that exists so the file proxy has something to serve.",
				"TypeScript, Postgres",
				SUBMISSION_FILE,
			],
		);

		for (const member of MEMBERS) {
			await client.query(
				`INSERT INTO members (id, team_id, full_name, email, phone, gender, role)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[
					member.id,
					member.teamId,
					member.fullName,
					member.email,
					member.phone,
					member.gender,
					member.role,
				],
			);
		}

		// One questionnaire response, owned by Priya on her own team.
		await client.query(
			`INSERT INTO questionnaire_responses (
				id, team_id, user_id, age, gender, education, college_name, district, skills,
				interests, challenges, experience, motivation, team_experience, expectations,
				additional_info
			 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
			[
				ID.questionnaire,
				ID.priyaTeam,
				ID.priya,
				21,
				"female",
				"B.Tech",
				INSTITUTION.name,
				INSTITUTION.district,
				"TypeScript, Postgres",
				"developer tooling",
				"keeping the scope small",
				"two hackathons",
				"build something real",
				"yes",
				QUESTIONNAIRE_MARKER,
				"none",
			],
		);

		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK").catch(() => {});
		throw err;
	} finally {
		client.release();
		await pool.end();
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
		users: {
			admin: { id: ID.admin, email: EMAIL.admin, role: "admin" },
			coordinator: { id: ID.coordinator, email: EMAIL.coordinator, role: "coordinator" },
			campusLead: { id: ID.campusLead, email: EMAIL.campusLead, role: "institution" },
			priya: { id: ID.priya, email: EMAIL.priya, role: "lead" },
			meera: { id: ID.meera, email: EMAIL.meera, role: "lead" },
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

await main();
