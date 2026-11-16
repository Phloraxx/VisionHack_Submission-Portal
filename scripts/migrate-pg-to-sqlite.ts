#!/usr/bin/env node
/**
 * Copy the portal's data from PostgreSQL into a SQLite database file.
 *
 * Reads every application table from a Postgres source and writes it to a
 * fresh SQLite file using the app's own data layer, so the schema, pragmas and
 * transaction semantics are exactly the ones the running app uses.
 *
 * What is preserved
 * -----------------
 * Ids, timestamps and password hashes are copied verbatim. Nothing is
 * regenerated: a session cookie, a file path under `$UPLOADS_DIR/teams/<id>/`
 * or a bcrypt hash that was valid before the migration is still valid after
 * it. Timestamps are read as `Date` and written as ISO-8601 UTC with
 * milliseconds, the shape `sqlite/schema.sql` and the app both produce.
 *
 * Idempotency
 * -----------
 * Every table is emptied and refilled inside ONE transaction, so re-running
 * the script against the same source leaves the same result and a failure
 * leaves the target untouched. `PRAGMA defer_foreign_keys` defers constraint
 * checking to COMMIT: `institutions.campus_lead_id` and `users.institution_id`
 * are a cycle, and inserting institutions with their campus lead already set
 * avoids a follow-up UPDATE that would fire the `updated_at` trigger and
 * destroy the timestamps this script exists to preserve.
 *
 * Usage
 * -----
 *   npx tsx scripts/migrate-pg-to-sqlite.ts \
 *     --source postgres://hub_admin@127.0.0.1:5433/visionhack \
 *     --target /path/to/portal.db
 *
 * Both options are required. The target is created if it does not exist, and
 * its parent directory is created if missing.
 *
 * This script only ever READS from Postgres. It never writes to the source.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

// ---------------------------------------------------------------------------
// Table plan
// ---------------------------------------------------------------------------
// Listed parents-first: the insert order below. Deletes run in reverse.
// The SQL is written out in full rather than assembled from the table name, so
// no identifier is ever interpolated into a statement.

interface TablePlan {
	name: string;
	columns: string[];
	/** Columns holding a `timestamptz`: read as Date, written as ISO text. */
	timestamps: string[];
	/** Columns holding a boolean: written as 0/1. */
	booleans: string[];
	selectSql: string;
	countSql: string;
	insertSql: string;
	deleteSql: string;
}

