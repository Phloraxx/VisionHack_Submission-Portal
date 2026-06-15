import { createRequestHandler } from "@react-router/express";
import express from "express";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env file in development (Docker / production uses env vars directly)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, ".env");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const app = express();

if (process.env.NODE_ENV === "production") {
  // Serve static assets
  app.use(express.static("build/client"));

  // Handle SSR
  const build = await import("./build/server/index.js");
  app.all("*", createRequestHandler({ build }));
} else {
  // Dev mode with Vite middleware
  const vite = await import("vite");
  const viteDevServer = await vite.createServer({
    server: { middlewareMode: true },
  });
  app.use(viteDevServer.middlewares);
  app.use(
    createRequestHandler({
      build: () =>
        viteDevServer.ssrLoadModule("virtual:react-router/server-build"),
    })
  );
}

const port = process.env.PORT || 3000;
createServer(app).listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
