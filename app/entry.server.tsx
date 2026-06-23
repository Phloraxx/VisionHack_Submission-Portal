import { renderToString } from "react-dom/server";
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";

import { getEnv } from "./lib/env.server";

export default function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
	_loadContext: AppLoadContext,
) {
	const nonce = crypto.randomUUID();

	const html = renderToString(
		<ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
	);

	// -----------------------------------------------------------------------
	// Inject missing SSR globals — RR7's <Scripts /> skips route-module
	// and manifest registration when isStatic is false (v7.17 bug). The
	// client HydratedRouter needs these to bootstrap the browser router.
	// -----------------------------------------------------------------------
	const entryModule = routerContext.manifest.entry.module;
	const partialManifest = {
		routes: routerContext.manifest.routes,
		entry: routerContext.manifest.entry,
		url: routerContext.manifest.url,
		version: routerContext.manifest.version,
	};
	const manifestScript = `<script>window.__reactRouterManifest = ${JSON.stringify(partialManifest)};</script>\n`;

	// Route modules: each module's client-side import path is in manifest.routes
	const routeModules: Record<string, string> = {};
	for (const [id, route] of Object.entries(routerContext.manifest.routes)) {
		if (route && typeof route === "object" && "module" in route && route.module) {
			routeModules[id] = String(route.module);
		}
	}
	const routeModulesScript = `<script>window.__reactRouterRouteModules = ${JSON.stringify(routeModules)};</script>\n`;

	const entryScript = `<script type="module" async src="${entryModule}"></script>\n`;

	const fullHtml = html.replace(
		"</body>",
		`${manifestScript}${routeModulesScript}${entryScript}</body>`,
	);

	responseHeaders.set("X-XSS-Protection", "0");

	if (process.env.NODE_ENV === "production") {
		responseHeaders.set(
			"Content-Security-Policy",
			[
				"default-src 'self'",
				"script-src 'self' 'unsafe-inline'",
				"style-src 'self' 'unsafe-inline'",
				"img-src 'self' data: blob:",
				"font-src 'self' data:",
				"frame-ancestors 'none'",
				"form-action 'self'",
				`connect-src 'self'${getEnv().SENTRY_DSN ? " https://*.sentry.io" : ""}`,
				"base-uri 'self'",
				"object-src 'none'",
			].join("; "),
		);
		responseHeaders.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	}

	return new Response(fullHtml, {
		headers: responseHeaders,
		status: responseStatusCode,
	});
}
