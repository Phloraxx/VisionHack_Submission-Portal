import { type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "react-router";
import { clearAuthCookie } from "~/lib/auth.server";
import { validateCsrfToken } from "~/lib/csrf.server";
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
	validateOrigin(request, false);

	const formData = await request.formData();
	validateCsrfToken(request, formData);

	// Clear the auth cookie and redirect to login. Rate limiting is handled
	// by PocketBase's built-in settings.
	const cookie = clearAuthCookie();

	throw redirect("/login", {
		headers: {
			"Set-Cookie": cookie,
		},
	});
}
