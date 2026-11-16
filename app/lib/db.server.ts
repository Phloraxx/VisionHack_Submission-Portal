/**
 * PostgreSQL access layer.
 *
 * The pool is a process-wide singleton guarded on `globalThis` so Vite HMR (and React Router
 * dev restarts) do not leak connections.
 *
 * Conventions
 * -----------
 * - Columns are snake_case (see `postgres/schema.sql`); the mappers here turn
 *   rows into the camelCase record shapes in `app/lib/types.ts`, so route code
 *   keeps reading `user.institutionId`, `team.created`, and so on.
 * - Every query is parameterised. No string interpolation of user input.
 * - `statement_timeout` is 20 s, matching the old backend's request timeout.
 * - Every repository method takes the acting user and applies the §6.2 scope
 *   predicate in SQL. The old backend's API rules were the second line of
 *   defence behind the route loaders; in Postgres they are gone, so the
 *   predicate lives here instead (docs/PG_PORT_PLAN.md §6.2).
 * - Repository calls made inside `withTransaction` join that transaction, so a
 *   route can compose several writes into one atomic unit.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
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

/** Matches the 20 s timeout the old backend applied to every request. */
const STATEMENT_TIMEOUT_MS = 20_000;
/** pg-hub runs max_connections=120 across all apps (plan §10.7). */
const POOL_MAX = 10;

// ---------------------------------------------------------------------------
// Pool singleton (HMR-safe)
// ---------------------------------------------------------------------------

interface DbGlobal {
	__visionhackPgPool?: Pool;
}

const globalForDb = globalThis as typeof globalThis & DbGlobal;

/**
 * The shared `pg` pool. Created on first use so importing this module never
 * opens a socket (tests and `react-router build` stay side-effect free).
 */
export function getPool(): Pool {
	if (!globalForDb.__visionhackPgPool) {
		const pool = new Pool({
			connectionString: getEnv().DATABASE_URL,
			max: POOL_MAX,
			statement_timeout: STATEMENT_TIMEOUT_MS,
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 10_000,
		});
		// An idle client erroring (server restart, network blip) must not take
		// the process down — pg emits it on the pool, not on the query.
		pool.on("error", (err) => {
			console.error("[db] Idle client error", err);
		});
		globalForDb.__visionhackPgPool = pool;
	}
	return globalForDb.__visionhackPgPool;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * The client of the transaction the current async call chain is running in.
 *
 * `withTransaction` publishes its client here so the repository methods below
 * join the transaction without every signature growing a `client` parameter:
 * `query()` prefers the ambient client over the pool.
 */
const transactionStorage = new AsyncLocalStorage<PoolClient>();

/**
 * Run a parameterised query.
 *
 * Inside `withTransaction` the query runs on that transaction's client, so a
 * repository call made from the callback is part of the same atomic unit.
 */
export function query<T extends QueryResultRow = QueryResultRow>(
	text: string,
	params: unknown[] = [],
): Promise<QueryResult<T>> {
	const client = transactionStorage.getStore();
	if (client) return client.query<T>(text, params);
	return getPool().query<T>(text, params);
}

/**
 * Run `fn` inside a transaction on a dedicated client.
 *
 * Commits when `fn` resolves, rolls back when it throws, and always releases
 * the client back to the pool. Repository calls made inside `fn` — directly or
 * through a helper — run on the transaction's client (see `query`), so a
 * multi-write sequence is all-or-nothing.
 *
 * Nested calls join the enclosing transaction instead of opening a second one.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
	const ambient = transactionStorage.getStore();
	if (ambient) return fn(ambient);

	const client = await getPool().connect();
	let failed = false;
	try {
		await client.query("BEGIN");
		const result = await transactionStorage.run(client, () => fn(client));
		await client.query("COMMIT");
		return result;
	} catch (err) {
		failed = true;
		try {
			await client.query("ROLLBACK");
		} catch (rollbackErr) {
			console.error("[db] Rollback failed", rollbackErr);
		}
		throw err;
	} finally {
		// Passing the error destroys the connection instead of returning a
		// possibly-broken one to the pool.
		client.release(failed ? new Error("transaction failed") : undefined);
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

/** `$n` placeholder factory — keeps the SQL text and the parameter array in sync. */
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
			return `$${params.length}`;
		},
	};
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guard a uuid cast: a malformed id must read as "no such row", not a 500. */
export function isUuid(value: string): boolean {
	return UUID_RE.test(value);
}

/** Postgres `foreign_key_violation` — a delete blocked by a referencing row. */
function isForeignKeyViolation(err: unknown): boolean {
	return typeof err === "object" && err !== null && (err as { code?: string }).code === "23503";
}

