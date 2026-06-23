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
	// Close the SSR stream — renderToString sets up a ReadableStream but
	// never writes to it, leaving the client's decodeViaTurboStream hanging.
	// Inject a close call between the context script and the module script.
	// -----------------------------------------------------------------------
	const closeScript =
		'<script>window.__reactRouterContext?.streamController?.close();</script>\n';
	// The Scripts component renders the context script (sets up stream),
	// then immediately the module script (which triggers HydratedRouter →
	// decodeViaTurboStream). Inject our close between them.
	const enhancedHtml = html.replace(
		'</script><script type="module"',
		`</script>${closeScript}<script type="module"`,
	);

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

	return new Response(enhancedHtml, {
		headers: responseHeaders,
		status: responseStatusCode,
	});
}
