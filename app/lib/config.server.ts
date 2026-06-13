import type PocketBase from "pocketbase";

/**
 * Fetch all feature-flag records from the `config` collection and return them
 * as a flat `Record<string, boolean>` map.
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

  const config: Record<string, boolean> = {};
  for (const record of records) {
    config[record.key] = record.value;
  }
  return config;
}

/**
 * Fetch a single feature-flag by its `key` from the `config` collection.
 *
 * Returns `false` when the key is not found (safe default — features are
 * off by default). Uses PocketBase's filter syntax to query by key.
 *
 * ```ts
 * const open = await isOpen(pb, "registration_open");
 * if (!open) throw new Response("Registration closed", { status: 403 });
 * ```
 */
export async function isOpen(
  pb: PocketBase,
  key: string,
): Promise<boolean> {
  try {
    const record = await pb
      .collection("config")
      .getFirstListItem<{ value: boolean }>(
        pb.filter("key = {:key}", { key }),
      );
    return record.value;
  } catch {
    return false;
  }
}
