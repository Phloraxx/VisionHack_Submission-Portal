import { renderToReadableStream } from "react-dom/server";
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";

import * as Sentry from "@sentry/node";
import { getEnv } from "./lib/env.server";

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
	loadContext: AppLoadContext,
) {
	// The nonce getLoadContext minted for this request. The root loader hands
	// the same value to <Scripts />, <ScrollRestoration /> and the inline theme
	// script, so server and client render identical script tags — React 19
	// fails hydration on attribute mismatches, which is what a previous
	// stamp-the-stream workaround tripped over (F-10).
	const nonce = loadContext.nonce;

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

	return new Response(body, {
		headers: responseHeaders,
		status: responseStatusCode,
	});
}
