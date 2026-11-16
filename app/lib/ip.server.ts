/**
 * Extract the client IP address from a request.
 *
 * SECURITY: Forwarded headers (CF-Connecting-IP, X-Forwarded-For, x-real-ip)
 * are client-controlled and trivially spoofable when the app is reachable
 * without a trusted reverse proxy in front. Trusting them unconditionally
 * lets an attacker rotate the header per request to defeat the per-IP rate
 * limits on login/forgot-password.
 *
 * Set `TRUST_PROXY_HEADERS=1` only when the app is reliably behind
 * Cloudflare / a trusted ingress that overwrites these headers. It is
 * REQUIRED in production: without it every client collapses onto
 * `UNKNOWN_IP`, and callers must skip the per-IP bucket rather than share
 * one global bucket (see `ipRateLimitKey`).
 */
import { getEnv } from "./env.server";

export const UNKNOWN_IP = "unknown";

export function getClientIp(request: Request): string {
	if (getEnv().TRUST_PROXY_HEADERS) {
		// CF-Connecting-IP and x-real-ip are single-valued and set by the
		// proxy. X-Forwarded-For is a list the client can prepend to, so the
		// *last* hop — the one the nearest trusted proxy appended — is the
		// only entry we can attribute.
		const forwarded = request.headers.get("X-Forwarded-For");
		const lastHop = forwarded?.split(",").at(-1)?.trim();
		return (
			request.headers.get("CF-Connecting-IP") ??
			request.headers.get("x-real-ip") ??
			(lastHop || UNKNOWN_IP)
		);
	}
	// Web Request objects (used by React Router) have no .socket property.
	// Per-IP rate limiting only works behind a trusted proxy that sets
	// CF-Connecting-IP / X-Forwarded-For. Without a proxy, all clients
	// share a single rate-limit bucket (per-email limits still apply).
	return UNKNOWN_IP;
}

/**
 * Rate-limit key for a per-IP bucket, or `null` when the client address is
 * unknown.
 *
 * Returning `null` is the point: keying the bucket on `UNKNOWN_IP` would make
 * every client on earth share one counter, so five failed logins from one
 * host would lock out everyone. Callers skip the bucket when this is null and
 * rely on the per-account limit instead.
 */
export function ipRateLimitKey(scope: string, request: Request): string | null {
	const ip = getClientIp(request);
	return ip === UNKNOWN_IP ? null : `${scope}:ip:${ip}`;
}
