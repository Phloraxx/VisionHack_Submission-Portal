/**
 * Password reset without a token table.
 *
 * A reset token is an HS256 JWT signed with `APP_JWT_SECRET`:
 *
 * ```json
 * { "sub": "<user id>", "purpose": "pwreset", "pwf": "<hash fingerprint>", "exp": … }
 * ```
 *
 * `pwf` is `sha256(password_hash).slice(0, 16)`. Because completing a reset
 * rewrites `password_hash`, the fingerprint stops matching and the token is
 * single-use by construction — no token table, no cleanup job. Session tokens
 * carry the same claim, so a reset also invalidates every other session.
 */

import { matchesPasswordFingerprint, passwordFingerprint } from "./auth.server";
import type { Db } from "./db.server";
import { sendEmail } from "./email.server";
import { getAppUrl } from "./env.server";
import { signJwt, verifyJwt } from "./jwt.server";
import { hashPassword } from "./password.server";
import { escapeHtml } from "./utils";

/** Reset links expire in 30 minutes, as the UI copy promises. */
export const RESET_TOKEN_TTL_SECONDS = 30 * 60;

/**
 * Email a reset link to `email` when that address belongs to a user.
 *
 * Returns silently for an unknown address so the caller can answer with an
 * unconditional `{ sent: true }` and never reveal whether an account exists.
 * Delivery is best-effort: failures are logged, not thrown.
 */
export async function sendPasswordResetEmail(database: Db, email: string): Promise<void> {
	const user = await database.users.findByEmail(email);
	if (!user) return;

	const token = signJwt(
		{
			sub: user.id,
			purpose: "pwreset",
			pwf: passwordFingerprint(user.passwordHash),
		},
		RESET_TOKEN_TTL_SECONDS,
	);
	const resetUrl = `${getAppUrl()}/reset-password?token=${encodeURIComponent(token)}`;

	const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 18px; margin: 0 0 16px;">Reset your password — VisionHack 2026</h1>
      <p>Hello <strong>${escapeHtml(user.name || user.email)}</strong>,</p>
      <p>We received a request to reset the password for your VisionHack submission portal account.</p>
      <p style="margin: 16px 0;">
        <a href="${resetUrl}"
           style="display: inline-block; background: #18181b; color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 14px;">
          Choose a new password
        </a>
      </p>
      <p style="font-size: 13px; color: #52525b;">This link expires in 30 minutes and can only be used once.</p>
      <p style="font-size: 13px; color: #52525b;">If you did not request this, you can ignore this email — your password stays unchanged.</p>
      <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;" />
      <p style="margin: 0; font-size: 12px; color: #71717a;">VisionHack Team</p>
    </div>
  `.trim();

	try {
		await sendEmail({
			to: user.email,
			subject: "Reset your VisionHack password",
			html,
		});
	} catch (err) {
		console.error("[password-reset] Failed to send reset email:", err);
	}
}

/**
 * Validate a reset token: signature, `purpose`, `exp` (inside `verifyJwt`)
 * and the `pwf` binding against the user's current hash.
 *
 * Returns the user id and the hash the token was minted against, or `null`
 * when the token is unusable.
 */
export async function verifyPasswordResetToken(
	database: Db,
	token: string,
): Promise<{ userId: string; passwordHash: string } | null> {
	const payload = verifyJwt(token);
	if (!payload || payload.purpose !== "pwreset") return null;
	if (typeof payload.sub !== "string" || !payload.sub) return null;
	if (typeof payload.pwf !== "string" || !payload.pwf) return null;

	const currentHash = await database.users.findPasswordHashById(payload.sub);
	if (!currentHash) return null;
	if (!matchesPasswordFingerprint(payload.pwf, currentHash)) return null;

	return { userId: payload.sub, passwordHash: currentHash };
}

/**
 * Complete a reset: verify the token, then write an argon2id hash.
 *
 * The write is conditional on the hash the token was minted against, so two
 * concurrent requests with the same token cannot both succeed.
 *
 * Returns `false` when the token is invalid, expired or already used.
 */
export async function resetPassword(
	database: Db,
	token: string,
	newPassword: string,
): Promise<boolean> {
	const verified = await verifyPasswordResetToken(database, token);
	if (!verified) return false;

	const newHash = await hashPassword(newPassword);
	return database.users.updatePasswordHashIfUnchanged(
		verified.userId,
		verified.passwordHash,
		newHash,
	);
}
