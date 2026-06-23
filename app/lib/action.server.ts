import * as Sentry from "@sentry/node";
import type PocketBase from "pocketbase";
import { data } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import type { ZodSchema } from "zod";
import { requireRole } from "./auth.server";
import { validateOrigin } from "./origin.server";
import type { Role, UserRecord } from "./types";

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

type Handler = (ctx: ActionContext) => unknown | Promise<unknown>;

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
 *  1. **Origin check** — Origin header validated against allow-list; 403 on mismatch.
 *  2. **Form parse** — reads the body as FormData; 400 on parse failure.
 *  3. **Auth** — caller must be one of `roles`; otherwise 403.
 *  4. **Intent dispatch** — the `intent` form field is exposed to the
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
export function secureAction(options: { roles: Role[]; schema?: ZodSchema }, handler: Handler) {
	return async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
		// 1. Origin check
		try {
			validateOrigin(request);
		} catch {
			return fail({ error: "Invalid request origin", status: 403 });
		}

		// 2. Form parse
		let formData: FormData;
		try {
			formData = await request.formData();
		} catch {
			return fail({ error: "Invalid form data", status: 400 });
		}

		// 3. Auth + role — catch redirects and return JSON instead
		let pb: PocketBase;
		let user: UserRecord;
		try {
			const auth = await requireRole(request, options.roles);
			pb = auth.pb;
			user = auth.user;
		} catch (err) {
			if (err instanceof Response) {
				// 401 = not authenticated (redirect to login), 403 = wrong role
				if (err.status === 401) {
					return fail({ error: "Authentication required", status: 401 });
				}
				// For any other redirect or error status, pass the status through
				if (err.status === 403) {
					return fail({ error: "Insufficient permissions", status: 403 });
				}
			}
			throw err;
		}

		// 4. Schema validation
		// NOTE: Object.fromEntries(formData.entries()) silently converts File
		// objects to filename strings. Routes with file uploads must use
		// formData.get("field") directly, not the schema validation path.
		if (options.schema) {
			// Guard: Object.fromEntries silently converts File objects to "[object File]"
			// strings. Routes with file uploads must use formData.get() directly.
			for (const [key, value] of formData.entries()) {
				if (value instanceof File && !(value.size === 0 && value.name === "")) {
					return fail({
						error: `File field "${key}" is not supported in schema validation. Use formData.get() directly.`,
						status: 400,
					});
				}
			}
			const parsed = options.schema.safeParse(Object.fromEntries(formData.entries()));
			if (!parsed.success) {
				return fail({
					fieldErrors: Object.fromEntries(
						Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [
							k,
							Array.isArray(v) ? v[0] : (v ?? "Invalid"),
						]),
					),
					status: 400,
				});
			}
			const ctx = {
				request,
				user,
				pb,
				formData,
				intent: String(formData.get("intent") ?? "").toLowerCase(),
				params: params as Record<string, string>,
				validated: parsed.data,
			} satisfies ActionContext;

			try {
				return (await handler(ctx)) as ActionResult;
			} catch (err) {
				if (process.env.NODE_ENV !== "production") {
					console.error("[secureAction]", err, {
						route: new URL(request.url).pathname,
						userId: user.id,
						role: user.role,
						intent: ctx.intent,
					});
				}
				Sentry.captureException(err, {
					extra: {
						route: new URL(request.url).pathname,
						userId: user.id,
						role: user.role,
						intent: ctx.intent,
					},
				});
				return fail({ error: "Something went wrong. Please try again.", status: 500 });
			}
		}

		// 5. (no schema) Dispatch
		const intent = String(formData.get("intent") ?? "").toLowerCase();
		const ctx = {
			request,
			user,
			pb,
			formData,
			intent,
			params: params as Record<string, string>,
		} satisfies ActionContext;

		try {
			return (await handler(ctx)) as ActionResult;
		} catch (err) {
			// Surface server-side errors uniformly. Don't leak the message
			// to the client.
			if (process.env.NODE_ENV !== "production") {
				console.error("[secureAction]", err, {
					route: new URL(request.url).pathname,
					userId: user.id,
					role: user.role,
					intent,
				});
			}
			Sentry.captureException(err, {
				extra: { route: new URL(request.url).pathname, userId: user.id, role: user.role, intent },
			});
			return fail({ error: "Something went wrong. Please try again.", status: 500 });
		}
	};
}
