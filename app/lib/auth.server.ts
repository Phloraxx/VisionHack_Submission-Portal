import { hash as hashArgon2, verify as verifyArgon2 } from "@node-rs/argon2";
import { compare as compareBcrypt } from "bcryptjs";
import { redirect } from "react-router";
import { type Db, db, users } from "./db.server";
import { isExpiringSoon, signJwt, verifyJwt } from "./jwt.server";
import type { Role, UserRecord } from "./types";

const COOKIE_NAME = "__Host-pb_jwt";
const COOKIE_MAX_AGE = 3600; // 1 hour — matches SESSION_TTL_SECONDS in jwt.server.ts

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
		`Max-Age=${COOKIE_MAX_AGE}`,
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

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

/** Migrated hashes from the legacy backend are bcrypt (`$2a$` / `$2b$`). */
function isBcryptHash(passwordHash: string): boolean {
	return passwordHash.startsWith("$2a$") || passwordHash.startsWith("$2b$");
}

/**
 * `Algorithm.Argon2id` from `@node-rs/argon2`.
 *
 * The package declares `Algorithm` as an ambient `const enum`, which cannot be
 * referenced at runtime under `verbatimModuleSyntax`. The member value is
 * spelled out instead; 2 = Argon2id in the package's `index.d.ts`.
 */
const ARGON2ID = 2 as const;

/** Hash a password with argon2id — the format every new hash uses. */
export function hashPassword(password: string): Promise<string> {
	return hashArgon2(password, { algorithm: ARGON2ID });
}

/**
 * Verify a password against a stored hash.
 *
 * Accepts argon2id (current) and bcrypt (hashes carried over from the
 * legacy backend). Anything else is treated as a failed login rather than an
 * error, so a corrupt row cannot be used to probe the login path.
 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
	try {
		if (passwordHash.startsWith("$argon2")) {
			return await verifyArgon2(passwordHash, password);
		}
		if (isBcryptHash(passwordHash)) {
			return await compareBcrypt(password, passwordHash);
		}
		return false;
	} catch (err) {
		console.error("[auth] Password verification failed", err);
		return false;
	}
}

/** The claims written into a session token (plan §3.3). */
function sessionClaims(user: UserRecord): Record<string, unknown> {
	return {
		id: user.id,
		role: user.role,
		institutionId: user.institutionId,
		email: user.email,
		name: user.name,
	};
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
	if (!row) throw new Error("Invalid email or password");

	const valid = await verifyPassword(row.passwordHash, password);
	if (!valid) throw new Error("Invalid email or password");

	// Upgrade a migrated bcrypt hash on first successful login. Best-effort:
	// a failed UPDATE must not fail an otherwise valid login.
	if (isBcryptHash(row.passwordHash)) {
		try {
			await users.updatePasswordHash(row.id, await hashPassword(password));
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

	return { token: signJwt(sessionClaims(record)), record };
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
 * 4. Loads the user record once (`SELECT … WHERE id = $1`); missing →
 *    **throws** `redirect("/login")`.
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
 * export async function loader({ request }: LoaderArgs) {
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

	const payload = verifyJwt(token);
	if (!payload || typeof payload.id !== "string" || !payload.id) {
		// Bad signature, wrong alg, expired or malformed — treat as
		// unauthenticated.
		throw redirect("/login");
	}
	// Password-reset tokens share the signing key but are not sessions.
	if (payload.purpose) throw redirect("/login");

	const user = await users.findById(payload.id);
	if (!user) throw redirect("/login");

	// Near expiry: re-mint locally and hand the new token back so
	// secureAction/secureLoader propagate the Set-Cookie they already do.
	const nextToken = isExpiringSoon(payload) ? signJwt(sessionClaims(user)) : token;

	return { db, user, token: nextToken };
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
 * Returns `token` so callers can propagate cookie updates on token rotation.
 *
 * ```ts
 * // In a child loader:
 * export async function loader({ request }: LoaderArgs) {
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
