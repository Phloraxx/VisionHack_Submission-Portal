import { getEnv } from "./env.server";

// ---------------------------------------------------------------------------
// Allowed origins
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_ORIGINS: string[] = [
  "http://localhost:5173",
  "http://localhost:3000",
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
 * In development mode (import.meta.env.DEV), allows any localhost origin
 * so the dev server can run on any port without reconfiguration.
 *
 * In production, reads `ALLOWED_ORIGINS` from the environment (comma-separated).
 * Falls back to the default set (`localhost:5173`, `localhost:3000`, the
 * production domain).
 *
 * - **Missing Origin:** throws a 403 response.
 * - **Mismatched Origin:** throws a 403 response.
 */
export function validateOrigin(request: Request): void {
  const origin = request.headers.get("Origin");

  if (!origin) {
    throw new Response("Missing Origin header", { status: 403 });
  }

  // In development, allow any localhost origin
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
      return;
    }
  }

  const allowedOrigins = getAllowedOrigins();

  if (!allowedOrigins.includes(origin)) {
    throw new Response("Invalid origin", { status: 403 });
  }
}
