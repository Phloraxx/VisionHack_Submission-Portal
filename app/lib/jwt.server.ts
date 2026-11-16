/**
 * JWT signing and verification for app-issued session tokens.
 *
 * SECURITY MODEL: the app is now the only issuer. `signJwt` mints HS256
 * tokens with `APP_JWT_SECRET`; `verifyJwt` checks the signature, the
 * algorithm and the expiry before any claim is trusted. There is no network
 * round trip and no session table (docs/PG_PORT_PLAN.md §3.1).
 *
 * `decodeJwtPayload` remains a *decode-only* helper for cheap claim reads
 * (e.g. `isExpiringSoon`). It must never be used to authorise a request —
 * use `verifyJwt` for that.
 *
 * Token shape (plan §3.3):
 *
 * ```json
 * {
 *   "id": "3f2b…",
 *   "role": "institution",
 *   "institutionId": "9a41…",
 *   "email": "lead@example.edu",
 *   "name": "Meera Nair",
 *   "iss": "visionhack-portal",
 *   "iat": 1763200000,
 *   "exp": 1763203600
 * }
 * ```
 *
 * `id` (not `sub`) is deliberate: `decodeJwtPayload` and `resolveAuth` already
 * read `payload.id`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env.server";

/** Issuer claim written into every token this app mints. */
export const JWT_ISSUER = "visionhack-portal";
/** Session lifetime — matches `COOKIE_MAX_AGE` in auth.server.ts. */
export const SESSION_TTL_SECONDS = 3600;

export interface JwtClaims {
	id?: string;
	/** Unix expiry (seconds). */
	exp?: number;
	/** Role at the time the token was minted. */
	role?: string;
	institutionId?: string;
	email?: string;
	name?: string;
	[claim: string]: unknown;
}

/** Claims this app writes. `purpose` marks non-session tokens (password reset). */
export interface JwtPayload extends JwtClaims {
	iss?: string;
	iat?: number;
	/** `"pwreset"` on password-reset tokens; absent on session tokens. */
	purpose?: string;
	/** Password-hash fingerprint binding a reset token to the current hash. */
	pwf?: string;
	/** Subject — used by reset tokens instead of `id`. */
	sub?: string;
}

/** Decode the base64url payload segment of a JWT. Returns null if malformed. */
export function decodeJwtPayload(token: string): JwtClaims | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;

		// base64url → base64
		const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");

		const json = atob(padded);
		return JSON.parse(json) as JwtClaims;
	} catch {
		return null;
	}
}

/**
 * `skewSeconds` (default 5 min). Used to decide whether to refresh.
 */
export function isExpiringSoon(payload: JwtClaims | null, skewSeconds = 300): boolean {
	if (!payload || typeof payload.exp !== "number") return true;
	const nowSeconds = Date.now() / 1000;
	return payload.exp - nowSeconds < skewSeconds;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/** Fixed header: HS256 only. Verification rejects anything else. */
const JWT_HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

function hmacBase64Url(signingInput: string): string {
	return createHmac("sha256", getEnv().APP_JWT_SECRET).update(signingInput).digest("base64url");
}

/**
 * Sign a payload as an HS256 JWT.
 *
 * `iss`, `iat` and `exp` are always written by this function — a caller
 * cannot forge an expiry by passing one in `payload`.
 *
 * @param payload claims to sign (e.g. `{ id, role, institutionId, email, name }`)
 * @param ttlSeconds lifetime in seconds; defaults to one hour
 */
export function signJwt(
	payload: Record<string, unknown>,
	ttlSeconds = SESSION_TTL_SECONDS,
): string {
	const now = Math.floor(Date.now() / 1000);
	const claims: JwtPayload = {
		...payload,
		iss: JWT_ISSUER,
		iat: now,
		exp: now + ttlSeconds,
	};
	const signingInput = `${JWT_HEADER}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
	return `${signingInput}.${hmacBase64Url(signingInput)}`;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify an HS256 JWT and return its claims, or `null` when the token is
 * unusable.
 *
 * Rejects: a malformed token, any `alg` other than `HS256` (including
 * `none`), a signature mismatch (compared with `timingSafeEqual`), a foreign
 * `iss`, and a missing or past `exp`.
 */
export function verifyJwt<T extends JwtPayload = JwtPayload>(token: string): T | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const [headerSegment, payloadSegment, signatureSegment] = parts;
		if (!headerSegment || !payloadSegment || !signatureSegment) return null;

		const header = JSON.parse(Buffer.from(headerSegment, "base64url").toString("utf8")) as {
			alg?: unknown;
		};
		if (!header || typeof header !== "object" || header.alg !== "HS256") return null;

		const expected = Buffer.from(hmacBase64Url(`${headerSegment}.${payloadSegment}`), "utf8");
		const provided = Buffer.from(signatureSegment, "utf8");
		if (expected.length !== provided.length) return null;
		if (!timingSafeEqual(expected, provided)) return null;

		const payload = JSON.parse(
			Buffer.from(payloadSegment, "base64url").toString("utf8"),
		) as JwtPayload;
		if (!payload || typeof payload !== "object") return null;
		if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
		if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

		return payload as T;
	} catch {
		return null;
	}
}
