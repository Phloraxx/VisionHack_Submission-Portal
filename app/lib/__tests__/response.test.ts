import { data } from "react-router";
import { describe, expect, it } from "vitest";
import { isDataWithResponseInit, withCookie } from "../response.server";

const COOKIE = "__Host-pb_jwt=token; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600";

describe("withCookie", () => {
	it("returns the result untouched when there is no cookie to set", () => {
		const result = data({ ok: true }, { status: 200 });
		expect(withCookie(result, null)).toBe(result);
	});

	/**
	 * F-63 regression: a `data()` result is a `DataWithResponseInit`, not a
	 * `Response`. Wrapping it in a second `data()` serialised the wrapper as the
	 * body and dropped the status code, so a 403 reached the client as a 200.
	 */
	it("preserves the status code of a data() result", () => {
		const result = data({ error: "nope" }, { status: 403 });
		const wrapped = withCookie(result, COOKIE);

		expect(isDataWithResponseInit(wrapped)).toBe(true);
		const { data: body, init } = wrapped as { data: unknown; init?: ResponseInit };
		expect(init?.status).toBe(403);
		expect(body).toEqual({ error: "nope" });
	});

	it("adds the Set-Cookie header to a data() result", () => {
		const wrapped = withCookie(data({ ok: true }, { status: 200 }), COOKIE);
		const headers = new Headers((wrapped as { init?: ResponseInit }).init?.headers);
		expect(headers.get("Set-Cookie")).toBe(COOKIE);
	});

	it("keeps headers the handler already set", () => {
		const result = data({ ok: true }, { status: 201, headers: { "X-Trace": "abc" } });
		const wrapped = withCookie(result, COOKIE);
		const headers = new Headers((wrapped as { init?: ResponseInit }).init?.headers);
		expect(headers.get("X-Trace")).toBe("abc");
		expect(headers.get("Set-Cookie")).toBe(COOKIE);
	});

	it("appends the cookie to a plain Response", () => {
		const response = new Response("ok", { status: 202 });
		const wrapped = withCookie(response, COOKIE) as Response;
		expect(wrapped.status).toBe(202);
		expect(wrapped.headers.get("Set-Cookie")).toBe(COOKIE);
	});

	it("wraps a bare object in a data() result", () => {
		const wrapped = withCookie({ ok: true }, COOKIE);
		expect(isDataWithResponseInit(wrapped)).toBe(true);
		expect((wrapped as { data: unknown }).data).toEqual({ ok: true });
	});
});
