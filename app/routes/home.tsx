import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireAuth, ROLE_DASHBOARD_MAP } from "~/lib/auth.server";

/**
 * Root index route — redirects authenticated users to their
 * role-specific dashboard. Unauthenticated users are redirected
 * to /login by requireAuth().
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await requireAuth(request);
  // Guard against legacy users with an empty role (the role select
  // is now constrained to 4 values, but pre-migration users may still
  // have role="" — fail closed to /login rather than redirecting to
  // an undefined path).
  const target = ROLE_DASHBOARD_MAP[user.role as keyof typeof ROLE_DASHBOARD_MAP];
  throw redirect(target ?? "/login");
}

export default function Home() {
  return null;
}
