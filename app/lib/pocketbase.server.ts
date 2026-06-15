import PocketBase from "pocketbase";
import { getEnv } from "./env.server";

// ---------------------------------------------------------------------------
// Dev-mode fetch stability
// ---------------------------------------------------------------------------
// workerd's built-in fetch has intermittent DNS timeouts in Miniflare.
// We simply extend the timeout and retry once on failure.

if (import.meta.env.DEV) {
  const origFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      return await origFetch(input, { ...init, signal: controller.signal });
    } catch (firstErr) {
      clearTimeout(timeout);
      const retryTimeout = setTimeout(() => controller.abort(), 20000);
      try {
        return await origFetch(input, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(retryTimeout);
      }
    } finally {
      clearTimeout(timeout);
    }
  };
}

// ---------------------------------------------------------------------------
// PocketBase client factory functions
// ---------------------------------------------------------------------------

export function createPocketBaseClient(): PocketBase {
  return new PocketBase(getEnv().POCKETBASE_URL);
}

export function createAuthenticatedClient(token: string): PocketBase {
  const pb = new PocketBase(getEnv().POCKETBASE_URL);
  pb.authStore.save(token, null);
  return pb;
}

/**
 * Create a superuser PocketBase instance using a pre-generated
 * long-lived superuser token from env (POCKETBASE_SUPER_TOKEN).
 * No email/password authentication needed.
 */
export function createSuperuserClient(): PocketBase {
  const env = getEnv();
  const pb = new PocketBase(env.POCKETBASE_URL);
  pb.authStore.save(env.POCKETBASE_SUPER_TOKEN, null);
  return pb;
}

export function getPocketBaseUrl(): string {
  return getEnv().POCKETBASE_URL;
}