const TABLES: TablePlan[] = [
	{
		name: "institutions",
		columns: [
			"id",
			"name",
			"district",
			"code",
			"campus_lead_id",
			"max_teams",
			"status",
			"created_at",
			"updated_at",
		],
		timestamps: ["created_at", "updated_at"],
		booleans: [],
		selectSql: `SELECT id, name, district, code, campus_lead_id, max_teams, status,
			created_at, updated_at FROM institutions ORDER BY id`,
		countSql: "SELECT count(*) AS count FROM institutions",
		insertSql: `INSERT INTO institutions
			(id, name, district, code, campus_lead_id, max_teams, status, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		deleteSql: "DELETE FROM institutions",
	},
	{
		name: "users",
		columns: [
			"id",
			"email",
			"email_visibility",
			"verified",
			"password_hash",
			"name",
			"role",
			"institution_id",
			"created_at",
			"updated_at",
		],
		timestamps: ["created_at", "updated_at"],
		booleans: ["email_visibility", "verified"],
		selectSql: `SELECT id, email, email_visibility, verified, password_hash, name, role,
			institution_id, created_at, updated_at FROM users ORDER BY id`,
		countSql: "SELECT count(*) AS count FROM users",
		insertSql: `INSERT INTO users
			(id, email, email_visibility, verified, password_hash, name, role, institution_id,
			 created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		deleteSql: "DELETE FROM users",
	},
	{
		name: "teams",
		columns: [
			"id",
			"name",
			"institution_id",
			"leader_user_id",
			"team_code",
			"status",
			"status_changed_at",
			"questionnaire_completed",
			"idea_title",
			"idea_desc",
			"idea_tech_stack",
			"submission_file",
			"created_at",
			"updated_at",
		],
		timestamps: ["status_changed_at", "created_at", "updated_at"],
		booleans: ["questionnaire_completed"],
		selectSql: `SELECT id, name, institution_id, leader_user_id, team_code, status,
			status_changed_at, questionnaire_completed, idea_title, idea_desc, idea_tech_stack,
			submission_file, created_at, updated_at FROM teams ORDER BY id`,
		countSql: "SELECT count(*) AS count FROM teams",
		insertSql: `INSERT INTO teams
			(id, name, institution_id, leader_user_id, team_code, status, status_changed_at,
			 questionnaire_completed, idea_title, idea_desc, idea_tech_stack, submission_file,
			 created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		deleteSql: "DELETE FROM teams",
	},
	{
		name: "members",
		columns: [
			"id",
			"team_id",
			"full_name",
			"email",
			"phone",
			"gender",
			"role",
			"created_at",
			"updated_at",
		],
		timestamps: ["created_at", "updated_at"],
		booleans: [],
		selectSql: `SELECT id, team_id, full_name, email, phone, gender, role, created_at,
			updated_at FROM members ORDER BY id`,
		countSql: "SELECT count(*) AS count FROM members",
		insertSql: `INSERT INTO members
			(id, team_id, full_name, email, phone, gender, role, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		deleteSql: "DELETE FROM members",
	},
	{
		name: "questionnaire_responses",
		columns: [
			"id",
			"team_id",
			"user_id",
			"age",
			"gender",
			"education",
			"college_name",
			"district",
			"skills",
			"interests",
			"challenges",
			"experience",
			"motivation",
			"team_experience",
			"expectations",
			"additional_info",
			"year_of_graduation",
			"created_at",
			"updated_at",
		],
		timestamps: ["created_at", "updated_at"],
		booleans: [],
		selectSql: `SELECT id, team_id, user_id, age, gender, education, college_name, district,
			skills, interests, challenges, experience, motivation, team_experience, expectations,
			additional_info, year_of_graduation, created_at, updated_at
			FROM questionnaire_responses ORDER BY id`,
		countSql: "SELECT count(*) AS count FROM questionnaire_responses",
		insertSql: `INSERT INTO questionnaire_responses
			(id, team_id, user_id, age, gender, education, college_name, district, skills,
			 interests, challenges, experience, motivation, team_experience, expectations,
			 additional_info, year_of_graduation, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		deleteSql: "DELETE FROM questionnaire_responses",
	},
	{
		name: "status_transitions",
		columns: [
			"id",
			"team_id",
			"actor_user_id",
			"from_status",
			"to_status",
			"role",
			"at",
			"created_at",
			"updated_at",
		],
		timestamps: ["at", "created_at", "updated_at"],
		booleans: [],
		selectSql: `SELECT id, team_id, actor_user_id, from_status, to_status, role, at,
			created_at, updated_at FROM status_transitions ORDER BY id`,
		countSql: "SELECT count(*) AS count FROM status_transitions",
		insertSql: `INSERT INTO status_transitions
			(id, team_id, actor_user_id, from_status, to_status, role, at, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		deleteSql: "DELETE FROM status_transitions",
	},
	{
		name: "config",
		columns: ["id", "key", "value", "created_at", "updated_at"],
		timestamps: ["created_at", "updated_at"],
		booleans: ["value"],
		selectSql: "SELECT id, key, value, created_at, updated_at FROM config ORDER BY id",
		countSql: "SELECT count(*) AS count FROM config",
		insertSql: `INSERT INTO config (id, key, value, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?)`,
		deleteSql: "DELETE FROM config",
	},
];

/** Child-first: the order rows must be removed in. */
const DELETE_ORDER = [...TABLES].reverse();

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
	source: string;
	target: string;
}

const USAGE = `Copy the portal's data from PostgreSQL into a SQLite file.

Usage:
  npx tsx scripts/migrate-pg-to-sqlite.ts --source <postgres-url> --target <sqlite-path>

Options:
  --source <url>    Postgres connection string to read from (required)
  --target <path>   SQLite database file to write (required; created if absent)
  --help            Show this message

The source is only ever read. The target is emptied and refilled inside one
transaction, so the script is safe to re-run.`;

function parseArgs(argv: string[]): Options | null {
	let source = "";
	let target = "";
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") return null;
		if (arg === "--source") source = argv[++i] ?? "";
		else if (arg === "--target") target = argv[++i] ?? "";
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!source) throw new Error("--source is required (a Postgres connection string)");
	if (!target) throw new Error("--target is required (the SQLite file to write)");
	return { source, target };
}

/** Hide the password when echoing the source URL. */
function describeSource(connectionString: string): string {
	try {
		const url = new URL(connectionString);
		const user = url.username ? `${url.username}@` : "";
		return `${url.protocol}//${user}${url.hostname}:${url.port || "5432"}${url.pathname}`;
	} catch {
		return "(unparseable source URL)";
	}
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/** Map one Postgres row to bound values, in `columns` order. */
function toBindValues(plan: TablePlan, row: Record<string, unknown>): unknown[] {
	return plan.columns.map((column) => {
		const value = row[column];
		if (value === null || value === undefined) return null;
		if (plan.timestamps.includes(column)) {
			// node-postgres returns a Date for timestamptz.
			return value instanceof Date ? value.toISOString() : String(value);
		}
		if (plan.booleans.includes(column)) return value === true ? 1 : 0;
		return value;
	});
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	if (!options) {
		console.log(USAGE);
		return;
	}

	const targetPath = path.resolve(options.target);
	mkdirSync(path.dirname(targetPath), { recursive: true });

	// The app's data layer reads its configuration through getEnv(), which
	// validates APP_JWT_SECRET and UPLOADS_DIR even though this script needs
	// neither. Satisfy it with placeholders rather than require a full .env.
	process.env.SQLITE_PATH = targetPath;
	process.env.APP_JWT_SECRET ??= "migration-only-secret-0123456789abcdef0123456789";
	process.env.UPLOADS_DIR ??= path.join(path.dirname(targetPath), "uploads");

	const { query, withTransaction } = await import("../app/lib/db.server");

	console.error(`[migrate] source ${describeSource(options.source)}`);
	console.error(`[migrate] target ${targetPath}`);

	const pool = new Pool({ connectionString: options.source, max: 1 });
	const sourceCounts = new Map<string, number>();
	const sourceRows = new Map<string, Record<string, unknown>[]>();

	try {
		// Read everything first: the write phase is one SQLite transaction and
		// must not depend on a live Postgres connection staying open.
		for (const plan of TABLES) {
			// Postgres returns count(*) as bigint, which node-postgres hands back
			// as a string; SQLite returns a number. Number() normalises both.
			const counted = await pool.query<{ count: string | number }>(plan.countSql);
			sourceCounts.set(plan.name, Number(counted.rows[0]?.count ?? 0));
			const result = await pool.query(plan.selectSql);
			sourceRows.set(plan.name, result.rows as Record<string, unknown>[]);
		}
	} finally {
		await pool.end();
	}

	const writtenCounts = new Map<string, number>();

	await withTransaction(async () => {
		// Deferred enforcement lets institutions reference a campus lead that
		// is inserted a moment later, so no follow-up UPDATE is needed.
		await query("PRAGMA defer_foreign_keys = ON");

		for (const plan of DELETE_ORDER) {
			await query(plan.deleteSql);
		}

		for (const plan of TABLES) {
			const rows = sourceRows.get(plan.name) ?? [];
			for (const row of rows) {
				await query(plan.insertSql, toBindValues(plan, row));
			}
			writtenCounts.set(plan.name, rows.length);
		}
	});

	// -----------------------------------------------------------------------
	// Verify
	// -----------------------------------------------------------------------

	const mismatches: string[] = [];
	console.log("");
	console.log("table                     source   written   sqlite");
	console.log("------------------------- -------- --------- --------");
	for (const plan of TABLES) {
		const counted = await query<{ count: number }>(plan.countSql);
		const inSqlite = Number(counted.rows[0]?.count ?? 0);
		const source = sourceCounts.get(plan.name) ?? 0;
		const written = writtenCounts.get(plan.name) ?? 0;
		const ok = source === written && written === inSqlite;
		if (!ok) mismatches.push(plan.name);
		console.log(
			`${plan.name.padEnd(25)} ${String(source).padStart(8)} ${String(written).padStart(9)} ${String(inSqlite).padStart(8)}${ok ? "" : "   <-- MISMATCH"}`,
		);
	}

	const integrity = await query<{ integrity_check: string }>("PRAGMA integrity_check");
	const fkViolations = await query<Record<string, unknown>>("PRAGMA foreign_key_check");
	console.log("");
	console.log(`integrity_check: ${integrity.rows[0]?.integrity_check ?? "unknown"}`);
	console.log(`foreign_key_check: ${fkViolations.rows.length} violation(s)`);

	if (mismatches.length > 0) {
		throw new Error(`Row count mismatch in: ${mismatches.join(", ")}`);
	}
	if (fkViolations.rows.length > 0) {
		throw new Error(`Foreign key violations: ${JSON.stringify(fkViolations.rows.slice(0, 5))}`);
	}

	console.log("");
	console.log(`[migrate] done — ${targetPath}`);
}

main().catch((err) => {
	console.error("[migrate] failed:", err);
	process.exitCode = 1;
});
