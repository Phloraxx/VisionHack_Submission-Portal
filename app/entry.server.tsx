import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { renderToReadableStream } from "react-dom/server";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext
) {
  let shellRendered = false;

  // Use a mutable wrapper so onError can update the outer scope
  const status: { code: number } = { code: responseStatusCode };

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        status.code = 500;
        // Log streaming rendering errors from inside the shell.  Don't log
        // errors encountered during initial shell rendering since they'll
        // reject and get logged in handleDocumentRequest.
        if (shellRendered) {
          console.error(error);
        }
      },
    }
  );
  shellRendered = true;

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");

  // -----------------------------------------------------------------------
  // Security headers — defense-in-depth for every HTML response
  // -----------------------------------------------------------------------

  // Prevent MIME-type sniffing
  responseHeaders.set("X-Content-Type-Options", "nosniff");

  // Prevent clickjacking
  responseHeaders.set("X-Frame-Options", "DENY");

  // Limit referrer information sent cross-origin
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Disable sensitive browser features we don't use
  responseHeaders.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );

  // HSTS: only in production (Cloudflare already does TLS termination)
  const isProd =
    typeof import.meta !== "undefined" && import.meta.env?.PROD;
  if (isProd) {
    responseHeaders.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  // Content-Security-Policy: restrict script/style sources.
  // 'unsafe-inline' on style-src is needed for Tailwind/shadcn UI components.
  // Tighten this further once inline styles are audited.
  responseHeaders.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "connect-src 'self'",
    ].join("; "),
  );

  return new Response(body, {
    headers: responseHeaders,
    status: status.code,
  });
}
