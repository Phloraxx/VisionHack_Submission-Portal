import { getEnv } from "./env.server";

// ---------------------------------------------------------------------------
// Allowed origins
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_ORIGINS: string[] = [
  "http://localhost:5173",
  "https://visionhack.mulearn.org",
];

function getAllowedOrigins(): string[] {
  const envOrigins = getEnv().ALLOWED_ORIGINS;
  if (envOrigins) {
    return envOrigins
      .split(",")
      .map((o: string) => o.trim())
      .filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

// ---------------------------------------------------------------------------
// Origin validation
// ---------------------------------------------------------------------------

/**
 * Validate the `Origin` header of a request against the allowed origins list.
 *
 * This is the primary CSRF defense, coupled with `SameSite=Lax` cookies.
 * Together they prevent cross-site form submissions and AJAX requests from
 * malicious origins. For defense-in-depth, consider adding a token-based
 * CSRF check (double-submit cookie pattern) on sensitive actions.
 *
 * In development mode (NODE_ENV !== 'production'), allows only the known Vite
 * dev-server ports (5173, 5174, 5175) on localhost and 127.0.0.1.
 *
 * In production, reads `ALLOWED_ORIGINS` from the environment (comma-separated).
 * Falls back to the default set (`localhost:5173`, the production domain).
 *
 * - **Missing Origin:** throws a 403 response.
 * - **Mismatched Origin:** throws a 403 response.
 */
export function validateOrigin(request: Request): void {
  const origin = request.headers.get("Origin");

  if (!origin) {
    throw new Response("Missing Origin header", { status: 403 });
  }

  // In development, allow only the known Vite dev-server ports
  if (process.env.NODE_ENV !== "production") {
    const devPorts = [5173, 5174, 5175];
    const isAllowedDevOrigin = devPorts.some(
      (port) =>
        origin === `http://localhost:${port}` ||
        origin === `http://127.0.0.1:${port}`,
    );
    if (isAllowedDevOrigin) return;
  }

  const allowedOrigins = getAllowedOrigins();

  if (!allowedOrigins.includes(origin)) {
    throw new Response("Invalid origin", { status: 403 });
  }
}
