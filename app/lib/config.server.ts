import type PocketBase from "pocketbase";

/**
 * Fetch all feature-flag records from the `config` collection and return
 * them as a flat `Record<string, boolean>` map.
 *
 * Each record is expected to have:
 * - `key`   (string)  — the feature name, e.g. `"registration_open"`
 * - `value` (bool)    — whether the feature is enabled
 *
 * ```ts
 * const config = await getConfig(pb);
 * if (config.registration_open) { … }
 * ```
 */
export async function getConfig(pb: PocketBase): Promise<Record<string, boolean>> {
	const MAX_SAFE_LIST = 100;
	const result = await pb.collection("config").getList<{
		key: string;
		value: boolean;
	}>(1, MAX_SAFE_LIST);
	if (result.totalItems > MAX_SAFE_LIST) {
		console.warn(`[config] More than ${MAX_SAFE_LIST} items — pagination needed`);
	}
	const records = result.items;

	const value: Record<string, boolean> = {};
	for (const record of records) {
		value[record.key] = !!record.value;
	}

	return value;
}
