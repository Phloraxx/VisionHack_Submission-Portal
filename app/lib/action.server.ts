import * as Sentry from "@sentry/node";
import { data } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import type { ZodSchema } from "zod";
import { type AuthResult, getAuthFromCookie, requireRole, setAuthCookie } from "./auth.server";
import type { Db } from "./db.server";
import { validateOrigin } from "./origin.server";
import { withCookie } from "./response.server";
import type { Role, UserRecord } from "./types";
import { extractFieldErrors } from "./utils";

/**
 * Per-request context passed to a `secureAction` handler.
 *
 * - `request` is the raw Request (rarely needed inside the handler)
 * - `user` is the authenticated user record
 * - `db` is the Postgres handle for the route's data reads
 * - `formData` is the parsed form payload
 * - `intent` is the `intent` field from the form, normalized to lowercase
 * - `params` is the route's URL params (e.g. `teamId` from
 *   `/admin/teams/:teamId`)
 */
export interface ActionContext {
	request: Request;
	user: UserRecord;
	db: Db;
	formData: FormData;
	intent: string;
	params: Record<string, string>;
	validated?: unknown;
	/** Pre-extracted File fields when `fileFields` option is used. */
	fileFields?: Record<string, File>;
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
 * Run the handler, turning an unexpected throw into a logged 500.
 *
 * A thrown `Response` (redirect, 403) is re-thrown untouched — those are
 * control flow, not failures.
 */
async function runHandler(
	handler: Handler,
	ctx: ActionContext,
	auth: AuthResult,
	originalToken: string | null,
): Promise<ActionResult> {
	try {
		const cookie = auth.token === originalToken ? null : setAuthCookie(auth.token);
		return withCookie(await handler(ctx), cookie);
	} catch (err) {
		if (err instanceof Response) throw err;
		const context = {
			route: new URL(ctx.request.url).pathname,
			userId: auth.user.id,
			role: auth.user.role,
			intent: ctx.intent,
		};
		// Always log: with SENTRY_DSN unset, Sentry is a no-op and a
		// production-only console.error would record nothing at all.
		console.error("[secureAction]", err, context);
		Sentry.captureException(err, { extra: context });
		return fail({ error: "Something went wrong. Please try again.", status: 500 });
	}
}

/**
 * Wrap a route action with the security checks every action MUST run.
 *
 *  1. **Origin check** — Origin header validated against allow-list; 403 on mismatch.
 *  2. **Auth** — caller must be one of `roles`; otherwise 403. Runs before the
 *     body is read, so an unauthenticated client cannot force a multipart parse.
 *  3. **Form parse** — reads the body as FormData; 400 on parse failure.
 *  4. **Intent dispatch** — the `intent` form field is exposed to the
 *     handler so multi-intent actions can `switch` on it.
 *
 * Rate limiting is intentionally NOT in the wrapper — it must run BEFORE
 * the body is read (so the wrapper can't apply it). If a per-route rate
 * limit is needed, do it inside the handler.
 *
 * ```ts
 * export const action = secureAction(
 *   { roles: ["lead"] },
 *   async ({ formData, user, intent }) => {
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
export function secureAction(
	options: { roles: Role[]; schema?: ZodSchema; fileFields?: string[] },
	handler: Handler,
) {
	return async ({ request, params }: ActionFunctionArgs): Promise<ActionResult> => {
		// 1. Origin check
		try {
			validateOrigin(request, true);
		} catch {
			return fail({ error: "Invalid request origin", status: 403 });
		}

		// 2. Auth + role — catch redirects and return JSON instead
		const originalToken = getAuthFromCookie(request);
		let auth: AuthResult;
		try {
			auth = await requireRole(request, options.roles);
		} catch (err) {
			if (err instanceof Response) {
				// 403 = wrong role; unauthenticated users get a 302 redirect to
				// /login (from requireAuth) — that falls through to `throw err`
				// below, which is the intended behavior for HTML form actions.
				if (err.status === 403) {
					return fail({ error: "Insufficient permissions", status: 403 });
				}
			}
			throw err;
		}

		// 3. Form parse
		let formData: FormData;
		try {
			formData = await request.formData();
		} catch {
			return fail({ error: "Invalid form data", status: 400 });
		}

		// 4. Schema validation
		// Pre-extract declared File fields so they don't get mangled by
		// Object.fromEntries (which converts Files to "[object File]" strings).
		const extractedFiles: Record<string, File> = {};
		if (options.fileFields) {
			for (const key of options.fileFields) {
				const value = formData.get(key);
				if (value instanceof File && !(value.size === 0 && value.name === "")) {
					extractedFiles[key] = value;
				}
			}
		}

		let validated: unknown;
		if (options.schema) {
			// Build a plain-object snapshot of FormData, omitting extracted file
			// fields so they don't pollute the zod parse.
			const formEntries = Object.fromEntries(formData.entries());
			for (const key of Object.keys(extractedFiles)) {
				delete formEntries[key];
			}
			const parsed = options.schema.safeParse(formEntries);
			if (!parsed.success) {
				return fail({
					fieldErrors: extractFieldErrors(parsed.error),
					status: 400,
				});
			}
			validated = parsed.data;
		}

		// 5. Handler dispatch
		const ctx = {
			request,
			user: auth.user,
			db: auth.db,
			formData,
			intent: String(formData.get("intent") ?? "").toLowerCase(),
			params: params as Record<string, string>,
			validated,
			fileFields: Object.keys(extractedFiles).length > 0 ? extractedFiles : undefined,
		} satisfies ActionContext;

		return runHandler(handler, ctx, auth, originalToken);
	};
}
