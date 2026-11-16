import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "../env.server";
import {
	JWT_ISSUER,
	SESSION_TTL_SECONDS,
	decodeJwtPayload,
	isExpiringSoon,
	signJwt,
	verifyJwt,
} from "../jwt.server";

// ---------------------------------------------------------------------------
// Env fixture — getEnv() validates APP_JWT_SECRET (>= 32 bytes) on first use,
// and caches the result, so every test starts from a known secret.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-jwt-secret-0123456789abcdef0123456789abcdef";
const ENV_KEYS = ["APP_JWT_SECRET", "DATABASE_URL", "UPLOADS_DIR"] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv(): void {
	for (const key of ENV_KEYS) {
		const value = ORIGINAL_ENV[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

beforeEach(() => {
	process.env.APP_JWT_SECRET = TEST_SECRET;
	process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://localhost:5432/test";
	process.env.UPLOADS_DIR = process.env.UPLOADS_DIR ?? "/tmp/visionhack-uploads";
	resetEnvCache();
});

afterEach(() => {
	restoreEnv();
	resetEnvCache();
});

/** base64url-encode a JSON object, the way a JWT segment is built. */
function encodeSegment(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Current time in whole seconds, matching the claim format. */
function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

/**
 * Sign an arbitrary payload the way `signJwt` does, but with a chosen `iss`.
 *
 * `signJwt` always overwrites the claim, so a foreign issuer can only be
 * produced by signing by hand — which is exactly what an attacker holding the
 * key (or a second app sharing it) would do.
 */
function signWithIssuer(payload: Record<string, unknown>, iss: string | undefined): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const now = nowSeconds();
	const body = Buffer.from(
		JSON.stringify({ ...payload, iss, iat: now, exp: now + SESSION_TTL_SECONDS }),
	).toString("base64url");
	const signature = createHmac("sha256", TEST_SECRET)
		.update(`${header}.${body}`)
		.digest("base64url");
	return `${header}.${body}.${signature}`;
}

// A real-shape legacy auth token payload (no signature verification).
// { collectionId, exp: 1813149038 (year 2027), id, refreshable, type }
const FAR_FUTURE_TOKEN =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
	"eyJjb2xsZWN0aW9uSWQiOiJwYmNfMzE0MjYzNTgyMyIsImV4cCI6MTgxMzE0OTAzOCwiaWQiOiI1dzg2MW50eGxnYWFxbWoiLCJyZWZyZXNoYWJsZSI6ZmFsc2UsInR5cGUiOiJhdXRoIn0." +
	"sig";

describe("decodeJwtPayload", () => {
	it("decodes a valid token payload", () => {
		const payload = decodeJwtPayload(FAR_FUTURE_TOKEN);
		expect(payload).not.toBeNull();
		expect(payload?.id).toBe("5w861ntxlgaaqmj");
		expect(payload?.exp).toBe(1813149038);
	});

	it("returns null for a malformed token (wrong segment count)", () => {
		expect(decodeJwtPayload("not.a.jwt.token")).toBeNull();
		expect(decodeJwtPayload("single")).toBeNull();
		expect(decodeJwtPayload("")).toBeNull();
	});

	it("returns null when the payload is not valid base64 JSON", () => {
		expect(decodeJwtPayload("a.!!!notbase64!!!.c")).toBeNull();
	});
});

describe("isExpiringSoon", () => {
	it("is false for a token far from expiry", () => {
		const payload = decodeJwtPayload(FAR_FUTURE_TOKEN);
		expect(isExpiringSoon(payload)).toBe(false);
	});

	it("is true for a null payload", () => {
		expect(isExpiringSoon(null)).toBe(true);
	});

	it("is true for a payload with no exp", () => {
		expect(isExpiringSoon({ id: "x" })).toBe(true);
	});

	it("is true when exp is within the skew window", () => {
		const soon = Math.floor(Date.now() / 1000) + 100; // 100s out
		expect(isExpiringSoon({ id: "x", exp: soon }, 3600)).toBe(true);
	});

	it("is false when exp is beyond the skew window", () => {
		const later = Math.floor(Date.now() / 1000) + 7200; // 2h out
		expect(isExpiringSoon({ id: "x", exp: later }, 3600)).toBe(false);
	});
});

describe("signJwt / verifyJwt", () => {
	const claims = {
		id: "3f2b0000-0000-4000-8000-000000000001",
		role: "lead",
		institutionId: null as string | null,
		email: "lead@example.edu",
		name: "Test Lead",
	};

	it("round-trips a valid token and returns the claims", () => {
		const token = signJwt(claims);
		const payload = verifyJwt(token);
		expect(payload).not.toBeNull();
		expect(payload?.id).toBe(claims.id);
		expect(payload?.role).toBe("lead");
		expect(payload?.iss).toBe(JWT_ISSUER);
		expect(payload?.exp).toBeGreaterThan(nowSeconds());
		expect(payload?.exp).toBeLessThanOrEqual(nowSeconds() + SESSION_TTL_SECONDS);
	});

	it("rejects a token whose payload was tampered with", () => {
		const segments = signJwt(claims).split(".");
		const forged = encodeSegment({ ...claims, role: "admin" });
		expect(verifyJwt(`${segments[0]}.${forged}.${segments[2]}`)).toBeNull();
	});

	it("rejects an expired token with a valid signature", () => {
		expect(verifyJwt(signJwt(claims, -60))).toBeNull();
	});

	it("rejects a token whose header declares a different alg", () => {
		const segments = signJwt(claims).split(".");
		const header = encodeSegment({ alg: "none", typ: "JWT" });
		expect(verifyJwt(`${header}.${segments[1]}.${segments[2]}`)).toBeNull();
	});

	/**
	 * R-02 regression: the e742828 commit message claimed `verifyJwt` rejects a
	 * foreign `iss`, but only the docstring had changed.
	 */
	it("rejects a token whose iss is not ours", () => {
		// Control: the same helper with our issuer verifies, so the rejection
		// below is the issuer check and not a broken signature.
		expect(verifyJwt(signWithIssuer(claims, JWT_ISSUER))).not.toBeNull();
		expect(verifyJwt(signWithIssuer(claims, "someone-else"))).toBeNull();
	});

	it("rejects a token with no iss claim at all", () => {
		expect(verifyJwt(signWithIssuer(claims, undefined))).toBeNull();
	});

	it("rejects a token minted with a different secret", () => {
		const token = signJwt(claims);
		process.env.APP_JWT_SECRET = "other-secret-0123456789abcdef0123456789abcdef";
		resetEnvCache();
		expect(verifyJwt(token)).toBeNull();
	});
});
