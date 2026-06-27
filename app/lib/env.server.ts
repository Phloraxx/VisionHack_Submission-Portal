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

export interface EnvConfig {
	POCKETBASE_URL: string;
	ALLOWED_ORIGINS?: string;
	/** Sentry DSN for error tracking. Set in production to enable. */
	SENTRY_DSN?: string;
	/** Public base URL of the app, used in outbound email links. */
	APP_URL?: string;
	/** Resend API key for transactional email. Leave unset for local dev (emails are skipped). */
	RESEND_API_KEY?: string;
}

let envCache: EnvConfig | null = null;

export function getEnv(): EnvConfig {
	if (envCache) return envCache;
	const pbUrl = process.env.POCKETBASE_URL ?? "";
	if (!pbUrl) {
		throw new Error("POCKETBASE_URL is not set. Check your .env file.");
	}

	const config: EnvConfig = {
		POCKETBASE_URL: pbUrl,
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
