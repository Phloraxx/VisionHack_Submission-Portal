import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "../env.server";
import { UNKNOWN_IP, getClientIp, ipRateLimitKey } from "../ip.server";

const ORIG_TRUST = process.env.TRUST_PROXY_HEADERS;

function request(headers: Record<string, string> = {}): Request {
	return new Request("http://localhost/login", { headers });
}

describe("getClientIp", () => {
	beforeEach(() => {
		resetEnvCache();
		// biome-ignore lint/performance/noDelete: test-only env cleanup
		delete process.env.TRUST_PROXY_HEADERS;
	});

	afterEach(() => {
		process.env.TRUST_PROXY_HEADERS = ORIG_TRUST;
		resetEnvCache();
	});

	it("returns the unknown sentinel when proxy headers are not trusted", () => {
		expect(getClientIp(request({ "CF-Connecting-IP": "1.2.3.4" }))).toBe(UNKNOWN_IP);
	});

	it("prefers CF-Connecting-IP when proxy headers are trusted", () => {
		process.env.TRUST_PROXY_HEADERS = "1";
		resetEnvCache();
		expect(getClientIp(request({ "CF-Connecting-IP": "1.2.3.4" }))).toBe("1.2.3.4");
	});

	it("takes the last X-Forwarded-For hop, not the client-supplied first one", () => {
		process.env.TRUST_PROXY_HEADERS = "1";
		resetEnvCache();
		expect(getClientIp(request({ "X-Forwarded-For": "9.9.9.9, 1.2.3.4" }))).toBe("1.2.3.4");
	});
});

/**
 * F-43 regression: the per-IP rate-limit bucket must not collapse onto one
 * global key when the client address is unknown.
 */
describe("ipRateLimitKey", () => {
	beforeEach(() => {
		resetEnvCache();
		// biome-ignore lint/performance/noDelete: test-only env cleanup
		delete process.env.TRUST_PROXY_HEADERS;
	});

	afterEach(() => {
		process.env.TRUST_PROXY_HEADERS = ORIG_TRUST;
		resetEnvCache();
	});

	it("returns null when the address is unknown, so no global bucket is created", () => {
		expect(ipRateLimitKey("login", request())).toBeNull();
	});

	it("returns a per-address key when the address is known", () => {
		process.env.TRUST_PROXY_HEADERS = "1";
		resetEnvCache();
		expect(ipRateLimitKey("login", request({ "CF-Connecting-IP": "1.2.3.4" }))).toBe(
			"login:ip:1.2.3.4",
		);
	});

	it("gives two different clients two different buckets", () => {
		process.env.TRUST_PROXY_HEADERS = "1";
		resetEnvCache();
		const a = ipRateLimitKey("login", request({ "CF-Connecting-IP": "1.2.3.4" }));
		const b = ipRateLimitKey("login", request({ "CF-Connecting-IP": "5.6.7.8" }));
		expect(a).not.toBe(b);
	});
});
