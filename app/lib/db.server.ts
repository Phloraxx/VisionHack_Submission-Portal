/**
 * SQLite access layer — one process-wide better-sqlite3 connection.
 *
 * The connection is a singleton guarded on `globalThis` so Vite HMR (and React
 * Router dev restarts) do not leak file handles. It is opened lazily, so
 * importing this module never touches the disk (tests and `react-router build`
 * stay side-effect free).
 *
 * Why one connection
 * ------------------
 * better-sqlite3 is synchronous, so the event loop *is* the write queue: a
 * statement runs to completion before any other request can start one. That is
 * what makes the single-connection design faster than a pool — see the
 * benchmark note in `sqlite/schema.sql`'s sibling brief. A pool of connections
 * would instead serialise on SQLite's writer lock and produce `SQLITE_BUSY`
 * tails.
 *
 * Conventions
 * -----------
 * - Columns are snake_case (see `sqlite/schema.sql`); the mappers here turn
 *   rows into the camelCase record shapes in `app/lib/types.ts`, so route code
 *   keeps reading `user.institutionId`, `team.created`, and so on.
 * - Every query is parameterised. No string interpolation of user input.
 * - Timestamps are TEXT ISO-8601 UTC with milliseconds. `strftime('%Y-%m-%dT%H:%M:%fZ')`
 *   in the schema and `Date.toISOString()` in the app produce the same shape,
 *   so lexical comparison is chronological.
 * - Booleans are INTEGER 0/1; `bindable` coerces on the way in and the mappers
 *   compare against 1 on the way out.
 * - Every repository method takes the acting user and applies the §6.2 scope
 *   predicate in SQL. The old backend's API rules were the second line of
 *   defence behind the route loaders; here the predicate is the only line, so
 *   it lives in this file (docs/PG_PORT_PLAN.md §6.2).
 * - Repository calls made inside `withTransaction` join that transaction, so a
 *   route can compose several writes into one atomic unit.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { getEnv } from "./env.server";
import type {
	ConfigRecord,
	InstitutionRecord,
	MemberRecord,
	QuestionnaireResponseRecord,
	Role,
	TeamStatus,
	TeamView,
	UserRecord,
} from "./types";

/**
 * Schema version this build expects. 1 is the initial release.
 *
 * Bumping this re-applies `sqlite/schema.sql`, which is idempotent — but the
 * file only creates missing objects. Changing an existing column (a type, a
 * NOT NULL) still needs a real migration; a bump alone will not alter it.
 */
const SCHEMA_VERSION = 1;

/** `:memory:` opens a private in-memory database — used by the unit tests. */
const IN_MEMORY = ":memory:";

// ---------------------------------------------------------------------------
// Connection singleton (HMR-safe)
// ---------------------------------------------------------------------------

interface DbGlobal {
	__visionhackSqlite?: Database.Database;
}

const globalForDb = globalThis as typeof globalThis & DbGlobal;

/**
 * Apply `sqlite/schema.sql` when the database is older than this build.
 *
 * The file is idempotent, so re-applying it to a database created by an older
 * build is safe. `PRAGMA user_version` is the marker: 0 means "never
 * initialised" (a fresh file, or one from before the port).
 */
function ensureSchema(database: Database.Database): void {
	const version = database.pragma("user_version", { simple: true }) as number;
	if (version >= SCHEMA_VERSION) return;

	const schemaFile = resolve(process.cwd(), "sqlite", "schema.sql");
	const schema = readFileSync(schemaFile, "utf8");

	database.exec("BEGIN IMMEDIATE");
	try {
		database.exec(schema);
		database.pragma(`user_version = ${SCHEMA_VERSION}`);
		database.exec("COMMIT");
	} catch (err) {
		database.exec("ROLLBACK");
		throw err;
	}
}

function openDatabase(): Database.Database {
	const path = getEnv().SQLITE_PATH;
	if (path !== IN_MEMORY) mkdirSync(dirname(resolve(path)), { recursive: true });

	const database = new Database(path);
	// WAL keeps readers off the writer's back and survives a crash; NORMAL
	// syncs at checkpoint rather than per commit (the documented trade: the
	// last few transactions can be lost on power loss, the database cannot
	// corrupt).
	database.pragma("journal_mode = WAL");
	database.pragma("synchronous = NORMAL");
	// Off by default in SQLite — without it every FK in the schema is decorative.
	database.pragma("foreign_keys = ON");
	database.pragma("busy_timeout = 5000");
	database.pragma("wal_autocheckpoint = 1000");

	ensureSchema(database);
	return database;
}

/** The shared connection. Opened on first use, never closed by the app. */
function getDatabase(): Database.Database {
	if (!globalForDb.__visionhackSqlite) {
		globalForDb.__visionhackSqlite = openDatabase();
	}
	return globalForDb.__visionhackSqlite;
}

// ---------------------------------------------------------------------------
// Statement cache + binding
// ---------------------------------------------------------------------------

/**
 * Prepared statements, keyed by SQL text.
 *
 * The set of distinct statements is fixed by the code paths below, so the map
 * is naturally bounded. Re-preparing per call would re-parse and re-plan on
 * every request — the single largest avoidable cost in a synchronous driver.
 */
const statementCache = new Map<string, Database.Statement>();

function prepare(sql: string): Database.Statement {
	let statement = statementCache.get(sql);
	if (!statement) {
		statement = getDatabase().prepare(sql);
		statementCache.set(sql, statement);
	}
	return statement;
}

/** What better-sqlite3 accepts as a bound value. */
type BindValue = string | number | bigint | Buffer | null;

/**
 * Coerce a JavaScript value to something SQLite can bind.
 *
 * SQLite has no boolean type and better-sqlite3 rejects `true`/`false`
 * outright, so they become 1/0 here rather than at every call site. `undefined`
 * binds as NULL, matching how an absent optional column behaved in Postgres.
 */
function bindable(value: unknown): BindValue {
	if (value === null || value === undefined) return null;
	if (typeof value === "boolean") return value ? 1 : 0;
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
		return value;
	}
	if (Buffer.isBuffer(value)) return value;
	throw new TypeError(`Unsupported SQLite bind value of type ${typeof value}`);
}

function bindAll(params: unknown[]): BindValue[] {
	return params.map(bindable);
}

/**
 * Run a statement and return every row it produced.
 *
 * `query()` is a general escape hatch, so a statement that returns no rows
 * (a plain INSERT/UPDATE/DELETE) is executed with `run()` and reported as an
 * empty result — the same shape pg gave for a write without RETURNING.
 */
function selectAll<T>(sql: string, params: unknown[] = []): T[] {
	const statement = prepare(sql);
	const values = bindAll(params);
	if (!statement.reader) {
		statement.run(...values);
		return [];
	}
	return statement.all(...values) as T[];
}

