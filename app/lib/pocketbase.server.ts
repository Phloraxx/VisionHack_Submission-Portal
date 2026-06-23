import PocketBase from "pocketbase";
import { getEnv } from "./env.server";

/**
 * Custom fetch wrapper that adds a 20-second timeout.
 * Respects existing AbortSignals (e.g., PocketBase auto-cancellation).
 */
function fetchWithTimeout(
	url: RequestInfo | URL,
	init?: RequestInit,
	timeoutMs = 20000,
): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	const existingSignal = init?.signal;
	if (existingSignal) {
		if (existingSignal.aborted) {
			clearTimeout(timeout);
			return Promise.reject(existingSignal.reason || new DOMException("Aborted", "AbortError"));
		}
		existingSignal.addEventListener("abort", () => controller.abort(existingSignal.reason), {
			once: true,
		});
	}

	return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

/**
 * Create a PocketBase client with a custom fetch that applies a 20-second
 * timeout to every request. Uses the `beforeSend` hook to inject the custom
 * fetch into each request's SendOptions (the SDK reads `options.fetch`).
 */
function createBaseClient(baseURL: string): PocketBase {
	const pb = new PocketBase(baseURL);
	pb.beforeSend = (url, options) => {
		options.fetch = (input: RequestInfo | URL, config?: RequestInit) =>
			fetchWithTimeout(input, config);
		return { url, options };
	};
	return pb;
}

// ---------------------------------------------------------------------------
// PocketBase client factory functions
// ---------------------------------------------------------------------------

/** Create an unauthenticated PocketBase client (public access only). */
export function createPocketBaseClient(): PocketBase {
	return createBaseClient(getEnv().POCKETBASE_URL);
}

/** Create a PocketBase client authenticated with a user's auth token. */
export function createAuthenticatedClient(token: string): PocketBase {
	const pb = createBaseClient(getEnv().POCKETBASE_URL);
	pb.authStore.save(token, null);
	return pb;
}

// ---------------------------------------------------------------------------
// Server-side admin client (singleton, authenticated at boot)
//
// Authenticates against _superusers using POCKETBASE_ADMIN_EMAIL and
// POCKETBASE_ADMIN_PASSWORD from env. The client is lazily initialised
// on first use and auto-refreshes before token expiry.
//
// Use this *only* when the caller's own auth token is insufficient —
// i.e. for the public login page stats, cross-boundary exports, and
// system-level file proxy operations. Most route handlers should use
// the per-request pb from `requireRole()` / `secureAction()` instead.
// ---------------------------------------------------------------------------

let _adminClient: PocketBase | null = null;
let _adminInitPromise: Promise<PocketBase> | null = null;

async function initAdminClient(): Promise<PocketBase> {
	const env = getEnv();
	const pbUrl = env.POCKETBASE_URL;
	const email = env.POCKETBASE_ADMIN_EMAIL;
	const password = env.POCKETBASE_ADMIN_PASSWORD;

	if (!email || !password) {
		throw new Error("POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD must be set");
	}

	const pb = createBaseClient(pbUrl);
	// Disable auto-cancellation — this client handles concurrent requests.
	pb.autoCancellation(false);

	await pb.collection("_superusers").authWithPassword(email, password, {
		// Auto-refresh when the token is within 30 minutes of expiry.
		autoRefreshThreshold: 30 * 60,
	});

	return pb;
}

/**
 * Get (or lazily create) the server-side admin PocketBase client.
 *
 * The client authenticates once at boot using the admin credentials from
 * env, then auto-refreshes the token before expiry. Safe to call from
 * any server-side context.
 *
 * @example
 * const pb = await getAdminClient();
 * const teams = await pb.collection("teams").getList(...);
 */
export async function getAdminClient(): Promise<PocketBase> {
	if (_adminClient?.authStore?.isValid) {
		return _adminClient;
	}

	// Deduplicate concurrent initialisation.
	if (_adminInitPromise) {
		return _adminInitPromise;
	}

	_adminInitPromise = initAdminClient()
		.then((pb) => {
			_adminClient = pb;
			_adminInitPromise = null;
			return pb;
		})
		.catch((err) => {
			// Clear both the promise AND the cached client so the next
			// caller retries from scratch (the client may be half-initialized).
			_adminClient = null;
			_adminInitPromise = null;
			throw err;
		});

	return _adminInitPromise;
}

/**
 * For testing only — reset the cached admin client so the next
 * `getAdminClient()` call re-authenticates.
 */
export function resetAdminClient(): void {
	if (process.env.NODE_ENV !== "test") {
		if (process.env.NODE_ENV === "production") {
			throw new Error("resetAdminClient is not available in production");
		}
		console.warn("[pocketbase] resetAdminClient should only be called in tests");
		return;
	}
	_adminClient = null;
	_adminInitPromise = null;
}
