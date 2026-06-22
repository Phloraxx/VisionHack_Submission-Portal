/**
 * Minimal JWT payload decoding for fast, network-free auth validation.
 *
 * We do NOT verify the signature here — PocketBase is the only issuer and
 * the token lives in an HttpOnly cookie set by our own server, so a
 * forged token would have to come from a compromised server anyway. What
 * we get cheaply is the claims (id, role, institutionId, email, exp) so
 * loaders can build the user without a round-trip to PocketBase on every
 * request. When the token is close to expiry we fall back to a real
 * `authRefresh()` (see auth.server.ts) which both validates against PB
 * and rotates the token.
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
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );

    const json = atob(padded);
    return JSON.parse(json) as PbJwtPayload;
  } catch {
    return null;
  }
}

/**
 * `skewSeconds` (default 5 min). Used to decide whether to refresh.
 */
export function isExpiringSoon(
  payload: PbJwtPayload | null,
  skewSeconds = 300,
): boolean {
  if (!payload || typeof payload.exp !== "number") return true;
  const nowSeconds = Date.now() / 1000;
  return payload.exp - nowSeconds < skewSeconds;
}
