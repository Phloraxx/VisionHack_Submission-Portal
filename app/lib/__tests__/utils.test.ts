import { describe, expect, it } from "vitest";
import { countByKey, escapeCsv, escapeHtml, extractFieldErrors } from "../utils";

describe("escapeCsv", () => {
	it("returns an empty string for empty input", () => {
		expect(escapeCsv("")).toBe("");
	});

	it("quotes values containing a comma, quote, newline or carriage return", () => {
		expect(escapeCsv("a,b")).toBe('"a,b"');
		expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
		expect(escapeCsv("line\nbreak")).toBe('"line\nbreak"');
		expect(escapeCsv("line\rbreak")).toBe('"line\rbreak"');
	});

	it("neutralizes spreadsheet formula injection", () => {
		expect(escapeCsv("=1+1")).toBe("'=1+1");
		expect(escapeCsv("@SUM(A1)")).toBe("'@SUM(A1)");
	});

	it("leaves a plain value untouched", () => {
		expect(escapeCsv("Team Priya")).toBe("Team Priya");
	});
});

describe("escapeHtml", () => {
	it("escapes every HTML-significant character", () => {
		expect(escapeHtml(`<a href="x">&'\`/`)).toBe(
			"&lt;a href=&quot;x&quot;&gt;&amp;&#039;&#96;&#47;",
		);
	});
});

describe("countByKey", () => {
	it("counts items per derived key", () => {
		const items = [{ team: "a" }, { team: "a" }, { team: "b" }];
		expect(countByKey(items, (item) => item.team)).toEqual({ a: 2, b: 1 });
	});

	it("returns an empty map for no items", () => {
		expect(countByKey([], () => "x")).toEqual({});
	});
});

describe("extractFieldErrors", () => {
	it("takes the first message per field", () => {
		const error = {
			flatten: () => ({
				fieldErrors: { email: ["Invalid email", "Too long"], name: undefined },
			}),
		};
		expect(extractFieldErrors(error)).toEqual({ email: "Invalid email", name: "Invalid" });
	});
});
