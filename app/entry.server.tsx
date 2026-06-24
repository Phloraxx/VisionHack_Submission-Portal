import { renderToReadableStream } from "react-dom/server";
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";

import * as Sentry from "@sentry/node";
import { getEnv } from "./lib/env.server";

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
	_loadContext: AppLoadContext,
) {
	const nonce = crypto.randomUUID();

	const body = await renderToReadableStream(
		<ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
		{
			onError(error) {
				console.error(error);
				Sentry.captureException(error);
			},
		},
	);

	// -----------------------------------------------------------------------
	// Inject the route module and manifest scripts that RR7's <Scripts />
	// omits when isStatic is false (v7.17 bug). We generate the same
	// content Scripts would produce if isStatic were true.
	// -----------------------------------------------------------------------
	const manifest = routerContext.manifest;
	const entryModule = manifest.entry.module;
	const routes = manifest.routes;
	const routeEntries = Object.entries(routes).filter(([, r]) => r?.module);

	// Build route import statements & module registry
	const importLines: string[] = [];
	const moduleEntries: string[] = [];
	routeEntries.forEach(([id, route], i) => {
		if (!route?.module) return;
		const vn = `route${i}`;
		importLines.push(`import * as ${vn} from ${JSON.stringify(route.module)};`);
		moduleEntries.push(`${JSON.stringify(id)}:${vn}`);
	});

	const manifestJson = JSON.stringify({
		entry: manifest.entry,
		routes: manifest.routes,
		url: manifest.url,
		version: manifest.version,
	});

	const moduleScript = [
		"",
		...importLines,
		`  window.__reactRouterManifest = ${manifestJson};`,
		`  window.__reactRouterRouteModules = {${moduleEntries.join(",")}};`,
		"",
		`import(${JSON.stringify(entryModule)});`,
	].join("\n");

	const patch = `<script type="module" async="" nonce="${nonce}">${moduleScript}</script>\n`;

	const transform = new TransformStream<Uint8Array, Uint8Array>();
	const writer = transform.writable.getWriter();
	const encoder = new TextEncoder();
	const injectTarget = /<\/body\s*>/i;

	(async () => {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let injected = false;
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				if (!injected) buffer = buffer.replace(injectTarget, `${patch}$&`);
				await writer.write(encoder.encode(buffer));
				await writer.close();
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			if (!injected) {
				const idx = buffer.search(injectTarget);
				if (idx !== -1) {
					injected = true;
					await writer.write(encoder.encode(buffer.slice(0, idx) + patch));
					buffer = buffer.slice(idx);
				}
			}
		}
	})().catch((err) => {
		writer.abort(err);
		console.error("[entry.server] Stream transform error:", err);
	});

	responseHeaders.set("Content-Type", "text/html; charset=utf-8");
	responseHeaders.set("X-Content-Type-Options", "nosniff");
	responseHeaders.set("X-Frame-Options", "DENY");
	responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
	responseHeaders.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
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

	return new Response(transform.readable, {
		headers: responseHeaders,
		status: responseStatusCode,
	});
}
