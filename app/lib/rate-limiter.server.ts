/**
 * Simple in-memory rate limiter.
 *
 * ARCHITECTURE NOTE: Not shared across server processes. Suitable for
 * single-instance deployments (current setup). If the app scales to
 * multiple containers or PM2 cluster mode, each instance has its own
 * counter — effective limit becomes N × maxAttempts.
 *
 * For multi-instance: replace this module's store with a Redis-backed
 * implementation (e.g., using ioredis + INCR/EXPIRE). The `checkRateLimit`
 * interface remains the same.
 */

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Periodically purge stale entries to prevent memory leak (runs every 5 min)
if (typeof setInterval !== "undefined") {
	setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of store) {
			if (now >= entry.resetAt) store.delete(key);
		}
	}, 300_000).unref();
}

/**
 * Check and increment a rate limit.
 * Throws a 429 Response when the limit is exceeded.
 */
export function checkRateLimit(key: string, maxAttempts: number, windowMs: number): void {
	const now = Date.now();
	const entry = store.get(key);

	if (entry && now < entry.resetAt) {
		if (entry.count >= maxAttempts) {
			throw new Response("Too many attempts. Please try again later.", {
				status: 429,
			});
		}
		entry.count++;
	} else {
		store.set(key, { count: 1, resetAt: now + windowMs });
	}
}

/** Export store for testing */
export function _resetStore(): void {
	store.clear();
}
