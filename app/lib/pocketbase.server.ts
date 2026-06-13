import PocketBase from "pocketbase";
import { getEnv } from "./env.server";

/**
 * Create a new PocketBase instance per request.
 * This is required for Cloudflare Workers — I/O objects
 * cannot be shared across requests.
 */
export function createPocketBaseClient(): PocketBase {
  return new PocketBase(getEnv().POCKETBASE_URL);
}

/**
 * Create an authenticated PocketBase instance using a JWT token.
 * Used in loaders/actions where the user's JWT is available from a cookie.
 *
 * The token is stored in the PocketBase authStore so subsequent
 * requests from this client instance carry the user's credentials.
 * Always create a fresh instance per request — never reuse across requests.
 */
export function createAuthenticatedClient(token: string): PocketBase {
  const pb = new PocketBase(getEnv().POCKETBASE_URL);
  pb.authStore.save(token, null);
  return pb;
}

/**
 * Create a superuser PocketBase instance for server-side operations
 * that bypass row-level security.
 *
 * **Only use for genuinely admin-level operations.**
 * For user-scoped operations, use `createAuthenticatedClient(token)` instead.
 */
export async function createSuperuserClient(): Promise<PocketBase> {
  const env = getEnv();
  const pb = new PocketBase(env.POCKETBASE_URL);
  await pb
    .collection("_superusers")
    .authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);
  return pb;
}

/**
 * Get the PocketBase base URL for constructing file download URLs.
 * Returns the latest value from the environment config.
 */
export function getPocketBaseUrl(): string {
  return getEnv().POCKETBASE_URL;
}
