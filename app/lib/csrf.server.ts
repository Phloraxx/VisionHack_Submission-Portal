import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookieParse } from "pocketbase";
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
 * NOT HttpOnly — client JS needs to read the cookie to inject its value
 * into the form body as a hidden input. Marked Secure in production.
 *
 * ```ts
 * headers.append("Set-Cookie", setCsrfCookie(token));
 * ```
 */
export function setCsrfCookie(token: string): string {
  const secure =
    getEnv().POCKETBASE_URL?.startsWith("https") ||
    process.env.NODE_ENV === "production";
  return [
    `csrf_token=${token}`,
    ...(secure ? ["Secure"] : []),
    "SameSite=Lax",
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
  const cookieToken = cookies["csrf_token"];
  const formToken = formData.get("csrf_token");

  if (!cookieToken || !formToken) {
    throw new Response("Missing CSRF token", { status: 403 });
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
