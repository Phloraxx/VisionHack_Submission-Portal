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
export async function getConfig(
  pb: PocketBase,
): Promise<Record<string, boolean>> {
  const records = await pb.collection("config").getFullList<{
    key: string;
    value: boolean;
  }>();

  const value: Record<string, boolean> = {};
  for (const record of records) {
    value[record.key] = !!record.value;
  }

  return value;
}
