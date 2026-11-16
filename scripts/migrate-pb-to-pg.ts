#!/usr/bin/env node
/**
 * One-time PocketBase -> PostgreSQL data migration.
 *
 * Reads the live PocketBase instance and writes the seven application tables
 * defined in `postgres/schema.sql`. Records come from the REST API; password
 * hashes come from a local copy of PocketBase's SQLite file, because the API
 * never returns them.
 *
 * Usage
 * -----
 *   # 1. Copy the PocketBase database out of its container. Read-only: the
 *   #    original file is never opened by this script. Requires the `sqlite3`
 *   #    CLI on PATH (the only external tool this script needs).
 *   docker cp <pb-container>:/pocketbase/data/data.db /tmp/pb-data.db
 *
 *   # 2. Dry run (default): prints the plan, writes nothing.
 *   PB_SUPERUSER_EMAIL=... PB_SUPERUSER_PASSWORD=... \
 *     npx tsx scripts/migrate-pb-to-pg.ts \
 *       --pb http://127.0.0.1:8090 \
 *       --pb-sqlite /tmp/pb-data.db \
 *       --target "$DATABASE_URL"
 *
 *   # 3. Apply.
 *   ... --apply
 *
 * Flags
 * -----
 *   --apply              perform the migration (default: dry run)
 *   --target <url>       PostgreSQL target (default: $DATABASE_URL)
 *   --pb <url>           PocketBase base URL (default: $POCKETBASE_URL)
 *   --pb-sqlite <path>   local copy of pb_data/data.db (default: $PB_SQLITE_PATH)
 *   --limit <n>          migrate the first n records per collection
 *   --force              replace the contents of the seven target tables
 *   --out <dir>          output directory (default: ./migration-output)
 *   --help
 *
 * Environment
 * -----------
 *   PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD  PocketBase superuser (required)
 *   DATABASE_URL, POCKETBASE_URL, PB_SQLITE_PATH, UPLOADS_DIR
 *   PB_VERSION                                 optional, printed in the report
 *
 * Guarantees
 * ----------
 *   * Every data row is written inside one PostgreSQL transaction. A failure
 *     rolls the whole migration back.
 *   * Submission files are downloaded into `<out>/<run>/staging` first and
 *     moved into `$UPLOADS_DIR/teams/<team uuid>/` only after the transaction
 *     commits. On any error the staging tree and every promoted file are
 *     removed, so the database and the volume never disagree.
 *   * PocketBase ids are 15-character strings; PostgreSQL ids are uuids. One
 *     uuid is generated per source record and every relation is remapped
 *     through that map. The map is written to `migrate-id-map.json` in the
 *     run's output directory on success.
 *   * Rows that cannot satisfy a NOT NULL column are never filled with an
 *     invented value: they are reported and skipped. Dangling references in
 *     nullable columns become NULL and are reported.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

// ---------------------------------------------------------------------------
// Schema mapping
// ---------------------------------------------------------------------------

/** The seven tables of `postgres/schema.sql`, in foreign-key insert order. */
const COLLECTIONS = [
	"institutions",
	"users",
	"teams",
	"members",
	"questionnaire_responses",
	"status_transitions",
	"config",
] as const;

type CollectionName = (typeof COLLECTIONS)[number];

type ColumnKind = "text" | "bool" | "int" | "float" | "timestamp" | "uuid";

interface ColumnSpec {
	/** PostgreSQL column name. */
	pg: string;
	/** PocketBase field name, or null when the column has no source field. */
	pb: string | null;
	kind: ColumnKind;
	/** NOT NULL in postgres/schema.sql. */
	notNull?: boolean;
	/** DEFAULT in postgres/schema.sql; used when the source value is empty. */
	sqlDefault?: string;
	/** Relation target. The value is remapped through the id map. */
	fk?: CollectionName;
	/** Lowercase the value before insert (emails). */
	lowercase?: boolean;
	/** varchar(n) limit from postgres/schema.sql. */
	maxLength?: number;
	/** Value comes from the PocketBase SQLite file, not the REST API. */
	fromSqlite?: boolean;
	/** The empty string is a legal value (status_transitions.from_status). */
	allowEmpty?: boolean;
	/** Inserted as NULL, then filled by an UPDATE after the target table exists. */
	deferred?: boolean;
	/** The uuid is generated for this row rather than copied. */
	generated?: boolean;
}

interface DroppedField {
	pb: string;
	reason: string;
}

interface TableSpec {
	name: CollectionName;
	columns: ColumnSpec[];
	dropped: DroppedField[];
	/** Column for `INSERT ... ON CONFLICT (col) DO UPDATE`. */
	upsertKey?: string;
}

const ID_COLUMN: ColumnSpec = { pg: "id", pb: null, kind: "uuid", notNull: true, generated: true };

/** `created`/`updated` autodate fields, present on most PocketBase collections. */
const PB_TIMESTAMPS: ColumnSpec[] = [
	{ pg: "created_at", pb: "created", kind: "timestamp", notNull: true, sqlDefault: "now()" },
	{ pg: "updated_at", pb: "updated", kind: "timestamp", notNull: true, sqlDefault: "now()" },
];

/** Collections without autodate fields: the schema DEFAULT fills the timestamps. */
const DEFAULT_TIMESTAMPS: ColumnSpec[] = [
	{ pg: "created_at", pb: null, kind: "timestamp", notNull: true, sqlDefault: "now()" },
	{ pg: "updated_at", pb: null, kind: "timestamp", notNull: true, sqlDefault: "now()" },
];

