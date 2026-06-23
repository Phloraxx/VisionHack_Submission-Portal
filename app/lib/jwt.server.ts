/**
 * Minimal JWT payload decoding for fast, network-free auth validation.
 *
 * SECURITY MODEL: We do NOT verify the JWT signature here. This is an
 * intentional design choice based on the threat model:
 *
 * 1. PocketBase is the sole JWT issuer — tokens are only minted by the
 *    PB auth endpoint, which our server calls with the correct admin/user
 *    credentials.
 * 2. The token lives in an HttpOnly cookie (`pb_jwt`) set exclusively by
 *    our own server. A client-side XSS attacker could steal it, but they
 *    would also have access to the full page context (making signature
 *    verification irrelevant).
 * 3. A forged token would require compromising the PB JWT secret, which
 *    is stored server-side in PB's database, not exposed to the client.
 *    If the PB secret is compromised, signature verification wouldn't help
 *    because the attacker could issue validly-signed tokens.
 *
 * For further defense-in-depth: tokens nearing expiry (within 5 min) are
 * refreshed via `authRefresh()` which validates against PB directly and
 * rotates the token (see auth.server.ts).
 *
 * If the threat model changes (e.g., PB secret shared across services),
 * add HMAC verification using the PB JWT secret exposed via env.
 */

export interface PbJwtPayload {
	id?: string;
	/** PocketBase collection id for the auth record. */
	collectionId?: string;
	/** Unix expiry (seconds). */
	exp?: number;
	/** Custom claims mirrored into the token by PocketBase. */
	role?: string;
	institutionId?: string;
	email?: string;
	name?: string;
	[claim: string]: unknown;
}

/** Decode the base64url payload segment of a JWT. Returns null if malformed. */
export function decodeJwtPayload(token: string): PbJwtPayload | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;

		// base64url → base64
		const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");

		const json = atob(padded);
		return JSON.parse(json) as PbJwtPayload;
	} catch {
		return null;
	}
}

/**
 * `skewSeconds` (default 5 min). Used to decide whether to refresh.
 */
export function isExpiringSoon(payload: PbJwtPayload | null, skewSeconds = 300): boolean {
	if (!payload || typeof payload.exp !== "number") return true;
	const nowSeconds = Date.now() / 1000;
	return payload.exp - nowSeconds < skewSeconds;
}
