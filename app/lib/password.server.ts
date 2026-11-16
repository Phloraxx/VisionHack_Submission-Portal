/**
 * Password hashing — a leaf module.
 *
 * Kept free of the app's server graph (db pool, env validation, React Router)
 * so scripts and tests can hash a password without booting the whole app.
 */

import { hash as hashArgon2, verify as verifyArgon2 } from "@node-rs/argon2";
import { compare as compareBcrypt } from "bcryptjs";

/** Migrated hashes from the legacy backend are bcrypt (`$2a$` / `$2b$`). */
export function isBcryptHash(passwordHash: string): boolean {
	return passwordHash.startsWith("$2a$") || passwordHash.startsWith("$2b$");
}

/**
 * `Algorithm.Argon2id` from `@node-rs/argon2`.
 *
 * The package declares `Algorithm` as an ambient `const enum`, which cannot be
 * referenced at runtime under `verbatimModuleSyntax`. The member value is
 * spelled out instead; 2 = Argon2id in the package's `index.d.ts`.
 */
const ARGON2ID = 2 as const;

/** Hash a password with argon2id — the format every new hash uses. */
export function hashPassword(password: string): Promise<string> {
	return hashArgon2(password, { algorithm: ARGON2ID });
}

/**
 * Verify a password against a stored hash.
 *
 * Accepts argon2id (current) and bcrypt (hashes carried over from the
 * legacy backend). Anything else is treated as a failed login rather than an
 * error, so a corrupt row cannot be used to probe the login path.
 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
	try {
		if (passwordHash.startsWith("$argon2")) {
			return await verifyArgon2(passwordHash, password);
		}
		if (isBcryptHash(passwordHash)) {
			return await compareBcrypt(password, passwordHash);
		}
		return false;
	} catch (err) {
		console.error("[auth] Password verification failed", err);
		return false;
	}
}
