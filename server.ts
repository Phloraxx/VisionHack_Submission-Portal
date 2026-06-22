import "dotenv/config";
import * as Sentry from "@sentry/node";
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "development",
  enabled: !!process.env.SENTRY_DSN,
});
import { createRequestListener } from "@react-router/node";
import type { ServerBuild } from "react-router";
import http from "node:http";


const handler = createRequestListener({
  // Cast: the built server bundle exports a ServerBuild-compliant object.
  // The dynamic import defers loading until first request (cold start).
  build: (() => {
    // @ts-expect-error — the build output is a plain JS file without types;
    // we cast it to ServerBuild at runtime.
    return import("./build/server/index.js") as Promise<ServerBuild>;
  }) as () => Promise<ServerBuild>,
  mode: process.env.NODE_ENV ?? "development",
  getLoadContext: () => ({}),
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const server = http.createServer(handler);

process.on("uncaughtException", (err) => {
  Sentry.captureException(err);
});
process.on("unhandledRejection", (reason) => {
  Sentry.captureException(reason);
});

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

/**
 * Close the HTTP server gracefully and exit the process.
 */
function gracefulShutdown(signal: string): void {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
