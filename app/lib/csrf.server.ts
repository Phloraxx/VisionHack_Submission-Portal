import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookieParse } from "pocketbase";

// ---------------------------------------------------------------------------
// CSRF token helpers (double-submit cookie pattern)
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random CSRF token.
 *
 * Returns a 64-character hex string (32 random bytes).
 */
export function generateCsrfToken(): string {
	return randomBytes(32).toString("hex");
}

/**
 * Build a `Set-Cookie` header value that stores the given CSRF token.
 *
 * HttpOnly is safe here because the token is read server-side in the
 * route loader and passed to the template via loader data, not by
 * client JS reading the cookie directly. Marked Secure in production.
 *
 * ```ts
 * headers.append("Set-Cookie", setCsrfCookie(token));
 * ```
 */
export function setCsrfCookie(token: string): string {
	const secure = process.env.NODE_ENV === "production";
	return [
		`csrf_token=${token}`,
		...(secure ? ["Secure"] : []),
		"SameSite=Lax",
		"HttpOnly",
		"Path=/",
		"Max-Age=3600",
	].join("; ");
}

/**
 * Validate a double-submit CSRF token.
 *
 * Reads `csrf_token` from both the request cookie and the form body.
 * If either is missing, or if they don't match (timing-safe comparison),
 * throws a 403 `Response`.
 *
 * Call this AFTER parsing `formData` and BEFORE dispatching the handler.
 *
 * @throws {Response} 403 with descriptive message
 */
export function validateCsrfToken(request: Request, formData: FormData): void {
	const cookies = cookieParse(request.headers.get("Cookie") || "");
	const cookieToken = cookies.csrf_token;
	const formToken = formData.get("csrf_token");

	if (!cookieToken || !formToken) {
		throw new Response("Missing CSRF token", { status: 403 });
	}

	if (typeof formToken !== "string") {
		throw new Response("Invalid CSRF token format", { status: 403 });
	}

	const cookieBuf = Buffer.from(cookieToken, "utf8");
	const formBuf = Buffer.from(String(formToken), "utf8");

	// Timing-safe compare: same length first, then constant-time compare
	if (
		cookieBuf.length !== formBuf.length ||
		!timingSafeEqual(cookieBuf, formBuf)
	) {
		throw new Response("Invalid CSRF token", { status: 403 });
	}
}
