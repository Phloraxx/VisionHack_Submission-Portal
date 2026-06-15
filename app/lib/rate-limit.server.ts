/**
 * In-memory rate limiter for Cloudflare Workers.
 *
 * Uses a sliding-window approach: tracks request timestamps per key (IP)
 * and rejects when the count exceeds the limit within the window.
 *
 * For production scale, consider Cloudflare's built-in Rate Limiting
 * (WAF → Rate Limiting Rules) or a distributed store (Durable Objects).
 * This in-memory implementation is sufficient for MVP traffic and
 * resets on cold start / isolate rotation.
 */

interface RateLimitEntry {
  timestamps: number[];
}

// Shared across requests within a single Worker isolate.
// Resets on cold start / isolate rotation (acceptable for MVP).
const store = new Map<string, RateLimitEntry>();

/**
 * Check whether a request should be rate-limited.
 *
 * @param key     Unique identifier (typically the client IP).
 * @param limit   Maximum number of requests allowed in the window.
 * @param windowMs  Time window in milliseconds.
 * @returns `true` if the request is allowed, `false` if it should be blocked.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry) {
    store.set(key, { timestamps: [now] });
    return true;
  }

  // Prune timestamps outside the window
  const windowStart = now - windowMs;
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= limit) {
    return false; // rate limited
  }

  entry.timestamps.push(now);
  return true;
}

/**
 * Extract the client IP from a Request.
 *
 * On Cloudflare Workers, the `CF-Connecting-IP` header is the most reliable
 * source. Falls back to `X-Forwarded-For` and then the socket address.
 */
export function getClientIP(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf) return cf;

  const xff = request.headers.get("X-Forwarded-For");
  if (xff) return xff.split(",")[0].trim();

  // Last resort — in local dev this is often "127.0.0.1"
  // which means all local requests share the same bucket.
  return "127.0.0.1";
}

// ---------------------------------------------------------------------------
// Pre-configured limiters for specific endpoints
// ---------------------------------------------------------------------------

/** Login: 10 attempts per minute per IP */
export function checkLoginRateLimit(request: Request): boolean {
  return checkRateLimit(`login:${getClientIP(request)}`, 10, 60_000);
}

/** Forgot password: 3 requests per minute per IP */
export function checkForgotPasswordRateLimit(request: Request): boolean {
  return checkRateLimit(`forgot:${getClientIP(request)}`, 3, 60_000);
}

/** Logout / general mutations: 30 per minute per IP */
export function checkMutationRateLimit(request: Request): boolean {
  return checkRateLimit(`mutation:${getClientIP(request)}`, 30, 60_000);
}

// ---------------------------------------------------------------------------
// Periodic cleanup — prevent unbounded memory growth
// ---------------------------------------------------------------------------

// Run cleanup every 5 minutes, removing entries older than 10 minutes.
const CLEANUP_INTERVAL_MS = 5 * 60_000;
const MAX_AGE_MS = 10 * 60_000;

let cleanupScheduled = false;

function scheduleCleanup(): void {
  if (cleanupScheduled) return;
  cleanupScheduled = true;

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => t > now - MAX_AGE_MS);
      if (entry.timestamps.length === 0) {
        store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Allow the interval to be garbage-collected if the isolate is evicted.
  if (typeof globalThis !== "undefined") {
    // Cloudflare Workers: setInterval is safe; it's cleared on isolate teardown.
  }
}

scheduleCleanup();
