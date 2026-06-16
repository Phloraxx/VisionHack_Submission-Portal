/**
 * Environment configuration abstraction for both Cloudflare Workers and Node.js scripts.
 *
 * In Cloudflare Workers, environment bindings are only available inside the
 * `fetch()` handler — not at module load time. Call `initEnv(env)` at the
 * start of every request.
 *
 * In Node.js scripts, `getEnv()` falls back to `process.env`.
 *
 * In Vite dev server SSR, env vars come from wrangler.jsonc vars via
 * the Cloudflare Vite plugin (Miniflare). worker/app.ts calls initEnv().
 */

export interface EnvConfig {
  POCKETBASE_URL: string;
  POCKETBASE_SUPER_TOKEN: string;
  ALLOWED_ORIGINS?: string;
  /** Public base URL of the app, used in outbound email links. */
  APP_URL?: string;
}

let _env: EnvConfig | null = null;

function readNodeEnv(): Partial<EnvConfig> {
  if (typeof process !== "undefined" && process.env) {
    return {
      POCKETBASE_URL: process.env.POCKETBASE_URL,
      POCKETBASE_SUPER_TOKEN: process.env.POCKETBASE_SUPER_TOKEN,
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
      APP_URL: process.env.APP_URL,
    };
  }
  return {};
}

function buildEnv(overrides: Partial<EnvConfig>): EnvConfig {
  const nodeEnv = readNodeEnv();
  const pbUrl =
    overrides.POCKETBASE_URL ||
    nodeEnv.POCKETBASE_URL ||
    "";

  // Warn if PocketBase is accessed over plain HTTP in production.
  // Ideally PocketBase should be behind a reverse proxy with TLS
  // (nginx + Let's Encrypt) or Cloudflare Tunnel.
  const isDev =
    typeof import.meta !== "undefined" && import.meta.env?.DEV;
  if (pbUrl && !isDev && !pbUrl.startsWith("https://")) {
    console.warn(
      "[env] ⚠️  POCKETBASE_URL is using plain HTTP. " +
      "Traffic between the Worker and PocketBase is not encrypted. " +
      "Consider enabling TLS when available.",
    );
  }

  return {
    POCKETBASE_URL: pbUrl,
    POCKETBASE_SUPER_TOKEN:
      overrides.POCKETBASE_SUPER_TOKEN ||
      nodeEnv.POCKETBASE_SUPER_TOKEN ||
      "",
    ALLOWED_ORIGINS:
      overrides.ALLOWED_ORIGINS ?? nodeEnv.ALLOWED_ORIGINS,
    APP_URL: overrides.APP_URL ?? nodeEnv.APP_URL,
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
 * Initialize environment configuration from Cloudflare Worker bindings.
 * Call this at the top of every `fetch()` handler.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initEnv(overrides: Partial<EnvConfig>): void {
  if (!_env) {
    _env = buildEnv(overrides);
  }
}

/**
 * Get environment configuration. For Node.js scripts, automatically
 * reads from `process.env` on first call.
 */
export function getEnv(): EnvConfig {
  if (!_env) {
    _env = buildEnv({});
  }
  return _env;
}

/**
 * Reset the cached environment (useful for testing).
 */
export function resetEnv(): void {
  _env = null;
}
