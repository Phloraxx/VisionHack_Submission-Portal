import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

/**
 * Record a client-side route error.
 *
 * RR7 calls this for loader/action throws that reach the client; without it a
 * failed navigation is rendered and recorded nowhere (F-12/F-93).
 */
export function handleError(error: unknown): void {
	console.error("[route-error]", error);
}

startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<HydratedRouter />
		</StrictMode>,
	);
});
