import { getEnv } from "./env.server";

// ---------------------------------------------------------------------------
// Allowed origins
// ---------------------------------------------------------------------------

/**
 * Dev-server origins. Production must set `ALLOWED_ORIGINS` — `getEnv()`
 * refuses to boot without it, so there is no production default to get wrong.
 */
const DEV_ORIGINS: string[] = ["http://localhost:5173"];

function getAllowedOrigins(): string[] {
	const envOrigins = getEnv().ALLOWED_ORIGINS;
	if (envOrigins) {
		return envOrigins
			.split(",")
			.map((o: string) => o.trim())
			.filter(Boolean);
	}
	return DEV_ORIGINS;
}

// ---------------------------------------------------------------------------
// Origin validation
// ---------------------------------------------------------------------------

/**
 * Validate the `Origin` header of a request against the allowed origins list.
 *
 * This is the secondary CSRF defense, coupled with `SameSite=Strict` cookies.
 * SameSite blocks cross-site cookie attachment; origin validation catches
 * cases where the header is present but mismatched.
 *
 * When `requireOrigin` is true, a missing Origin header causes a 403.
 * Use `requireOrigin: true` on endpoints that are not behind the dashboard
 * layout (login, forgot-password) so they are not bypassed by attackers
 * omitting the Origin header.
 *
 * In development mode, allows only the known Vite dev-server ports (5173,
 * 5174, 5175) on localhost and 127.0.0.1. In production, reads
 * `ALLOWED_ORIGINS` from the environment (comma-separated, mandatory).
 *
 * - **Missing Origin:** throws a 403 when `requireOrigin` is true; allowed
 *   when false (SameSite=Strict is the primary defense).
 * - **Mismatched Origin:** throws a 403 response.
 */
export function validateOrigin(request: Request, requireOrigin = false): void {
	const origin = request.headers.get("Origin");

	if (!origin) {
		if (requireOrigin) {
			throw new Response("Missing Origin header", { status: 403 });
		}
		// Missing Origin is allowed when requireOrigin is false — the
		// SameSite=Strict cookie attribute is the primary defense. Some
		// browsers (especially headless/automated) omit Origin on same-origin
		// POST requests from JS.
		return;
	}

	// In development, allow only the known Vite dev-server ports
	if (getEnv().NODE_ENV === "development") {
		const devPorts = [5173, 5174, 5175];
		const isAllowedDevOrigin = devPorts.some(
			(port) => origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`,
		);
		if (isAllowedDevOrigin) return;
	}

	const allowedOrigins = getAllowedOrigins();

	if (!allowedOrigins.includes(origin)) {
		throw new Response("Invalid origin", { status: 403 });
	}
}
