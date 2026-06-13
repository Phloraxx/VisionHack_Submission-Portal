import { getEnv } from "./env.server";

// ---------------------------------------------------------------------------
// PocketBase mail hook endpoint
// ---------------------------------------------------------------------------
// Sends email via PocketBase's SMTP using the custom hook at
// POST /api/send-invite (deployed in pb_hooks/ on the PocketBase server).
//
// The hook uses PocketBase's own mail client, so SMTP is configured
// once in the PocketBase Admin UI (Settings → Mail). No external
// email service needed.

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  sent: boolean;
}

/**
 * Send a custom email via PocketBase's SMTP hook.
 *
 * Authenticates as PocketBase superuser (required by the hook) and
 * calls `POST /api/send-invite`. Note: this authenticates on every
 * call — if bulk sending is added, cache the superuser token for the
 * request lifetime.
 *
 * Returns `{ sent: true }` on success.
 * Returns `{ sent: false }` on failure — the caller should handle the error.
 */
export async function sendEmail({
  to,
  subject,
  html,
}: SendEmailOptions): Promise<SendEmailResult> {
  const env = getEnv();
  const pbUrl = env.POCKETBASE_URL.replace(/\/+$/, "");

  try {
    // Authenticate as superuser (one call per sendEmail invocation).
    // If bulk sending is ever added, cache the token for the request
    // lifetime to avoid re-authenticating for every email.
    const authResp = await fetch(
      `${pbUrl}/api/collections/_superusers/auth-with-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity: env.POCKETBASE_ADMIN_EMAIL,
          password: env.POCKETBASE_ADMIN_PASSWORD,
        }),
      },
    );

    if (!authResp.ok) {
      console.error("[email] Superuser auth failed");
      return { sent: false };
    }

    const { token } = (await authResp.json()) as { token: string };

    // Call the custom mail hook
    const mailResp = await fetch(`${pbUrl}/api/send-invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to, subject, html }),
    });

    if (!mailResp.ok) {
      console.error("[email] Hook returned", mailResp.status);
      return { sent: false };
    }

    return { sent: true };
  } catch (err) {
    console.error("[email] sendEmail failed:", err);
    return { sent: false };
  }
}
