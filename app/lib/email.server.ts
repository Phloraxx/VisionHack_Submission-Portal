import { getEnv } from "./env.server";
import { createSuperuserClient } from "./pocketbase.server";

/**
 * Email outbox — we never block a user-facing request on the SMTP round
 * trip. The route action enqueues the message to PB's `email_outbox`
 * collection with status=pending, then fires a background drain. If the
 * drain fails, the message stays pending and the next request that
 * touches the outbox (any admin action) will retry.
 *
 * In production on Cloudflare, "background" means "triggered from the
 * same request lifecycle" — CF Workers don't have long-lived background
 * processes. The drain runs as a `waitUntil`-style detached promise so
 * the user response is not blocked, but it executes within the
 * lifetime of the request. That is good enough for a hackathon-scale
 * event; a real durable queue (Cloudflare Queues, or a cron) would be
 * the production answer.
 */

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  enqueued: boolean;
  /** True if the message was actually delivered during this call. */
  sent: boolean;
}

/** Enqueue a message and best-effort drain the outbox. */
export async function sendEmail({
  to,
  subject,
  html,
}: SendEmailOptions): Promise<SendEmailResult> {
  try {
    const pb = createSuperuserClient();
    await pb.collection("email_outbox").create({
      to,
      subject,
      html,
      status: "pending",
      attempts: 0,
    });
    // Fire-and-forget drain. If it errors, the next sender will retry.
    void drainOutbox().catch((err) =>
      console.error("[email] drainOutbox failed:", err),
    );
    return { enqueued: true, sent: false };
  } catch (err) {
    console.error("[email] enqueue failed:", err);
    return { enqueued: false, sent: false };
  }
}

/**
 * Drain all pending messages in the outbox by calling PB's `/api/send-invite`
 * hook. Called automatically after every enqueue and may also be called
 * manually by an admin (e.g. as a recovery action).
 */
export async function drainOutbox(limit = 25): Promise<{ sent: number; failed: number }> {
  const pb = createSuperuserClient();
  const env = getEnv();
  const pbUrl = env.POCKETBASE_URL.replace(/\/+$/, "");

  // Only pick up messages that haven't been tried in the last 30s —
  // prevents tight loops if the SMTP is down. We use a custom
  // `next_attempt_at` date field (PB's system `updated` autodate
  // can't be filtered by comparison in 0.27).
  // Pick up: pending messages OR failed messages whose next_attempt_at
  // has passed. Newly created pending messages have no next_attempt_at,
  // so we explicitly OR with the IS NULL check.
  //
  // Note: do NOT sort by `created` here — PocketBase 0.27 has a bug
  // where combining a date-field filter with `sort=created` (which is
  // an autodate) returns 400. The default order (newest first) is
  // fine since both `pending` and `failed` messages get retried
  // promptly.
  const cutoff = new Date(Date.now() - 30_000).toISOString();
  const pending = await pb.collection("email_outbox").getList(1, limit, {
    filter: pb.filter(
      '(status = "pending" && next_attempt_at = null) || (status = "failed" && next_attempt_at < {:cutoff})',
      { cutoff },
    ),
  });

  let sent = 0;
  let failed = 0;

  for (const msg of pending.items) {
    try {
      const r = await fetch(`${pbUrl}/api/send-invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.POCKETBASE_SUPER_TOKEN}`,
        },
        body: JSON.stringify({ to: msg.to, subject: msg.subject, html: msg.html }),
      });

      if (r.ok) {
        await pb.collection("email_outbox").update(msg.id, {
          status: "sent",
          sent_at: new Date().toISOString(),
          attempts: (msg.attempts ?? 0) + 1,
          last_error: "",
        });
        sent++;
      } else if (r.status === 429) {
        // PB is rate-limiting. Back off and let the next drain retry.
        // We don't increment attempts (this is a server-side limit,
        // not a delivery failure).
        const retryAfter = Number(r.headers.get("Retry-After") ?? "60") || 60;
        console.warn(`[email] PB rate-limited; backing off ${retryAfter}s`);
        await pb.collection("email_outbox").update(msg.id, {
          next_attempt_at: new Date(Date.now() + retryAfter * 1000).toISOString(),
        }).catch(() => {});
        break;
      } else {
        const body = await r.text().catch(() => "");
        // Exponential backoff: 30s, 1m, 2m, 4m, 8m (cap at 5 min).
        const backoffSec = Math.min(30 * Math.pow(2, msg.attempts ?? 0), 300);
        await pb.collection("email_outbox").update(msg.id, {
          status: "failed",
          attempts: (msg.attempts ?? 0) + 1,
          last_error: `${r.status} ${body.slice(0, 500)}`,
          next_attempt_at: new Date(Date.now() + backoffSec * 1000).toISOString(),
        });
        failed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const backoffSec = Math.min(30 * Math.pow(2, msg.attempts ?? 0), 300);
      await pb.collection("email_outbox").update(msg.id, {
        status: "failed",
        attempts: (msg.attempts ?? 0) + 1,
        last_error: message.slice(0, 500),
        next_attempt_at: new Date(Date.now() + backoffSec * 1000).toISOString(),
      }).catch(() => {
        // ignore — log only
      });
      console.error(`[email] send failed for ${msg.to}:`, message);
      failed++;
    }
  }

  if (sent > 0 || failed > 0) {
    console.log(`[email] outbox drain: ${sent} sent, ${failed} failed`);
  }

  return { sent, failed };
}
