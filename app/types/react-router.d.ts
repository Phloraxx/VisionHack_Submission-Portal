/**
 * The per-request load context minted in server.ts (getLoadContext) and
 * shared with route loaders and entry.server for the CSP nonce flow.
 *
 * The import keeps this file a module so the `declare module` below is an
 * *augmentation* of react-router's types rather than an ambient override.
 */
import type {} from "react-router";

declare module "react-router" {
	interface AppLoadContext {
		/** CSP nonce for this request; used by the root loader and entry.server. */
		nonce: string;
	}
}
