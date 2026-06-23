import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearAuthCookie, getAuthFromCookie, setAuthCookie } from "../auth.server";

const ORIG_PB_URL = process.env.POCKETBASE_URL;
const ORIG_APP_URL = process.env.APP_URL;
const ORIG_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
	process.env.POCKETBASE_URL = "http://localhost:5173";
	process.env.APP_URL = "https://visionhack.mulearn.org";
	process.env.NODE_ENV = "test";
});

afterEach(() => {
	process.env.POCKETBASE_URL = ORIG_PB_URL;
	process.env.APP_URL = ORIG_APP_URL;
	process.env.NODE_ENV = ORIG_NODE_ENV;
});
// getAuthFromCookie
// ---------------------------------------------------------------------------
describe("getAuthFromCookie", () => {
	it("extracts pb_jwt from a simple cookie header", () => {
		const request = new Request("http://localhost", {
			headers: { Cookie: "pb_jwt=abc123" },
		});
		expect(getAuthFromCookie(request)).toBe("abc123");
	});

	it("returns null when no Cookie header is present", () => {
		const request = new Request("http://localhost");
		expect(getAuthFromCookie(request)).toBeNull();
	});

	it("extracts pb_jwt from a multi-cookie header", () => {
		const request = new Request("http://localhost", {
			headers: { Cookie: "other=value; pb_jwt=token456" },
		});
		expect(getAuthFromCookie(request)).toBe("token456");
	});

	it("returns null when pb_jwt cookie is not present", () => {
		const request = new Request("http://localhost", {
			headers: { Cookie: "other=value" },
		});
		expect(getAuthFromCookie(request)).toBeNull();
	});

	it("handles an empty Cookie header gracefully", () => {
		const request = new Request("http://localhost", {
			headers: { Cookie: "" },
		});
		expect(getAuthFromCookie(request)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// setAuthCookie
// ---------------------------------------------------------------------------
describe("setAuthCookie", () => {
	it("returns a Set-Cookie header string with the token", () => {
		const result = setAuthCookie("abc123");
		expect(result).toContain("pb_jwt=abc123");
		expect(result).toContain("HttpOnly");
		expect(result).toContain("SameSite=Strict");
		expect(result).toContain("Path=/");
		expect(result).toContain("Max-Age=432000");
	});

	it("omits Secure flag in non-production environments", () => {
		const result = setAuthCookie("abc123");
		expect(result).not.toContain("Secure");
	});

	it("includes Secure flag in production environment", () => {
		const prevEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		try {
			const result = setAuthCookie("abc123");
			expect(result).toContain("Secure");
		} finally {
			process.env.NODE_ENV = prevEnv;
		}
	});
});

// ---------------------------------------------------------------------------
// clearAuthCookie
// ---------------------------------------------------------------------------
describe("clearAuthCookie", () => {
	it("returns a Set-Cookie header that clears the pb_jwt cookie", () => {
		const result = clearAuthCookie();
		expect(result).toContain("pb_jwt=");
		expect(result).toContain("Max-Age=0");
		expect(result).toContain("HttpOnly");
		expect(result).toContain("SameSite=Strict");
		expect(result).toContain("Path=/");
	});

	it("has an empty token value and Max-Age of 0", () => {
		const result = clearAuthCookie();
		const parts = result.split("; ");
		expect(parts[0]).toBe("pb_jwt=");
		expect(parts).toContain("Max-Age=0");
	});

	it("includes Secure flag in production environment", () => {
		const prevEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		try {
			const result = clearAuthCookie();
			expect(result).toContain("Secure");
		} finally {
			process.env.NODE_ENV = prevEnv;
		}
	});
});
