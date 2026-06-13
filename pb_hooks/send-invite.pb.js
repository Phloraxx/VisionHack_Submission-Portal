/**
 * PocketBase Hook — Custom Email Sending Endpoint
 *
 * Place this file at:  pb_hooks/send-invite.pb.js
 * (alongside the PocketBase binary on the server, then restart PocketBase)
 *
 * Registers `POST /api/send-invite` — superuser-only endpoint that sends
 * a custom HTML email using PocketBase's configured SMTP settings.
 *
 * Prerequisites:
 *   SMTP must be configured in PocketBase Admin UI (Settings → Mail).
 *   The "Sender name" and "Sender address" fields will be used as the
 *   From header on every email sent through this hook.
 *
 * Usage (from your Cloudflare Worker or any HTTP client):
 *
 *   POST /api/send-invite
 *   Authorization: Bearer <superuser-token>
 *   Content-Type: application/json
 *   {
 *     "to":      "recipient@example.com",
 *     "subject": "You're invited!",
 *     "html":    "<h1>Hello!</h1><p>Custom HTML here.</p>"
 *   }
 */

routerAdd("POST", "/api/send-invite", (c) => {
  // ---- Auth: only superusers can send emails ----
  const admin = $apis.requestInfo(c).admin;
  if (!admin) {
    console.log(
      "[send-invite] Request rejected — no superuser auth. " +
      "Check that the Authorization header is present and contains a valid superuser token."
    );
    return c.json(403, { error: "Superuser authentication required" });
  }

  // ---- Parse body ----
  const data = $apis.requestInfo(c).data;
  const { to, subject, html } = data;

  if (!to || !subject || !html) {
    return c.json(400, {
      error: "Missing required fields: to, subject, html",
    });
  }

  // ---- Build and send ----
  const message = new MailerMessage({
    from: {
      address: $app.settings().meta.senderAddress,
      name: $app.settings().meta.senderName,
    },
    to: [{ address: to }],
    subject: subject,
    html: html,
  });

  try {
    // $app.newMailClient().send() throws on failure — we intentionally
    // ignore the return value. PocketBase's mail client never returns
    // error codes; any SMTP failure surfaces as a thrown exception.
    $app.newMailClient().send(message);
    return c.json(200, { sent: true });
  } catch (err) {
    console.error("[send-invite] Email send failed:", err);
    return c.json(500, {
      error: err.message || "Email send failed — check SMTP configuration",
    });
  }
});
