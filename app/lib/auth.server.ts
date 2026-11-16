import { createHash } from "node:crypto";
import { redirect } from "react-router";
import { type Db, db, users } from "./db.server";
import {
	type JwtPayload,
	SESSION_TTL_SECONDS,
	isExpiringSoon,
	signJwt,
	timingSafeStringEqual,
	verifyJwt,
} from "./jwt.server";
import { hashPassword, isBcryptHash, verifyPassword } from "./password.server";
import type { Role, UserRecord } from "./types";

const COOKIE_NAME = "__Host-pb_jwt";

// ---------------------------------------------------------------------------
// Per-request auth cache
// ---------------------------------------------------------------------------
//
// React Router 7 runs the layout loader and every child loader in
// parallel, and each previously resolved auth independently — 2+ user-row
// loads per navigation, plus a token-rotation race. We dedupe by caching the
// in-flight auth promise keyed by the Request object for the lifetime of that
// request. A WeakMap means entries are GC'd once the request is done; nothing
// leaks across users.

const authCache = new WeakMap<Request, Promise<AuthResult>>();

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Parse a `Cookie` request header into a name → value map.
 *
 * The header is `; `-separated `name=value` pairs; values may be
 * percent-encoded, so each one is decoded. Malformed pairs are skipped rather
 * than throwing — a bad cookie must not fail the request.
 */
function parseCookieHeader(header: string): Record<string, string> {
	const cookies: Record<string, string> = {};
	for (const pair of header.split(";")) {
		const eq = pair.indexOf("=");
		if (eq < 0) continue;
		const name = pair.slice(0, eq).trim();
		if (!name) continue;
		const raw = pair.slice(eq + 1).trim();
		try {
			cookies[name] = decodeURIComponent(raw);
		} catch {
			cookies[name] = raw;
		}
	}
	return cookies;
}

/**
 * Extract the `pb_jwt` token from the request's Cookie header.
 * Returns `null` when no token is present.
 */
export function getAuthFromCookie(request: Request): string | null {
	const cookies = parseCookieHeader(request.headers.get("Cookie") || "");
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
	return [
		`${COOKIE_NAME}=${token}`,
		"HttpOnly",
		"Secure",
		"SameSite=Strict",
		"Path=/",
		`Max-Age=${SESSION_TTL_SECONDS}`,
	].join("; ");
}

/**
 * Build a `Set-Cookie` header value that clears the auth cookie
 * (immediate expiry).
 */
export function clearAuthCookie(): string {
	return [`${COOKIE_NAME}=`, "HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=0"].join(
		"; ",
	);
}

/**
 * A throwaway argon2id hash, minted once per process.
 *
 * `login()` verifies against it when the email is unknown so that a missing
 * account costs the same wall-clock time as a wrong password — otherwise the
 * response time tells an attacker which addresses are registered.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyPasswordHash(): Promise<string> {
	dummyHashPromise ??= hashPassword(crypto.randomUUID());
	return dummyHashPromise;
}

/** The claims written into a session token. */
function sessionClaims(user: UserRecord, passwordHash: string): Record<string, unknown> {
	return {
		id: user.id,
		role: user.role,
		institutionId: user.institutionId,
		email: user.email,
		name: user.name,
		// Binds the session to the current password hash: a completed reset
		// rewrites the hash, which invalidates every other session.
		pwf: passwordFingerprint(passwordHash),
	};
}

