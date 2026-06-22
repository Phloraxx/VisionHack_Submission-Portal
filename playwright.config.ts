import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
  },
  webServer: {
    command: "npm run build && npm run start:prod",
    port: 3000,
    timeout: 60000,
  },
});
