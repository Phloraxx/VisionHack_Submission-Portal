import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { clearAuthCookie } from "~/lib/auth.server";
import { validateOrigin } from "~/lib/csrf.server";
import { checkMutationRateLimit } from "~/lib/rate-limit.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  validateOrigin(request);

  // Rate limiting: 30 mutations per minute per IP
  if (!checkMutationRateLimit(request)) {
    return new Response("Too many requests", { status: 429 });
  }

  // Clear the auth cookie and redirect to login
  const cookie = clearAuthCookie();

  throw redirect("/login", {
    headers: { "Set-Cookie": cookie },
  });
}