/** Short, non-reversible binding between a token and the current password hash. */
export function passwordFingerprint(passwordHash: string): string {
	return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

/**
 * Whether a token's `pwf` claim still matches the live password hash.
 *
 * Constant-time: the claim is attacker-supplied, so a short-circuiting compare
 * would leak how much of a guessed fingerprint is correct.
 */
export function matchesPasswordFingerprint(claim: unknown, passwordHash: string): boolean {
	return (
		typeof claim === "string" && timingSafeStringEqual(claim, passwordFingerprint(passwordHash))
	);
}

// ---------------------------------------------------------------------------
// Auth actions
// ---------------------------------------------------------------------------

/**
 * Authenticate a user with email and password against the `users` table.
 *
 * Returns the signed JWT and the user record. Callers should pass the token
 * to `setAuthCookie()` and include it in the response headers.
 *
 * Throws on invalid credentials. Callers must catch this and return a
 * user-friendly error message.
 */
export async function login(
	email: string,
	password: string,
): Promise<{ token: string; record: UserRecord }> {
	const row = await users.findByEmail(email);
	if (!row) {
		// Same work as a wrong password, so the timing does not reveal whether
		// the address exists.
		await verifyPassword(await dummyPasswordHash(), password);
		throw new Error("Invalid email or password");
	}

	const valid = await verifyPassword(row.passwordHash, password);
	if (!valid) throw new Error("Invalid email or password");

	// Upgrade a migrated bcrypt hash on first successful login. Best-effort:
	// a failed UPDATE must not fail an otherwise valid login.
	let passwordHash = row.passwordHash;
	if (isBcryptHash(row.passwordHash)) {
		try {
			const upgraded = await hashPassword(password);
			await users.updatePasswordHash(row.id, upgraded);
			// Promote only after the UPDATE resolved: a token bound to a hash
			// the row does not hold would be rejected on the next request.
			passwordHash = upgraded;
		} catch (err) {
			console.error("[auth] bcrypt → argon2id rehash failed", err);
		}
	}

	// Build the record explicitly so the password hash can never leak into
	// loader data.
	const record: UserRecord = {
		id: row.id,
		email: row.email,
		name: row.name,
		role: row.role,
		institutionId: row.institutionId,
		created: row.created,
		updated: row.updated,
	};

	return { token: signJwt(sessionClaims(record, passwordHash)), record };
}

// ---------------------------------------------------------------------------
// Request guards (use in layout / route loaders)
// ---------------------------------------------------------------------------

/**
 * Result returned by `requireAuth` and `requireRole`.
 * Always includes the (possibly re-minted) token so callers can
 * update the cookie when the token is rotated.
 *
 * `db` is the Postgres handle for the route's data reads.
 */
export interface AuthResult {
	db: Db;
	user: UserRecord;
	token: string;
}

/**
 * Require a valid authenticated session.
 *
 * 1. Reads the `pb_jwt` cookie from the request.
 * 2. If missing/malformed → **throws** `redirect("/login")`.
 * 3. Verifies the JWT signature and expiry locally. If the token is near
 *    expiry, mints a fresh one (no network round trip).
 * 4. Loads the user record once (`SELECT … WHERE id = $1`); missing → **throws**
 *    `redirect("/login")`.
 * 5. Returns the database handle, the user record, and the (possibly
 *    re-minted) token so callers can issue a new cookie if needed.
 *
 * The result is cached per `Request` (WeakMap), so the layout loader and
 * all child loaders share one user-row load instead of each making their
 * own.
 *
 * **Important:** React Router 7 layout loaders run in parallel with child
 * loaders, so you must `throw redirect()` (not return it) to stop execution.
 *
 * ```ts
 * // In a layout loader:
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   const { db, user, token } = await requireAuth(request);
 *   // Update cookie if token was rotated
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
	// layout loader and child loaders share a single user-row load.
	const cached = authCache.get(request);
	if (cached) return cached;

	const promise = resolveAuth(request);
	authCache.set(request, promise);
	// If auth fails (throws redirect), drop the cached rejected promise so a
	// retry within the same request can re-evaluate.
	promise.catch(() => authCache.delete(request));
	return promise;
}

/** A cookie that resolves to a live session. */
export interface Session {
	user: UserRecord;
	/** The hash the token's `pwf` claim was checked against. */
	passwordHash: string;
	payload: JwtPayload;
}

/**
 * Resolve a session token to its live user, or `null` when it is not a session.
 *
 * This is the single definition of "this cookie is still good": signature,
 * expiry, `purpose`, the live row, and the `pwf` password binding. `resolveAuth`
 * and the `/login` loader both call it — when the two disagreed about a stale
 * cookie, the browser bounced between `/login` and the dashboard forever.
 */
export async function resolveSession(token: string): Promise<Session | null> {
	const payload = verifyJwt(token);
	// Bad signature, wrong alg, foreign issuer, expired or malformed.
	if (!payload || typeof payload.id !== "string" || !payload.id) return null;
	// Password-reset tokens share the signing key but are not sessions.
	if (payload.purpose) return null;

	const row = await users.findSessionUser(payload.id);
	if (!row) return null;

	// A completed password reset rewrites the hash, so the fingerprint in the
	// token stops matching and every other session is invalidated.
	if (!matchesPasswordFingerprint(payload.pwf, row.passwordHash)) return null;

	const user: UserRecord = {
		id: row.id,
		email: row.email,
		name: row.name,
		role: row.role,
		institutionId: row.institutionId,
		created: row.created,
		updated: row.updated,
	};

	return { user, passwordHash: row.passwordHash, payload };
}

/**
 * The actual auth resolution. Verifies the JWT locally (cheap) and loads the
 * live user row once per request.
 *
 * The row load is what makes a deleted user, a demoted admin or a reassigned
 * institution take effect on the next request rather than at the next token
 * refresh — the same guarantee the previous design had.
 */
async function resolveAuth(request: Request): Promise<AuthResult> {
	const token = getAuthFromCookie(request);
	if (!token) throw redirect("/login");

	const session = await resolveSession(token);
	if (!session) throw redirect("/login");

	// Near expiry: re-mint locally and hand the new token back so
	// secureAction/secureLoader propagate the Set-Cookie they already do.
	const nextToken = isExpiringSoon(session.payload)
		? signJwt(sessionClaims(session.user, session.passwordHash))
		: token;

	return { db, user: session.user, token: nextToken };
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
		// requireAuth throws a redirect to /login for unauthenticated requests;
		// resource routes want a 401 JSON body instead. Only that redirect is
		// converted — any other Response propagates untouched.
		if (err instanceof Response && err.status >= 300 && err.status < 400) {
			const location = err.headers.get("Location");
			if (!location || new URL(location, request.url).pathname === "/login") {
				return new Response(JSON.stringify({ error: "Unauthorized" }), {
					status: 401,
					headers: { "Content-Type": "application/json" },
				});
			}
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
 * Returns `token` so callers can propagate cookie updates on token rotation.
 *
 * ```ts
 * // In a child loader:
 * export async function loader({ request }: LoaderFunctionArgs) {
 *   const { db, user, token } = await requireRole(request, ["admin", "coordinator"]);
 *   return { user };
 * }
 * ```
 */
export async function requireRole(request: Request, roles: Role[]): Promise<AuthResult> {
	const { db: database, user, token } = await requireAuth(request);

	if (!roles.includes(user.role)) {
		throw new Response("Forbidden", { status: 403 });
	}

	return { db: database, user, token };
}
