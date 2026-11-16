import { createRequire } from "node:module";
import { renderToReadableStream } from "react-dom/server";
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";

import * as Sentry from "@sentry/node";
import { getEnv } from "./lib/env.server";

/**
 * React Router version this file's manifest/script injection was written
 * against (audit finding F-10).
 *
 * RR7 7.17 omits the route-module and manifest scripts from `<Scripts />`
 * when `isStatic` is false, so the injection below re-creates them by hand.
 * If the framework is upgraded, re-check whether the workaround is still
 * needed before bumping this constant.
 */
const PATCHED_ROUTER_VERSION = "7.17.";

/** Installed React Router version, read once at boot. */
function installedRouterVersion(): string {
	try {
		const require = createRequire(import.meta.url);
		return String((require("react-router/package.json") as { version?: string }).version ?? "");
	} catch {
		return "";
	}
}

const routerVersion = installedRouterVersion();
if (routerVersion && !routerVersion.startsWith(PATCHED_ROUTER_VERSION)) {
	console.warn(
		`[entry.server] React Router ${routerVersion} is not the ${PATCHED_ROUTER_VERSION}x line this manifest injection was written for (F-10). Verify the workaround still applies.`,
	);
}

/**
 * Record a server-side route error.
 *
 * RR7 calls this for loader/action throws, which never reach `onError` below —
 * without it a 500 is rendered and recorded nowhere (F-12/F-93).
 */
export function handleError(error: unknown, { request }: { request: Request }): void {
	console.error("[route-error]", error, { url: request.url });
	Sentry.captureException(error, { extra: { url: request.url } });
}

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
			nonce,
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
	// Match <script tags that do NOT already carry a nonce attribute.
	const nonceRe = /<script(?![^>]*\bnonce=)/g;
	const addNonce = (html: string) => html.replace(nonceRe, `<script nonce="${nonce}"`);

	(async () => {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let pending = "";
		let injected = false;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			pending += decoder.decode(value, { stream: true });
			if (!injected) {
				const idx = pending.search(injectTarget);
				if (idx !== -1) {
					injected = true;
					pending = pending.slice(0, idx) + patch + pending.slice(idx);
				}
			}

			// Write through immediately, holding back only the tail from the last
			// `<` so a tag is never split across chunks (the nonce rewrite needs
			// the whole tag to see whether it already has one).
			const cut = pending.lastIndexOf("<");
			const ready = cut === -1 ? pending : pending.slice(0, cut);
			if (ready) {
				pending = pending.slice(ready.length);
				await writer.write(encoder.encode(addNonce(ready)));
			}
		}

		// Flush the decoder: a multi-byte sequence split across the final chunk
		// would otherwise be dropped.
		pending += decoder.decode();
		if (!injected) pending = pending.replace(injectTarget, `${patch}$&`);
		if (pending) await writer.write(encoder.encode(addNonce(pending)));
		await writer.close();
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
				`script-src 'self' 'nonce-${nonce}'`,
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
