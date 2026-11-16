import { data } from "react-router";

/**
 * RR7's `data()` returns a `DataWithResponseInit` class instance, not a
 * `Response`. Wrapping one in another `data()` serialises the wrapper as the
 * body and drops the inner status code.
 *
 * React Router keeps this predicate internal (only the `UNSAFE_DataWithResponseInit`
 * type is exported), so the check has to be local.
 */
export function isDataWithResponseInit(
	value: unknown,
): value is { data: unknown; init?: ResponseInit } {
	return (
		typeof value === "object" &&
		value !== null &&
		"data" in value &&
		"init" in value &&
		(value as { type?: unknown }).type === "DataWithResponseInit"
	);
}

/**
 * Attach a `Set-Cookie` header to whatever a route handler returned.
 *
 * `cookie` is null when there is nothing to propagate, in which case the
 * result is returned untouched. A `Response` gets the header appended; a
 * `data()` result gets it merged into its `init` so the status code survives;
 * anything else is wrapped in a fresh `data()`.
 */
export function withCookie(
	result: unknown,
	cookie: string | null,
): Response | ReturnType<typeof data> {
	if (!cookie) return result as Response | ReturnType<typeof data>;

	if (result instanceof Response) {
		result.headers.append("Set-Cookie", cookie);
		return result;
	}

	if (isDataWithResponseInit(result)) {
		const headers = new Headers(result.init?.headers);
		headers.append("Set-Cookie", cookie);
		return data(result.data, { ...result.init, headers });
	}

	return data(result, { headers: new Headers([["Set-Cookie", cookie]]) });
}
