import { redirect } from "react-router";
import { createAuthenticatedClient, createPocketBaseClient } from "./pocketbase.server";
import { getEnv } from "./env.server";
import { cookieParse } from "pocketbase";
import { decodeJwtPayload, isExpiringSoon } from "./jwt.server";
import type { Role, UserRecord } from "./types";

const COOKIE_NAME = "pb_jwt";
const COOKIE_MAX_AGE = 432000; // 5 days in seconds
const COOKIE_PATH = "/";

// ---------------------------------------------------------------------------
// Per-request auth cache
// ---------------------------------------------------------------------------
//
// React Router 7 runs the layout loader and every child loader in
// parallel, and each previously called `authRefresh()` independently —
// 2+ network round-trips to PocketBase per navigation, plus a token-
// rotation race. We dedupe by caching the in-flight auth promise keyed by
// the Request object for the lifetime of that request. A WeakMap means
// entries are GC'd once the request is done; nothing leaks across users.

const authCache = new WeakMap<Request, Promise<AuthResult>>();

/** Map of role → default dashboard path */
export const ROLE_DASHBOARD_MAP: Record<Role, string> = {
	admin: "/admin/dashboard",
	coordinator: "/coordinator/dashboard",
	institution: "/institution/dashboard",
	lead: "/lead/dashboard",
};

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Extract the `pb_jwt` token from the request's Cookie header.
 * Returns `null` when no token is present.
 */
export function getAuthFromCookie(request: Request): string | null {
	const cookies = cookieParse(request.headers.get("Cookie") || "");
	return cookies[COOKIE_NAME] ?? null;
}

/**
 * Build a `Set-Cookie` header value that stores the given JWT.
 *
 * ```ts
 * headers.append("Set-Cookie", setAuthCookie(token));
 * ```
 */
export function setAuthCookie(token: string): string {
	const secure = process.env.NODE_ENV === "production";
	return [
		`${COOKIE_NAME}=${token}`,
		"HttpOnly",
		...(secure ? ["Secure"] : []),
		"SameSite=Strict",
		`Path=${COOKIE_PATH}`,
		`Max-Age=${COOKIE_MAX_AGE}`,
	].join("; ");
}

/**
 * Build a `Set-Cookie` header value that clears the auth cookie
 * (immediate expiry).
 */
export function clearAuthCookie(): string {
	const secure = process.env.NODE_ENV === "production";
	return [
		`${COOKIE_NAME}=`,
		"HttpOnly",
		...(secure ? ["Secure"] : []),
		"SameSite=Strict",
		`Path=${COOKIE_PATH}`,
		"Max-Age=0",
	].join("; ");
}

// ---------------------------------------------------------------------------
// Auth actions
// ---------------------------------------------------------------------------

/**
 * Authenticate a user with email and password against PocketBase.
 *
 * Returns the JWT token and the user record. Callers should pass the token
 * to `setAuthCookie()` and include it in the response headers.
 *
 * Throws a PocketBase `ClientResponseError` on invalid credentials.
 * Callers must catch this and return a user-friendly error message.
 */
export async function login(
	email: string,
	password: string,
): Promise<{ token: string; record: UserRecord }> {
	const pb = createPocketBaseClient();
	const authData = await pb.collection("users").authWithPassword(email, password);

	return {
		token: authData.token,
		record: authData.record as unknown as UserRecord,
	};
}

// ---------------------------------------------------------------------------
// Request guards (use in layout / route loaders)
// ---------------------------------------------------------------------------

/**
 * Result returned by `requireAuth` and `requireRole`.
 * Always includes the (possibly refreshed) token so callers can
 * update the cookie when the token is rotated.
 */
export interface AuthResult {
	pb: ReturnType<typeof createAuthenticatedClient>;
	user: UserRecord;
	token: string;
}

