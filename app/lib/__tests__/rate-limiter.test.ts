import { beforeEach, describe, expect, it } from "vitest";
import { _resetStore, checkRateLimit } from "../rate-limiter.server";

describe("checkRateLimit", () => {
	beforeEach(() => {
		_resetStore();
	});

	it("allows attempts up to the limit", () => {
		expect(() => {
			for (let i = 0; i < 3; i++) checkRateLimit("k", 3, 60_000);
		}).not.toThrow();
	});

	it("throws a 429 once the limit is reached", () => {
		for (let i = 0; i < 3; i++) checkRateLimit("k", 3, 60_000);
		try {
			checkRateLimit("k", 3, 60_000);
			expect.fail("Expected checkRateLimit to throw");
		} catch (err) {
			expect(err).toBeInstanceOf(Response);
			expect((err as Response).status).toBe(429);
			expect((err as Response).headers.get("Retry-After")).toBeTruthy();
		}
	});

	it("keeps separate buckets per key", () => {
		for (let i = 0; i < 3; i++) checkRateLimit("a", 3, 60_000);
		expect(() => checkRateLimit("b", 3, 60_000)).not.toThrow();
	});

	it("starts a fresh window once the previous one expired", async () => {
		checkRateLimit("k", 1, 1);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(() => checkRateLimit("k", 1, 60_000)).not.toThrow();
	});
});
