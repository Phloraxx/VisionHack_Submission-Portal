import { type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "react-router";
import { clearAuthCookie } from "~/lib/auth.server";
import { validateOrigin } from "~/lib/origin.server";

/** GET (or any non-POST) → 405 */
export async function loader(_args: LoaderFunctionArgs) {
	return new Response(JSON.stringify({ error: "Method not allowed" }), {
		status: 405,
		headers: { "Content-Type": "application/json" },
	});
}

export async function action({ request }: ActionFunctionArgs) {
	if (request.method !== "POST") {
		return new Response(JSON.stringify({ error: "Method not allowed" }), {
			status: 405,
			headers: { "Content-Type": "application/json" },
		});
	}
	// A state-changing POST must carry a matching Origin.
	validateOrigin(request, true);

	// Clear the auth cookie and redirect to login. Logout is idempotent and
	// costs no database work, so it carries no rate limit of its own.
	const cookie = clearAuthCookie();

	throw redirect("/login", {
		headers: {
			"Set-Cookie": cookie,
		},
	});
}
