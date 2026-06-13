/**
 * Generate a cryptographically-secure temporary password.
 * These are auto-generated credentials used for new user accounts
 * created by institution leads. Users are expected to reset their
 * password on first login via the forgot-password flow.
 *
 * Uses crypto.randomUUID() which is backed by the platform's CSPRNG
 * (Web Crypto API in browsers/Workers, OpenSSL in Node.js).
 *
 * 12 hex chars = 48 bits of entropy — sufficient for temporary
 * credentials that are rotated on first use.
 */
export function generateSecurePassword(length = 12): string {
  // UUID v4 is 36 chars (hex + hyphens). Remove hyphens and truncate.
  return crypto.randomUUID().replace(/-/g, "").slice(0, length);
}
