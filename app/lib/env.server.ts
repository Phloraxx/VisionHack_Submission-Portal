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
  POCKETBASE_ADMIN_EMAIL: string;
  POCKETBASE_ADMIN_PASSWORD: string;
  ALLOWED_ORIGINS?: string;
}

let _env: EnvConfig | null = null;

function readNodeEnv(): Partial<EnvConfig> {
  if (typeof process !== "undefined" && process.env) {
    return {
      POCKETBASE_URL: process.env.POCKETBASE_URL,
      POCKETBASE_ADMIN_EMAIL: process.env.POCKETBASE_ADMIN_EMAIL,
      POCKETBASE_ADMIN_PASSWORD: process.env.POCKETBASE_ADMIN_PASSWORD,
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
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

  // In production (non-localhost), PocketBase MUST use HTTPS.
  // Plain HTTP between the Worker and PocketBase exposes all data
  // (including admin credentials and user JWTs) to network interception.
  const isDev =
    typeof import.meta !== "undefined" && import.meta.env?.DEV;
  if (pbUrl && !isDev && !pbUrl.startsWith("https://")) {
    throw new Error(
      "POCKETBASE_URL must use HTTPS in production. " +
      "Plain HTTP exposes all traffic to MITM attacks. " +
      "Put PocketBase behind a reverse proxy with TLS (nginx + Let's Encrypt) " +
      "or use Cloudflare Tunnel.",
    );
  }

  return {
    POCKETBASE_URL: pbUrl,
    POCKETBASE_ADMIN_EMAIL:
      overrides.POCKETBASE_ADMIN_EMAIL ||
      nodeEnv.POCKETBASE_ADMIN_EMAIL ||
      "",
    POCKETBASE_ADMIN_PASSWORD:
      overrides.POCKETBASE_ADMIN_PASSWORD ||
      nodeEnv.POCKETBASE_ADMIN_PASSWORD ||
      "",
    ALLOWED_ORIGINS:
      overrides.ALLOWED_ORIGINS ?? nodeEnv.ALLOWED_ORIGINS,
  };
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