/** `timestamptz` → ISO string; unset → `""`. */
function toIso(value: Date | null): string {
	return value ? value.toISOString() : "";
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
function teamScope(user: ActingUser, p: ParamList["p"], alias = "t"): string {
	if (user.role === "admin" || user.role === "coordinator") return "TRUE";
	if (user.role === "institution") {
		return user.institutionId ? `${alias}.institution_id = ${p(user.institutionId)}` : "FALSE";
	}
	return `${alias}.leader_user_id = ${p(user.id)}`;
}

/** §6.2 `institutions` list/view predicate: `role IN ('admin','coordinator') OR id = $inst`. */
function institutionScope(user: ActingUser, p: ParamList["p"], alias = "i"): string {
	if (user.role === "admin" || user.role === "coordinator") return "TRUE";
	return user.institutionId ? `${alias}.id = ${p(user.institutionId)}` : "FALSE";
}

// ---------------------------------------------------------------------------
// users repository
// ---------------------------------------------------------------------------

/** A `users` row as Postgres returns it. */
interface UserDbRow extends QueryResultRow {
	id: string;
	email: string;
	name: string | null;
	role: Role;
	institution_id: string | null;
	password_hash: string;
	created_at: Date;
	updated_at: Date;
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
		created: row.created_at.toISOString(),
		updated: row.updated_at.toISOString(),
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
	/** Load the live record used by `resolveAuth` — no password hash. */
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
		const result = await query<UserDbRow>(
			`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = lower($1) LIMIT 1`,
			[email],
		);
		const row = result.rows[0];
		if (!row) return null;
		return { ...toUserRecord(row), passwordHash: row.password_hash };
	},

	async findById(id: string): Promise<UserRecord | null> {
		// Guard the uuid cast: a malformed id must read as "no such user", not
		// as a 500 from Postgres.
		if (!isUuid(id)) return null;
		const result = await query<UserDbRow>(
			`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
			[id],
		);
		const row = result.rows[0];
		return row ? toUserRecord(row) : null;
	},

	async findSessionUser(id: string): Promise<UserAuthRow | null> {
		if (!isUuid(id)) return null;
		const result = await query<UserDbRow>(
			`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE id = $1 LIMIT 1`,
			[id],
		);
		const row = result.rows[0];
		return row ? { ...toUserRecord(row), passwordHash: row.password_hash } : null;
	},

	async count(user: ActingUser): Promise<number> {
		const { params, p } = paramList();
		const actorId = p(user.id);
		const actorRole = p(user.role);
		const actorInstitution = p(user.institutionId);
		// §6.2 users list/view: self ∨ admin ∨ coordinator ∨ own institution.
		const scope = [
			`id = NULLIF(${actorId}, '')::uuid`,
			`${actorRole}::text IN ('admin', 'coordinator')`,
			`institution_id = NULLIF(${actorInstitution}, '')::uuid`,
		].join(" OR ");
		const result = await query<{ count: number }>(
			`SELECT count(*)::int AS count FROM users WHERE ${scope}`,
			params,
		);
		return result.rows[0]?.count ?? 0;
	},

	async findPasswordHashById(id: string): Promise<string | null> {
		if (!isUuid(id)) return null;
		const result = await query<{ password_hash: string }>(
			"SELECT password_hash FROM users WHERE id = $1 LIMIT 1",
			[id],
		);
		return result.rows[0]?.password_hash ?? null;
	},

	async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
		if (!isUuid(id)) return;
		await query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, passwordHash]);
	},

	async updatePasswordHashIfUnchanged(
		id: string,
		expectedHash: string,
		passwordHash: string,
	): Promise<boolean> {
		if (!isUuid(id)) return false;
		const result = await query(
			"UPDATE users SET password_hash = $3 WHERE id = $1 AND password_hash = $2 RETURNING id",
			[id, expectedHash, passwordHash],
		);
		return result.rows.length > 0;
	},

	async create(user: ActingUser, input: UserCreateInput): Promise<UserRecord | null> {
		const { params, p } = paramList();
		const email = p(input.email.toLowerCase());
		const name = p(input.name);
		const role = p(input.role);
		const institutionId = p(input.institutionId ?? "");
		const passwordHash = p(input.passwordHash);
		const actorRole = p(user.role);
		const actorInstitution = p(user.institutionId);

		// §6.2 users create: admin, or (institution ∧ role = 'lead' ∧ own inst).
		const scope = [
			`${actorRole}::text = 'admin'`,
			`(${actorRole}::text = 'institution' AND ${role} = 'lead' AND NULLIF(${institutionId}, '')::uuid = NULLIF(${actorInstitution}, '')::uuid)`,
		].join(" OR ");

		const result = await query<UserDbRow>(
			`INSERT INTO users (email, name, role, institution_id, password_hash)
			 SELECT ${email}, ${name}, ${role}, NULLIF(${institutionId}, '')::uuid, ${passwordHash}
			 WHERE ${scope}
			 RETURNING ${USER_COLUMNS}`,
			params,
		);
		const row = result.rows[0];
		return row ? toUserRecord(row) : null;
	},

	async delete(user: ActingUser, id: string): Promise<boolean> {
		if (!isUuid(id)) return false;
		const { params, p } = paramList();
		const idParam = p(id);
		const actorRole = p(user.role);
		try {
			const result = await query(
				`DELETE FROM users WHERE id = ${idParam} AND ${actorRole}::text = 'admin' RETURNING id`,
				params,
			);
			return result.rows.length > 0;
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
interface TeamRow extends QueryResultRow {
	id: string;
	name: string;
	institution_id: string;
	leader_user_id: string;
	team_code: string | null;
	status: TeamStatus;
	statusChangedAt: Date | null;
	questionnaireCompleted: boolean;
	ideaTitle: string | null;
	ideaDesc: string | null;
	ideaTechStack: string | null;
	submissionFile: string | null;
	created_at: Date;
	updated_at: Date;
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
	t.statusChangedAt, t.questionnaireCompleted, t.ideaTitle, t.ideaDesc,
	t.ideaTechStack, t.submissionFile, t.created_at, t.updated_at,
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
		statusChangedAt: toIso(row.statusChangedAt),
		questionnaireCompleted: row.questionnaireCompleted,
		ideaTitle: row.ideaTitle ?? "",
		ideaDesc: row.ideaDesc ?? "",
		ideaTechStack: row.ideaTechStack ?? "",
		submissionFile: row.submissionFile ?? "",
		created: row.created_at.toISOString(),
		updated: row.updated_at.toISOString(),
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
	 * Update with the optimistic lock: `WHERE id = $1 AND status = $expected`.
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
	// Every id was malformed — read as "no match" rather than letting the
	// ::uuid[] cast raise 22P02.
	if (requested.length > 0 && institutionIds.length === 0) return null;
	if (institutionIds.length > 0) {
		where.push(`t.institution_id = ANY(${p(institutionIds)}::uuid[])`);
	}

	const statuses = toArray(options.status);
	if (statuses.length > 0) {
		where.push(`t.status = ANY(${p(statuses)}::text[])`);
	}

	if (options.q) {
		const pattern = p(containsPattern(options.q));
		// Search covers the team, its lead and its institution — the joins are
		// already in TEAM_FROM, so this costs nothing extra.
		where.push(
			`(t.name ILIKE ${pattern} ESCAPE '\\' OR t.team_code ILIKE ${pattern} ESCAPE '\\'
				OR u.name ILIKE ${pattern} ESCAPE '\\' OR u.email ILIKE ${pattern} ESCAPE '\\'
				OR i.name ILIKE ${pattern} ESCAPE '\\')`,
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

		const countResult = await query<{ count: number }>(
			`SELECT count(*)::int AS count ${TEAM_FROM} WHERE ${whereSql}`,
			params,
		);
		const totalItems = countResult.rows[0]?.count ?? 0;

		const limitParam = `$${params.length + 1}`;
		const offsetParam = `$${params.length + 2}`;
		const rows = await query<TeamRow>(
			`SELECT ${TEAM_SELECT} ${TEAM_FROM} WHERE ${whereSql}
			 ORDER BY ${orderByClause(options.sort, TEAM_SORT_COLUMNS, "-created")}
			 LIMIT ${limitParam} OFFSET ${offsetParam}`,
			[...params, perPage, offset],
		);

		return {
			page,
			perPage,
			totalItems,
			totalPages: Math.ceil(totalItems / perPage),
			items: rows.rows.map(toTeamView),
		};
	},

	async aggregate(user: ActingUser, options: TeamListOptions = {}): Promise<TeamAggregate> {
		const { params, p } = paramList();
		const where = teamWhere(user, options, p);
		const empty: TeamAggregate = { byStatus: {}, byInstitution: {}, total: 0, institutions: 0 };
		if (!where) return empty;

		const result = await query<{ status: TeamStatus; institution_id: string; count: number }>(
			`SELECT t.status, t.institution_id, count(*)::int AS count ${TEAM_FROM}
			 WHERE ${where.join(" AND ")}
			 GROUP BY t.status, t.institution_id`,
			params,
		);

		const aggregate: TeamAggregate = { byStatus: {}, byInstitution: {}, total: 0, institutions: 0 };
		for (const row of result.rows) {
			aggregate.byStatus[row.status] = (aggregate.byStatus[row.status] ?? 0) + row.count;
			aggregate.total += row.count;
			const bucket = (aggregate.byInstitution[row.institution_id] ??= {
				total: 0,
				registered: 0,
				shortlisted: 0,
			});
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
		const result = await query<TeamRow>(
			`SELECT ${TEAM_SELECT} ${TEAM_FROM} WHERE t.id = ${idParam} AND ${scope} LIMIT 1`,
			params,
		);
		const row = result.rows[0];
		return row ? toTeamView(row) : null;
	},

	async findByLeader(user: ActingUser, leaderUserId: string): Promise<TeamView | null> {
		if (!isUuid(leaderUserId)) return null;
		const { params, p } = paramList();
		const leaderParam = p(leaderUserId);
		const scope = teamScope(user, p);
		const result = await query<TeamRow>(
			`SELECT ${TEAM_SELECT} ${TEAM_FROM}
			 WHERE t.leader_user_id = ${leaderParam} AND ${scope}
			 ORDER BY t.created_at DESC LIMIT 1`,
			params,
		);
		const row = result.rows[0];
		return row ? toTeamView(row) : null;
	},

	async countByInstitution(user: ActingUser, institutionId: string): Promise<number> {
		if (!isUuid(institutionId)) return 0;
		const { params, p } = paramList();
		const institutionParam = p(institutionId);
		const actorRole = p(user.role);
		const actorInstitution = p(user.institutionId);
		const scope = [
			`${actorRole}::text IN ('admin', 'coordinator')`,
			`NULLIF(${actorInstitution}, '')::uuid = ${institutionParam}::uuid`,
		].join(" OR ");
		const result = await query<{ count: number }>(
			`SELECT count(*)::int AS count FROM teams t
			 WHERE t.institution_id = ${institutionParam}::uuid AND (${scope})`,
			params,
		);
		return result.rows[0]?.count ?? 0;
	},

	async create(user: ActingUser, input: TeamCreateInput): Promise<TeamView | null> {
		if (!isUuid(input.institutionId) || !isUuid(input.leaderUserId)) return null;

		const { params, p } = paramList();
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

		const actorRole = p(user.role);
		const actorInstitution = p(user.institutionId);
		const actorId = p(user.id);

		// §6.2 teams create: admin, or (institution ∧ own inst ∧ status invited),
		// or (lead ∧ own inst ∧ leader = self ∧ status registered).
		const scope = [
			`${actorRole}::text = 'admin'`,
			`(${actorRole}::text = 'institution' AND NULLIF(${actorInstitution}, '')::uuid = ${institutionId}::uuid AND ${status} = 'invited')`,
			`(${actorRole}::text = 'lead' AND NULLIF(${actorInstitution}, '')::uuid = ${institutionId}::uuid AND ${leaderUserId}::uuid = NULLIF(${actorId}, '')::uuid AND ${status} = 'registered')`,
		].join(" OR ");

		const result = await query<{ id: string }>(
			`INSERT INTO teams (
				name, institution_id, leader_user_id, team_code, status, status_changed_at,
				questionnaire_completed, idea_title, idea_desc, idea_tech_stack, submission_file
			 )
			 SELECT ${name}, ${institutionId}::uuid, ${leaderUserId}::uuid, NULLIF(${teamCode}, ''),
				${status}, ${statusChangedAt}::timestamptz, ${questionnaireCompleted}::boolean,
				NULLIF(${ideaTitle}, ''), NULLIF(${ideaDesc}, ''), NULLIF(${ideaTechStack}, ''),
				NULLIF(${submissionFile}, '')
			 WHERE ${scope}
			 RETURNING id`,
			params,
		);
		const created = result.rows[0];
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
			sets.push(`questionnaire_completed = ${p(patch.questionnaireCompleted)}::boolean`);
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
			sets.push(
				`status_changed_at = ${p(patch.statusChangedAt ?? new Date().toISOString())}::timestamptz`,
			);
		}

		if (sets.length === 0) return teams.getOne(user, id);

		const idParam = p(id);
		const where = [`id = ${idParam}`, teamScope(user, p, "teams")];
		if (options.expectedStatus) {
			where.push(`status = ${p(options.expectedStatus)}`);
		}

		const result = await query<{ id: string }>(
			`UPDATE teams SET ${sets.join(", ")} WHERE ${where.join(" AND ")} RETURNING id`,
			params,
		);
		if (!result.rows[0]) return null;
		return teams.getOne(user, id);
	},

	async delete(user: ActingUser, id: string): Promise<boolean> {
		if (!isUuid(id)) return false;
		const { params, p } = paramList();
		const idParam = p(id);
		const actorRole = p(user.role);
		const result = await query(
			`DELETE FROM teams WHERE id = ${idParam} AND ${actorRole}::text = 'admin' RETURNING id`,
			params,
		);
		return result.rows.length > 0;
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

interface InstitutionRow extends QueryResultRow {
	id: string;
	name: string;
	district: string | null;
	code: string;
	campus_lead_id: string | null;
	max_teams: number | null;
	status: string | null;
	created_at: Date;
	updated_at: Date;
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
		created: row.created_at.toISOString(),
		updated: row.updated_at.toISOString(),
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
	 * Lock the institution row for the rest of the transaction and return its
	 * capacity. Serialises the SEC-9 capacity check against concurrent
	 * registrations, which a plain read under READ COMMITTED does not.
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
			const pattern = p(containsPattern(options.q));
			where.push(`(i.name ILIKE ${pattern} ESCAPE '\\' OR i.code ILIKE ${pattern} ESCAPE '\\')`);
		}

		const whereSql = where.join(" AND ");
		const { page, perPage, offset } = normalizePaging(options.page, options.perPage);

		const countResult = await query<{ count: number }>(
			`SELECT count(*)::int AS count ${INSTITUTION_FROM} WHERE ${whereSql}`,
			params,
		);
		const totalItems = countResult.rows[0]?.count ?? 0;

		const limitParam = `$${params.length + 1}`;
		const offsetParam = `$${params.length + 2}`;
		const rows = await query<InstitutionRow>(
			`SELECT ${INSTITUTION_SELECT} ${INSTITUTION_FROM} WHERE ${whereSql}
			 ORDER BY ${orderByClause(options.sort, INSTITUTION_SORT_COLUMNS, "name")}
			 LIMIT ${limitParam} OFFSET ${offsetParam}`,
			[...params, perPage, offset],
		);

		return {
			page,
			perPage,
			totalItems,
			totalPages: Math.ceil(totalItems / perPage),
			items: rows.rows.map(toInstitutionView),
		};
	},

	async getOne(user: ActingUser, id: string): Promise<InstitutionView | null> {
		if (!isUuid(id)) return null;
		const { params, p } = paramList();
		const idParam = p(id);
		const scope = institutionScope(user, p);
		const result = await query<InstitutionRow>(
			`SELECT ${INSTITUTION_SELECT} ${INSTITUTION_FROM} WHERE i.id = ${idParam} AND ${scope} LIMIT 1`,
			params,
		);
		const row = result.rows[0];
		return row ? toInstitutionView(row) : null;
	},

	async findByCampusLeadId(
		user: ActingUser,
		campusLeadId: string,
	): Promise<InstitutionView | null> {
		if (!isUuid(campusLeadId)) return null;
		const { params, p } = paramList();
		const leadParam = p(campusLeadId);
		const actorRole = p(user.role);
		const actorInstitution = p(user.institutionId);
		const actorId = p(user.id);
		const scope = [
			`${actorRole}::text IN ('admin', 'coordinator')`,
			`i.id = NULLIF(${actorInstitution}, '')::uuid`,
			`i.campus_lead_id = NULLIF(${actorId}, '')::uuid`,
		].join(" OR ");
		const result = await query<InstitutionRow>(
			`SELECT ${INSTITUTION_SELECT} ${INSTITUTION_FROM}
			 WHERE i.campus_lead_id = ${leadParam} AND (${scope})
			 LIMIT 1`,
			params,
		);
		const row = result.rows[0];
		return row ? toInstitutionView(row) : null;
	},

	async findByCode(user: ActingUser, code: string): Promise<InstitutionView | null> {
		const { params, p } = paramList();
		const codeParam = p(code);
		const scope = institutionScope(user, p);
		const result = await query<InstitutionRow>(
			`SELECT ${INSTITUTION_SELECT} ${INSTITUTION_FROM}
			 WHERE i.code = ${codeParam} AND ${scope}
			 LIMIT 1`,
			params,
		);
		const row = result.rows[0];
		return row ? toInstitutionView(row) : null;
	},

	async lockForUpdate(user: ActingUser, id: string): Promise<{ maxTeams: number } | null> {
		if (!isUuid(id)) return null;
		const { params, p } = paramList();
		const idParam = p(id);
		const scope = institutionScope(user, p);
		const result = await query<{ max_teams: number | null }>(
			`SELECT i.max_teams FROM institutions i WHERE i.id = ${idParam} AND ${scope} FOR UPDATE`,
			params,
		);
		const row = result.rows[0];
		return row ? { maxTeams: row.max_teams ?? 0 } : null;
	},

	async create(user: ActingUser, input: InstitutionCreateInput): Promise<InstitutionView | null> {
		const { params, p } = paramList();
		const name = p(input.name);
		const district = p(input.district ?? "");
		const code = p(input.code);
		const campusLeadId = p(input.campusLeadId ?? "");
		const maxTeams = p(input.maxTeams ?? 0);
		const status = p(input.status ?? "active");
		const actorRole = p(user.role);

		const result = await query<{ id: string }>(
			`INSERT INTO institutions (name, district, code, campus_lead_id, max_teams, status)
			 SELECT ${name}, NULLIF(${district}, ''), ${code}, NULLIF(${campusLeadId}, '')::uuid,
				${maxTeams}::int, ${status}
			 WHERE ${actorRole}::text = 'admin'
			 RETURNING id`,
			params,
		);
		const created = result.rows[0];
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
			sets.push(`campus_lead_id = NULLIF(${p(patch.campusLeadId)}, '')::uuid`);
		}
		if (patch.maxTeams !== undefined) sets.push(`max_teams = ${p(patch.maxTeams)}::int`);
		if (patch.status !== undefined) sets.push(`status = ${p(patch.status)}`);

		if (sets.length === 0) return institutions.getOne(user, id);

		const idParam = p(id);
		const actorRole = p(user.role);
		const result = await query<{ id: string }>(
			`UPDATE institutions SET ${sets.join(", ")}
			 WHERE id = ${idParam} AND ${actorRole}::text = 'admin'
			 RETURNING id`,
			params,
		);
		if (!result.rows[0]) return null;
		return institutions.getOne(user, id);
	},

	async delete(user: ActingUser, id: string): Promise<boolean> {
		if (!isUuid(id)) return false;
		const { params, p } = paramList();
		const idParam = p(id);
		const actorRole = p(user.role);
		try {
			const result = await query(
				`DELETE FROM institutions WHERE id = ${idParam} AND ${actorRole}::text = 'admin' RETURNING id`,
				params,
			);
			return result.rows.length > 0;
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

interface MemberRow extends QueryResultRow {
	id: string;
	team_id: string;
	full_name: string;
	email: string;
	phone: string | null;
	gender: string | null;
	role: string | null;
	created_at: Date;
	updated_at: Date;
}

const MEMBER_SELECT = `
	m.id, m.team_id, m.full_name, m.email, m.phone, m.gender, m.role,
	m.created_at, m.updated_at`;

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
		created: row.created_at.toISOString(),
		updated: row.updated_at.toISOString(),
	};
}

/** §6.2 members create: admin ∨ (institution ∧ own inst) ∨ team leader. */
function memberCreateScope(user: ActingUser, p: ParamList["p"], teamAlias = "t"): string {
	if (user.role === "admin") return "TRUE";
	if (user.role === "institution") {
		return user.institutionId ? `${teamAlias}.institution_id = ${p(user.institutionId)}` : "FALSE";
	}
	if (user.role === "lead") return `${teamAlias}.leader_user_id = ${p(user.id)}`;
	return "FALSE";
}

/** §6.2 members update/delete: admin ∨ team leader. */
function memberWriteScope(user: ActingUser, p: ParamList["p"], teamAlias = "t"): string {
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
		// match" rather than reaching the ::uuid cast.
		if (options.teamId) {
			if (!isUuid(options.teamId)) return emptyList();
			where.push(`m.team_id = ${p(options.teamId)}`);
		}
		const teamIds = (options.teamIds ?? []).filter(isUuid);
		if (teamIds.length > 0) where.push(`m.team_id = ANY(${p(teamIds)}::uuid[])`);
		if (options.institutionId) {
			if (!isUuid(options.institutionId)) return emptyList();
			where.push(`t.institution_id = ${p(options.institutionId)}`);
		}

		const whereSql = where.join(" AND ");
		const { page, perPage, offset } = normalizePaging(options.page, options.perPage);

		const countResult = await query<{ count: number }>(
			`SELECT count(*)::int AS count ${MEMBER_FROM} WHERE ${whereSql}`,
			params,
		);
		const totalItems = countResult.rows[0]?.count ?? 0;

		const limitParam = `$${params.length + 1}`;
		const offsetParam = `$${params.length + 2}`;
		const rows = await query<MemberRow>(
			`SELECT ${MEMBER_SELECT} ${MEMBER_FROM} WHERE ${whereSql}
			 ORDER BY ${orderByClause(options.sort, MEMBER_SORT_COLUMNS, "-created")}
			 LIMIT ${limitParam} OFFSET ${offsetParam}`,
			[...params, perPage, offset],
		);

		return {
			page,
			perPage,
			totalItems,
			totalPages: Math.ceil(totalItems / perPage),
			items: rows.rows.map(toMemberRecord),
		};
	},

	async countByTeams(user: ActingUser, teamIds: string[]): Promise<Record<string, number>> {
		const ids = teamIds.filter(isUuid);
		if (ids.length === 0) return {};
		const { params, p } = paramList();
		const idsParam = p(ids);
		const scope = teamScope(user, p);
		const result = await query<{ team_id: string; count: number }>(
			`SELECT m.team_id, count(*)::int AS count ${MEMBER_FROM}
			 WHERE m.team_id = ANY(${idsParam}::uuid[]) AND (${scope})
			 GROUP BY m.team_id`,
			params,
		);
		const counts: Record<string, number> = {};
		for (const row of result.rows) counts[row.team_id] = row.count;
		return counts;
	},

	async create(user: ActingUser, input: MemberCreateInput): Promise<MemberRecord | null> {
		if (!isUuid(input.teamId)) return null;
		const { params, p } = paramList();
		const teamId = p(input.teamId);
		const fullName = p(input.fullName);
		const email = p(input.email.toLowerCase());
		const phone = p(input.phone ?? "");
		const gender = p(input.gender ?? "");
		const role = p(input.role ?? "");
		const scope = memberCreateScope(user, p);

		const result = await query<MemberRow>(
			`INSERT INTO members (team_id, full_name, email, phone, gender, role)
			 SELECT t.id, ${fullName}, ${email}, NULLIF(${phone}, ''), NULLIF(${gender}, ''),
				NULLIF(${role}, '')
			 FROM teams t
			 WHERE t.id = ${teamId}::uuid AND (${scope})
			 RETURNING id, team_id, full_name, email, phone, gender, role, created_at, updated_at`,
			params,
		);
		const row = result.rows[0];
		return row ? toMemberRecord(row) : null;
	},

	async createMany(user: ActingUser, teamId: string, rows: MemberCreateInput[]): Promise<number> {
		if (!isUuid(teamId) || rows.length === 0) return 0;
		const { params, p } = paramList();
		const teamIdParam = p(teamId);
		const fullNames = p(rows.map((row) => row.fullName));
		const emails = p(rows.map((row) => row.email.toLowerCase()));
		const phones = p(rows.map((row) => row.phone ?? ""));
		const genders = p(rows.map((row) => row.gender ?? ""));
		const roles = p(rows.map((row) => row.role ?? ""));
		const scope = memberCreateScope(user, p);
		const result = await query(
			`INSERT INTO members (team_id, full_name, email, phone, gender, role)
			 SELECT t.id, v.full_name, v.email, NULLIF(v.phone, ''), NULLIF(v.gender, ''),
				NULLIF(v.role, '')
			 FROM teams t,
				unnest(${fullNames}::text[], ${emails}::text[], ${phones}::text[],
					${genders}::text[], ${roles}::text[])
					AS v(full_name, email, phone, gender, role)
			 WHERE t.id = ${teamIdParam}::uuid AND (${scope})
			 RETURNING id`,
			params,
		);
		return result.rows.length;
	},

	async deleteByTeam(user: ActingUser, teamId: string): Promise<number> {
		if (!isUuid(teamId)) return 0;
		const { params, p } = paramList();
		const teamIdParam = p(teamId);
		const scope = memberWriteScope(user, p);
		const result = await query(
			`DELETE FROM members m USING teams t
			 WHERE m.team_id = ${teamIdParam}::uuid AND t.id = m.team_id AND (${scope})
			 RETURNING m.id`,
			params,
		);
		return result.rows.length;
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
			const current = await query<MemberRow>(
				`SELECT ${MEMBER_SELECT} ${MEMBER_FROM} WHERE m.id = ${idParam} AND (${scope}) LIMIT 1`,
				params,
			);
			const row = current.rows[0];
			return row ? toMemberRecord(row) : null;
		}

		const idParam = p(id);
		const scope = memberWriteScope(user, p);
		const result = await query<MemberRow>(
			`UPDATE members m SET ${sets.join(", ")}
			 FROM teams t
			 WHERE m.id = ${idParam} AND t.id = m.team_id AND (${scope})
			 RETURNING m.id, m.team_id, m.full_name, m.email, m.phone, m.gender, m.role,
				m.created_at, m.updated_at`,
			params,
		);
		const row = result.rows[0];
		return row ? toMemberRecord(row) : null;
	},

	async delete(user: ActingUser, id: string): Promise<boolean> {
		if (!isUuid(id)) return false;
		const { params, p } = paramList();
		const idParam = p(id);
		const scope = memberWriteScope(user, p);
		const result = await query(
			`DELETE FROM members m USING teams t
			 WHERE m.id = ${idParam} AND t.id = m.team_id AND (${scope})
			 RETURNING m.id`,
			params,
		);
		return result.rows.length > 0;
	},
};

// ---------------------------------------------------------------------------
// questionnaire_responses repository
// ---------------------------------------------------------------------------

interface QuestionnaireRow extends QueryResultRow {
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
	created_at: Date;
	updated_at: Date;
}

const QUESTIONNAIRE_SELECT = `
	q.id, q.team_id, q.user_id, q.age, q.gender, q.education, q.college_name, q.district,
	q.skills, q.interests, q.challenges, q.experience, q.motivation, q.team_experience,
	q.expectations, q.additional_info, q.year_of_graduation, q.created_at, q.updated_at`;

const QUESTIONNAIRE_FROM = `
	FROM questionnaire_responses q
	JOIN teams t ON t.id = q.team_id`;

/**
 * `questionnaire_responses` row → record.
 *
 * The answer columns are free-form (`[field: string]: unknown` in
 * `types.ts`), so the mapper is generic: snake → camel, dates → ISO, and
 * unset text → `""` / unset number → `0`, matching the old backend's defaults.
 */
function toQuestionnaireRecord(row: QuestionnaireRow): QuestionnaireResponseRecord {
	const record: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(row)) {
		const name = toCamelCase(key);
		if (value instanceof Date) {
			record[name] = value.toISOString();
		} else if (name === "age") {
			record[name] = value ?? 0;
		} else {
			record[name] = value ?? "";
		}
	}
	return record as QuestionnaireResponseRecord;
}

/** §6.2 questionnaire list/view: admin ∨ coordinator ∨ (institution ∧ own inst) ∨ own response. */
function questionnaireScope(user: ActingUser, p: ParamList["p"]): string {
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
		const result = await query<QuestionnaireRow>(
			`SELECT ${QUESTIONNAIRE_SELECT} ${QUESTIONNAIRE_FROM}
			 WHERE q.team_id = ${teamParam} AND (${scope})
			 ORDER BY q.created_at DESC
			 LIMIT 1`,
			params,
		);
		const row = result.rows[0];
		return row ? toQuestionnaireRecord(row) : null;
	},

	async create(
		user: ActingUser,
		input: QuestionnaireResponseInput,
	): Promise<QuestionnaireResponseRecord | null> {
		if (!isUuid(input.teamId) || !isUuid(input.userId)) return null;

		const { params, p } = paramList();
		const teamId = p(input.teamId);
		const userId = p(input.userId);
		const values = QUESTIONNAIRE_FIELDS.map(([key]) => {
			const value = input[key];
			if (key === "age") return `${p(value ?? 0)}::double precision`;
			return `NULLIF(${p(typeof value === "string" ? value : "")}, '')`;
		});

		// §6.2 questionnaire create: admin ∨ (institution ∧ own inst) ∨
		// (lead ∧ own team ∧ userId = self).
		const actorRole = p(user.role);
		const actorInstitution = p(user.institutionId);
		const actorId = p(user.id);
		const scope = [
			`${actorRole}::text = 'admin'`,
			`(${actorRole}::text = 'institution' AND NULLIF(${actorInstitution}, '')::uuid = t.institution_id)`,
			`(${actorRole}::text = 'lead' AND t.leader_user_id = ${actorId}::uuid AND ${userId}::uuid = ${actorId}::uuid)`,
		].join(" OR ");

		const columns = QUESTIONNAIRE_FIELDS.map(([, column]) => column).join(", ");
		const result = await query<QuestionnaireRow>(
			`INSERT INTO questionnaire_responses (team_id, user_id, ${columns})
			 SELECT t.id, ${userId}::uuid, ${values.join(", ")}
			 FROM teams t
			 WHERE t.id = ${teamId}::uuid AND (${scope})
			 RETURNING id, team_id, user_id, ${columns}, created_at, updated_at`,
			params,
		);
		const row = result.rows[0];
		return row ? toQuestionnaireRecord(row) : null;
	},

	async upsert(
		user: ActingUser,
		input: QuestionnaireResponseInput,
	): Promise<QuestionnaireResponseRecord | null> {
		if (!isUuid(input.teamId) || !isUuid(input.userId)) return null;

		const { params, p } = paramList();
		const teamId = p(input.teamId);
		const userId = p(input.userId);
		const values = QUESTIONNAIRE_FIELDS.map(([key]) => {
			const value = input[key];
			if (key === "age") return `${p(value ?? 0)}::double precision`;
			return `NULLIF(${p(typeof value === "string" ? value : "")}, '')`;
		});

		const actorRole = p(user.role);
		const actorInstitution = p(user.institutionId);
		const actorId = p(user.id);
		const scope = [
			`${actorRole}::text = 'admin'`,
			`(${actorRole}::text = 'institution' AND NULLIF(${actorInstitution}, '')::uuid = t.institution_id)`,
			`(${actorRole}::text = 'lead' AND t.leader_user_id = ${actorId}::uuid AND ${userId}::uuid = ${actorId}::uuid)`,
		].join(" OR ");

		const columns = QUESTIONNAIRE_FIELDS.map(([, column]) => column);
		const assignments = columns.map((column) => `${column} = EXCLUDED.${column}`).join(", ");
		const result = await query<QuestionnaireRow>(
			`INSERT INTO questionnaire_responses (team_id, user_id, ${columns.join(", ")})
			 SELECT t.id, ${userId}::uuid, ${values.join(", ")}
			 FROM teams t
			 WHERE t.id = ${teamId}::uuid AND (${scope})
			 ON CONFLICT (team_id) DO UPDATE SET ${assignments}
			 RETURNING id, team_id, user_id, ${columns.join(", ")}, created_at, updated_at`,
			params,
		);
		const row = result.rows[0];
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
				sets.push(`${column} = ${p(value)}::double precision`);
			} else {
				sets.push(`${column} = NULLIF(${p(value)}, '')`);
			}
		}

		if (sets.length === 0) {
			const idParam = p(id);
			const scope = questionnaireScope(user, p);
			const current = await query<QuestionnaireRow>(
				`SELECT ${QUESTIONNAIRE_SELECT} ${QUESTIONNAIRE_FROM}
				 WHERE q.id = ${idParam} AND (${scope}) LIMIT 1`,
				params,
			);
			const row = current.rows[0];
			return row ? toQuestionnaireRecord(row) : null;
		}

		const idParam = p(id);
		const scope = questionnaireWriteScope(user, p);
		const result = await query<QuestionnaireRow>(
			`UPDATE questionnaire_responses q SET ${sets.join(", ")}
			 FROM teams t
			 WHERE q.id = ${idParam} AND t.id = q.team_id AND (${scope})
			 RETURNING ${QUESTIONNAIRE_SELECT}`,
			params,
		);
		const row = result.rows[0];
		return row ? toQuestionnaireRecord(row) : null;
	},

	async delete(user: ActingUser, id: string): Promise<boolean> {
		if (!isUuid(id)) return false;
		const { params, p } = paramList();
		const idParam = p(id);
		const actorRole = p(user.role);
		const result = await query(
			`DELETE FROM questionnaire_responses
			 WHERE id = ${idParam} AND ${actorRole}::text = 'admin'
			 RETURNING id`,
			params,
		);
		return result.rows.length > 0;
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

interface StatusTransitionRow extends QueryResultRow {
	id: string;
	team_id: string;
	actor_user_id: string;
	from_status: string;
	to_status: string;
	role: Role;
	at: Date;
	created_at: Date;
	updated_at: Date;
}

const STATUS_TRANSITION_SELECT = `
	s.id, s.team_id, s.actor_user_id, s.from_status, s.to_status, s.role, s.at,
	s.created_at, s.updated_at`;

function toStatusTransitionRecord(row: StatusTransitionRow): StatusTransitionRecord {
	return {
		id: row.id,
		teamId: row.team_id,
		actorUserId: row.actor_user_id,
		fromStatus: row.from_status,
		toStatus: row.to_status,
		role: row.role,
		at: row.at.toISOString(),
		created: row.created_at.toISOString(),
		updated: row.updated_at.toISOString(),
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
		const teamId = p(input.teamId);
		const actorUserId = p(user.id);
		const fromStatus = p(input.fromStatus);
		const toStatus = p(input.toStatus);
		const role = p(user.role);
		const at = p(input.at ?? new Date().toISOString());

		// §6.2: an audit row may only be appended for a team the actor can
		// already see, so a forged team id cannot create one.
		const scope = teamScope(user, p);
		const result = await query<StatusTransitionRow>(
			`INSERT INTO status_transitions (team_id, actor_user_id, from_status, to_status, role, at)
			 SELECT t.id, ${actorUserId}::uuid, ${fromStatus}, ${toStatus}, ${role},
				${at}::timestamptz
			 FROM teams t
			 WHERE t.id = ${teamId}::uuid AND (${scope})
			 RETURNING ${STATUS_TRANSITION_SELECT}`,
			params,
		);
		const row = result.rows[0];
		return row ? toStatusTransitionRecord(row) : null;
	},
};

// ---------------------------------------------------------------------------
// config repository
// ---------------------------------------------------------------------------

interface ConfigRow extends QueryResultRow {
	id: string;
	key: string;
	value: boolean;
	created_at: Date;
	updated_at: Date;
}

const CONFIG_SELECT = "id, key, value, created_at, updated_at";

function toConfigRecord(row: ConfigRow): ConfigRecord {
	return {
		id: row.id,
		key: row.key,
		value: row.value === true,
		created: row.created_at.toISOString(),
		updated: row.updated_at.toISOString(),
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
		const result = await query<ConfigRow>(
			`SELECT ${CONFIG_SELECT} FROM config WHERE key = $1 LIMIT 1`,
			[key],
		);
		const row = result.rows[0];
		return row ? toConfigRecord(row) : null;
	},

	async upsert(user: ActingUser, key: string, value: boolean): Promise<ConfigRecord | null> {
		if (!isFlagKey(key)) return null;
		const { params, p } = paramList();
		const keyParam = p(key);
		const valueParam = p(value);
		const actorRole = p(user.role);
		const result = await query<ConfigRow>(
			`INSERT INTO config (key, value)
			 SELECT ${keyParam}, ${valueParam}::boolean
			 WHERE ${actorRole}::text = 'admin'
			 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
			 RETURNING ${CONFIG_SELECT}`,
			params,
		);
		const row = result.rows[0];
		return row ? toConfigRecord(row) : null;
	},

	async toggle(user: ActingUser, key: string): Promise<ConfigRecord | null> {
		if (!isFlagKey(key)) return null;
		const { params, p } = paramList();
		const keyParam = p(key);
		const actorRole = p(user.role);
		const result = await query<ConfigRow>(
			`UPDATE config SET value = NOT value
			 WHERE key = ${keyParam} AND ${actorRole}::text = 'admin'
			 RETURNING ${CONFIG_SELECT}`,
			params,
		);
		const row = result.rows[0];
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