/**
 * Require a valid authenticated session.
 *
 * 1. Reads the `pb_jwt` cookie from the request.
 * 2. If missing/malformed → **throws** `redirect("/login")`.
 * 3. Validates the JWT expiry locally. If healthy, loads the user record
 *    with a single `getOne`. If near expiry, calls `authRefresh()` to
 *    validate against PocketBase and rotate the token.
 * 4. If validation fails → **throws** `redirect("/login")`.
 * 5. Returns the PocketBase instance, the user record, and the (possibly
 *    refreshed) token so callers can issue a new cookie if needed.
 *
 * The result is cached per `Request` (WeakMap), so the layout loader and
 * all child loaders share one PocketBase call instead of each making their
 * own — eliminating the previous 2+ round-trips per navigation.
 *
 * **Important:** React Router 7 layout loaders run in parallel with child
 * loaders, so you must `throw redirect()` (not return it) to stop execution.
 *
 * ```ts
 * // In a layout loader:
 * export async function loader({ request }: LoaderArgs) {
 *   const { pb, user, token } = await requireAuth(request);
 *   // Update cookie if token was refreshed
 *   const headers = new Headers();
 *   const originalToken = getAuthFromCookie(request);
 *   if (token !== originalToken) {
 *     headers.append("Set-Cookie", setAuthCookie(token));
 *   }
 *   return data({ user }, { headers });
 * }
 * ```
 */
export async function requireAuth(request: Request): Promise<AuthResult> {
	// Reuse an in-flight/resolved auth result for this request so the
	// layout loader and child loaders share a single PocketBase call.
	const cached = authCache.get(request);
	if (cached) return cached;

	const promise = resolveAuth(request);
	authCache.set(request, promise);
	// If auth fails (throws redirect), drop the cached rejected promise so a
	// retry within the same request can re-evaluate.
	promise.catch(() => authCache.delete(request));
	return promise;
}

/**
 * The actual auth resolution. Validates the JWT locally (cheap) and only
 * hits PocketBase when:
 *   - the token is near expiry (needs a real `authRefresh` + rotation), or
 *   - we still need the user record (role/institutionId aren't in the JWT).
 *
 * PocketBase JWTs carry only `id`/`collectionId`/`exp` — custom fields
 * like `role` live on the record, so a single `getOne` (or `authRefresh`
 * when rotating) is required to load them. We do that exactly once per
 * request via the cache above.
 */
async function resolveAuth(request: Request): Promise<AuthResult> {
	const token = getAuthFromCookie(request);
	if (!token) throw redirect("/login");

	const payload = decodeJwtPayload(token);
	if (!payload || !payload.id) {
		// Malformed token — treat as unauthenticated.
		throw redirect("/login");
	}

	const pb = createAuthenticatedClient(token);

	if (isExpiringSoon(payload)) {
		// Near expiry (or already expired): validate against PB and rotate.
		try {
			await pb.collection("users").authRefresh();
		} catch {
			throw redirect("/login");
		}
		const user = pb.authStore.model as unknown as UserRecord | null;
		if (!user) throw redirect("/login");
		return { pb, user, token: pb.authStore.token || token };
	}

	// Healthy token: skip the refresh round-trip. Load the user record once
	// (needed for role/institutionId, which aren't present in the JWT).
	try {
		const user = await pb.collection("users").getOne<UserRecord>(payload.id);
		return { pb, user, token };
	} catch {
		// Record fetch failed (deleted user / invalid token) — sign out.
		throw redirect("/login");
	}
}

/**
 * JSON-API variant of `requireAuth`.
 *
 * Returns a 401 JSON response instead of a redirect to /login. Use this
 * for resource routes (`/api/...`) where HTML redirects are inappropriate.
 */
export async function requireAuthJson(request: Request): Promise<AuthResult | Response> {
	try {
		// Reuse the same local-validation + per-request dedupe as requireAuth.
		return await requireAuth(request);
	} catch (err) {
		// requireAuth throws a redirect Response for unauthenticated requests;
		// resource routes want a 401 JSON body instead. Only convert redirects
		// — other Responses (e.g. 403 from requireRole) should propagate.
		if (err instanceof Response && err.status >= 300 && err.status < 400) {
			return new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}
		throw err;
	}
}

/**
 * Require a valid authenticated session **and** one of the specified roles.
 *
 * Combines `requireAuth()` with a role check. Throws a 403 `Response` when
 * the user's role is not in the allowed list.
 *
 * Now returns `token` so callers can propagate cookie updates on token rotation
 * (previously this was lost).
 *
 * ```ts
 * // In a child loader:
 * export async function loader({ request }: LoaderArgs) {
 *   const { pb, user, token } = await requireRole(request, ["admin", "coordinator"]);
 *   return { user };
 * }
 * ```
 */
export async function requireRole(request: Request, roles: Role[]): Promise<AuthResult> {
	const { pb, user, token } = await requireAuth(request);

	if (!roles.includes(user.role)) {
		throw new Response("Forbidden", { status: 403 });
	}

	return { pb, user, token };
}
