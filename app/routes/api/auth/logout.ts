import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { clearAuthCookie } from "~/lib/auth.server";
import { validateOrigin } from "~/lib/origin.server";
import { validateCsrfToken } from "~/lib/csrf.server";

export async function action({ request }: ActionFunctionArgs) {
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}
	validateOrigin(request, true);

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
