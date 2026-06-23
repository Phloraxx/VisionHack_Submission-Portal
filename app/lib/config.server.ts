import type PocketBase from "pocketbase";

const CACHE_TTL = 30_000;

let cached: { data: Record<string, boolean> | null; expiry: number } = {
	data: null,
	expiry: 0,
};

/**
 * Fetch all feature-flag records from the `config` collection and return
 * them as a flat `Record<string, boolean>` map.
 *
 * Each record is expected to have:
 * - `key`   (string)  — the feature name, e.g. `"registration_open"`
 * - `value` (bool)    — whether the feature is enabled
 *
 * Results are cached in-memory for 30 seconds to avoid redundant DB reads
 * on every loader and action.
 *
 * ```ts
 * const config = await getConfig(pb);
 * if (config.registration_open) { … }
 * ```
 */
export async function getConfig(pb: PocketBase): Promise<Record<string, boolean>> {
	const now = Date.now();
	if (cached.data !== null && now < cached.expiry) {
		return cached.data;
	}

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
		value[record.key] = record.value === true;
	}

	cached = { data: value, expiry: Date.now() + CACHE_TTL };
	return value;
}
