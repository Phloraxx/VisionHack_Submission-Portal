/**
 * Admin-only email outbox drain. Used as a recovery action when the
 * inline fire-and-forget drain in sendEmail() is interrupted (e.g. CF
 * isolate cold start) and messages are stuck in status=pending.
 *
 * POST /api/email/drain
 *   → 200 { sent: number, failed: number }
 *
 * The admin can also poll the email_outbox collection directly via PB's
 * admin UI to inspect failed messages.
 */
import type { ActionFunctionArgs } from "react-router";
import { requireAuthJson } from "~/lib/auth.server";
import { validateOrigin } from "~/lib/csrf.server";
import { drainOutbox } from "~/lib/email.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  validateOrigin(request);

  const auth = await requireAuthJson(request);
  if (auth instanceof Response) return auth;
  if (auth.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await drainOutbox();
  return Response.json(result, { status: 200 });
}
