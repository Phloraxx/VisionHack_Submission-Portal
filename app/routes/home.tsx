import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireAuth, ROLE_DASHBOARD_MAP } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await requireAuth(request);
  throw redirect(ROLE_DASHBOARD_MAP[user.role]);
}

export default function Home() {
  return null;
}
