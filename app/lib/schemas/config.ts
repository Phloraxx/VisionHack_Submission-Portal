import { z } from "zod";
import { FEATURE_FLAG_KEYS } from "~/lib/feature-flags";

export const configUpdateSchema = z.object({
	key: z.enum(FEATURE_FLAG_KEYS as [string, ...string[]]),
	value: z
		.string()
		.transform((v) => v === "true" || v === "1"),
});

export type ConfigUpdateInput = z.infer<typeof configUpdateSchema>;
