/**
 * Environment configuration — reads from `process.env`.
 *
 * In Node.js, `process.env` is available at module load time after
 * `dotenv.config()` has been called at server boot. There is no need for
 * an explicit `initEnv()` call; `getEnv()` reads directly from process.env.
 *
 * `getEnv()` is called once from `server.ts` before `listen`, so a missing or
 * invalid variable fails the process at boot rather than inside the first
 * request.
 */

/** Minimum length of `APP_JWT_SECRET`, in bytes. */
export const MIN_JWT_SECRET_BYTES = 32;

export interface EnvConfig {
	/**
	 * Path to the SQLite database file, e.g. `./data/portal.db`.
	 *
	 * `:memory:` opens a private in-memory database, which is what the unit
	 * tests use. The parent directory is created on first connection.
	 */
	SQLITE_PATH: string;
	/** HS256 signing key for session and password-reset tokens. At least 32 bytes. */
	APP_JWT_SECRET: string;
	/** Root of the submission-file volume. */
	UPLOADS_DIR: string;
	/** Comma-separated allowed `Origin` values. Required in production. */
	ALLOWED_ORIGINS?: string;
	/** Sentry DSN for error tracking. Set in production to enable. */
	SENTRY_DSN?: string;
	/** Public base URL of the app, used in outbound email links. Required in production. */
	APP_URL?: string;
	/** Resend API key for transactional email. Leave unset for local dev (emails are skipped). */
	RESEND_API_KEY?: string;
	/** Trust `CF-Connecting-IP` / `X-Forwarded-For` / `x-real-ip`. Required in production. */
	TRUST_PROXY_HEADERS: boolean;
	/** HTTP port. */
	PORT: number;
	/** `development` | `production` | `test`. */
	NODE_ENV: string;
}

let envCache: EnvConfig | null = null;

/** Read a required variable, failing fast with the same message shape as before. */
function requireEnv(name: string): string {
	const value = process.env[name] ?? "";
	if (!value) {
		throw new Error(`${name} is not set. Check your .env file.`);
	}
	return value;
}

/**
 * Validate `APP_JWT_SECRET` at boot.
 *
 * A missing or short secret would otherwise sign every session with a
 * guessable key, so this fails the process instead of degrading silently.
 */
function requireJwtSecret(): string {
	const secret = requireEnv("APP_JWT_SECRET");
	const bytes = Buffer.byteLength(secret, "utf8");
	if (bytes < MIN_JWT_SECRET_BYTES) {
		throw new Error(
			`APP_JWT_SECRET must be at least ${MIN_JWT_SECRET_BYTES} bytes (got ${bytes}). Generate one with: openssl rand -base64 48`,
		);
	}
	return secret;
}

export function getEnv(): EnvConfig {
	if (envCache) return envCache;

	const nodeEnv = process.env.NODE_ENV ?? "development";
	const isProduction = nodeEnv === "production";

	// Both are load-bearing in production: without APP_URL every reset link
	// points at the wrong host, and without ALLOWED_ORIGINS every same-origin
	// POST is rejected with a 403. Fail at boot instead of at the first user.
	if (isProduction) {
		requireEnv("APP_URL");
		requireEnv("ALLOWED_ORIGINS");
	}

	const rawPort = Number(process.env.PORT ?? 3000);

	const config: EnvConfig = {
		SQLITE_PATH: process.env.SQLITE_PATH || "./data/portal.db",
		APP_JWT_SECRET: requireJwtSecret(),
		UPLOADS_DIR: requireEnv("UPLOADS_DIR"),
		ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
		APP_URL: process.env.APP_URL,
		RESEND_API_KEY: process.env.RESEND_API_KEY,
		SENTRY_DSN: process.env.SENTRY_DSN,
		TRUST_PROXY_HEADERS: process.env.TRUST_PROXY_HEADERS === "1",
		PORT: Number.isFinite(rawPort) ? rawPort : 3000,
		NODE_ENV: nodeEnv,
	};

	envCache = config;
	return config;
}

/** Public base URL of the app (no trailing slash). Required in production. */
export function getAppUrl(): string {
	const raw = getEnv().APP_URL || "http://localhost:5173";
	return raw.replace(/\/+$/, "");
}

/** Reset the cached env config — used in tests to isolate process.env changes. */
export function resetEnvCache(): void {
	envCache = null;
}
