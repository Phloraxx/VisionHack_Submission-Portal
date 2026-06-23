import { renderToReadableStream } from "react-dom/server";
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
	let shellRendered = false;

	// Generate a per-request nonce for CSP. React 19 stamps all inline
	// <script> tags with this nonce so hydration and client boot scripts
	// are trusted without resorting to 'unsafe-inline' in production.
	const nonce = crypto.randomUUID();

	// Use a mutable wrapper so onError can update the outer scope
	const status: { code: number } = { code: responseStatusCode };

	const body = await renderToReadableStream(
		<ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
		{
			nonce, // React 19 stamps inline scripts with this nonce
			onError(error: unknown) {
				status.code = 500;
				if (shellRendered) {
					console.error(error);
				}
			},
		},
	);
	shellRendered = true;

	responseHeaders.set("Content-Type", "text/html; charset=utf-8");

	// -----------------------------------------------------------------------
	// Security headers — defense-in-depth for every HTML response
	// -----------------------------------------------------------------------

	responseHeaders.set("X-Content-Type-Options", "nosniff");
	responseHeaders.set("X-Frame-Options", "DENY");
	responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
	responseHeaders.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	responseHeaders.set("X-XSS-Protection", "0");

	// Content-Security-Policy: nonce-based. React 19 stamps every inline
	// <script> emitted by ServerRouter with the nonce we pass in. The
	// theme script in app/root.tsx must also be nonce-stamped — we do
	// that in the layout via `nonce={...}` on the <script> tag.
	const isProd = process.env.NODE_ENV === "production";

	// Strict nonce-based CSP only in production — Vite's HMR injects
	// unnonce-stamped inline scripts in dev that would all be blocked.
	if (isProd) {
		responseHeaders.set(
			"Content-Security-Policy",
			[
				"default-src 'self'",
				`script-src 'self' 'nonce-${nonce}'`,
				`style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
				"img-src 'self' data: blob:",
				"font-src 'self' data:",
				"frame-ancestors 'none'",
				"form-action 'self'",
				`connect-src 'self'${getEnv().SENTRY_DSN ? " https://*.sentry.io" : ""}`,
				"base-uri 'self'",
				"object-src 'none'",
			].join("; "),
		);
	}

	// HSTS: only in production
	if (isProd) {
		responseHeaders.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	}

	return new Response(body, {
		headers: responseHeaders,
		status: status.code,
	});
}
