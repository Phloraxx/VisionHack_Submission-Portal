/**
 * Small typed FormData helpers.
 *
 * These replace the dozens of `(formData.get("x") as string | null)?.trim()
 * ?? ""` + manual length-cap blocks scattered across the action handlers.
 * They never throw — invalid input becomes "" — so callers validate via
 * the returned values.
 */

export interface GetStrOptions {
	/** Trim surrounding whitespace (default true). */
	trim?: boolean;
	/** Lowercase the result (useful for emails). */
	lower?: boolean;
	/** Hard cap the length (truncates). */
	max?: number;
}

/** Read a string field from FormData with optional trim / lower / max. */
export function getStr(formData: FormData, key: string, opts: GetStrOptions = {}): string {
	const { trim = true, lower = false, max } = opts;
	let value = String(formData.get(key) ?? "");
	if (trim) value = value.trim();
	if (lower) value = value.toLowerCase();
	if (typeof max === "number") value = value.slice(0, max);
	return value;
}

/** Read all repeated string fields with optional trim/max. */
export function getAllStr(formData: FormData, key: string, opts: GetStrOptions = {}): string[] {
	const { trim = true, lower = false, max } = opts;
	return formData.getAll(key).map((v) => {
		let value = String(v ?? "");
		if (trim) value = value.trim();
		if (lower) value = value.toLowerCase();
		if (typeof max === "number") value = value.slice(0, max);
		return value;
	});
}

/** Basic email shape check (not exhaustive, just a sanity gate). */
export function isEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
