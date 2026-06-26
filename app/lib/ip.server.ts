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
 * Cloudflare / a trusted ingress that overwrites these headers. When
 * unset, fall back to "unknown" so the per-IP rate-limit key degrades
 * to a single shared bucket (per-email limits still bind).
 */
export function getClientIp(request: Request): string {
	const trustProxy = process.env.TRUST_PROXY_HEADERS === "1";
	if (!trustProxy) return "unknown";

	return (
		request.headers.get("CF-Connecting-IP") ??
		request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
		request.headers.get("x-real-ip") ??
		"unknown"
	);
}
