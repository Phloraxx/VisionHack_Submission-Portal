/**
 * Sentry bootstrap.
 *
 * This lives in its own module because ESM evaluates every `import` before the
 * importing module's body: a `Sentry.init()` call written above the imports in
 * `server.ts` would still run after all of them. Importing this module first
 * makes the ordering real — Sentry is initialised before `node:http` and the
 * React Router server are loaded, which is what its instrumentation needs.
 */
import * as Sentry from "@sentry/node";

Sentry.init({
	dsn: process.env.SENTRY_DSN,
	environment: process.env.NODE_ENV ?? "development",
	enabled: !!process.env.SENTRY_DSN,
});
