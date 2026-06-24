import * as Sentry from "@sentry/node";
import type PocketBase from "pocketbase";
import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "./auth.server";
import type { Role, UserRecord } from "./types";

/**
 * Per-request context passed to a `secureLoader` handler.
 *
 * - `request` is the raw Request (rarely needed inside the handler)
 * - `user` is the authenticated PocketBase user record
 * - `pb` is a fresh authenticated PocketBase client
 * - `params` is the route's URL params (e.g. `teamId` from
 *   `/admin/teams/:teamId`)
 */
export interface LoaderContext {
	request: Request;
	user: UserRecord;
	pb: PocketBase;
	params: Record<string, string>;
}

type LoaderHandler<C extends LoaderContext> = (ctx: C) => unknown | Promise<unknown>;

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
 *   async ({ user, pb }) => {
 *     const items = await pb.collection("...").getList(1, 10);
 *     return { items };
 *   },
 * );
 */
export function secureLoader<C extends LoaderContext = LoaderContext>(
	options: { roles: Role[] },
	handler: LoaderHandler<C>,
) {
	return async ({ request, params }: LoaderFunctionArgs): Promise<unknown> => {
		// 1. Auth + role — catch redirects and return JSON instead
		let pb: PocketBase;
		let user: UserRecord;
		try {
			const auth = await requireRole(request, options.roles);
			pb = auth.pb;
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
			pb,
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
