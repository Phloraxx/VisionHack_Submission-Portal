import { describe, expect, it } from "vitest";
import { decodeJwtPayload, isExpiringSoon } from "../jwt.server";

// A real-shape PocketBase auth token payload (no signature verification).
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
