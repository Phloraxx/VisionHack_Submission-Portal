import * as Sentry from "@sentry/node";
Sentry.init({
	dsn: process.env.SENTRY_DSN,
	environment: process.env.NODE_ENV ?? "development",
	enabled: !!process.env.SENTRY_DSN,
});
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequestListener } from "@react-router/node";
import type { ServerBuild } from "react-router";

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

const clientDir = path.resolve(import.meta.dirname, "build", "client");
const realClientDir = fs.realpathSync(clientDir);

let buildPromise: Promise<ServerBuild> | null = null;
const getBuild = (): Promise<ServerBuild> => {
	// @ts-expect-error — build output is not present during typecheck
	if (!buildPromise) buildPromise = import("./build/server/index.js") as Promise<ServerBuild>;
	return buildPromise;
};

const rrHandler = createRequestListener({
	// Cast: the built server bundle exports a ServerBuild-compliant object.
	// The dynamic import defers loading until first request (cold start).
	build: getBuild as () => Promise<ServerBuild>,
	mode: process.env.NODE_ENV ?? "development",
	getLoadContext: () => ({}),
});

const server = http.createServer((req, res) => {
	// -----------------------------------------------------------------------
	// Static file serving — serve build/client/ assets before falling
	// through to the React Router SSR handler.
	// -----------------------------------------------------------------------
	let url: URL;
	try {
		url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		if (url.pathname.includes("\0")) {
			res.writeHead(400);
			res.end("Bad Request");
			return;
		}
	} catch {
		res.writeHead(400);
		res.end("Bad Request");
		return;
	}

	// Only attempt static serving for GET/HEAD on paths without a file extension
	// that maps to our MIME table. Anything without a recognized extension
	// (e.g. "/login", "/admin/dashboard") falls through to RR7.
	const ext = path.extname(url.pathname).toLowerCase();
	if ((req.method === "GET" || req.method === "HEAD") && MIME[ext]) {
		const filePath = path.join(clientDir, url.pathname);

		// Prevent directory traversal — the resolved path must be inside clientDir.
		// Resolve symlinks so that a symlink outside clientDir can't bypass the check.
		const resolved = path.resolve(filePath);
		const realResolved = fs.realpathSync(resolved);
		if (realResolved.startsWith(realClientDir + path.sep)) {
			try {
				const stat = fs.statSync(resolved);
				if (stat.isFile()) {
					res.writeHead(200, {
						"Content-Type": MIME[ext],
						"Content-Length": stat.size,
						"Cache-Control":
							ext === ".html"
								? "no-cache"
								: url.pathname.startsWith("/assets/")
									? "public, max-age=31536000, immutable"
									: "no-cache",
						"X-Content-Type-Options": "nosniff",
					});
					if (req.method === "GET") {
						fs.createReadStream(resolved)
							.on("error", () => {
								try {
									res.destroy();
								} catch {}
							})
							.pipe(res);
					} else {
						res.end();
					}
					return;
				}
			} catch {
				// File not found — fall through to RR7 handler
			}
		}
	}

	// -----------------------------------------------------------------------
	// React Router SSR handler
	// -----------------------------------------------------------------------
	rrHandler(req, res);
});

process.on("uncaughtException", (err) => {
	Sentry.captureException(err);
	console.error("[server] Uncaught exception — exiting");
	process.exit(1);
});
process.on("unhandledRejection", (reason) => {
	Sentry.captureException(reason);
	console.error("[server] Unhandled rejection — exiting");
	process.exit(1);
});

const rawPort = process.env.PORT ? Number(process.env.PORT) : 3000;
const port = Number.isFinite(rawPort) ? rawPort : 3000;
server.listen(port, () => {
	console.log(`Server listening on http://localhost:${port}`);
});

function gracefulShutdown(signal: string): void {
	console.log(`\n${signal} received. Shutting down gracefully...`);
	const forceExit = setTimeout(() => {
		console.error("[server] Forced exit after timeout");
		process.exit(1);
	}, 10000);
	server.close(() => {
		clearTimeout(forceExit);
		console.log("HTTP server closed.");
		process.exit(0);
	});
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
