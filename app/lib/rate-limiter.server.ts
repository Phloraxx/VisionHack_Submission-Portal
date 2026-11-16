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

/**
 * Hard cap on tracked keys. Per-email keys are attacker-controlled, so the
 * store must not grow without bound between purges.
 */
const MAX_ENTRIES = 10_000;

/** Drop expired entries; returns the number removed. */
function purgeExpired(now: number): number {
	let removed = 0;
	for (const [key, entry] of store) {
		if (now >= entry.resetAt) {
			store.delete(key);
			removed++;
		}
	}
	return removed;
}

// Periodically purge stale entries to prevent memory leak (runs every 5 min)
setInterval(() => purgeExpired(Date.now()), 300_000).unref();

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
				headers: { "Retry-After": String(Math.ceil((entry.resetAt - Date.now()) / 1000)) },
			});
		}
		entry.count++;
		return;
	}

	if (store.size >= MAX_ENTRIES) {
		purgeExpired(now);
		// Still full: evict the oldest key (Map preserves insertion order).
		while (store.size >= MAX_ENTRIES) {
			const oldest = store.keys().next().value;
			if (oldest === undefined) break;
			store.delete(oldest);
		}
	}
	store.set(key, { count: 1, resetAt: now + windowMs });
}

/**
 * Forget one bucket.
 *
 * Used after a successful login so the per-account limit only counts failed
 * attempts — otherwise five sign-ins in a minute would trip it.
 */
export function resetRateLimit(key: string): void {
	store.delete(key);
}

/** Clear the store — used by tests to isolate cases. */
export function _resetStore(): void {
	store.clear();
}
