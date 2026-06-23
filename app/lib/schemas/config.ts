import { z } from "zod";

export const configUpdateSchema = z.object({
	key: z.string().min(1, "Key is required"),
	value: z.coerce.boolean(),
});

export type ConfigUpdateInput = z.infer<typeof configUpdateSchema>;
