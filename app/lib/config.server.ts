import { query } from "./db.server";

/**
 * Fetch all feature-flag rows from the `config` table and return them as a
 * flat `Record<string, boolean>` map.
 *
 * Each row is expected to have:
 * - `key`   (text)    — the feature name, e.g. `"registration_open"`
 * - `value` (boolean) — whether the feature is enabled
 *
 * `schema_version` and any `_`-prefixed key are skipped: they are bookkeeping,
 * not phase gates (plan §6.3).
 *
 * ```ts
 * const config = await getConfig();
 * if (config.registration_open) { … }
 * ```
 */
export async function getConfig(): Promise<Record<string, boolean>> {
	const MAX_SAFE_LIST = 100;
	// One row over the cap is enough to know the warning applies.
	const result = await query<{ key: string; value: number }>(
		"SELECT key, value FROM config ORDER BY key LIMIT ?",
		[MAX_SAFE_LIST + 1],
	);
	if (result.rows.length > MAX_SAFE_LIST) {
		console.warn(`[config] More than ${MAX_SAFE_LIST} items — pagination needed`);
	}

	const value: Record<string, boolean> = {};
	for (const row of result.rows) {
		if (row.key === "schema_version" || row.key.startsWith("_")) continue;
		// SQLite stores booleans as INTEGER 0/1, never as a JS boolean.
		value[row.key] = row.value === 1;
	}

	return value;
}
