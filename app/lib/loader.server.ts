import * as Sentry from "@sentry/node";
import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "./auth.server";
import type { Db } from "./db.server";
import type { Role, UserRecord } from "./types";

/**
 * Per-request context passed to a `secureLoader` handler.
 *
 * - `request` is the raw Request (rarely needed inside the handler)
 * - `user` is the authenticated user record
 * - `db` is the Postgres handle for the route's data reads
 * - `params` is the route's URL params (e.g. `teamId` from
 *   `/admin/teams/:teamId`)
 */
export interface LoaderContext {
	request: Request;
	user: UserRecord;
	db: Db;
	params: Record<string, string>;
}

type LoaderHandler<C extends LoaderContext, R> = (ctx: C) => R | Promise<R>;

/**
 * Wrap a route loader with authentication and role checks.
 *
 * Every loader that requires authentication should use this wrapper
 * instead of calling `requireRole` directly — it guarantees the role
 * check isn't forgotten.
 *
 * Loaders are GET-only so CSRF protection is unnecessary; only
 * authentication and role authorization are enforced.
 *
 * @example
 * export const loader = secureLoader(
 *   { roles: ["admin"] },
 *   async ({ user, db }) => {
 *     const items = await db.query("SELECT … FROM teams LIMIT 10");
 *     return { items };
 *   },
 * );
 */
export function secureLoader<C extends LoaderContext = LoaderContext, R = unknown>(
	options: { roles: Role[] },
	handler: LoaderHandler<C, R>,
) {
	return async ({ request, params }: LoaderFunctionArgs): Promise<R | ReturnType<typeof data>> => {
		// 1. Auth + role — catch redirects and return JSON instead
		let db: Db;
		let user: UserRecord;
		try {
			const auth = await requireRole(request, options.roles);
			db = auth.db;
			user = auth.user;
		} catch (err) {
			if (err instanceof Response) {
				// Navigation (SSR) requests expect HTML; let the redirect flow
				// so the browser follows to /login. Only return JSON for API/data
				// requests that don't accept text/html.
				const isNavigation = request.headers.get("Accept")?.includes("text/html");
				if (isNavigation) throw err;

				if (err.status === 401) {
					return data({ error: "Authentication required" }, { status: 401 });
				}
				if (err.status === 403) {
					return data({ error: "Insufficient permissions" }, { status: 403 });
				}
			}
			throw err;
		}

		// 2. Build context and dispatch
		const ctx = {
			request,
			user,
			db,
			params: params as Record<string, string>,
		} as C;

		try {
			return await handler(ctx);
		} catch (err) {
			if (process.env.NODE_ENV !== "production") {
				console.error("[secureLoader]", err, {
					route: new URL(request.url).pathname,
					userId: user.id,
					role: user.role,
				});
			}
			Sentry.captureException(err, {
				extra: {
					route: new URL(request.url).pathname,
					userId: user.id,
					role: user.role,
				},
			});
			throw err;
		}
	};
}
