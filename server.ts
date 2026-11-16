// First import on purpose: ESM evaluates imports in declaration order, so this
// initialises Sentry before any other module is loaded.
import "./app/lib/sentry.server.ts";
import fs from "node:fs";
import http from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { createRequestListener } from "@react-router/node";
import * as Sentry from "@sentry/node";
import type { ServerBuild } from "react-router";
import { getEnv } from "./app/lib/env.server.ts";

/** MIME types for static assets served from build/client/. */
const MIME: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".txt": "text/plain; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".html": "text/html; charset=utf-8",
};

/** Largest request body the HTTP layer accepts — the upload cap plus form overhead. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

const clientDir = path.resolve(import.meta.dirname, "build", "client");
const realClientDir = fs.realpathSync(clientDir);

let buildPromise: Promise<ServerBuild> | null = null;
const getBuild = (): Promise<ServerBuild> => {
	if (!buildPromise) {
		// @ts-expect-error — build/server/index.js only exists after `npm run build`
		buildPromise = import("./build/server/index.js");
	}
	return buildPromise;
};

const rrHandler = createRequestListener({
	build: getBuild,
	mode: process.env.NODE_ENV ?? "development",
	// Minted once per request and shared with the root loader and
	// entry.server so the CSP header and every rendered script tag use the
	// same nonce.
	getLoadContext: () => ({ nonce: crypto.randomUUID() }),
});

/**
 * Serve a file from `build/client/` when the request path maps to one.
 * Returns false so the caller can fall through to React Router.
 *
 * `realpath` + `stat` are async: they run on every static-asset request, and
 * the sync variants would block the event loop for the whole server.
 */
async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
	let url: URL;
	try {
		url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		if (url.pathname.includes("\0")) {
			res.writeHead(400);
			res.end("Bad Request");
			return true;
		}
	} catch {
		res.writeHead(400);
		res.end("Bad Request");
		return true;
	}

	// Only attempt static serving for GET/HEAD on paths whose extension maps to
	// our MIME table. Anything else (e.g. "/login") falls through to RR7.
	const ext = path.extname(url.pathname).toLowerCase();
	if ((req.method !== "GET" && req.method !== "HEAD") || !MIME[ext]) return false;

	const resolved = path.resolve(path.join(clientDir, url.pathname));
	const realResolved = await fs.promises.realpath(resolved).catch(() => null);
	if (!realResolved?.startsWith(realClientDir + path.sep)) return false;

	const stat = await fs.promises.stat(realResolved).catch(() => null);
	if (!stat?.isFile()) return false;

	// `mtime` carries milliseconds while an HTTP date has seconds, so truncate
	// before comparing: otherwise a file written mid-second never matches.
	const lastModified = stat.mtime.toUTCString();
	const cacheControl = url.pathname.startsWith("/assets/")
		? "public, max-age=31536000, immutable"
		: "no-cache";
	const ifModifiedSince = req.headers["if-modified-since"];
	if (
		ifModifiedSince &&
		Date.parse(ifModifiedSince) >= Math.floor(stat.mtime.getTime() / 1000) * 1000
	) {
		res.writeHead(304, { "Last-Modified": lastModified, "Cache-Control": cacheControl });
		res.end();
		return true;
	}

	res.writeHead(200, {
		"Content-Type": MIME[ext],
		"Content-Length": stat.size,
		"Cache-Control": cacheControl,
		"Last-Modified": lastModified,
		"X-Content-Type-Options": "nosniff",
	});
	if (req.method === "GET") {
		fs.createReadStream(realResolved)
			.on("error", () => {
				try {
					res.destroy();
				} catch {}
			})
			.pipe(res);
	} else {
		res.end();
	}
	return true;
}

const server = http.createServer((req, res) => {
	// Reject oversized bodies before React Router buffers them.
	const declaredLength = Number(req.headers["content-length"] ?? 0);
	if (declaredLength > MAX_BODY_BYTES) {
		res.writeHead(413, { Connection: "close" });
		res.end("Payload Too Large");
		return;
	}

	serveStatic(req, res)
		.then((served) => {
			if (served) return;
			rrHandler(req, res);

			// A chunked body declares no length, so the cap above cannot see it.
			// Count the bytes as React Router reads them and drop the connection
			// past the limit, before `formData()` buffers the whole thing.
			//
			// Attached *after* the handler on purpose: a `data` listener resumes
			// the stream, so attaching first would emit the body before the
			// handler's own listener exists and lose it.
			let received = 0;
			req.on("data", (chunk: Buffer) => {
				received += chunk.length;
				if (received > MAX_BODY_BYTES) req.destroy();
			});
		})
		.catch((err) => {
			console.error("[server] Static handler failed", err);
			if (!res.headersSent) res.writeHead(500);
			res.end();
		});
});

// Bound how long a slow or stalled client can hold a connection. A 10 MiB
// upload needs ~2.8 Mbit/s to finish inside 30 s, so the cap is 120 s.
server.requestTimeout = 120_000;
server.headersTimeout = 20_000;
server.keepAliveTimeout = 65_000;

process.on("uncaughtException", (err) => {
	Sentry.captureException(err);
	console.error("[server] Uncaught exception — exiting", err);
	// The process state is undefined after an uncaught exception; continuing to
	// serve risks corrupting data. Let the orchestrator restart us.
	process.exit(1);
});
process.on("unhandledRejection", (reason) => {
	Sentry.captureException(reason);
	console.error("[server] Unhandled rejection — exiting", reason);
	// Node's default is to terminate; installing a handler must not downgrade
	// that to "keep serving with undefined state".
	process.exit(1);
});

// Validate the environment before accepting traffic: a missing DATABASE_URL or
// a short APP_JWT_SECRET must fail the boot, not the first request.
const env = getEnv();
if (env.NODE_ENV === "production" && !env.TRUST_PROXY_HEADERS) {
	console.warn(
		"[SECURITY] TRUST_PROXY_HEADERS is not set to 1 in production. " +
			"Per-IP rate limiting on login/forgot-password is disabled — only the per-email bucket binds. " +
			"Set TRUST_PROXY_HEADERS=1 if the app is behind Cloudflare or a trusted ingress.",
	);
}

server.listen(env.PORT, () => {
	console.log(`Server listening on http://localhost:${env.PORT}`);
});

// Track open sockets for clean shutdown
const activeSockets = new Set<Socket>();
server.on("connection", (socket) => {
	activeSockets.add(socket);
	socket.once("close", () => activeSockets.delete(socket));
});

function gracefulShutdown(signal: string): void {
	console.log(`\n${signal} received. Shutting down gracefully...`);
	const forceExit = setTimeout(() => {
		console.error("[server] Forced exit after timeout");
		for (const socket of activeSockets) socket.destroy();
		activeSockets.clear();
		process.exit(1);
	}, 10_000);
	forceExit.unref();

	server.close(() => {
		clearTimeout(forceExit);
		console.log("HTTP server closed.");
		for (const socket of activeSockets) socket.destroy();
		activeSockets.clear();
		process.exit(0);
	});
	// `server.close()` waits for idle keep-alive sockets; drop those so the
	// close callback fires promptly without cutting off in-flight responses.
	server.closeIdleConnections();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
