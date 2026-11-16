import type { Config } from "@react-router/dev/config";

export default {
	ssr: true,
	// 4 routes: ship the full manifest with the initial document. Lazy
	// discovery only pays off with many routes; here it just adds a runtime
	// /__manifest fetch and re-render after hydration.
	routeDiscovery: { mode: "initial" },
	future: {
		v8_viteEnvironmentApi: true,
	},
} satisfies Config;
