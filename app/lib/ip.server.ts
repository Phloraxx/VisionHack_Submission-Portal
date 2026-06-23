/**
 * Extract the client IP address from a request.
 * Trusts Cloudflare header first, then X-Forwarded-For, then x-real-ip.
 * Falls back to "unknown" when no header is present.
 */
export function getClientIp(request: Request): string {
	return (
		request.headers.get("CF-Connecting-IP") ??
		request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
		request.headers.get("x-real-ip") ??
		"unknown"
	);
}
