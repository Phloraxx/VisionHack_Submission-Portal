/**
 * Environment configuration — reads from `process.env`.
 *
 * In Node.js, `process.env` is available at module load time after
 * `dotenv.config()` has been called at server boot. There is no need for
 * an explicit `initEnv()` call; `getEnv()` reads directly from process.env.
 *
 * Backward-compatible no-op exports of `initEnv` and `resetEnv` were removed.
 * Call `getEnv()` directly.
 */
// initEnv and resetEnv were previously exported as no-ops for backward compatibility.
// They have been removed. Call getEnv() directly.

/** Minimum length of `APP_JWT_SECRET`, in bytes (docs/PG_PORT_PLAN.md §7.2). */
export const MIN_JWT_SECRET_BYTES = 32;

export interface EnvConfig {
	/** PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/db?sslmode=disable`. */
	DATABASE_URL: string;
	/** HS256 signing key for session and password-reset tokens. At least 32 bytes. */
	APP_JWT_SECRET: string;
	/** Root of the submission-file volume. */
	UPLOADS_DIR: string;
	ALLOWED_ORIGINS?: string;
	/** Sentry DSN for error tracking. Set in production to enable. */
	SENTRY_DSN?: string;
	/** Public base URL of the app, used in outbound email links. */
	APP_URL?: string;
	/** Resend API key for transactional email. Leave unset for local dev (emails are skipped). */
	RESEND_API_KEY?: string;
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

	const config: EnvConfig = {
		DATABASE_URL: requireEnv("DATABASE_URL"),
		APP_JWT_SECRET: requireJwtSecret(),
		UPLOADS_DIR: requireEnv("UPLOADS_DIR"),
		ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
		APP_URL: process.env.APP_URL,
		RESEND_API_KEY: process.env.RESEND_API_KEY,
		SENTRY_DSN: process.env.SENTRY_DSN,
	};

	envCache = config;
	return config;
}

/**
 * Public base URL of the app (no trailing slash). Falls back to the
 * production domain when APP_URL is not configured.
 */
export function getAppUrl(): string {
	const raw = getEnv().APP_URL || "https://visionhack.mulearn.org";
	return raw.replace(/\/+$/, "");
}

/** Reset the cached env config — used in tests to isolate process.env changes. */
export function resetEnvCache(): void {
	envCache = null;
}
