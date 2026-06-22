import { data } from "react-router";
import * as Sentry from "@sentry/node";
import type { ActionFunctionArgs } from "react-router";
import { requireRole } from "./auth.server";
import { validateOrigin, validateCsrfToken } from "./csrf.server";
import type { Role, UserRecord } from "./types";
import PocketBase from "pocketbase";
import type { ZodSchema } from "zod";

/**
 * Per-request context passed to a `secureAction` handler.
 *
 * - `request` is the raw Request (rarely needed inside the handler)
 * - `user` is the authenticated PocketBase user record
 * - `pb` is a fresh authenticated PocketBase client
 * - `formData` is the parsed form payload
 * - `intent` is the `intent` field from the form, normalized to lowercase
 * - `params` is the route's URL params (e.g. `teamId` from
 *   `/admin/teams/:teamId`)
 */
export interface ActionContext {
  request: Request;
  user: UserRecord;
  pb: PocketBase;
  formData: FormData;
  intent: string;
  params: Record<string, string>;
  validated?: unknown;
}

type Handler<C extends ActionContext> = (ctx: C) => unknown | Promise<unknown>;

/**
 * Shape of the result a handler can return.
 *
 * Returning a `Response` (or `data()`) is fine; helpers below are
 * sugar for the common shapes:
 *   - `ok()` → 200 JSON
 *   - `fail({ status, fieldErrors, error })` → JSON with status code
 */
export type ActionResult = Response | ReturnType<typeof data>;

export function ok(body: Record<string, unknown> = { success: true }): ActionResult {
  return data(body, { status: 200 });
}

export function fail(args: {
  status?: number;
  error?: string;
  fieldErrors?: Record<string, string>;
}): ActionResult {
  const { status = 400, error, fieldErrors } = args;
  return data({ error, fieldErrors }, { status });
}

/**
 * Wrap a route action with the security checks every action MUST run.
 *
 *  1. **CSRF** — Origin header is validated against the allow-list.
 *  2. **Form parse** — reads the body as FormData; 400 on parse failure.
 *  3. **CSRF token** — double-submit token from cookie vs form field; 403 on
 *     mismatch (defense-in-depth alongside Origin + SameSite).
 *  4. **Auth** — caller must be one of `roles`; otherwise 403.
 *  5. **Intent dispatch** — the `intent` form field is exposed to the
 *     handler so multi-intent actions can `switch` on it.
 *
 * Rate limiting is intentionally NOT in the wrapper — it must run BEFORE
 * the body is read (so the wrapper can't apply it) and is configured
 * server-wide by PocketBase's built-in rules. If a per-route rate limit
 * is ever needed, do it inside the handler.
 *
 * ```ts
 * export const action = secureAction(
 *   { roles: ["lead"] },
 *   async ({ formData, user, pb, intent }) => {
 *     switch (intent) {
 *       case "withdraw":
 *         // ...
 *         return ok();
 *       default:
 *         return fail({ error: "Unknown intent", status: 400 });
 *     }
 *   },
 * );
 * ```
 */
export function secureAction<C extends ActionContext = ActionContext>(
  options: { roles: Role[]; schema?: ZodSchema },
  handler: Handler<C>,
) {
  return async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
    // 1. CSRF
    validateOrigin(request);

    // 2. Form parse
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return fail({ error: "Invalid form data", status: 400 });
    }

    // 3. CSRF token (double-submit)
    validateCsrfToken(request, formData);

    // 4. Auth + role
    const { pb, user } = await requireRole(request, options.roles);

    // 5. Schema validation

    if (options.schema) {
      const result = options.schema.safeParse(Object.fromEntries(formData.entries()));
      if (!result.success) {
        return fail({ fieldErrors: Object.fromEntries(Object.entries(result.error.flatten().fieldErrors).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v ?? "Invalid"])) });
      }
      // Attach validated data to context for the handler
      const ctx = {
        request,
        user,
        pb,
        formData,
        intent: String(formData.get("intent") ?? "").toLowerCase(),
        params: params as Record<string, string>,
        validated: result.data,
      } as C;

      try {
        return (await handler(ctx)) as ActionResult;
      } catch (err) {
        console.error("[secureAction]", err, {
          route: new URL(request.url).pathname,
          userId: user.id,
          role: user.role,
          intent: ctx.intent,
        });
        Sentry.captureException(err, { extra: { route: new URL(request.url).pathname, userId: user.id, role: user.role, intent: ctx.intent } });
        return fail({ error: "Something went wrong. Please try again.", status: 500 });
      }
    }

    // 6. Dispatch (no schema validation)
    const intent = String(formData.get("intent") ?? "").toLowerCase();
    const ctx = {
      request,
      user,
      pb,
      formData,
      intent,
      params: params as Record<string, string>,
    } as C;

    try {
      return (await handler(ctx)) as ActionResult;
    } catch (err) {
      // Surface server-side errors uniformly. Don't leak the message
      // to the client.
      console.error("[secureAction]", err, {
        route: new URL(request.url).pathname,
        userId: user.id,
        role: user.role,
        intent,
      });
      Sentry.captureException(err, { extra: { route: new URL(request.url).pathname, userId: user.id, role: user.role, intent } });
      return fail({ error: "Something went wrong. Please try again.", status: 500 });
    }
  };
}