const TABLES: TableSpec[] = [
	{
		name: "institutions",
		columns: [
			ID_COLUMN,
			{ pg: "name", pb: "name", kind: "text", notNull: true, maxLength: 100 },
			{ pg: "district", pb: "district", kind: "text", maxLength: 100 },
			{ pg: "code", pb: "code", kind: "text", notNull: true, maxLength: 12 },
			// Circular FK: institutions -> users -> institutions. Inserted as
			// NULL, filled once the users exist (see applyDeferredColumns).
			{ pg: "campus_lead_id", pb: "campusLeadId", kind: "uuid", fk: "users", deferred: true },
			{ pg: "max_teams", pb: "maxTeams", kind: "int" },
			{ pg: "status", pb: "status", kind: "text", maxLength: 16 },
			...PB_TIMESTAMPS,
		],
		dropped: [{ pb: "teamsRegistered", reason: "no PG column; derived from teams" }],
	},
	{
		name: "users",
		columns: [
			ID_COLUMN,
			{ pg: "email", pb: "email", kind: "text", notNull: true, maxLength: 255, lowercase: true },
			{
				pg: "email_visibility",
				pb: "emailVisibility",
				kind: "bool",
				notNull: true,
				sqlDefault: "false",
			},
			{ pg: "verified", pb: "verified", kind: "bool", notNull: true, sqlDefault: "false" },
			// bcrypt hash, read from the SQLite file: the REST API omits it.
			{ pg: "password_hash", pb: null, kind: "text", notNull: true, fromSqlite: true },
			{ pg: "name", pb: "name", kind: "text", maxLength: 255 },
			{ pg: "role", pb: "role", kind: "text", notNull: true, maxLength: 16 },
			{ pg: "institution_id", pb: "institutionId", kind: "uuid", fk: "institutions" },
			...PB_TIMESTAMPS,
		],
		dropped: [
			{ pb: "tokenKey", reason: "PB token store dropped; the app issues its own JWTs" },
			{ pb: "avatar", reason: "never read by the app" },
		],
	},
	{
		name: "teams",
		columns: [
			ID_COLUMN,
			{ pg: "name", pb: "name", kind: "text", notNull: true, maxLength: 100 },
			{
				pg: "institution_id",
				pb: "institutionId",
				kind: "uuid",
				notNull: true,
				fk: "institutions",
			},
			{ pg: "leader_user_id", pb: "leaderUserId", kind: "uuid", notNull: true, fk: "users" },
			{ pg: "team_code", pb: "teamCode", kind: "text", maxLength: 12 },
			{ pg: "status", pb: "status", kind: "text", notNull: true, maxLength: 16 },
			{ pg: "status_changed_at", pb: "status_changed_at", kind: "timestamp" },
			{
				pg: "questionnaire_completed",
				pb: "questionnaire_completed",
				kind: "bool",
				notNull: true,
				sqlDefault: "false",
			},
			{ pg: "idea_title", pb: "idea_title", kind: "text", maxLength: 200 },
			{ pg: "idea_desc", pb: "idea_desc", kind: "text", maxLength: 5000 },
			{ pg: "idea_tech_stack", pb: "idea_tech_stack", kind: "text", maxLength: 500 },
			{ pg: "submission_file", pb: "submission_file", kind: "text" },
			...PB_TIMESTAMPS,
		],
		dropped: [
			{ pb: "membersCount", reason: "derived from members" },
			{ pb: "institutionName", reason: "denormalised copy; join institutions" },
			{ pb: "teamLeadName", reason: "denormalised copy; join users" },
			{ pb: "teamLeadEmail", reason: "denormalised copy; join users" },
			{ pb: "mentor_name", reason: "no PG column" },
			{ pb: "mentor_contact", reason: "no PG column" },
			{ pb: "notes", reason: "no PG column" },
			{ pb: "reviewed_by", reason: "no PG column" },
		],
	},
	{
		name: "members",
		columns: [
			ID_COLUMN,
			{ pg: "team_id", pb: "teamId", kind: "uuid", notNull: true, fk: "teams" },
			{ pg: "full_name", pb: "fullName", kind: "text", notNull: true, maxLength: 200 },
			{ pg: "email", pb: "email", kind: "text", notNull: true, maxLength: 320, lowercase: true },
			{ pg: "phone", pb: "phone", kind: "text", maxLength: 20 },
			{ pg: "gender", pb: "gender", kind: "text" },
			{ pg: "role", pb: "role", kind: "text" },
			...PB_TIMESTAMPS,
		],
		dropped: [
			{ pb: "institution_id", reason: "denormalised copy; reachable via teams.institution_id" },
			{ pb: "institution_name", reason: "denormalised copy" },
		],
	},
	{
		name: "questionnaire_responses",
		columns: [
			ID_COLUMN,
			{ pg: "team_id", pb: "teamId", kind: "uuid", notNull: true, fk: "teams" },
			{ pg: "user_id", pb: "userId", kind: "uuid", notNull: true, fk: "users" },
			{ pg: "age", pb: "age", kind: "float" },
			{ pg: "gender", pb: "gender", kind: "text", maxLength: 16 },
			{ pg: "education", pb: "education", kind: "text", maxLength: 200 },
			{ pg: "college_name", pb: "college_name", kind: "text", maxLength: 200 },
			{ pg: "district", pb: "district", kind: "text", maxLength: 100 },
			{ pg: "skills", pb: "skills", kind: "text", maxLength: 1000 },
			{ pg: "interests", pb: "interests", kind: "text", maxLength: 1000 },
			{ pg: "challenges", pb: "challenges", kind: "text", maxLength: 2000 },
			{ pg: "experience", pb: "experience", kind: "text", maxLength: 2000 },
			{ pg: "motivation", pb: "motivation", kind: "text", maxLength: 2000 },
			{ pg: "team_experience", pb: "team_experience", kind: "text", maxLength: 2000 },
			{ pg: "expectations", pb: "expectations", kind: "text", maxLength: 2000 },
			{ pg: "additional_info", pb: "additional_info", kind: "text", maxLength: 2000 },
			// The collection has no autodate fields.
			...DEFAULT_TIMESTAMPS,
		],
		dropped: [],
	},
	{
		name: "status_transitions",
		columns: [
			ID_COLUMN,
			{ pg: "team_id", pb: "teamId", kind: "uuid", notNull: true, fk: "teams" },
			{ pg: "actor_user_id", pb: "actorUserId", kind: "uuid", notNull: true, fk: "users" },
			{
				pg: "from_status",
				pb: "fromStatus",
				kind: "text",
				notNull: true,
				maxLength: 20,
				allowEmpty: true,
			},
			{ pg: "to_status", pb: "toStatus", kind: "text", notNull: true, maxLength: 20 },
			{ pg: "role", pb: "role", kind: "text", notNull: true, maxLength: 20 },
			{ pg: "at", pb: "at", kind: "timestamp", notNull: true },
			...PB_TIMESTAMPS,
		],
		dropped: [],
	},
	{
		name: "config",
		columns: [
			ID_COLUMN,
			{ pg: "key", pb: "key", kind: "text", notNull: true },
			{ pg: "value", pb: "value", kind: "bool", notNull: true, sqlDefault: "false" },
			// The collection has no autodate fields.
			...DEFAULT_TIMESTAMPS,
		],
		dropped: [],
		upsertKey: "key",
	},
];

