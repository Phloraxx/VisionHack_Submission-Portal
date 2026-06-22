import PocketBase from "pocketbase";
import { getEnv } from "./env.server";

/**
 * Custom fetch wrapper that adds a 20-second timeout.
 * Respects existing AbortSignals (e.g., PocketBase auto-cancellation).
 */
function fetchWithTimeout(
  url: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 20000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const existingSignal = init?.signal;
  if (existingSignal) {
    if (existingSignal.aborted) {
      clearTimeout(timeout);
      return Promise.reject(
        existingSignal.reason || new DOMException("Aborted", "AbortError"),
      );
    }
    existingSignal.addEventListener(
      "abort",
      () => controller.abort(existingSignal.reason),
      { once: true },
    );
  }

  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timeout),
  );
}

/**
 * Create a PocketBase client with a custom fetch that applies a 20-second
 * timeout to every request. Uses the `beforeSend` hook to inject the custom
 * fetch into each request's SendOptions (the SDK reads `options.fetch`).
 */
function createBaseClient(baseURL: string): PocketBase {
  const pb = new PocketBase(baseURL);
  pb.beforeSend = (url, options) => {
    options.fetch = (input: RequestInfo | URL, config?: RequestInit) =>
      fetchWithTimeout(input, config);
    return { url, options };
  };
  return pb;
}

// ---------------------------------------------------------------------------
// PocketBase client factory functions
// ---------------------------------------------------------------------------

export function createPocketBaseClient(): PocketBase {
  return createBaseClient(getEnv().POCKETBASE_URL);
}

export function createAuthenticatedClient(token: string): PocketBase {
  const pb = createBaseClient(getEnv().POCKETBASE_URL);
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
  const pb = createBaseClient(env.POCKETBASE_URL);
  pb.authStore.save(env.POCKETBASE_SUPER_TOKEN, null);
  return pb;
}
