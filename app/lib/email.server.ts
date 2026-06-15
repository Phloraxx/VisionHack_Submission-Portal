import { getEnv } from "./env.server";

// ---------------------------------------------------------------------------
// PocketBase mail hook — uses superuser token from env
// ---------------------------------------------------------------------------
// Sends email via PocketBase's custom hook at POST /api/send-invite.
// Authenticates using the pre-generated POCKETBASE_SUPER_TOKEN env var —
// no email/password exchange needed.

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  sent: boolean;
}

export async function sendEmail({
  to,
  subject,
  html,
}: SendEmailOptions): Promise<SendEmailResult> {
  const env = getEnv();
  const pbUrl = env.POCKETBASE_URL.replace(/\/+$/, "");

  try {
    const mailResp = await fetch(`${pbUrl}/api/send-invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.POCKETBASE_SUPER_TOKEN}`,
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