/** PocketBase collections that exist but have no PostgreSQL table. */
const UNMIGRATED_COLLECTIONS = ["email_queue", "team_drafts", "email_outbox"] as const;

/** Same rule as `app/lib/uploads.server.ts`: no separators, no `..`. */
const SAFE_FILENAME = /^[\w.-]+$/;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
	apply: boolean;
	force: boolean;
	help: boolean;
	target?: string;
	pb?: string;
	pbSqlite?: string;
	limit?: number;
	out: string;
}

function parseArgs(argv: string[]): Options {
	const options: Options = { apply: false, force: false, help: false, out: "./migration-output" };

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = (): string => {
			const value = argv[i + 1];
			if (value === undefined) throw new Error(`${arg} needs a value`);
			i++;
			return value;
		};
		switch (arg) {
			case "--apply":
				options.apply = true;
				break;
			case "--force":
				options.force = true;
				break;
			case "--help":
			case "-h":
				options.help = true;
				break;
			case "--target":
				options.target = next();
				break;
			case "--pb":
				options.pb = next();
				break;
			case "--pb-sqlite":
				options.pbSqlite = next();
				break;
			case "--out":
				options.out = next();
				break;
			case "--limit": {
				const raw = next();
				const limit = Number(raw);
				if (!Number.isInteger(limit) || limit <= 0) {
					throw new Error(`--limit must be a positive integer (got ${raw})`);
				}
				options.limit = limit;
				break;
			}
			default:
				throw new Error(`Unknown argument: ${arg} (try --help)`);
		}
	}

	return options;
}

function printHelp(): void {
	console.log(`PocketBase -> PostgreSQL data migration

  npx tsx scripts/migrate-pb-to-pg.ts [flags]

  --apply              perform the migration (default: dry run)
  --target <url>       PostgreSQL target (default: $DATABASE_URL)
  --pb <url>           PocketBase base URL (default: $POCKETBASE_URL)
  --pb-sqlite <path>   local copy of pb_data/data.db (default: $PB_SQLITE_PATH)
  --limit <n>          migrate the first n records per collection
  --force              replace the contents of the seven target tables
  --out <dir>          output directory (default: ./migration-output)
  --help

Environment:
  PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD  PocketBase superuser (required)
  DATABASE_URL, POCKETBASE_URL, PB_SQLITE_PATH, UPLOADS_DIR

The PocketBase SQLite file is only read, never written. Copy it out first:

  docker cp <pb-container>:/pocketbase/data/data.db /tmp/pb-data.db`);
}

// ---------------------------------------------------------------------------
// PocketBase client
// ---------------------------------------------------------------------------

type PbRecord = Record<string, unknown>;

interface PbClient {
	baseUrl: string;
	token: string;
	version: string;
}

interface PbListResult {
	records: PbRecord[];
	totalItems: number;
	/** The collection does not exist on this instance. */
	absent: boolean;
}

/** Authenticate as a superuser. PB 0.23+ uses `_superusers`, older builds `admins`. */
async function pbAuthenticate(
	baseUrl: string,
	identity: string,
	password: string,
): Promise<PbClient> {
	const routes = [
		"/api/collections/_superusers/auth-with-password",
		"/api/admins/auth-with-password",
	];
	let lastError = "";

	for (const route of routes) {
		const response = await fetch(new URL(route, baseUrl), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ identity, password }),
			signal: AbortSignal.timeout(30_000),
		});
		if (response.ok) {
			const body = (await response.json()) as { token?: string };
			if (!body.token) throw new Error(`PocketBase returned no token from ${route}`);
			return { baseUrl, token: body.token, version: process.env.PB_VERSION ?? "unknown" };
		}
		// 404 means the route does not exist on this PocketBase version.
		if (response.status !== 404) {
			lastError = `${route} -> HTTP ${response.status}`;
			break;
		}
		lastError = `${route} -> HTTP 404`;
	}

	throw new Error(`PocketBase superuser authentication failed (${lastError})`);
}

/** Page through a collection. A missing collection is reported, not fatal. */
async function pbListAll(
	client: PbClient,
	collection: string,
	limit?: number,
): Promise<PbListResult> {
	const perPage = 200;
	const records: PbRecord[] = [];
	let totalItems = 0;
	let page = 1;

	while (true) {
		const url = new URL(`/api/collections/${collection}/records`, client.baseUrl);
		url.searchParams.set("page", String(page));
		url.searchParams.set("perPage", String(perPage));
		// Deterministic order, so --limit always selects the same records.
		url.searchParams.set("sort", "id");

		const response = await fetch(url, {
			headers: { Authorization: client.token },
			signal: AbortSignal.timeout(60_000),
		});
		if (response.status === 404) {
			return { records: [], totalItems: 0, absent: true };
		}
		if (!response.ok) {
			throw new Error(`GET ${url.pathname} failed: HTTP ${response.status}`);
		}

		const body = (await response.json()) as { items?: PbRecord[]; totalItems?: number };
		const items = body.items ?? [];
		totalItems = body.totalItems ?? items.length;
		records.push(...items);

		if (items.length === 0 || records.length >= totalItems) break;
		if (limit !== undefined && records.length >= limit) break;
		page++;
	}

	return {
		records: limit === undefined ? records : records.slice(0, limit),
		totalItems,
		absent: false,
	};
}

