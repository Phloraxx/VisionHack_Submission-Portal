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

	const nonce = crypto.randomUUID();
	const status: { code: number } = { code: responseStatusCode };

	const body = await renderToReadableStream(
		<ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
		{
			nonce,
			onError(error: unknown) {
				status.code = 500;
				if (shellRendered) {
					console.error(error);
				}
			},
		},
	);
	shellRendered = true;

	// -----------------------------------------------------------------------
	// Inject the entry.client module script — RR7's <Scripts /> component
	// fails to render it in v7.17 due to an internal isStatic check. We read
	// the entry module from the build manifest and inject it before </body>.
	// -----------------------------------------------------------------------
	const entryModule = routerContext.manifest.entry.module;
	const transform = new TransformStream<Uint8Array, Uint8Array>();
	const writer = transform.writable.getWriter();
	const encoder = new TextEncoder();

	(async () => {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				// Inject entry script before the closing body tag
				const script = `<script type="module" async src="${entryModule}"></script>\n`;
				buffer = buffer.replace("</body>", `${script}</body>`);
				await writer.write(encoder.encode(buffer));
				await writer.close();
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			// Flush everything before </body> as we receive it, inject script at the boundary
			const bodyIdx = buffer.indexOf("</body>");
			if (bodyIdx !== -1) {
				const before = buffer.slice(0, bodyIdx);
				const script = `<script type="module" async src="${entryModule}"></script>\n`;
				await writer.write(encoder.encode(before + script));
				buffer = "</body>" + buffer.slice(bodyIdx + 7);
			}
		}
	})();

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
		status: status.code,
	});
}
