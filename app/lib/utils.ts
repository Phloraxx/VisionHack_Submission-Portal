import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** Escape HTML special characters to prevent injection in email/HTML contexts. */
export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;")
		.replace(/`/g, "&#96;")
		.replace(/\//g, "&#47;");
}

/**
 * Escape a value for CSV output.
 *
 * Handles two concerns:
 *  1. RFC-4180 quoting for commas, quotes, and newlines.
 *  2. Spreadsheet formula injection — a value beginning with `= + - @`
 *     (or a tab / carriage return) is treated as a formula by Excel /
 *     Google Sheets and can execute on open. We neutralize it by
 *     prefixing a single quote, which spreadsheets render as text.
 */
export function escapeCsv(str: string): string {
	if (!str) return "";
	let text = String(str);

	// Neutralize formula injection before quoting.
	if (/^[=+\-@\t\r]/.test(text)) {
		text = `'${text}`;
	}

	text = text.replace(/"/g, '""');
	return text.includes(",") || text.includes('"') || text.includes("\n") ? `"${text}"` : text;
}

/**
 * Keys excluded when flattening a questionnaire response for display or
 * CSV export. These are PocketBase system fields and relation ids that
 * aren't meaningful answers.
 */
export const QUESTIONNAIRE_EXCLUDE_KEYS = [
	"id",
	"teamId",
	"userId",
	"created",
	"updated",
	"collectionId",
	"collectionName",
] as const;

/**
 * Count items by a derived key.
 * Returns `Record<key, count>` — e.g. count members per team.
 */
export function countByKey<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const item of items) {
		const key = keyFn(item);
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return counts;
}

/**
 * Extract a flat `Record<string, string>` of field errors from a Zod validation
 * error. Takes the first error message per field. Compatible with `fail()` in
 * action.server.ts which accepts `fieldErrors` in its options.
 */
export function extractFieldErrors(error: {
	flatten: () => { fieldErrors: Record<string, string | string[] | undefined> };
}): Record<string, string> {
	return Object.fromEntries(
		Object.entries(error.flatten().fieldErrors).map(([k, v]) => [
			k,
			Array.isArray(v) ? v[0] : (v ?? "Invalid"),
		]),
	);
}