/** Run a statement and return its first row, if any. */
function selectOne<T>(sql: string, params: unknown[] = []): T | undefined {
	return prepare(sql).get(...bindAll(params)) as T | undefined;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** The `rows` shape `query()` returns — the subset of pg's result the app reads. */
export interface QueryResult<T> {
	rows: T[];
}

/**
 * Marks the async call chain that is running inside `withTransaction`.
 *
 * `query()` publishes nothing here; it only *reads* it to decide whether to
 * join the open transaction or wait for it to finish.
 */
const transactionStorage = new AsyncLocalStorage<true>();

/**
 * Tail of the queue that serialises access to the single connection.
 *
 * A transaction holds this for its whole duration, including any await inside
 * its body. That matters: better-sqlite3 is synchronous, but a transaction body
 * may still await non-database I/O (the campus-lead invite hashes a password
 * with argon2 inside one). Without the lock, another request's statements would
 * execute inside that open transaction and be committed or rolled back with it.
 */
let lockTail: Promise<void> = Promise.resolve();

async function acquireConnection(): Promise<() => void> {
	let release!: () => void;
	const held = new Promise<void>((resolveHeld) => {
		release = resolveHeld;
	});
	const previous = lockTail;
	lockTail = previous.then(() => held);
	await previous;
	return release;
}

/**
 * Run a parameterised query.
 *
 * Inside `withTransaction` the query runs on the open transaction, so a
 * repository call made from the callback is part of the same atomic unit.
 * Outside one it waits for any in-flight transaction to finish first.
 */
export async function query<T = Record<string, unknown>>(
	sql: string,
	params: unknown[] = [],
): Promise<QueryResult<T>> {
	if (transactionStorage.getStore()) return { rows: selectAll<T>(sql, params) };

	const release = await acquireConnection();
	try {
		return { rows: selectAll<T>(sql, params) };
	} finally {
		release();
	}
}

/**
 * Run `fn` inside a transaction on the shared connection.
 *
 * `BEGIN IMMEDIATE` takes the write lock up front, so a transaction that will
 * write cannot fail halfway through on a lock upgrade. Commits when `fn`
 * resolves, rolls back when it throws. Repository calls made inside `fn` —
 * directly or through a helper — run on the same connection (see `query`), so a
 * multi-write sequence is all-or-nothing.
 *
 * Nested calls join the enclosing transaction instead of opening a second one.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
	if (transactionStorage.getStore()) return fn();

	const release = await acquireConnection();
	const database = getDatabase();
	try {
		database.exec("BEGIN IMMEDIATE");
		try {
			const result = await transactionStorage.run(true, fn);
			database.exec("COMMIT");
			return result;
		} catch (err) {
			try {
				database.exec("ROLLBACK");
			} catch (rollbackErr) {
				// The connection is in an unknown state; surface both failures
				// rather than hiding the rollback behind the original error.
				console.error("[db] Rollback failed", rollbackErr);
			}
			throw err;
		}
	} finally {
		release();
	}
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

/** `institution_id` → `institutionId`. */
function toCamelCase(key: string): string {
	return key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

// ---------------------------------------------------------------------------
// Shared query helpers
// ---------------------------------------------------------------------------

/**
 * The acting user a repository scopes its queries to (plan §6.2).
 *
 * A full `UserRecord` satisfies it, so route code passes `user` unchanged;
 * `transitionTeamStatus` builds one from the session's id/role/institution.
 */
export type ActingUser = Pick<UserRecord, "id" | "role" | "institutionId">;

/** Paginated list result shape, so route code keeps reading `.items`. */
export interface ListResult<T> {
	page: number;
	perPage: number;
	totalItems: number;
	totalPages: number;
	items: T[];
}

/** The "no rows" result — returned when a filter value cannot match anything. */
function emptyList<T>(): ListResult<T> {
	return { page: 1, perPage: 0, totalItems: 0, totalPages: 0, items: [] };
}

/**
 * Placeholder factory — keeps the SQL text and the parameter array in sync.
 *
 * SQLite binds positionally, so each `?` consumes the next value: a value
 * referenced twice in one statement must be pushed twice. Call `p()` at the
 * point of use rather than reusing the returned string.
 */
interface ParamList {
	params: unknown[];
	p(value: unknown): string;
}

function paramList(): ParamList {
	const params: unknown[] = [];
	return {
		params,
		p(value: unknown): string {
			params.push(value);
			return "?";
		},
	};
}

/** `?, ?, ?` for an `IN (…)` list, pushing one parameter per value. */
function inClause(values: unknown[], p: ParamList["p"]): string {
	return values.map((value) => p(value)).join(", ");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guard an id: a malformed one must read as "no such row", not as an error. */
export function isUuid(value: string): boolean {
	return UUID_RE.test(value);
}

/** SQLite `foreign key constraint failed` — a delete blocked by a referencing row. */
function isForeignKeyViolation(err: unknown): boolean {
	if (typeof err !== "object" || err === null) return false;
	const { code, message } = err as { code?: string; message?: string };
	// A dangling reference on INSERT/UPDATE reports FOREIGNKEY directly.
	if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") return true;
	// SQLite implements ON DELETE RESTRICT as an internal trigger, so a delete
	// blocked by a referencing row surfaces as TRIGGER instead. The message is
	// checked too, so an unrelated trigger failure is not swallowed here.
	return code === "SQLITE_CONSTRAINT_TRIGGER" && /FOREIGN KEY/i.test(message ?? "");
}

/** Stored ISO-8601 text → the same string; unset → `""`. */
function toIso(value: string | null): string {
	if (!value) return "";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function toArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 1000;

function normalizePaging(
	page: number | undefined,
	perPage: number | undefined,
): { page: number; perPage: number; offset: number } {
	// `Number("Infinity")` survives Math.floor and would reach SQL as an
	// offset, so both bounds are checked for finiteness.
	const safePage = page && Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
	const safePerPage =
		perPage && Number.isFinite(perPage) && perPage > 0
			? Math.min(Math.floor(perPage), MAX_PER_PAGE)
			: DEFAULT_PER_PAGE;
	return { page: safePage, perPage: safePerPage, offset: (safePage - 1) * safePerPage };
}

/**
 * Translate a sort string (`"-created"`, `"name"`) into an ORDER BY
 * clause. Only whitelisted columns reach the SQL, so the value cannot inject.
 */
function orderByClause(
	sort: string | undefined,
	columns: Record<string, string>,
	fallback: string,
): string {
	const raw = (sort ?? fallback).trim();
	const descending = raw.startsWith("-");
	const key = descending ? raw.slice(1) : raw;
	// Always resolve to a real column: an unknown key falls back to the
	// caller's default, then to the first whitelisted column.
	const column =
		columns[key] ?? columns[fallback.replace(/^-/, "")] ?? Object.values(columns)[0] ?? "1";
	return `${column} ${descending ? "DESC" : "ASC"}`;
}

/** `%value%` with LIKE metacharacters escaped, for a `contains` match. */
function containsPattern(value: string): string {
	return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * §6.2 `teams` list/view predicate:
 * `role IN ('admin','coordinator') OR institution_id = $inst OR leader_user_id = $uid`.
 *
 * `members` and `questionnaire_responses` reuse it against their joined
 * `teams` alias — their rules are the same predicate on the parent team.
 */
export function teamScope(user: ActingUser, p: ParamList["p"], alias = "t"): string {
	if (user.role === "admin" || user.role === "coordinator") return "TRUE";
	if (user.role === "institution") {
		return user.institutionId ? `${alias}.institution_id = ${p(user.institutionId)}` : "FALSE";
	}
	return `${alias}.leader_user_id = ${p(user.id)}`;
}

/** §6.2 `institutions` list/view predicate: `role IN ('admin','coordinator') OR id = $inst`. */
export function institutionScope(user: ActingUser, p: ParamList["p"], alias = "i"): string {
	if (user.role === "admin" || user.role === "coordinator") return "TRUE";
	return user.institutionId ? `${alias}.id = ${p(user.institutionId)}` : "FALSE";
}

// ---------------------------------------------------------------------------
// users repository
// ---------------------------------------------------------------------------

/** A `users` row as SQLite returns it. */
interface UserDbRow {
	id: string;
	email: string;
	name: string | null;
	role: Role;
	institution_id: string | null;
	password_hash: string;
	created_at: string;
	updated_at: string;
}

/** `UserRecord` plus the password hash — only the auth paths may see this. */
export type UserAuthRow = UserRecord & { passwordHash: string };

const USER_COLUMNS = "id, email, name, role, institution_id, created_at, updated_at";

/**
 * `users` row → `UserRecord`.
 *
 * Unset relations map to `""` and the autodate fields to ISO strings; both
 * are preserved so components keep their existing truthiness checks.
 */
function toUserRecord(row: UserDbRow): UserRecord {
	return {
		id: row.id,
		email: row.email,
		name: row.name ?? "",
		role: row.role,
		institutionId: row.institution_id ?? "",
		created: toIso(row.created_at),
		updated: toIso(row.updated_at),
	};
}

export interface UserCreateInput {
	email: string;
	name: string;
	role: Role;
	institutionId?: string;
	/** Already hashed — the caller owns the hashing algorithm. */
	passwordHash: string;
}

export interface UsersRepository {
	/** Look up by email (case-insensitive) including the password hash. */
	findByEmail(email: string): Promise<UserAuthRow | null>;
	/**
	 * Load the live record used by `resolveAuth` — no password hash.
	 *
	 * The only repository read with no scope predicate: `id` must come from a
	 * verified token or a server-side relation, never from a request parameter.
	 */
	findById(id: string): Promise<UserRecord | null>;
	/** `findById` plus the password hash, for the session fingerprint check. */
	findSessionUser(id: string): Promise<UserAuthRow | null>;
	/** Count the users the actor may list (§6.2 users list predicate). */
	count(user: ActingUser): Promise<number>;
	/** Current hash, for the password-reset fingerprint check. */
	findPasswordHashById(id: string): Promise<string | null>;
	/** Write a new hash (bcrypt → argon2id upgrade, or a completed reset). */
	updatePasswordHash(id: string, passwordHash: string): Promise<void>;
	/**
	 * Write a new hash only when the stored one still matches `expectedHash`.
	 * Returns false when another request already consumed the reset token.
	 */
	updatePasswordHashIfUnchanged(
		id: string,
		expectedHash: string,
		passwordHash: string,
	): Promise<boolean>;
	/**
	 * Create a user. §6.2: admin, or an institution inviting a `lead` into its
	 * own institution. Returns null when the acting user may not.
	 */
	create(user: ActingUser, input: UserCreateInput): Promise<UserRecord | null>;
	/** Delete a user (admin only — the campus-lead rollback path). */
	delete(user: ActingUser, id: string): Promise<boolean>;
}

export const users: UsersRepository = {
	async findByEmail(email: string): Promise<UserAuthRow | null> {
		const row = selectOne<UserDbRow>(
			`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = lower(?) LIMIT 1`,
			[email],
		);
		if (!row) return null;
		return { ...toUserRecord(row), passwordHash: row.password_hash };
	},

	async findById(id: string): Promise<UserRecord | null> {
		// Guard the id: a malformed one must read as "no such user", not as an
		// error from the driver.
		if (!isUuid(id)) return null;
		const row = selectOne<UserDbRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`, [
			id,
		]);
		return row ? toUserRecord(row) : null;
	},

	async findSessionUser(id: string): Promise<UserAuthRow | null> {
		if (!isUuid(id)) return null;
		const row = selectOne<UserDbRow>(
			`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE id = ? LIMIT 1`,
			[id],
		);
		return row ? { ...toUserRecord(row), passwordHash: row.password_hash } : null;
	},

	async count(user: ActingUser): Promise<number> {
		const { params, p } = paramList();
		// §6.2 users list/view: self ∨ admin ∨ coordinator ∨ own institution.
		const scope = [
			`id = NULLIF(${p(user.id)}, '')`,
			`${p(user.role)} IN ('admin', 'coordinator')`,
			`institution_id = NULLIF(${p(user.institutionId)}, '')`,
		].join(" OR ");
		const row = selectOne<{ count: number }>(
			`SELECT count(*) AS count FROM users WHERE ${scope}`,
			params,
		);
		return row?.count ?? 0;
	},

	async findPasswordHashById(id: string): Promise<string | null> {
		if (!isUuid(id)) return null;
		const row = selectOne<{ password_hash: string }>(
			"SELECT password_hash FROM users WHERE id = ? LIMIT 1",
			[id],
		);
		return row?.password_hash ?? null;
	},

	async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
		if (!isUuid(id)) return;
		prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
	},

	async updatePasswordHashIfUnchanged(
		id: string,
		expectedHash: string,
		passwordHash: string,
	): Promise<boolean> {
		if (!isUuid(id)) return false;
		const rows = selectAll<{ id: string }>(
			"UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ? RETURNING id",
			[passwordHash, id, expectedHash],
		);
		return rows.length > 0;
	},

	async create(user: ActingUser, input: UserCreateInput): Promise<UserRecord | null> {
		const { params, p } = paramList();
		const id = p(randomUUID());
		const email = p(input.email.toLowerCase());
		const name = p(input.name);
		const role = p(input.role);
		const institutionId = p(input.institutionId ?? "");
		const passwordHash = p(input.passwordHash);

		// §6.2 users create: admin, or (institution ∧ role = 'lead' ∧ own inst).
		const scope = [
			`${p(user.role)} = 'admin'`,
			`(${p(user.role)} = 'institution' AND ${p(input.role)} = 'lead' AND NULLIF(${p(input.institutionId ?? "")}, '') = NULLIF(${p(user.institutionId)}, ''))`,
		].join(" OR ");

		const row = selectOne<UserDbRow>(
			`INSERT INTO users (id, email, name, role, institution_id, password_hash)
			 SELECT ${id}, ${email}, ${name}, ${role}, NULLIF(${institutionId}, ''), ${passwordHash}
			 WHERE ${scope}
			 RETURNING ${USER_COLUMNS}`,
			params,
		);
		return row ? toUserRecord(row) : null;
	},

	async delete(user: ActingUser, id: string): Promise<boolean> {
		if (!isUuid(id)) return false;
		const { params, p } = paramList();
		const idParam = p(id);
		const actorRole = p(user.role);
		try {
			const rows = selectAll<{ id: string }>(
				`DELETE FROM users WHERE id = ${idParam} AND ${actorRole} = 'admin' RETURNING id`,
				params,
			);
			return rows.length > 0;
		} catch (err) {
			// A user still leading a team cannot be deleted — report "not
			// deleted" instead of surfacing the FK error as a 500.
			if (isForeignKeyViolation(err)) return false;
			throw err;
		}
	},
};

// ---------------------------------------------------------------------------
// teams repository
// ---------------------------------------------------------------------------

/** A `teams` row joined with its institution and leader (the `expand` shape). */
interface TeamRow {
	id: string;
	name: string;
	institution_id: string;
	leader_user_id: string;
	team_code: string | null;
	status: TeamStatus;
	status_changed_at: string | null;
	questionnaire_completed: number;
	idea_title: string | null;
	idea_desc: string | null;
	idea_tech_stack: string | null;
	submission_file: string | null;
	created_at: string;
	updated_at: string;
	inst_id: string | null;
	inst_name: string | null;
	inst_district: string | null;
	inst_code: string | null;
	lead_id: string | null;
	lead_name: string | null;
	lead_email: string | null;
}

const TEAM_SELECT = `
	t.id, t.name, t.institution_id, t.leader_user_id, t.team_code, t.status,
	t.status_changed_at, t.questionnaire_completed, t.idea_title, t.idea_desc,
	t.idea_tech_stack, t.submission_file, t.created_at, t.updated_at,
	i.id AS inst_id, i.name AS inst_name, i.district AS inst_district, i.code AS inst_code,
	u.id AS lead_id, u.name AS lead_name, u.email AS lead_email`;

const TEAM_FROM = `
	FROM teams t
	LEFT JOIN institutions i ON i.id = t.institution_id
	LEFT JOIN users u ON u.id = t.leader_user_id`;

const TEAM_SORT_COLUMNS: Record<string, string> = {
	created: "t.created_at",
	updated: "t.updated_at",
	name: "t.name",
	status: "t.status",
	teamCode: "t.team_code",
};

/**
 * `teams` row → `TeamView`.
 *
 * `expand.institutionId` / `expand.leaderUserId` are always populated from the
 * LEFT JOINs, so components keep reading `team.expand.institutionId.name`.
 * Unset text/date columns come back as `""`.
 */
function toTeamView(row: TeamRow): TeamView {
	const team: TeamView = {
		id: row.id,
		name: row.name,
		institutionId: row.institution_id,
		leaderUserId: row.leader_user_id,
		teamCode: row.team_code ?? "",
		status: row.status,
		statusChangedAt: toIso(row.status_changed_at),
		questionnaireCompleted: row.questionnaire_completed === 1,
		ideaTitle: row.idea_title ?? "",
		ideaDesc: row.idea_desc ?? "",
		ideaTechStack: row.idea_tech_stack ?? "",
		submissionFile: row.submission_file ?? "",
		created: toIso(row.created_at),
		updated: toIso(row.updated_at),
	};

	if (row.inst_id) {
		team.expand = {
			...team.expand,
			institutionId: {
				id: row.inst_id,
				name: row.inst_name ?? "",
				district: row.inst_district ?? "",
				code: row.inst_code ?? "",
			},
		};
	}
	if (row.lead_id) {
		team.expand = {
			...team.expand,
			leaderUserId: {
				id: row.lead_id,
				name: row.lead_name ?? "",
				email: row.lead_email ?? "",
			},
		};
	}

	return team;
}

export interface TeamListOptions {
	page?: number;
	perPage?: number;
	/** Sort string: `"-created"`, `"name"`, … */
	sort?: string;
	institutionId?: string | string[];
	status?: TeamStatus | TeamStatus[];
	/** Contains match on `name` and `team_code`. */
	q?: string;
}

export interface TeamCreateInput {
	name: string;
	institutionId: string;
	leaderUserId: string;
	status: TeamStatus;
	teamCode?: string;
	statusChangedAt?: string;
	questionnaireCompleted?: boolean;
	ideaTitle?: string;
	ideaDesc?: string;
	ideaTechStack?: string;
	submissionFile?: string;
}

/**
 * Fields a caller may change. Ownership (`institutionId`, `leaderUserId`) is
 * deliberately absent: the old backend's update rule forbade both roles from
 * touching them, and no flow needs to.
 */
export interface TeamUpdateInput {
	name?: string;
	teamCode?: string;
	status?: TeamStatus;
	/** Written by the app on every transition (§6.1); defaults to now. */
	statusChangedAt?: string;
	questionnaireCompleted?: boolean;
	ideaTitle?: string;
	ideaDesc?: string;
	ideaTechStack?: string;
	submissionFile?: string;
}

/** Per-status and per-institution totals for the dashboard cards. */
export interface TeamAggregate {
	byStatus: Partial<Record<TeamStatus, number>>;
	byInstitution: Record<string, { total: number; registered: number; shortlisted: number }>;
	total: number;
	institutions: number;
}

export interface TeamsRepository {
	/** Scoped list with pagination + `totalItems`, `expand` populated. */
	list(user: ActingUser, options?: TeamListOptions): Promise<ListResult<TeamView>>;
	/**
	 * One `GROUP BY status, institution_id` for the dashboard counters.
	 *
	 * Replaces the per-status count queries and the "fetch 500/1000 rows and
	 * bucket them in JS" scans.
	 */
	aggregate(user: ActingUser, options?: TeamListOptions): Promise<TeamAggregate>;
	/** Scoped single read — null on miss *and* on out-of-scope (§6.2). */
	getOne(user: ActingUser, id: string): Promise<TeamView | null>;
	/** The team led by `leaderUserId`, scoped to that lead. */
	findByLeader(user: ActingUser, leaderUserId: string): Promise<TeamView | null>;
	/**
	 * Count every team in an institution — the SEC-9 capacity check.
	 *
	 * The count is institution-wide by design (a lead must not register past
	 * the campus limit), so it does not use `teamScope`; the predicate below
	 * only lets the actor count their own institution.
	 */
	countByInstitution(user: ActingUser, institutionId: string): Promise<number>;
	/** Create a team. Null when the acting user may not (§6.2 create rule). */
	create(user: ActingUser, input: TeamCreateInput): Promise<TeamView | null>;
	/**
	 * Update with the optimistic lock: `WHERE id = ? AND status = ?expected`.
	 * Null means "no row matched" — the caller turns that into the 409.
	 */
	update(
		user: ActingUser,
		id: string,
		patch: TeamUpdateInput,
		options?: { expectedStatus?: TeamStatus },
	): Promise<TeamView | null>;
	/** Delete a team (admin only). */
	delete(user: ActingUser, id: string): Promise<boolean>;
}

/**
 * Build the `teams` WHERE clause shared by `list` and `aggregate`.
 * Returns null when a filter value cannot match anything.
 */
function teamWhere(user: ActingUser, options: TeamListOptions, p: ParamList["p"]): string[] | null {
	const where: string[] = [teamScope(user, p)];

	const requested = toArray(options.institutionId);
	const institutionIds = requested.filter(isUuid);
	// Every id was malformed — read as "no match" rather than letting a
	// malformed value reach the query.
	if (requested.length > 0 && institutionIds.length === 0) return null;
	if (institutionIds.length > 0) {
		where.push(`t.institution_id IN (${inClause(institutionIds, p)})`);
	}

	const statuses = toArray(options.status);
	if (statuses.length > 0) {
		where.push(`t.status IN (${inClause(statuses, p)})`);
	}

	if (options.q) {
		// SQLite's LIKE is case-insensitive for ASCII, which is what ILIKE gave
		// us. Search covers the team, its lead and its institution — the joins
		// are already in TEAM_FROM, so this costs nothing extra.
		const like = (column: string) =>
			`${column} LIKE ${p(containsPattern(options.q ?? ""))} ESCAPE '\\'`;
		where.push(
			`(${like("t.name")} OR ${like("t.team_code")} OR ${like("u.name")} OR ${like("u.email")} OR ${like("i.name")})`,
		);
	}

	return where;
}

export const teams: TeamsRepository = {
	async list(user: ActingUser, options: TeamListOptions = {}): Promise<ListResult<TeamView>> {
		const { params, p } = paramList();
		const where = teamWhere(user, options, p);
		if (!where) return emptyList();

		const whereSql = where.join(" AND ");
		const { page, perPage, offset } = normalizePaging(options.page, options.perPage);

		const countRow = selectOne<{ count: number }>(
			`SELECT count(*) AS count ${TEAM_FROM} WHERE ${whereSql}`,
			params,
		);
		const totalItems = countRow?.count ?? 0;

		const rows = selectAll<TeamRow>(
			`SELECT ${TEAM_SELECT} ${TEAM_FROM} WHERE ${whereSql}
			 ORDER BY ${orderByClause(options.sort, TEAM_SORT_COLUMNS, "-created")}
			 LIMIT ? OFFSET ?`,
			[...params, perPage, offset],
		);

		return {
			page,
			perPage,
			totalItems,
			totalPages: Math.ceil(totalItems / perPage),
			items: rows.map(toTeamView),
		};
	},

	async aggregate(user: ActingUser, options: TeamListOptions = {}): Promise<TeamAggregate> {
		const { params, p } = paramList();
		const where = teamWhere(user, options, p);
		const empty: TeamAggregate = { byStatus: {}, byInstitution: {}, total: 0, institutions: 0 };
		if (!where) return empty;

		const rows = selectAll<{ status: TeamStatus; institution_id: string; count: number }>(
			`SELECT t.status, t.institution_id, count(*) AS count ${TEAM_FROM}
			 WHERE ${where.join(" AND ")}
			 GROUP BY t.status, t.institution_id`,
			params,
		);

		const aggregate: TeamAggregate = { byStatus: {}, byInstitution: {}, total: 0, institutions: 0 };
		for (const row of rows) {
			aggregate.byStatus[row.status] = (aggregate.byStatus[row.status] ?? 0) + row.count;
			aggregate.total += row.count;
			let bucket = aggregate.byInstitution[row.institution_id];
			if (!bucket) {
				bucket = { total: 0, registered: 0, shortlisted: 0 };
				aggregate.byInstitution[row.institution_id] = bucket;
			}
			bucket.total += row.count;
			if (row.status === "registered") bucket.registered += row.count;
			if (row.status === "shortlisted") bucket.shortlisted += row.count;
		}
		aggregate.institutions = Object.keys(aggregate.byInstitution).length;
		return aggregate;
	},

	async getOne(user: ActingUser, id: string): Promise<TeamView | null> {
		if (!isUuid(id)) return null;
		const { params, p } = paramList();
		const idParam = p(id);
		const scope = teamScope(user, p);
		const row = selectOne<TeamRow>(
			`SELECT ${TEAM_SELECT} ${TEAM_FROM} WHERE t.id = ${idParam} AND ${scope} LIMIT 1`,
			params,
		);
		return row ? toTeamView(row) : null;
	},

	async findByLeader(user: ActingUser, leaderUserId: string): Promise<TeamView | null> {
		if (!isUuid(leaderUserId)) return null;
		const { params, p } = paramList();
		const leaderParam = p(leaderUserId);
		const scope = teamScope(user, p);
		const row = selectOne<TeamRow>(
			`SELECT ${TEAM_SELECT} ${TEAM_FROM}
			 WHERE t.leader_user_id = ${leaderParam} AND ${scope}
			 ORDER BY t.created_at DESC LIMIT 1`,
			params,
		);
		return row ? toTeamView(row) : null;
	},

	async countByInstitution(user: ActingUser, institutionId: string): Promise<number> {
		if (!isUuid(institutionId)) return 0;
		const { params, p } = paramList();
		const institutionParam = p(institutionId);
		const scope = [
			`${p(user.role)} IN ('admin', 'coordinator')`,
			`NULLIF(${p(user.institutionId)}, '') = ${p(institutionId)}`,
		].join(" OR ");
		const row = selectOne<{ count: number }>(
			`SELECT count(*) AS count FROM teams t
			 WHERE t.institution_id = ${institutionParam} AND (${scope})`,
			params,
		);
		return row?.count ?? 0;
	},

	async create(user: ActingUser, input: TeamCreateInput): Promise<TeamView | null> {
		if (!isUuid(input.institutionId) || !isUuid(input.leaderUserId)) return null;

		const { params, p } = paramList();
		const id = p(randomUUID());
		const name = p(input.name);
		const institutionId = p(input.institutionId);
		const leaderUserId = p(input.leaderUserId);
		const teamCode = p(input.teamCode ?? "");
		const status = p(input.status);
		const statusChangedAt = p(input.statusChangedAt ?? new Date().toISOString());
		const questionnaireCompleted = p(input.questionnaireCompleted ?? false);
		const ideaTitle = p(input.ideaTitle ?? "");
		const ideaDesc = p(input.ideaDesc ?? "");
		const ideaTechStack = p(input.ideaTechStack ?? "");
		const submissionFile = p(input.submissionFile ?? "");

		// §6.2 teams create: admin, or (institution ∧ own inst ∧ status invited),
		// or (lead ∧ own inst ∧ leader = self ∧ status registered).
		const scope = [
			`${p(user.role)} = 'admin'`,
			`(${p(user.role)} = 'institution' AND NULLIF(${p(user.institutionId)}, '') = ${p(input.institutionId)} AND ${p(input.status)} = 'invited')`,
			`(${p(user.role)} = 'lead' AND NULLIF(${p(user.institutionId)}, '') = ${p(input.institutionId)} AND ${p(input.leaderUserId)} = NULLIF(${p(user.id)}, '') AND ${p(input.status)} = 'registered')`,
		].join(" OR ");

		const created = selectOne<{ id: string }>(
			`INSERT INTO teams (
				id, name, institution_id, leader_user_id, team_code, status, status_changed_at,
				questionnaire_completed, idea_title, idea_desc, idea_tech_stack, submission_file
			 )
			 SELECT ${id}, ${name}, ${institutionId}, ${leaderUserId}, NULLIF(${teamCode}, ''),
				${status}, ${statusChangedAt}, ${questionnaireCompleted},
				NULLIF(${ideaTitle}, ''), NULLIF(${ideaDesc}, ''), NULLIF(${ideaTechStack}, ''),
				NULLIF(${submissionFile}, '')
			 WHERE ${scope}
			 RETURNING id`,
			params,
		);
		if (!created) return null;
		return teams.getOne(user, created.id);
	},

	async update(
		user: ActingUser,
		id: string,
		patch: TeamUpdateInput,
		options: { expectedStatus?: TeamStatus } = {},
	): Promise<TeamView | null> {
		if (!isUuid(id)) return null;

		const { params, p } = paramList();
		const sets: string[] = [];
		if (patch.name !== undefined) sets.push(`name = ${p(patch.name)}`);
		if (patch.teamCode !== undefined) sets.push(`team_code = NULLIF(${p(patch.teamCode)}, '')`);
		if (patch.questionnaireCompleted !== undefined) {
			sets.push(`questionnaire_completed = ${p(patch.questionnaireCompleted)}`);
		}
		if (patch.ideaTitle !== undefined) sets.push(`idea_title = NULLIF(${p(patch.ideaTitle)}, '')`);
		if (patch.ideaDesc !== undefined) sets.push(`idea_desc = NULLIF(${p(patch.ideaDesc)}, '')`);
		if (patch.ideaTechStack !== undefined) {
			sets.push(`idea_tech_stack = NULLIF(${p(patch.ideaTechStack)}, '')`);
		}
		if (patch.submissionFile !== undefined) {
			sets.push(`submission_file = NULLIF(${p(patch.submissionFile)}, '')`);
		}
		if (patch.status !== undefined) {
			sets.push(`status = ${p(patch.status)}`);
			// §6.1: status_changed_at is written by the app, never by a trigger.
			sets.push(`status_changed_at = ${p(patch.statusChangedAt ?? new Date().toISOString())}`);
		}

		if (sets.length === 0) return teams.getOne(user, id);

		const idParam = p(id);
		// The UPDATE target is the table itself, so the scope predicate is
		// qualified with the table name rather than the `t` join alias.
		const where = [`id = ${idParam}`, teamScope(user, p, "teams")];
		if (options.expectedStatus) {
			where.push(`status = ${p(options.expectedStatus)}`);
		}

		const updated = selectOne<{ id: string }>(
			`UPDATE teams SET ${sets.join(", ")} WHERE ${where.join(" AND ")} RETURNING id`,
			params,
		);
		if (!updated) return null;
		return teams.getOne(user, id);
	},

	async delete(user: ActingUser, id: string): Promise<boolean> {
		if (!isUuid(id)) return false;
		const { params, p } = paramList();
		const idParam = p(id);
		const actorRole = p(user.role);
		const rows = selectAll<{ id: string }>(
			`DELETE FROM teams WHERE id = ${idParam} AND ${actorRole} = 'admin' RETURNING id`,
			params,
		);
		return rows.length > 0;
	},
};

// ---------------------------------------------------------------------------
// institutions repository
// ---------------------------------------------------------------------------

/** `InstitutionRecord` plus the `expand.campusLeadId` join. */
export interface InstitutionView extends InstitutionRecord {
	expand?: {
		campusLeadId?: { id: string; name: string; email: string };
	};
}

interface InstitutionRow {
	id: string;
	name: string;
	district: string | null;
	code: string;
	campus_lead_id: string | null;
	max_teams: number | null;
	status: string | null;
	created_at: string;
	updated_at: string;
	lead_id: string | null;
	lead_name: string | null;
	lead_email: string | null;
}

const INSTITUTION_SELECT = `
	i.id, i.name, i.district, i.code, i.campus_lead_id, i.max_teams, i.status,
	i.created_at, i.updated_at,
	u.id AS lead_id, u.name AS lead_name, u.email AS lead_email`;

const INSTITUTION_FROM = `
	FROM institutions i
	LEFT JOIN users u ON u.id = i.campus_lead_id`;

const INSTITUTION_SORT_COLUMNS: Record<string, string> = {
	created: "i.created_at",
	updated: "i.updated_at",
	name: "i.name",
	code: "i.code",
	district: "i.district",
};

function toInstitutionView(row: InstitutionRow): InstitutionView {
	const institution: InstitutionView = {
		id: row.id,
		name: row.name,
		district: row.district ?? "",
		code: row.code,
		campusLeadId: row.campus_lead_id ?? "",
		maxTeams: row.max_teams ?? 0,
		status: row.status ?? "",
		created: toIso(row.created_at),
		updated: toIso(row.updated_at),
	};
	if (row.lead_id) {
		institution.expand = {
			campusLeadId: {
				id: row.lead_id,
				name: row.lead_name ?? "",
				email: row.lead_email ?? "",
			},
		};
	}
	return institution;
}

export interface InstitutionListOptions {
	page?: number;
	perPage?: number;
	sort?: string;
	/** Contains match on `name` and `code`. */
	q?: string;
}

export interface InstitutionCreateInput {
	name: string;
	district?: string;
	code: string;
	campusLeadId?: string;
	maxTeams?: number;
	status?: string;
}

export interface InstitutionUpdateInput {
	name?: string;
	district?: string;
	code?: string;
	campusLeadId?: string;
	maxTeams?: number;
	status?: string;
}

export interface InstitutionsRepository {
	list(user: ActingUser, options?: InstitutionListOptions): Promise<ListResult<InstitutionView>>;
	getOne(user: ActingUser, id: string): Promise<InstitutionView | null>;
	/**
	 * The institution this user is the campus lead of.
	 *
	 * The `campus_lead_id` filter is itself the scope — it can only ever return
	 * a row the user is attached to — and the §6.2 view predicate is applied on
	 * top of it.
	 */
	findByCampusLeadId(user: ActingUser, campusLeadId: string): Promise<InstitutionView | null>;
	/**
	 * Exact `code` lookup — the campus-leads duplicate check.
	 *
	 * `code` is unique, so this is the `getFirstListItem("code = …")` the
	 * admin route used before the port.
	 */
	findByCode(user: ActingUser, code: string): Promise<InstitutionView | null>;
	/**
	 * Read the institution's capacity inside the caller's transaction.
	 *
	 * Postgres needed `SELECT … FOR UPDATE` here to serialise the SEC-9 capacity
	 * check against concurrent registrations. SQLite has no row locks, and none
	 * are needed: `withTransaction` opens with `BEGIN IMMEDIATE`, so the whole
	 * transaction already holds the database write lock and no other writer can
	 * observe or change the count in between.
	 */
	lockForUpdate(user: ActingUser, id: string): Promise<{ maxTeams: number } | null>;
	create(user: ActingUser, input: InstitutionCreateInput): Promise<InstitutionView | null>;
	update(
		user: ActingUser,
		id: string,
		patch: InstitutionUpdateInput,
	): Promise<InstitutionView | null>;
	delete(user: ActingUser, id: string): Promise<boolean>;
}

export const institutions: InstitutionsRepository = {
	async list(
		user: ActingUser,
		options: InstitutionListOptions = {},
	): Promise<ListResult<InstitutionView>> {
		const { params, p } = paramList();
		const where: string[] = [institutionScope(user, p)];

		if (options.q) {
			const like = (column: string) =>
				`${column} LIKE ${p(containsPattern(options.q ?? ""))} ESCAPE '\\'`;
			where.push(`(${like("i.name")} OR ${like("i.code")})`);
		}

		const whereSql = where.join(" AND ");
		const { page, perPage, offset } = normalizePaging(options.page, options.perPage);

		const countRow = selectOne<{ count: number }>(
			`SELECT count(*) AS count ${INSTITUTION_FROM} WHERE ${whereSql}`,
			params,
		);
		const totalItems = countRow?.count ?? 0;

		const rows = selectAll<InstitutionRow>(
			`SELECT ${INSTITUTION_SELECT} ${INSTITUTION_FROM} WHERE ${whereSql}
			 ORDER BY ${orderByClause(options.sort, INSTITUTION_SORT_COLUMNS, "name")}
			 LIMIT ? OFFSET ?`,
			[...params, perPage, offset],
		);

		return {
			page,
			perPage,
			totalItems,
			totalPages: Math.ceil(totalItems / perPage),
			items: rows.map(toInstitutionView),
		};
	},

	async getOne(user: ActingUser, id: string): Promise<InstitutionView | null> {
		if (!isUuid(id)) return null;
		const { params, p } = paramList();
		const idParam = p(id);
		const scope = institutionScope(user, p);
		const row = selectOne<InstitutionRow>(
			`SELECT ${INSTITUTION_SELECT} ${INSTITUTION_FROM} WHERE i.id = ${idParam} AND ${scope} LIMIT 1`,
			params,
		);
		return row ? toInstitutionView(row) : null;
	},

	async findByCampusLeadId(
		user: ActingUser,
		campusLeadId: string,
	): Promise<InstitutionView | null> {
		if (!isUuid(campusLeadId)) return null;
		const { params, p } = paramList();
		const leadParam = p(campusLeadId);
		const scope = [
			`${p(user.role)} IN ('admin', 'coordinator')`,
			`i.id = NULLIF(${p(user.institutionId)}, '')`,
			`i.campus_lead_id = NULLIF(${p(user.id)}, '')`,
		].join(" OR ");
		const row = selectOne<InstitutionRow>(
			`SELECT ${INSTITUTION_SELECT} ${INSTITUTION_FROM}
			 WHERE i.campus_lead_id = ${leadParam} AND (${scope})
			 LIMIT 1`,
			params,
		);
		return row ? toInstitutionView(row) : null;
	},

	async findByCode(user: ActingUser, code: string): Promise<InstitutionView | null> {
		const { params, p } = paramList();
		const codeParam = p(code);
		const scope = institutionScope(user, p);
		const row = selectOne<InstitutionRow>(
			`SELECT ${INSTITUTION_SELECT} ${INSTITUTION_FROM}
			 WHERE i.code = ${codeParam} AND ${scope}
			 LIMIT 1`,
			params,
		);
		return row ? toInstitutionView(row) : null;
	},

	async lockForUpdate(user: ActingUser, id: string): Promise<{ maxTeams: number } | null> {
		if (!isUuid(id)) return null;
		const { params, p } = paramList();
		const idParam = p(id);
		const scope = institutionScope(user, p);
		const row = selectOne<{ max_teams: number | null }>(
			`SELECT i.max_teams FROM institutions i WHERE i.id = ${idParam} AND ${scope}`,
			params,
		);
		return row ? { maxTeams: row.max_teams ?? 0 } : null;
	},

	async create(user: ActingUser, input: InstitutionCreateInput): Promise<InstitutionView | null> {
		const { params, p } = paramList();
		const id = p(randomUUID());
		const name = p(input.name);
		const district = p(input.district ?? "");
		const code = p(input.code);
		const campusLeadId = p(input.campusLeadId ?? "");
		const maxTeams = p(input.maxTeams ?? 0);
		const status = p(input.status ?? "active");
		const actorRole = p(user.role);

		const created = selectOne<{ id: string }>(
			`INSERT INTO institutions (id, name, district, code, campus_lead_id, max_teams, status)
			 SELECT ${id}, ${name}, NULLIF(${district}, ''), ${code}, NULLIF(${campusLeadId}, ''),
				${maxTeams}, ${status}
			 WHERE ${actorRole} = 'admin'
			 RETURNING id`,
			params,
		);
		if (!created) return null;
		return institutions.getOne(user, created.id);
	},

	async update(
		user: ActingUser,
		id: string,
		patch: InstitutionUpdateInput,
	): Promise<InstitutionView | null> {
		if (!isUuid(id)) return null;

		const { params, p } = paramList();
		const sets: string[] = [];
		if (patch.name !== undefined) sets.push(`name = ${p(patch.name)}`);
		if (patch.district !== undefined) sets.push(`district = NULLIF(${p(patch.district)}, '')`);
		if (patch.code !== undefined) sets.push(`code = ${p(patch.code)}`);
		if (patch.campusLeadId !== undefined) {
			sets.push(`campus_lead_id = NULLIF(${p(patch.campusLeadId)}, '')`);
		}
		if (patch.maxTeams !== undefined) sets.push(`max_teams = ${p(patch.maxTeams)}`);
		if (patch.status !== undefined) sets.push(`status = ${p(patch.status)}`);

		if (sets.length === 0) return institutions.getOne(user, id);

		const idParam = p(id);
		const actorRole = p(user.role);
		const updated = selectOne<{ id: string }>(
			`UPDATE institutions SET ${sets.join(", ")}
			 WHERE id = ${idParam} AND ${actorRole} = 'admin'
			 RETURNING id`,
			params,
		);
		if (!updated) return null;
		return institutions.getOne(user, id);
	},

	async delete(user: ActingUser, id: string): Promise<boolean> {
		if (!isUuid(id)) return false;
		const { params, p } = paramList();
		const idParam = p(id);
		const actorRole = p(user.role);
		try {
			const rows = selectAll<{ id: string }>(
				`DELETE FROM institutions WHERE id = ${idParam} AND ${actorRole} = 'admin' RETURNING id`,
				params,
			);
			return rows.length > 0;
		} catch (err) {
			// An institution that still owns teams cannot be deleted — report
			// "not deleted" instead of surfacing the FK error as a 500.
			if (isForeignKeyViolation(err)) return false;
			throw err;
		}
	},
};

// ---------------------------------------------------------------------------
// members repository
// ---------------------------------------------------------------------------

interface MemberRow {
	id: string;
	team_id: string;
	full_name: string;
	email: string;
	phone: string | null;
	gender: string | null;
	role: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * Bare column list, so the same names work in a `SELECT … FROM members m`
 * projection and in an `UPDATE members … RETURNING` clause (which has no alias).
 */
const MEMBER_COLUMNS = [
	"id",
	"team_id",
	"full_name",
	"email",
	"phone",
	"gender",
	"role",
	"created_at",
	"updated_at",
];

const MEMBER_SELECT = MEMBER_COLUMNS.map((column) => `m.${column}`).join(", ");
const MEMBER_RETURNING = MEMBER_COLUMNS.join(", ");

const MEMBER_FROM = `
	FROM members m
	JOIN teams t ON t.id = m.team_id`;

const MEMBER_SORT_COLUMNS: Record<string, string> = {
	created: "m.created_at",
	updated: "m.updated_at",
	fullName: "m.full_name",
	email: "m.email",
};

function toMemberRecord(row: MemberRow): MemberRecord {
	return {
		id: row.id,
		teamId: row.team_id,
		fullName: row.full_name,
		email: row.email,
		phone: row.phone ?? "",
		gender: row.gender ?? "",
		role: row.role ?? "",
		created: toIso(row.created_at),
		updated: toIso(row.updated_at),
	};
}

/** §6.2 members create: admin ∨ (institution ∧ own inst) ∨ team leader. */
export function memberCreateScope(user: ActingUser, p: ParamList["p"], teamAlias = "t"): string {
	if (user.role === "admin") return "TRUE";
	if (user.role === "institution") {
		return user.institutionId ? `${teamAlias}.institution_id = ${p(user.institutionId)}` : "FALSE";
	}
	if (user.role === "lead") return `${teamAlias}.leader_user_id = ${p(user.id)}`;
	return "FALSE";
}

/** §6.2 members update/delete: admin ∨ team leader. */
export function memberWriteScope(user: ActingUser, p: ParamList["p"], teamAlias = "t"): string {
	if (user.role === "admin") return "TRUE";
	if (user.role === "lead") return `${teamAlias}.leader_user_id = ${p(user.id)}`;
	return "FALSE";
}

export interface MemberListOptions {
	teamId?: string;
	teamIds?: string[];
	/** Every member of a team in this institution (relation traversal). */
	institutionId?: string;
	page?: number;
	perPage?: number;
	sort?: string;
}

export interface MemberCreateInput {
	teamId: string;
	fullName: string;
	email: string;
	phone?: string;
	gender?: string;
	role?: string;
}

export interface MemberUpdateInput {
	fullName?: string;
	email?: string;
	phone?: string;
	gender?: string;
	role?: string;
}

export interface MembersRepository {
	/** Scoped list — joins `teams` and applies the §6.2 predicate there. */
	list(user: ActingUser, options?: MemberListOptions): Promise<ListResult<MemberRecord>>;
	/** Member counts per team, for the dashboard cards. */
	countByTeams(user: ActingUser, teamIds: string[]): Promise<Record<string, number>>;
	create(user: ActingUser, input: MemberCreateInput): Promise<MemberRecord | null>;
	/** Insert a whole roster in one statement. Returns the number of rows written. */
	createMany(user: ActingUser, teamId: string, rows: MemberCreateInput[]): Promise<number>;
	/** Drop every member of a team in one statement. Returns the number removed. */
	deleteByTeam(user: ActingUser, teamId: string): Promise<number>;
	update(user: ActingUser, id: string, patch: MemberUpdateInput): Promise<MemberRecord | null>;
	delete(user: ActingUser, id: string): Promise<boolean>;
}

export const members: MembersRepository = {
	async list(user: ActingUser, options: MemberListOptions = {}): Promise<ListResult<MemberRecord>> {
		const { params, p } = paramList();
		const where: string[] = [teamScope(user, p)];

		// Ids arrive from query params, so a malformed one must read as "no
		// match" rather than reaching the query.
		if (options.teamId) {
			if (!isUuid(options.teamId)) return emptyList();
			where.push(`m.team_id = ${p(options.teamId)}`);
		}
		const teamIds = (options.teamIds ?? []).filter(isUuid);
		if (teamIds.length > 0) where.push(`m.team_id IN (${inClause(teamIds, p)})`);
		if (options.institutionId) {
			if (!isUuid(options.institutionId)) return emptyList();
			where.push(`t.institution_id = ${p(options.institutionId)}`);
		}

		const whereSql = where.join(" AND ");
		const { page, perPage, offset } = normalizePaging(options.page, options.perPage);

		const countRow = selectOne<{ count: number }>(
			`SELECT count(*) AS count ${MEMBER_FROM} WHERE ${whereSql}`,
			params,
		);
		const totalItems = countRow?.count ?? 0;

		const rows = selectAll<MemberRow>(
			`SELECT ${MEMBER_SELECT} ${MEMBER_FROM} WHERE ${whereSql}
			 ORDER BY ${orderByClause(options.sort, MEMBER_SORT_COLUMNS, "-created")}
			 LIMIT ? OFFSET ?`,
			[...params, perPage, offset],
		);

		return {
			page,
			perPage,
			totalItems,
			totalPages: Math.ceil(totalItems / perPage),
			items: rows.map(toMemberRecord),
		};
	},

	async countByTeams(user: ActingUser, teamIds: string[]): Promise<Record<string, number>> {
		const ids = teamIds.filter(isUuid);
		if (ids.length === 0) return {};
		const { params, p } = paramList();
		const idsParam = inClause(ids, p);
		const scope = teamScope(user, p);
		const rows = selectAll<{ team_id: string; count: number }>(
			`SELECT m.team_id, count(*) AS count ${MEMBER_FROM}
			 WHERE m.team_id IN (${idsParam}) AND (${scope})
			 GROUP BY m.team_id`,
			params,
		);
		const counts: Record<string, number> = {};
		for (const row of rows) counts[row.team_id] = row.count;
		return counts;
	},

	async create(user: ActingUser, input: MemberCreateInput): Promise<MemberRecord | null> {
		if (!isUuid(input.teamId)) return null;
		const { params, p } = paramList();
		// Bind order must match the order the placeholders appear in the SQL:
		// the SELECT list first, then the WHERE clause that follows the FROM.
		const id = p(randomUUID());
		const fullName = p(input.fullName);
		const email = p(input.email.toLowerCase());
		const phone = p(input.phone ?? "");
		const gender = p(input.gender ?? "");
		const role = p(input.role ?? "");
		const teamId = p(input.teamId);
		const scope = memberCreateScope(user, p);

		const row = selectOne<MemberRow>(
			`INSERT INTO members (id, team_id, full_name, email, phone, gender, role)
			 SELECT ${id}, t.id, ${fullName}, ${email}, NULLIF(${phone}, ''), NULLIF(${gender}, ''),
				NULLIF(${role}, '')
			 FROM teams t
			 WHERE t.id = ${teamId} AND (${scope})
			 RETURNING ${MEMBER_RETURNING}`,
			params,
		);
		return row ? toMemberRecord(row) : null;
	},

	async createMany(user: ActingUser, teamId: string, rows: MemberCreateInput[]): Promise<number> {
		if (!isUuid(teamId) || rows.length === 0) return 0;
		const { params, p } = paramList();
		// One bound row per member; the CTE replaces Postgres's parallel
		// `unnest(...)` arrays, which SQLite has no equivalent for.
		const values = rows
			.map(
				(row) =>
					`(${p(randomUUID())}, ${p(row.fullName)}, ${p(row.email.toLowerCase())}, ${p(row.phone ?? "")}, ${p(row.gender ?? "")}, ${p(row.role ?? "")})`,
			)
			.join(", ");
		const teamIdParam = p(teamId);
		const scope = memberCreateScope(user, p);

		const written = selectAll<{ id: string }>(
			`WITH v (id, full_name, email, phone, gender, role) AS (VALUES ${values})
			 INSERT INTO members (id, team_id, full_name, email, phone, gender, role)
			 SELECT v.id, t.id, v.full_name, v.email, NULLIF(v.phone, ''), NULLIF(v.gender, ''),
				NULLIF(v.role, '')
			 FROM v, teams t
			 WHERE t.id = ${teamIdParam} AND (${scope})
			 RETURNING id`,
			params,
		);
		return written.length;
	},

	async deleteByTeam(user: ActingUser, teamId: string): Promise<number> {
		if (!isUuid(teamId)) return 0;
		const { params, p } = paramList();
		const teamIdParam = p(teamId);
		const scope = memberWriteScope(user, p);
		// SQLite has no `DELETE … USING`; the correlated EXISTS is the same
		// predicate against the parent team.
		const rows = selectAll<{ id: string }>(
			`DELETE FROM members
			 WHERE team_id = ${teamIdParam}
				AND EXISTS (SELECT 1 FROM teams t WHERE t.id = members.team_id AND (${scope}))
			 RETURNING id`,
			params,
		);
		return rows.length;
	},

	async update(
		user: ActingUser,
		id: string,
		patch: MemberUpdateInput,
	): Promise<MemberRecord | null> {
		if (!isUuid(id)) return null;

		const { params, p } = paramList();
		const sets: string[] = [];
		if (patch.fullName !== undefined) sets.push(`full_name = ${p(patch.fullName)}`);
		if (patch.email !== undefined) sets.push(`email = ${p(patch.email.toLowerCase())}`);
		if (patch.phone !== undefined) sets.push(`phone = NULLIF(${p(patch.phone)}, '')`);
		if (patch.gender !== undefined) sets.push(`gender = NULLIF(${p(patch.gender)}, '')`);
		if (patch.role !== undefined) sets.push(`role = NULLIF(${p(patch.role)}, '')`);

		if (sets.length === 0) {
			const idParam = p(id);
			const scope = teamScope(user, p);
			const current = selectOne<MemberRow>(
				`SELECT ${MEMBER_SELECT} ${MEMBER_FROM} WHERE m.id = ${idParam} AND (${scope}) LIMIT 1`,
				params,
			);
			return current ? toMemberRecord(current) : null;
		}

		const idParam = p(id);
		const scope = memberWriteScope(user, p);
		const row = selectOne<MemberRow>(
			`UPDATE members SET ${sets.join(", ")}
			 WHERE id = ${idParam}
				AND EXISTS (SELECT 1 FROM teams t WHERE t.id = members.team_id AND (${scope}))
			 RETURNING ${MEMBER_RETURNING}`,
			params,
		);
		return row ? toMemberRecord(row) : null;
	},

	async delete(user: ActingUser, id: string): Promise<boolean> {
		if (!isUuid(id)) return false;
		const { params, p } = paramList();
		const idParam = p(id);
		const scope = memberWriteScope(user, p);
		const rows = selectAll<{ id: string }>(
			`DELETE FROM members
			 WHERE id = ${idParam}
				AND EXISTS (SELECT 1 FROM teams t WHERE t.id = members.team_id AND (${scope}))
			 RETURNING id`,
			params,
		);
		return rows.length > 0;
	},
};

/**
 * Every member row matching `options`, fetched page by page.
 *
 * `members.list` caps a page at `MAX_PER_PAGE`, so a caller that needs the
 * whole set — a CSV export, a dashboard roster — must page or silently lose
 * rows past the cap.
 */
export async function listAllMembers(
	user: ActingUser,
	options: Omit<MemberListOptions, "page" | "perPage"> = {},
): Promise<MemberRecord[]> {
	const items: MemberRecord[] = [];
	for (let page = 1; ; page++) {
		const result = await members.list(user, { ...options, page, perPage: MAX_PER_PAGE });
		items.push(...result.items);
		if (result.items.length === 0 || items.length >= result.totalItems) return items;
	}
}

// ---------------------------------------------------------------------------
// questionnaire_responses repository
// ---------------------------------------------------------------------------

interface QuestionnaireRow {
	id: string;
	team_id: string;
	user_id: string;
	age: number | null;
	gender: string | null;
	education: string | null;
	college_name: string | null;
	district: string | null;
	skills: string | null;
	interests: string | null;
	challenges: string | null;
	experience: string | null;
	motivation: string | null;
	team_experience: string | null;
	expectations: string | null;
	additional_info: string | null;
	year_of_graduation: string | null;
	created_at: string;
	updated_at: string;
}

/** Bare column list — usable in a `q.`-qualified SELECT and an unaliased RETURNING. */
const QUESTIONNAIRE_COLUMNS = [
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
];

const QUESTIONNAIRE_SELECT = QUESTIONNAIRE_COLUMNS.map((column) => `q.${column}`).join(", ");
const QUESTIONNAIRE_RETURNING = QUESTIONNAIRE_COLUMNS.join(", ");

const QUESTIONNAIRE_FROM = `
	FROM questionnaire_responses q
	JOIN teams t ON t.id = q.team_id`;

/**
 * `questionnaire_responses` row → record.
 *
 * The answer columns are free-form (`[field: string]: unknown` in
 * `types.ts`), so the mapper is generic: snake → camel, and unset text → `""`
 * / unset number → `0`, matching the old backend's defaults.
 */
function toQuestionnaireRecord(row: QuestionnaireRow): QuestionnaireResponseRecord {
	const record: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(row)) {
		const name = toCamelCase(key);
		if (name === "age") {
			record[name] = value ?? 0;
		} else if (name === "createdAt" || name === "updatedAt") {
			record[name] = toIso(value as string | null);
		} else {
			record[name] = value ?? "";
		}
	}
	return record as QuestionnaireResponseRecord;
}

/** §6.2 questionnaire list/view: admin ∨ coordinator ∨ (institution ∧ own inst) ∨ own response. */
export function questionnaireScope(user: ActingUser, p: ParamList["p"]): string {
	if (user.role === "admin" || user.role === "coordinator") return "TRUE";
	if (user.role === "institution") {
		return user.institutionId ? `t.institution_id = ${p(user.institutionId)}` : "FALSE";
	}
	return `q.user_id = ${p(user.id)}`;
}

/** §6.2 questionnaire update: admin ∨ (institution ∧ own inst) ∨ team leader. */
function questionnaireWriteScope(user: ActingUser, p: ParamList["p"]): string {
	if (user.role === "admin") return "TRUE";
	if (user.role === "institution") {
		return user.institutionId ? `t.institution_id = ${p(user.institutionId)}` : "FALSE";
	}
	if (user.role === "lead") return `t.leader_user_id = ${p(user.id)}`;
	return "FALSE";
}

export interface QuestionnaireResponseInput {
	teamId: string;
	userId: string;
	age?: number;
	gender?: string;
	education?: string;
	collegeName?: string;
	district?: string;
	skills?: string;
	interests?: string;
	challenges?: string;
	experience?: string;
	motivation?: string;
	teamExperience?: string;
	expectations?: string;
	additionalInfo?: string;
	yearOfGraduation?: string;
}

export type QuestionnaireResponseUpdate = Partial<
	Omit<QuestionnaireResponseInput, "teamId" | "userId">
>;

export interface QuestionnaireResponsesRepository {
	/** The single response for a team (`getFirstListItem` by team). */
	getByTeam(user: ActingUser, teamId: string): Promise<QuestionnaireResponseRecord | null>;
	create(
		user: ActingUser,
		input: QuestionnaireResponseInput,
	): Promise<QuestionnaireResponseRecord | null>;
	/**
	 * Insert the team's response or overwrite its answers.
	 *
	 * `ON CONFLICT (team_id) DO UPDATE` makes two concurrent first
	 * submissions collapse into one row instead of one of them hitting the
	 * unique index.
	 */
	upsert(
		user: ActingUser,
		input: QuestionnaireResponseInput,
	): Promise<QuestionnaireResponseRecord | null>;
	update(
		user: ActingUser,
		id: string,
		patch: QuestionnaireResponseUpdate,
	): Promise<QuestionnaireResponseRecord | null>;
	/** Delete a response (admin only). */
	delete(user: ActingUser, id: string): Promise<boolean>;
}

/** Column names for the answer fields, in insert order. */
const QUESTIONNAIRE_FIELDS: Array<[keyof QuestionnaireResponseUpdate, string]> = [
	["age", "age"],
	["gender", "gender"],
	["education", "education"],
	["collegeName", "college_name"],
	["district", "district"],
	["skills", "skills"],
	["interests", "interests"],
	["challenges", "challenges"],
	["experience", "experience"],
	["motivation", "motivation"],
	["teamExperience", "team_experience"],
	["expectations", "expectations"],
	["additionalInfo", "additional_info"],
	["yearOfGraduation", "year_of_graduation"],
];

export const questionnaireResponses: QuestionnaireResponsesRepository = {
	async getByTeam(user: ActingUser, teamId: string): Promise<QuestionnaireResponseRecord | null> {
		if (!isUuid(teamId)) return null;
		const { params, p } = paramList();
		const teamParam = p(teamId);
		const scope = questionnaireScope(user, p);
		const row = selectOne<QuestionnaireRow>(
			`SELECT ${QUESTIONNAIRE_SELECT} ${QUESTIONNAIRE_FROM}
			 WHERE q.team_id = ${teamParam} AND (${scope})
			 ORDER BY q.created_at DESC
			 LIMIT 1`,
			params,
		);
		return row ? toQuestionnaireRecord(row) : null;
	},

	async create(
		user: ActingUser,
		input: QuestionnaireResponseInput,
	): Promise<QuestionnaireResponseRecord | null> {
		if (!isUuid(input.teamId) || !isUuid(input.userId)) return null;

		const { params, p } = paramList();
		// Bind order must match the order the placeholders appear in the SQL:
		// the SELECT list first, then the WHERE clause that follows the FROM.
		const id = p(randomUUID());
		const userId = p(input.userId);
		const values = QUESTIONNAIRE_FIELDS.map(([key]) => {
			const value = input[key];
			if (key === "age") return p(value ?? 0);
			return `NULLIF(${p(typeof value === "string" ? value : "")}, '')`;
		});
		const teamId = p(input.teamId);

		// §6.2 questionnaire create: admin ∨ (institution ∧ own inst) ∨
		// (lead ∧ own team ∧ userId = self).
		const scope = [
			`${p(user.role)} = 'admin'`,
			`(${p(user.role)} = 'institution' AND NULLIF(${p(user.institutionId)}, '') = t.institution_id)`,
			`(${p(user.role)} = 'lead' AND t.leader_user_id = ${p(user.id)} AND ${p(input.userId)} = ${p(user.id)})`,
		].join(" OR ");

		const columns = QUESTIONNAIRE_FIELDS.map(([, column]) => column).join(", ");
		const row = selectOne<QuestionnaireRow>(
			`INSERT INTO questionnaire_responses (id, team_id, user_id, ${columns})
			 SELECT ${id}, t.id, ${userId}, ${values.join(", ")}
			 FROM teams t
			 WHERE t.id = ${teamId} AND (${scope})
			 RETURNING ${QUESTIONNAIRE_RETURNING}`,
			params,
		);
		return row ? toQuestionnaireRecord(row) : null;
	},

	async upsert(
		user: ActingUser,
		input: QuestionnaireResponseInput,
	): Promise<QuestionnaireResponseRecord | null> {
		if (!isUuid(input.teamId) || !isUuid(input.userId)) return null;

		const { params, p } = paramList();
		// Bind order must match the order the placeholders appear in the SQL:
		// the SELECT list first, then the WHERE clause that follows the FROM.
		const id = p(randomUUID());
		const userId = p(input.userId);
		const values = QUESTIONNAIRE_FIELDS.map(([key]) => {
			const value = input[key];
			if (key === "age") return p(value ?? 0);
			return `NULLIF(${p(typeof value === "string" ? value : "")}, '')`;
		});
		const teamId = p(input.teamId);

		const scope = [
			`${p(user.role)} = 'admin'`,
			`(${p(user.role)} = 'institution' AND NULLIF(${p(user.institutionId)}, '') = t.institution_id)`,
			`(${p(user.role)} = 'lead' AND t.leader_user_id = ${p(user.id)} AND ${p(input.userId)} = ${p(user.id)})`,
		].join(" OR ");

		const columns = QUESTIONNAIRE_FIELDS.map(([, column]) => column);
		const assignments = columns.map((column) => `${column} = EXCLUDED.${column}`).join(", ");
		const row = selectOne<QuestionnaireRow>(
			`INSERT INTO questionnaire_responses (id, team_id, user_id, ${columns.join(", ")})
			 SELECT ${id}, t.id, ${userId}, ${values.join(", ")}
			 FROM teams t
			 WHERE t.id = ${teamId} AND (${scope})
			 ON CONFLICT (team_id) DO UPDATE SET ${assignments}
			 RETURNING ${QUESTIONNAIRE_RETURNING}`,
			params,
		);
		return row ? toQuestionnaireRecord(row) : null;
	},

	async update(
		user: ActingUser,
		id: string,
		patch: QuestionnaireResponseUpdate,
	): Promise<QuestionnaireResponseRecord | null> {
		if (!isUuid(id)) return null;

		const { params, p } = paramList();
		const sets: string[] = [];
		for (const [key, column] of QUESTIONNAIRE_FIELDS) {
			const value = patch[key];
			if (value === undefined) continue;
			if (key === "age") {
				sets.push(`${column} = ${p(value)}`);
			} else {
				sets.push(`${column} = NULLIF(${p(value)}, '')`);
			}
		}

		if (sets.length === 0) {
			const idParam = p(id);
			const scope = questionnaireScope(user, p);
			const current = selectOne<QuestionnaireRow>(
				`SELECT ${QUESTIONNAIRE_SELECT} ${QUESTIONNAIRE_FROM}
				 WHERE q.id = ${idParam} AND (${scope}) LIMIT 1`,
				params,
			);
			return current ? toQuestionnaireRecord(current) : null;
		}

		const idParam = p(id);
		const scope = questionnaireWriteScope(user, p);
		const row = selectOne<QuestionnaireRow>(
			`UPDATE questionnaire_responses SET ${sets.join(", ")}
			 WHERE id = ${idParam}
				AND EXISTS (
					SELECT 1 FROM teams t
					WHERE t.id = questionnaire_responses.team_id AND (${scope})
				)
			 RETURNING ${QUESTIONNAIRE_RETURNING}`,
			params,
		);
		return row ? toQuestionnaireRecord(row) : null;
	},

	async delete(user: ActingUser, id: string): Promise<boolean> {
		if (!isUuid(id)) return false;
		const { params, p } = paramList();
		const idParam = p(id);
		const actorRole = p(user.role);
		const rows = selectAll<{ id: string }>(
			`DELETE FROM questionnaire_responses
			 WHERE id = ${idParam} AND ${actorRole} = 'admin'
			 RETURNING id`,
			params,
		);
		return rows.length > 0;
	},
};

// ---------------------------------------------------------------------------
// status_transitions repository
// ---------------------------------------------------------------------------

/** An audit row. `role` is the actor's role at the time of the transition. */
export interface StatusTransitionRecord {
	id: string;
	teamId: string;
	actorUserId: string;
	fromStatus: string;
	toStatus: string;
	role: Role;
	at: string;
	created: string;
	updated: string;
}

interface StatusTransitionRow {
	id: string;
	team_id: string;
	actor_user_id: string;
	from_status: string;
	to_status: string;
	role: Role;
	at: string;
	created_at: string;
	updated_at: string;
}

/**
 * Bare column list: this projection is used in an `INSERT … RETURNING`, where
 * the target table has no alias.
 */
const STATUS_TRANSITION_RETURNING =
	"id, team_id, actor_user_id, from_status, to_status, role, at, created_at, updated_at";

function toStatusTransitionRecord(row: StatusTransitionRow): StatusTransitionRecord {
	return {
		id: row.id,
		teamId: row.team_id,
		actorUserId: row.actor_user_id,
		fromStatus: row.from_status,
		toStatus: row.to_status,
		role: row.role,
		at: toIso(row.at),
		created: toIso(row.created_at),
		updated: toIso(row.updated_at),
	};
}

export interface StatusTransitionCreateInput {
	teamId: string;
	fromStatus: string;
	toStatus: string;
	/** Defaults to now — the app owns the timestamp. */
	at?: string;
}

export interface StatusTransitionsRepository {
	/**
	 * Append an audit row.
	 *
	 * `actor_user_id` and `role` come from the session, never from the caller's
	 * payload — the old backend's create rule required exactly that.
	 */
	create(
		user: ActingUser,
		input: StatusTransitionCreateInput,
	): Promise<StatusTransitionRecord | null>;
}

export const statusTransitions: StatusTransitionsRepository = {
	async create(
		user: ActingUser,
		input: StatusTransitionCreateInput,
	): Promise<StatusTransitionRecord | null> {
		if (!isUuid(input.teamId) || !isUuid(user.id)) return null;
		const { params, p } = paramList();
		// Bind order must match the order the placeholders appear in the SQL:
		// the SELECT list first, then the WHERE clause that follows the FROM.
		const id = p(randomUUID());
		const actorUserId = p(user.id);
		const fromStatus = p(input.fromStatus);
		const toStatus = p(input.toStatus);
		const role = p(user.role);
		const at = p(input.at ?? new Date().toISOString());
		const teamId = p(input.teamId);

		// §6.2: an audit row may only be appended for a team the actor can
		// already see, so a forged team id cannot create one.
		const scope = teamScope(user, p);
		const row = selectOne<StatusTransitionRow>(
			`INSERT INTO status_transitions
				(id, team_id, actor_user_id, from_status, to_status, role, at)
			 SELECT ${id}, t.id, ${actorUserId}, ${fromStatus}, ${toStatus}, ${role}, ${at}
			 FROM teams t
			 WHERE t.id = ${teamId} AND (${scope})
			 RETURNING ${STATUS_TRANSITION_RETURNING}`,
			params,
		);
		return row ? toStatusTransitionRecord(row) : null;
	},
};

// ---------------------------------------------------------------------------
// config repository
// ---------------------------------------------------------------------------

interface ConfigRow {
	id: string;
	key: string;
	value: number;
	created_at: string;
	updated_at: string;
}

const CONFIG_SELECT = "id, key, value, created_at, updated_at";

function toConfigRecord(row: ConfigRow): ConfigRecord {
	return {
		id: row.id,
		key: row.key,
		value: row.value === 1,
		created: toIso(row.created_at),
		updated: toIso(row.updated_at),
	};
}

/**
 * `schema_version` and any `_`-prefixed key are bookkeeping, not phase gates
 * (plan §6.3) — `getConfig()` skips them, so the write path must too.
 */
function isFlagKey(key: string): boolean {
	return key !== "schema_version" && !key.startsWith("_");
}

export interface ConfigRepository {
	/** One flag by key. Null for a missing key or a bookkeeping key. */
	get(key: string): Promise<ConfigRecord | null>;
	/**
	 * Insert or update one flag.
	 *
	 * `ON CONFLICT (key) DO UPDATE` makes the write idempotent against the
	 * unique index on `key`; `updated_at` is bumped by the table trigger.
	 * Admin only (§6.2 config write rule) — null when the actor may not.
	 */
	upsert(user: ActingUser, key: string, value: boolean): Promise<ConfigRecord | null>;
	/**
	 * Flip one flag in a single statement.
	 *
	 * `SET value = NOT value` is atomic, so two concurrent toggles cannot both
	 * read the same starting value and write the same result.
	 */
	toggle(user: ActingUser, key: string): Promise<ConfigRecord | null>;
}

export const config: ConfigRepository = {
	async get(key: string): Promise<ConfigRecord | null> {
		// §6.2 config list/view is public — the login page reads it
		// unauthenticated — so there is no actor to scope by.
		if (!isFlagKey(key)) return null;
		const row = selectOne<ConfigRow>(`SELECT ${CONFIG_SELECT} FROM config WHERE key = ? LIMIT 1`, [
			key,
		]);
		return row ? toConfigRecord(row) : null;
	},

	async upsert(user: ActingUser, key: string, value: boolean): Promise<ConfigRecord | null> {
		if (!isFlagKey(key)) return null;
		const { params, p } = paramList();
		const id = p(randomUUID());
		const keyParam = p(key);
		const valueParam = p(value);
		const actorRole = p(user.role);
		const row = selectOne<ConfigRow>(
			`INSERT INTO config (id, key, value)
			 SELECT ${id}, ${keyParam}, ${valueParam}
			 WHERE ${actorRole} = 'admin'
			 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
			 RETURNING ${CONFIG_SELECT}`,
			params,
		);
		return row ? toConfigRecord(row) : null;
	},

	async toggle(user: ActingUser, key: string): Promise<ConfigRecord | null> {
		if (!isFlagKey(key)) return null;
		const { params, p } = paramList();
		const keyParam = p(key);
		const actorRole = p(user.role);
		const row = selectOne<ConfigRow>(
			`UPDATE config SET value = NOT value
			 WHERE key = ${keyParam} AND ${actorRole} = 'admin'
			 RETURNING ${CONFIG_SELECT}`,
			params,
		);
		return row ? toConfigRecord(row) : null;
	},
};

// ---------------------------------------------------------------------------
// Per-request context handle
// ---------------------------------------------------------------------------

/**
 * The database handle handed to loaders and actions as `ctx.db`.
 *
 * `config` is deliberately absent: `getConfig()` is a single `SELECT key,
 * value FROM config` and needs no repository (plan §6.3).
 */
export interface Db {
	query: typeof query;
	withTransaction: typeof withTransaction;
	users: UsersRepository;
	teams: TeamsRepository;
	institutions: InstitutionsRepository;
	members: MembersRepository;
	questionnaireResponses: QuestionnaireResponsesRepository;
	statusTransitions: StatusTransitionsRepository;
}

export const db: Db = {
	query,
	withTransaction,
	users,
	teams,
	institutions,
	members,
	questionnaireResponses,
	statusTransitions,
};
