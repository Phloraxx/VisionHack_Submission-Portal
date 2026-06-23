/**
 * Server-side entry point.
 *
 * Renders the app to a pipeable stream, matching React Router's expected
 * SSR pattern so that <Scripts /> receives the correct static context.
 */
import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { createReadableStreamFromReadable } from "@react-router/node";
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";

import { getEnv } from "./lib/env.server";

export default async function handleRequest(
	request: Request,
	responseStatusCode: number,
	responseHeaders: Headers,
	routerContext: EntryContext,
	_loadContext: AppLoadContext,
) {
	return new Promise<Response>((resolve, reject) => {
		let didError = false;
		const nonce = crypto.randomUUID();

		const { pipe, abort } = renderToPipeableStream(
			<ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
			{
				nonce,
				onShellReady() {
					responseHeaders.set("Content-Type", "text/html; charset=utf-8");

					// -----------------------------------------------------------------------
					// Security headers — defense-in-depth for every HTML response
					// -----------------------------------------------------------------------
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
								// RR7's <Scripts /> emits inline route-chunk mapping scripts without
								// nonce support, so 'unsafe-inline' is required.
								// NOTE: 'unsafe-inline' is silently dropped when a hash or nonce
								// appears in the same directive, so we keep only 'self' + 'unsafe-inline'.
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

					const body = new PassThrough();
					const stream = createReadableStreamFromReadable(body);
					resolve(
						new Response(stream, {
							headers: responseHeaders,
							status: didError ? 500 : responseStatusCode,
						}),
					);
					pipe(body);
				},
				onShellError(err: unknown) {
					reject(err);
				},
				onError(err: unknown) {
					didError = true;
					console.error(err);
				},
			},
		);
		// Abort the streaming render after 11 seconds to avoid hanging
		setTimeout(abort, 11_000);
	});
}
