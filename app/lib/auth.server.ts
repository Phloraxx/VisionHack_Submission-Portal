import { redirect } from "react-router";
import {
  createAuthenticatedClient,
  createPocketBaseClient,
} from "./pocketbase.server";
import { getEnv } from "./env.server";
import { cookieParse } from "pocketbase";
import type { Role, UserRecord } from "./types";

const COOKIE_NAME = "pb_jwt";
const COOKIE_MAX_AGE = 432000; // 5 days in seconds
const COOKIE_PATH = "/";

/** Map of role → default dashboard path */
export const ROLE_DASHBOARD_MAP: Record<Role, string> = {
  admin: "/admin/dashboard",
  coordinator: "/coordinator/dashboard",
  institution: "/institution/dashboard",
  lead: "/lead/dashboard",
};

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Extract the `pb_jwt` token from the request's Cookie header.
 * Returns `null` when no token is present.
 */
export function getAuthFromCookie(request: Request): string | null {
  const cookies = cookieParse(request.headers.get("Cookie") || "");
  return cookies[COOKIE_NAME] ?? null;
}

/**
 * Build a `Set-Cookie` header value that stores the given JWT.
 *
 * ```ts
 * headers.append("Set-Cookie", setAuthCookie(token));
 * ```
 */
export function setAuthCookie(token: string): string {
  // Secure flag: true if PB URL uses HTTPS, or if running in production
  const secure =
    getEnv().POCKETBASE_URL?.startsWith("https") ||
    (typeof import.meta !== "undefined" && import.meta.env?.PROD);
  return [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    ...(secure ? ["Secure"] : []),
    "SameSite=Lax",
    `Path=${COOKIE_PATH}`,
    `Max-Age=${COOKIE_MAX_AGE}`,
  ].join("; ");
}

/**
 * Build a `Set-Cookie` header value that clears the auth cookie
 * (immediate expiry).
 */
export function clearAuthCookie(): string {
  const secure =
    getEnv().POCKETBASE_URL?.startsWith("https") ||
    (typeof import.meta !== "undefined" && import.meta.env?.PROD);
  return [
    `${COOKIE_NAME}=`,
    "HttpOnly",
    ...(secure ? ["Secure"] : []),
    "SameSite=Lax",
    `Path=${COOKIE_PATH}`,
    "Max-Age=0",
  ].join("; ");
}

// ---------------------------------------------------------------------------
// Auth actions
// ---------------------------------------------------------------------------

/**
 * Authenticate a user with email and password against PocketBase.
 *
 * Returns the JWT token and the user record. Callers should pass the token
 * to `setAuthCookie()` and include it in the response headers.
 *
 * Throws a PocketBase `ClientResponseError` on invalid credentials.
 * Callers must catch this and return a user-friendly error message.
 */
export async function login(
  email: string,
  password: string,
): Promise<{ token: string; record: UserRecord }> {
  const pb = createPocketBaseClient();
  const authData = await pb
    .collection("users")
    .authWithPassword(email, password);

  return {
    token: authData.token,
    record: authData.record as unknown as UserRecord,
  };
}

// ---------------------------------------------------------------------------
// Request guards (use in layout / route loaders)
// ---------------------------------------------------------------------------

/**
 * Result returned by `requireAuth` and `requireRole`.
 * Always includes the (possibly refreshed) token so callers can
 * update the cookie when the token is rotated.
 */
export interface AuthResult {
  pb: ReturnType<typeof createAuthenticatedClient>;
  user: UserRecord;
  token: string;
}

/**
 * Require a valid authenticated session.
 *
 * 1. Reads the `pb_jwt` cookie from the request.
 * 2. If missing → **throws** `redirect("/login")`.
 * 3. Creates an authenticated PocketBase client and calls `authRefresh()`
 *    to validate (and potentially refresh) the token.
 * 4. If refresh fails → **throws** `redirect("/login")`.
 * 5. Returns the PocketBase instance, the user record, and the (possibly
 *    refreshed) token so callers can issue a new cookie if needed.
 *
 * **Important:** React Router 7 layout loaders run in parallel with child
 * loaders, so you must `throw redirect()` (not return it) to stop execution.
 *
 * ```ts
 * // In a layout loader:
 * export async function loader({ request }: LoaderArgs) {
 *   const { pb, user, token } = await requireAuth(request);
 *   // Update cookie if token was refreshed
 *   const headers = new Headers();
 *   const originalToken = getAuthFromCookie(request);
 *   if (token !== originalToken) {
 *     headers.append("Set-Cookie", setAuthCookie(token));
 *   }
 *   return data({ user }, { headers });
 * }
 * ```
 */
export async function requireAuth(
  request: Request,
): Promise<AuthResult> {
  const token = getAuthFromCookie(request);
  if (!token) throw redirect("/login");

  const pb = createAuthenticatedClient(token);

  try {
    await pb.collection("users").authRefresh();
  } catch {
    // Token expired or invalid — redirect to login
    throw redirect("/login");
  }

  const user = pb.authStore.model as unknown as UserRecord | null;
  if (!user) throw redirect("/login");

  // After authRefresh, PocketBase may have rotated the token.
  const refreshedToken = pb.authStore.token || token;

  return { pb, user, token: refreshedToken };
}

/**
 * Require a valid authenticated session **and** one of the specified roles.
 *
 * Combines `requireAuth()` with a role check. Throws a 403 `Response` when
 * the user's role is not in the allowed list.
 *
 * Now returns `token` so callers can propagate cookie updates on token rotation
 * (previously this was lost).
 *
 * ```ts
 * // In a child loader:
 * export async function loader({ request }: LoaderArgs) {
 *   const { pb, user, token } = await requireRole(request, ["admin", "coordinator"]);
 *   return { user };
 * }
 * ```
 */
export async function requireRole(
  request: Request,
  roles: Role[],
): Promise<AuthResult> {
  const { pb, user, token } = await requireAuth(request);

  if (!roles.includes(user.role)) {
    throw new Response("Forbidden", { status: 403 });
  }

  return { pb, user, token };
}
