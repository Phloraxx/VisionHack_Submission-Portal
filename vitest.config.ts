import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"~": path.resolve(__dirname, "app"),
		},
	},
	test: {
		globals: true,
		setupFiles: ["./app/lib/__tests__/setup.ts"],
		environment: "node",
		include: ["app/**/*.test.ts"],
	},
});