/**
 * Request a short-lived file token.
 *
 * `teams.submission_file` is a protected file field: the file route rejects a
 * plain auth token and needs `?token=` from this endpoint. Builds without the
 * route (older PocketBase) fall back to the auth header alone.
 */
async function pbFileToken(client: PbClient): Promise<string | null> {
	const response = await fetch(new URL("/api/files/token", client.baseUrl), {
		method: "POST",
		headers: { Authorization: client.token },
		signal: AbortSignal.timeout(30_000),
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`POST /api/files/token failed: HTTP ${response.status}`);
	const body = (await response.json()) as { token?: string };
	return body.token ?? null;
}

/** Download a record file. */
async function pbDownloadFile(
	client: PbClient,
	collection: string,
	recordId: string,
	filename: string,
	fileToken: string | null,
): Promise<{ bytes: Uint8Array; contentLength: number | null }> {
	const url = new URL(`/api/files/${collection}/${recordId}/${filename}`, client.baseUrl);
	if (fileToken !== null) url.searchParams.set("token", fileToken);
	const response = await fetch(url, {
		headers: { Authorization: client.token },
		signal: AbortSignal.timeout(120_000),
	});
	if (!response.ok) {
		throw new Error(`GET ${url.pathname} failed: HTTP ${response.status}`);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	const header = response.headers.get("content-length");
	return { bytes, contentLength: header === null ? null : Number(header) };
}

// ---------------------------------------------------------------------------
// Password hashes (SQLite)
// ---------------------------------------------------------------------------

/**
 * Read `users.password` from a local copy of PocketBase's SQLite file.
 *
 * The REST API never returns password hashes, and the app keeps the bcrypt
 * hashes so it can rehash to argon2id on the next login. The host `sqlite3`
 * CLI is used instead of a driver: no new dependency, and the file is opened
 * read-only.
 */
function readPasswordHashes(sqlitePath: string): Map<string, string> {
	// Fail with a clear message rather than an ENOENT from execFileSync.
	try {
		execFileSync("sqlite3", ["-version"], { stdio: "ignore" });
	} catch {
		throw new Error(
			"the `sqlite3` CLI is required to read password hashes from the PocketBase database; install it (apt install sqlite3 / brew install sqlite) and re-run",
		);
	}

	let output: string;
	try {
		output = execFileSync("sqlite3", ["-json", sqlitePath, "SELECT id, password FROM users"], {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Could not read password hashes from ${sqlitePath} with the sqlite3 CLI (${message}). Copy the file out of the PocketBase container first: docker cp <pb-container>:/pocketbase/data/data.db /tmp/pb-data.db`,
		);
	}

	const rows =
		output.trim() === "" ? [] : (JSON.parse(output) as { id: string; password: string }[]);
	const hashes = new Map<string, string>();
	for (const row of rows) {
		if (typeof row.id === "string" && typeof row.password === "string") {
			hashes.set(row.id, row.password);
		}
	}
	return hashes;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

interface RowIssue {
	column: string;
	pbField: string | null;
	reason: string;
}

interface PlannedRow {
	pbId: string;
	id: string;
	/** PostgreSQL column -> value. Deferred columns are excluded from the INSERT. */
	values: Record<string, unknown>;
	/** PostgreSQL column -> PocketBase id, resolved once the target rows are known. */
	fkSources: Record<string, string>;
	/** Unresolvable NOT NULL / overflow problems. A row with issues is skipped. */
	issues: RowIssue[];
	/** Dangling nullable references, repaired to NULL. */
	repairs: RowIssue[];
}

interface TablePlan {
	spec: TableSpec;
	sourceCount: number;
	absent: boolean;
	rows: PlannedRow[];
}

interface SourceData {
	lists: Map<CollectionName, PbListResult>;
	/** PB id -> uuid, per collection. */
	idMap: Map<CollectionName, Map<string, string>>;
}

type Coerced =
	| { ok: true; value: unknown }
	| { ok: true; empty: true }
	| { ok: false; reason: string };

const EMPTY: Coerced = { ok: true, empty: true };

function coerceValue(column: ColumnSpec, raw: unknown): Coerced {
	if (raw === null || raw === undefined) return EMPTY;

	switch (column.kind) {
		case "text": {
			const text = String(raw);
			if (text === "") {
				return column.allowEmpty ? { ok: true, value: "" } : EMPTY;
			}
			const value = column.lowercase ? text.toLowerCase() : text;
			if (column.maxLength !== undefined && value.length > column.maxLength) {
				return { ok: false, reason: `${value.length} chars exceeds varchar(${column.maxLength})` };
			}
			return { ok: true, value };
		}
		case "bool":
			return {
				ok: true,
				value: raw === true || String(raw).toLowerCase() === "true" || Number(raw) === 1,
			};
		case "int": {
			const value = Number(raw);
			if (!Number.isFinite(value)) return { ok: false, reason: `not a number: ${String(raw)}` };
			return { ok: true, value: Math.trunc(value) };
		}
		case "float": {
			const value = Number(raw);
			if (!Number.isFinite(value)) return { ok: false, reason: `not a number: ${String(raw)}` };
			return { ok: true, value };
		}
		case "timestamp": {
			const text = String(raw).trim();
			if (text === "") return EMPTY;
			// PocketBase serialises dates as "2026-06-15 08:54:54.072Z".
			const date = new Date(text.includes("T") ? text : text.replace(" ", "T"));
			if (Number.isNaN(date.getTime())) {
				return { ok: false, reason: `unparseable timestamp: ${text}` };
			}
			return { ok: true, value: date };
		}
		case "uuid":
			return { ok: true, value: String(raw) };
	}
}

/** Build the id map and the per-table row plans. Pure: no I/O. */
function buildPlan(source: SourceData, passwordHashes: Map<string, string>): TablePlan[] {
	const plans: TablePlan[] = [];

	for (const spec of TABLES) {
		const list = source.lists.get(spec.name) ?? { records: [], totalItems: 0, absent: true };
		const rows: PlannedRow[] = [];

		for (const record of list.records) {
			const pbId = String(record.id ?? "");
			const id = source.idMap.get(spec.name)?.get(pbId) ?? randomUUID();
			const row: PlannedRow = { pbId, id, values: {}, fkSources: {}, issues: [], repairs: [] };

			for (const column of spec.columns) {
				if (column.generated) {
					row.values[column.pg] = id;
					continue;
				}
				if (column.fromSqlite) {
					const hash = passwordHashes.get(pbId);
					if (!hash) {
						row.issues.push({
							column: column.pg,
							pbField: "password",
							reason: "no password hash in the PocketBase SQLite file",
						});
						continue;
					}
					if (!/^\$2[aby]\$/.test(hash)) {
						throw new Error(
							`users ${pbId}: password hash is not bcrypt ($2a$/$2b$/$2y$ expected); refusing to migrate`,
						);
					}
					row.values[column.pg] = hash;
					continue;
				}
				if (column.pb === null) {
					// No source field: the column keeps its schema DEFAULT.
					continue;
				}

				const raw = record[column.pb];
				if (column.fk) {
					const reference = raw === null || raw === undefined ? "" : String(raw);
					if (reference === "") {
						if (column.notNull) {
							row.issues.push({
								column: column.pg,
								pbField: column.pb,
								reason: "empty relation, but the column is NOT NULL",
							});
						}
						continue;
					}
					row.fkSources[column.pg] = reference;
					continue;
				}

				const coerced = coerceValue(column, raw);
				if ("empty" in coerced) {
					if (column.notNull && column.sqlDefault === undefined) {
						row.issues.push({
							column: column.pg,
							pbField: column.pb,
							reason: "empty value, but the column is NOT NULL",
						});
					}
					continue;
				}
				if (!coerced.ok) {
					row.issues.push({ column: column.pg, pbField: column.pb, reason: coerced.reason });
					continue;
				}
				row.values[column.pg] = coerced.value;
			}

			rows.push(row);
		}

		plans.push({ spec, sourceCount: list.totalItems, absent: list.absent, rows });
	}

	return plans;
}

/**
 * Resolve relation columns against the rows that will actually be inserted.
 *
 * Runs in foreign-key order so a skipped parent also skips its children. A
 * dangling reference in a nullable column becomes NULL (reported); in a NOT
 * NULL column it skips the row (reported). Deferred columns are resolved in a
 * second pass, after every table's inserted set is known.
 */
function resolveForeignKeys(plans: TablePlan[], source: SourceData): void {
	const inserted = new Map<CollectionName, Set<string>>();

	const resolve = (table: TablePlan, row: PlannedRow, column: string, reference: string): void => {
		const spec = table.spec.columns.find((candidate) => candidate.pg === column);
		const target = spec?.fk;
		const uuid = target ? source.idMap.get(target)?.get(reference) : undefined;
		const migrated =
			uuid !== undefined && inserted.get(target as CollectionName)?.has(uuid) === true;

		if (migrated) {
			row.values[column] = uuid;
			return;
		}

		const reason = `references ${target ?? "?"} ${reference}, which is not migrated`;
		if (spec?.notNull) {
			row.issues.push({ column, pbField: spec.pb, reason });
		} else {
			row.repairs.push({ column, pbField: spec.pb ?? null, reason: `${reason} -> NULL` });
		}
	};

	for (const table of plans) {
		for (const row of table.rows) {
			for (const [column, reference] of Object.entries(row.fkSources)) {
				const spec = table.spec.columns.find((candidate) => candidate.pg === column);
				if (spec?.deferred) continue;
				resolve(table, row, column, reference);
			}
		}
		const ids = new Set<string>();
		for (const row of table.rows) {
			if (row.issues.length === 0) ids.add(row.id);
		}
		inserted.set(table.spec.name, ids);
	}

	// Second pass: deferred columns are nullable by construction, so resolving
	// them cannot change any inserted set.
	for (const table of plans) {
		for (const row of table.rows) {
			if (row.issues.length > 0) continue;
			for (const [column, reference] of Object.entries(row.fkSources)) {
				const spec = table.spec.columns.find((candidate) => candidate.pg === column);
				if (!spec?.deferred) continue;
				resolve(table, row, column, reference);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function redactUrl(raw: string): string {
	try {
		const url = new URL(raw);
		if (url.password) url.password = "***";
		return url.toString();
	} catch {
		return "<unparseable url>";
	}
}

function databaseName(raw: string): string {
	try {
		return new URL(raw).pathname.replace(/^\//, "") || "<unknown>";
	} catch {
		return "<unknown>";
	}
}

function printTable(headers: string[], rows: string[][]): void {
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length), 0),
	);
	const line = (cells: string[]): string =>
		cells
			.map((cell, index) => cell.padEnd(widths[index] ?? 0))
			.join("  ")
			.trimEnd();
	console.log(`  ${line(headers)}`);
	console.log(`  ${line(widths.map((width) => "-".repeat(width)))}`);
	for (const row of rows) console.log(`  ${line(row)}`);
}

function describeColumn(column: ColumnSpec): string {
	if (column.generated) return "(generated uuid)";
	if (column.fromSqlite) return "password (SQLite)";
	if (column.pb === null) return `(default ${column.sqlDefault ?? "NULL"})`;
	return column.pb;
}

function printColumnMapping(plans: TablePlan[]): void {
	console.log("\nColumn mapping");
	for (const table of plans) {
		console.log(`\n  ${table.spec.name}`);
		printTable(
			["PG column", "<- PB field", "type", "null"],
			table.spec.columns.map((column) => [
				column.pg,
				describeColumn(column),
				column.kind,
				column.notNull ? "NOT NULL" : "null",
			]),
		);
		if (table.spec.dropped.length > 0) {
			for (const dropped of table.spec.dropped) {
				console.log(`    dropped ${dropped.pb}: ${dropped.reason}`);
			}
		}
	}
}

interface FilePlan {
	pbTeamId: string;
	teamUuid: string;
	filename: string;
	stagedPath: string;
	finalPath: string;
}

function planFiles(plans: TablePlan[], stagingRoot: string, uploadsDir: string): FilePlan[] {
	const teams = plans.find((table) => table.spec.name === "teams");
	if (!teams) return [];

	const files: FilePlan[] = [];
	for (const row of teams.rows) {
		if (row.issues.length > 0) continue;
		const filename = row.values.submission_file;
		if (typeof filename !== "string" || filename === "") continue;
		if (!SAFE_FILENAME.test(filename)) {
			throw new Error(`Team ${row.pbId} has an unsafe submission filename: ${filename}`);
		}
		files.push({
			pbTeamId: row.pbId,
			teamUuid: row.id,
			filename,
			stagedPath: path.join(stagingRoot, "teams", row.id, filename),
			finalPath: path.join(uploadsDir, "teams", row.id, filename),
		});
	}
	return files;
}

// ---------------------------------------------------------------------------
// Target database
// ---------------------------------------------------------------------------

interface TargetState {
	database: string;
	missingTables: string[];
	counts: Map<CollectionName, number>;
}

async function inspectTarget(pool: Pool): Promise<TargetState> {
	const identity = await pool.query<{ database: string }>("SELECT current_database() AS database");
	const present = await pool.query<{ table_name: string }>(
		"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
	);
	const names = new Set(present.rows.map((row) => row.table_name));
	const missingTables = TABLES.map((table) => table.name).filter((name) => !names.has(name));

	const counts = new Map<CollectionName, number>();
	for (const table of TABLES) {
		if (missingTables.includes(table.name)) {
			counts.set(table.name, 0);
			continue;
		}
		const result = await pool.query<{ count: string }>(
			`SELECT count(*) AS count FROM "${table.name}"`,
		);
		counts.set(table.name, Number(result.rows[0]?.count ?? 0));
	}

	return { database: identity.rows[0]?.database ?? "<unknown>", missingTables, counts };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function insertableColumns(spec: TableSpec): ColumnSpec[] {
	return spec.columns.filter((column) => !column.deferred);
}

/**
 * Build the INSERT statement for one table.
 *
 * Columns that no row provides are left out of the column list entirely, so
 * the schema DEFAULT applies — that is how `created_at`/`updated_at` are
 * filled for collections without autodate fields. A row that lacks a column
 * another row provides gets the `DEFAULT` keyword in its VALUES list.
 */
function buildInsert(spec: TableSpec, columns: ColumnSpec[]): { prefix: string; suffix: string } {
	const names = columns.map((column) => `"${column.pg}"`).join(", ");
	const suffix =
		spec.upsertKey === undefined
			? ""
			: ` ON CONFLICT ("${spec.upsertKey}") DO UPDATE SET "value" = EXCLUDED."value"`;
	return { prefix: `INSERT INTO "${spec.name}" (${names}) VALUES `, suffix };
}

async function insertTable(client: PoolClient, table: TablePlan): Promise<number> {
	const rows = table.rows.filter((row) => row.issues.length === 0);
	if (rows.length === 0) return 0;

	const columns = insertableColumns(table.spec).filter((column) =>
		rows.some((row) => row.values[column.pg] !== undefined),
	);
	const { prefix, suffix } = buildInsert(table.spec, columns);

	for (const row of rows) {
		const params: unknown[] = [];
		const placeholders = columns.map((column) => {
			const value = row.values[column.pg];
			if (value === undefined) return "DEFAULT";
			params.push(value);
			return `$${params.length}`;
		});
		await client.query(`${prefix}(${placeholders.join(", ")})${suffix}`, params);
	}
	return rows.length;
}

/**
 * Fill `institutions.campus_lead_id`, which cannot be set on INSERT because
 * users reference institutions.
 *
 * The `trg_institutions_updated_at` trigger would overwrite the migrated
 * `updated_at` with `now()`, so it is disabled for the duration of the update
 * and re-enabled before the transaction commits.
 */
async function applyDeferredColumns(client: PoolClient, table: TablePlan): Promise<number> {
	const deferred = table.spec.columns.filter((column) => column.deferred);
	if (deferred.length === 0) return 0;

	const rows = table.rows.filter(
		(row) =>
			row.issues.length === 0 && deferred.some((column) => row.values[column.pg] !== undefined),
	);
	if (rows.length === 0) return 0;

	// Preserving the migrated `updated_at` needs the trigger off, which needs
	// table ownership. Without it the trigger bumps the column to now() — an
	// acceptable loss for a one-time migration, so degrade instead of failing.
	let triggerDisabled = false;
	try {
		await client.query(
			`ALTER TABLE "${table.spec.name}" DISABLE TRIGGER "trg_${table.spec.name}_updated_at"`,
		);
		triggerDisabled = true;
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code !== "42501" && code !== "42P01") throw error;
		console.warn(
			`[migrate] cannot disable the updated_at trigger on "${table.spec.name}" (${code}); migrated timestamps will be replaced by now()`,
		);
	}
	try {
		for (const row of rows) {
			const assignments = deferred
				.filter((column) => row.values[column.pg] !== undefined)
				.map((column, index) => `"${column.pg}" = $${index + 1}`);
			const params = deferred
				.filter((column) => row.values[column.pg] !== undefined)
				.map((column) => row.values[column.pg]);
			// Keep the migrated timestamp: the trigger is off, so this sticks.
			assignments.push(`"updated_at" = $${params.length + 1}`);
			params.push(row.values.updated_at ?? new Date());
			params.push(row.id);
			await client.query(
				`UPDATE "${table.spec.name}" SET ${assignments.join(", ")} WHERE "id" = $${params.length}`,
				params,
			);
		}
	} finally {
		if (triggerDisabled) {
			await client.query(
				`ALTER TABLE "${table.spec.name}" ENABLE TRIGGER "trg_${table.spec.name}_updated_at"`,
			);
		}
	}

	return rows.length;
}

async function stageFiles(
	client: PbClient,
	files: FilePlan[],
): Promise<{ staged: FilePlan[]; bytes: number }> {
	const fileToken = files.length > 0 ? await pbFileToken(client) : null;
	let bytes = 0;
	for (const file of files) {
		const download = await pbDownloadFile(client, "teams", file.pbTeamId, file.filename, fileToken);
		if (download.contentLength !== null && download.contentLength !== download.bytes.byteLength) {
			throw new Error(
				`${file.filename}: Content-Length ${download.contentLength} != ${download.bytes.byteLength} bytes received`,
			);
		}
		await mkdir(path.dirname(file.stagedPath), { recursive: true });
		await writeFile(file.stagedPath, download.bytes);
		bytes += download.bytes.byteLength;
	}
	return { staged: files, bytes };
}

/**
 * Move staged files into the uploads volume.
 *
 * Each file lands under a temporary name in its final directory and is then
 * renamed, so a crash never leaves a truncated submission behind. Every
 * promoted path is appended to `written` as it lands, so a failure halfway
 * through still leaves the caller able to undo what was written.
 */
async function promoteFiles(files: FilePlan[], written: string[]): Promise<void> {
	for (const file of files) {
		const directory = path.dirname(file.finalPath);
		await mkdir(directory, { recursive: true });
		const temporary = path.join(directory, `.tmp-${randomUUID()}`);
		await copyFile(file.stagedPath, temporary);
		await rename(temporary, file.finalPath);
		written.push(file.finalPath);
	}
}

async function removeFiles(paths: string[]): Promise<void> {
	for (const file of paths) {
		await unlink(file).catch(() => {});
		const directory = path.dirname(file);
		const remaining = await readdir(directory).catch(() => null);
		if (remaining !== null && remaining.length === 0) {
			await rm(directory, { recursive: false, force: true }).catch(() => {});
		}
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const startedAt = Date.now();
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		printHelp();
		return;
	}

	const targetUrl = options.target ?? process.env.DATABASE_URL;
	if (!targetUrl) throw new Error("No target database: pass --target or set DATABASE_URL.");

	const pbUrl = options.pb ?? process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090";
	const sqlitePath = options.pbSqlite ?? process.env.PB_SQLITE_PATH;
	if (!sqlitePath) {
		throw new Error(
			"No PocketBase SQLite file: pass --pb-sqlite or set PB_SQLITE_PATH. " +
				"Copy it out of the container first: " +
				"docker cp <pb-container>:/pocketbase/data/data.db /tmp/pb-data.db",
		);
	}

	const uploadsDir = process.env.UPLOADS_DIR;
	if (!uploadsDir)
		throw new Error("UPLOADS_DIR is not set: it is the root of the submission volume.");

	const identity = process.env.PB_SUPERUSER_EMAIL;
	const password = process.env.PB_SUPERUSER_PASSWORD;
	if (!identity || !password) {
		throw new Error("PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD must be set.");
	}

	const runDir = path.join(options.out, new Date().toISOString().replace(/[:.]/g, "-"));
	const stagingRoot = path.join(runDir, "staging");

	console.log("VisionHack PocketBase -> PostgreSQL migration");
	console.log(`mode:    ${options.apply ? "APPLY" : "DRY RUN (no writes)"}`);
	console.log(`source:  ${pbUrl}`);
	console.log(`target:  ${redactUrl(targetUrl)}`);
	console.log(`uploads: ${path.resolve(uploadsDir)}`);
	console.log(`output:  ${path.resolve(runDir)}`);
	console.log(`limit:   ${options.limit ?? "none"}`);

	// --- Source -----------------------------------------------------------
	const client = await pbAuthenticate(pbUrl, identity, password);
	console.log(`PB:      authenticated (version ${client.version})`);

	const lists = new Map<CollectionName, PbListResult>();
	for (const collection of COLLECTIONS) {
		lists.set(collection, await pbListAll(client, collection, options.limit));
	}

	// One uuid per source record, generated before any row is built so that
	// relations resolve regardless of insert order.
	const idMap = new Map<CollectionName, Map<string, string>>();
	for (const collection of COLLECTIONS) {
		const map = new Map<string, string>();
		for (const record of lists.get(collection)?.records ?? []) {
			map.set(String(record.id ?? ""), randomUUID());
		}
		idMap.set(collection, map);
	}

	const passwordHashes = readPasswordHashes(sqlitePath);
	const plans = buildPlan({ lists, idMap }, passwordHashes);
	resolveForeignKeys(plans, { lists, idMap });

	// --- Target -----------------------------------------------------------
	const pool = new Pool({ connectionString: targetUrl, max: 2, connectionTimeoutMillis: 10_000 });
	pool.on("error", (error) => console.error("[migrate] idle client error", error));

	let exitCode = 0;
	try {
		const target = await inspectTarget(pool);
		if (target.missingTables.length > 0) {
			throw new Error(
				`Target database ${target.database} is missing tables: ${target.missingTables.join(", ")}. Apply postgres/schema.sql first.`,
			);
		}

		const populated = TABLES.filter((table) => (target.counts.get(table.name) ?? 0) > 0).map(
			(table) => `${table.name} (${target.counts.get(table.name)})`,
		);

		// --- Report -------------------------------------------------------
		console.log("\nSource rows (PocketBase REST totalItems)");
		printTable(
			["collection", "totalItems", "fetched", "note"],
			COLLECTIONS.map((collection) => {
				const list = lists.get(collection);
				return [
					collection,
					String(list?.totalItems ?? 0),
					String(list?.records.length ?? 0),
					list?.absent ? "collection absent on this instance" : "",
				];
			}),
		);

		console.log("\nTarget tables");
		printTable(
			["table", "rows", "state"],
			TABLES.map((table) => [
				table.name,
				String(target.counts.get(table.name) ?? 0),
				(target.counts.get(table.name) ?? 0) > 0 ? "POPULATED" : "empty",
			]),
		);

		printColumnMapping(plans);

		// Column-level gaps: a NOT NULL column with no source and no DEFAULT.
		const columnGaps: string[] = [];
		for (const table of plans) {
			for (const column of table.spec.columns) {
				if (
					column.notNull &&
					column.pb === null &&
					column.sqlDefault === undefined &&
					!column.generated &&
					!column.fromSqlite
				) {
					columnGaps.push(`${table.spec.name}.${column.pg}`);
				}
			}
		}
		console.log("\nNOT NULL columns without a source");
		if (columnGaps.length === 0) {
			console.log("  none: every NOT NULL column has a PocketBase source or a schema DEFAULT");
		} else {
			for (const gap of columnGaps) console.log(`  ${gap}`);
		}

		// Row-level gaps.
		console.log("\nRows that cannot be migrated (NOT NULL unsatisfiable)");
		let skippedTotal = 0;
		for (const table of plans) {
			const skipped = table.rows.filter((row) => row.issues.length > 0);
			if (skipped.length === 0) continue;
			skippedTotal += skipped.length;
			for (const row of skipped) {
				for (const issue of row.issues) {
					console.log(
						`  ${table.spec.name} ${row.pbId} (${issue.pbField ?? "?"}): ${issue.reason} [${issue.column}]`,
					);
				}
			}
		}
		if (skippedTotal === 0) console.log("  none");

		console.log("\nDangling references repaired to NULL (nullable columns)");
		let repairTotal = 0;
		for (const table of plans) {
			for (const row of table.rows) {
				for (const repair of row.repairs) {
					repairTotal++;
					console.log(`  ${table.spec.name} ${row.pbId} ${repair.column}: ${repair.reason}`);
				}
			}
		}
		if (repairTotal === 0) console.log("  none");

		const files = planFiles(plans, stagingRoot, uploadsDir);
		console.log("\nSubmission files");
		if (files.length === 0) {
			console.log("  none");
		} else {
			printTable(
				["PB team", "new team uuid", "filename"],
				files.map((file) => [file.pbTeamId, file.teamUuid, file.filename]),
			);
		}

		console.log("\nPlanned inserts");
		printTable(
			["table", "source", "insert", "skipped"],
			plans.map((table) => {
				const skipped = table.rows.filter((row) => row.issues.length > 0).length;
				return [
					table.spec.name,
					String(table.sourceCount),
					String(table.rows.length - skipped),
					String(skipped),
				];
			}),
		);

		if (columnGaps.length > 0) {
			throw new Error(
				`${columnGaps.length} NOT NULL column(s) have no PocketBase source and no DEFAULT: ${columnGaps.join(", ")}`,
			);
		}

		if (!options.apply) {
			console.log("\nDRY RUN: nothing written. Re-run with --apply to migrate.");
			return;
		}

		// --- Apply --------------------------------------------------------
		if (populated.length > 0 && !options.force) {
			throw new Error(
				`Target database ${target.database} already has data in: ${populated.join(", ")}. Re-run with --force to replace the contents of the seven tables.`,
			);
		}
		if (populated.length > 0) {
			console.log(`\n--force: replacing the contents of ${populated.join(", ")}`);
		}

		await mkdir(stagingRoot, { recursive: true });

		// Files are downloaded before the transaction opens: no network I/O
		// inside the transaction, and nothing reaches the volume until commit.
		let staged: { staged: FilePlan[]; bytes: number };
		try {
			staged = await stageFiles(client, files);
		} catch (error) {
			await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
			throw error;
		}
		console.log(`\nStaged ${staged.staged.length} file(s), ${staged.bytes} bytes`);

		const inserted = new Map<CollectionName, number>();
		const dbClient = await pool.connect();
		try {
			await dbClient.query("BEGIN");
			if (options.force) {
				await dbClient.query(
					`TRUNCATE ${TABLES.map((table) => `"${table.name}"`).join(", ")} CASCADE`,
				);
			}

			for (const table of plans) {
				inserted.set(table.spec.name, await insertTable(dbClient, table));
				if (table.spec.name === "users") {
					const institutions = plans.find((plan) => plan.spec.name === "institutions");
					if (institutions) await applyDeferredColumns(dbClient, institutions);
				}
			}

			await dbClient.query("COMMIT");
		} catch (error) {
			// Nothing has reached the volume yet: the files are still staged.
			await dbClient.query("ROLLBACK").catch(() => {});
			await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
			throw error;
		} finally {
			dbClient.release();
		}

		// The transaction is committed: promote the staged files.
		const written: string[] = [];
		try {
			await promoteFiles(staged.staged, written);
		} catch (error) {
			// The rows are already committed, so the only consistent recovery is
			// to undo the files that landed and keep the staging tree for a retry.
			await removeFiles(written);
			throw new Error(
				`Database committed but file promotion failed: ${error instanceof Error ? error.message : String(error)}. ` +
					`Rows are in ${target.database}; the staged files are still in ${stagingRoot}.`,
			);
		}

		// --- Id map -------------------------------------------------------
		const mapFile = path.join(runDir, "migrate-id-map.json");
		const mapDocument = {
			generatedAt: new Date().toISOString(),
			source: { baseUrl: pbUrl, version: client.version },
			target: { database: target.database },
			limit: options.limit ?? null,
			counts: Object.fromEntries(inserted),
			collections: Object.fromEntries(
				COLLECTIONS.map((collection) => [
					collection,
					Object.fromEntries(idMap.get(collection) ?? []),
				]),
			),
			skipped: plans.flatMap((table) =>
				table.rows
					.filter((row) => row.issues.length > 0)
					.map((row) => ({ table: table.spec.name, pbId: row.pbId, issues: row.issues })),
			),
			repaired: plans.flatMap((table) =>
				table.rows.flatMap((row) =>
					row.repairs.map((repair) => ({ table: table.spec.name, pbId: row.pbId, ...repair })),
				),
			),
			files: staged.staged.map((file) => ({
				pbTeamId: file.pbTeamId,
				teamUuid: file.teamUuid,
				filename: file.filename,
			})),
		};
		await writeFile(mapFile, `${JSON.stringify(mapDocument, null, 2)}\n`, "utf8");

		console.log("\nInserted");
		printTable(
			["table", "inserted"],
			TABLES.map((table) => [table.name, String(inserted.get(table.name) ?? 0)]),
		);
		console.log(`\nFiles written: ${written.length}`);
		console.log(`Id map:        ${mapFile}`);
		console.log(`Duration:      ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
		console.log("\nMigration complete.");
	} catch (error) {
		exitCode = 1;
		console.error(`\nmigration failed: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		await pool.end();
	}

	if (exitCode !== 0) process.exitCode = exitCode;
}

await main();
