import {
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	isRouteErrorResponse,
	useRouteLoaderData,
} from "react-router";
import { Toaster } from "sonner";
import type { Route } from "./+types/root";

import "./app.css";
// ^ Side-effect import: registers the stylesheet with the route manifest so
// SSR and the client resolve the same hashed asset. A `?url` import is
// resolved separately by each build environment, which emitted two different
// hashed CSS files in the Docker build and broke hydration (React #418).

/**
 * Runs before first paint: applies the saved theme so the page never flashes
 * the wrong one. `localStorage` throws in storage-blocked browsers, so the
 * read is guarded and the media query is the fallback.
 */
const THEME_INIT_SCRIPT = `(() => {
	try {
		const saved = localStorage.getItem("vh-theme");
		const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
		if ((saved || (prefersDark ? "dark" : "light")) === "dark") {
			document.documentElement.classList.add("dark");
		}
	} catch {}
})();`;

/**
 * Hands the per-request CSP nonce (minted in server.ts) to the inline theme
 * script, <Scripts /> and <ScrollRestoration /> so they render the nonce on
 * both server and client. entry.server builds the CSP header from the same
 * value, and React 19 hydration requires identical attributes on both sides.
 */
export function loader({ context }: Route.LoaderArgs) {
	return { nonce: context.nonce };
}

export function Layout({ children }: { children: React.ReactNode }) {
	const nonce = useRouteLoaderData<typeof loader>("root")?.nonce ?? "";
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
				<meta name="theme-color" content="#2a2620" media="(prefers-color-scheme: dark)" />
				<Meta />
				<Links />
				{/* Applies the saved theme before first paint. Inline so it is not a
				    render-blocking request; the nonce comes from the root loader and is
				    identical on server and client, keeping hydration clean. */}
				<script
					nonce={nonce}
					// biome-ignore lint/security/noDangerouslySetInnerHtml: static constant, no user input
					dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
				/>
			</head>
			<body className="min-h-screen bg-background text-foreground antialiased">
				{children}
				<Toaster
					position="bottom-right"
					toastOptions={{
						duration: 4000,
						style: {
							background: "var(--card)",
							color: "var(--card-foreground)",
							border: "1px solid var(--border)",
						},
					}}
				/>
				<ScrollRestoration nonce={nonce} />
				<Scripts nonce={nonce} />
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let message = "Something went wrong";
	let details = "An unexpected error occurred.";
	let stack: string | undefined;

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? "Page not found" : `${error.status}`;
		details =
			error.status === 404
				? "The page you are looking for does not exist."
				: import.meta.env.DEV
					? error.statusText || details
					: "Please try again or contact support.";
	} else if (import.meta.env.DEV && error && error instanceof Error) {
		details = error.message;
		stack = error.stack;
	}

	return (
		<main className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground p-8">
			<div className="mx-auto max-w-md text-center">
				<p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-danger">
					{isRouteErrorResponse(error) ? `Error ${error.status}` : "Error"}
				</p>
				<div className="mb-4 font-mono text-5xl font-bold tracking-tight text-muted-foreground/30">
					{isRouteErrorResponse(error) ? error.status : "!"}
				</div>
				<h1 className="mb-2 text-2xl font-semibold tracking-tight">{message}</h1>
				<p className="mb-8 text-sm text-muted-foreground">{details}</p>
				<a
					href="/login"
					className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
				>
					Back to sign in
				</a>
			</div>
			{stack && (
				<pre className="mt-8 w-full max-w-2xl overflow-x-auto rounded-lg border border-border bg-muted/50 p-4 text-xs">
					<code>{stack}</code>
				</pre>
			)}
		</main>
	);
}
