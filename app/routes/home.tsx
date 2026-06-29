import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireAuth } from "~/lib/auth.server";
import { ROLE_DASHBOARD_MAP } from "~/lib/team-policy";

/**
 * Root index route — redirects authenticated users to their
 * role-specific dashboard. Unauthenticated users are redirected
 * to /login by requireAuth().
 */
export async function loader({ request }: LoaderFunctionArgs) {
	const { user } = await requireAuth(request);
	// Guard against legacy users with an empty role or unknown role value.
	// Redirecting to /login for an already-authenticated user would loop.
	const target = ROLE_DASHBOARD_MAP[user.role as keyof typeof ROLE_DASHBOARD_MAP];
	if (!target) {
		throw new Response("No dashboard configured for your account role. Contact support.", {
			status: 403,
		});
	}
	throw redirect(target);
}

export default function Home() {
	return null;
}
