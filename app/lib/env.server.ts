/**
 * Environment configuration — reads from `process.env`.
 *
 * In Node.js, `process.env` is available at module load time after
 * `dotenv.config()` has been called at server boot. There is no need for
 * an explicit `initEnv()` call; `getEnv()` reads directly from process.env.
 *
 * Backward-compatible no-op exports of `initEnv` and `resetEnv` are kept
 * so that existing imports (including tests) continue to compile.
 */

export interface EnvConfig {
  POCKETBASE_URL: string;
  POCKETBASE_SUPER_TOKEN: string;
  ALLOWED_ORIGINS?: string;
  /** Public base URL of the app, used in outbound email links. */
  APP_URL?: string;
  /** Resend API key for transactional email. Leave unset for local dev (emails are skipped). */
  RESEND_API_KEY?: string;
}



export function getEnv(): EnvConfig {
  const pbUrl = process.env.POCKETBASE_URL ?? "";
  if (!pbUrl) {
    throw new Error(
      "POCKETBASE_URL is not set. Check your .env file.",
    );
  }

  // Warn if PocketBase is accessed over plain HTTP in production.
  // Ideally PocketBase should be behind a reverse proxy with TLS
  // (nginx + Let's Encrypt) or Cloudflare Tunnel.
  const isDev = process.env.NODE_ENV !== "production";
  if (pbUrl && !isDev && !pbUrl.startsWith("https://")) {
    console.warn(
      "[env] \u26a0\ufe0f  POCKETBASE_URL is using plain HTTP. " +
      "Traffic between the server and PocketBase is not encrypted. " +
      "Consider enabling TLS when available.",
    );
  }

  return {
    POCKETBASE_URL: pbUrl,
    POCKETBASE_SUPER_TOKEN: process.env.POCKETBASE_SUPER_TOKEN ?? "",
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    APP_URL: process.env.APP_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };
}

/**
 * Public base URL of the app (no trailing slash). Falls back to the
 * production domain when APP_URL is not configured.
 */
export function getAppUrl(): string {
  const raw = getEnv().APP_URL || "https://visionhack.mulearn.org";
  return raw.replace(/\/+$/, "");
}

/**
 * @deprecated No-op kept for backward compatibility.
 * Environment is now read from `process.env` directly.
 */
export function initEnv(_overrides?: Partial<EnvConfig>): void {
  // no-op
}


/**
 * @deprecated No-op kept for backward compatibility.
 * Environment is now read from `process.env` directly.
 */
export function resetEnv(): void {
  // no-op
}
