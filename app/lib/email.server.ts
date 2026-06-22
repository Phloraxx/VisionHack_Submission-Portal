/**
 * Transactional email integration via Resend.
 *
 * Sends emails using the Resend REST API with a `fetch` call — no SDK dependency.
 * The API key is read from environment config so it can be set via secrets
 * (Cloudflare Workers) or local .dev.vars files.
 *
 * Calls are best-effort: a missing or invalid API key logs a warning and returns
 * without throwing. Callers should wrap in try/catch when the email is non-critical.
 */

import { getEnv } from "./env.server";

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "VisionHack <noreply@visionhack.mulearn.org>";

/**
 * Send a transactional email through Resend.
 *
 * When `RESEND_API_KEY` is not configured, logs a warning and returns
 * without error — this keeps local dev and CI happy without email setup.
 *
 * @throws if the API returns a non-2xx status.
 */
export async function sendEmail(
  options: { to: string; subject: string; html: string },
): Promise<void> {
  const apiKey = getEnv().RESEND_API_KEY;

  if (!apiKey) {
    console.warn(
      "[email] RESEND_API_KEY is not configured — skipping email send.",
    );
    return;
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: DEFAULT_FROM,
      to: options.to,
      subject: options.subject,
      html: options.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(no body)");
    throw new Error(
      `Resend API returned ${response.status}: ${body}`,
    );
  }
}
