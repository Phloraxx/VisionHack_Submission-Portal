/**
 * PostgreSQL access layer.
 *
 * Replaces `app/lib/pocketbase.server.ts` for the ported surface. The pool is a
 * process-wide singleton guarded on `globalThis` so Vite HMR (and React Router
 * dev restarts) do not leak connections.
 *
 * Conventions
 * -----------
 * - Columns are snake_case (see `postgres/schema.sql`); the mappers here turn
 *   rows into the camelCase record shapes in `app/lib/types.ts`, so route code
 *   keeps reading `user.institutionId`, `team.created`, and so on.
 * - Every query is parameterised. No string interpolation of user input.
 * - `statement_timeout` is 20 s, matching the old PocketBase `fetch` timeout.
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { getEnv } from "./env.server";
import type { Role, UserRecord } from "./types";

/** Matches the 20 s timeout the PocketBase client applied to every request. */
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

/** Run a parameterised query on the shared pool. */
export function query<T extends QueryResultRow = QueryResultRow>(
	text: string,
	params: unknown[] = [],
): Promise<QueryResult<T>> {
	return getPool().query<T>(text, params);
}

/**
 * Run `fn` inside a transaction on a dedicated client.
 *
 * Commits when `fn` resolves, rolls back when it throws, and always releases
 * the client back to the pool.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
	const client = await getPool().connect();
	try {
		await client.query("BEGIN");
		const result = await fn(client);
		await client.query("COMMIT");
		return result;
	} catch (err) {
		try {
			await client.query("ROLLBACK");
		} catch (rollbackErr) {
			console.error("[db] Rollback failed", rollbackErr);
		}
		throw err;
	} finally {
		client.release();
	}
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

/** `institution_id` → `institutionId`. */
export function toCamelCase(key: string): string {
	return key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

/** Map one row's column names to camelCase, leaving values untouched. */
export function mapRow<T>(row: QueryResultRow): T {
	const mapped: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(row)) {
		mapped[toCamelCase(key)] = value;
	}
	return mapped as T;
}

/** Map a result set's column names to camelCase. */
export function mapRows<T>(rows: QueryResultRow[]): T[] {
	return rows.map((row) => mapRow<T>(row));
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `users` row → `UserRecord`.
 *
 * PocketBase returned `""` for an unset relation and ISO strings for the
 * autodate fields; both are preserved so components keep their existing
 * truthiness checks.
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

export interface UsersRepository {
	/** Look up by email (case-insensitive) including the password hash. */
	findByEmail(email: string): Promise<UserAuthRow | null>;
	/** Load the live record used by `resolveAuth` — no password hash. */
	findById(id: string): Promise<UserRecord | null>;
	/** Current hash, for the password-reset fingerprint check. */
	findPasswordHashById(id: string): Promise<string | null>;
	/** Write a new hash (bcrypt → argon2id upgrade, or a completed reset). */
	updatePasswordHash(id: string, passwordHash: string): Promise<void>;
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
		if (!UUID_RE.test(id)) return null;
		const result = await query<UserDbRow>(
			`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
			[id],
		);
		const row = result.rows[0];
		return row ? toUserRecord(row) : null;
	},

	async findPasswordHashById(id: string): Promise<string | null> {
		if (!UUID_RE.test(id)) return null;
		const result = await query<{ password_hash: string }>(
			"SELECT password_hash FROM users WHERE id = $1 LIMIT 1",
			[id],
		);
		return result.rows[0]?.password_hash ?? null;
	},

	async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
		if (!UUID_RE.test(id)) return;
		await query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, passwordHash]);
	},
};

// ---------------------------------------------------------------------------
// Per-request context handle
// ---------------------------------------------------------------------------

/**
 * The database handle handed to loaders and actions as `ctx.db`.
 *
 * Repositories are added here as their call sites are ported; this pass only
 * needs `users`.
 */
export interface Db {
	query: typeof query;
	withTransaction: typeof withTransaction;
	users: UsersRepository;
}

export const db: Db = { query, withTransaction, users };
