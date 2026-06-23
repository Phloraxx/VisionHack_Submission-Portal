import { z } from "zod";

export const createCampusLeadSchema = z.object({
	institutionName: z.string().min(1, "Institution name is required").max(100, "Institution name must be at most 100 characters"),
	district: z.string().min(1, "District is required").max(100, "District must be at most 100 characters"),
	code: z
		.string()
		.min(1, "Code is required")
		.max(12, "Code must be at most 12 characters")
		.regex(/^[A-Z0-9]+$/, "Code must contain only uppercase letters and digits"),
	leadName: z.string().min(1, "Lead name is required").max(100, "Lead name must be at most 100 characters"),
	leadEmail: z.string().email("Invalid email address"),
	maxTeams: z.coerce.number().min(0, "Max teams must be 0 or greater").optional(),
});

export type CreateCampusLeadInput = z.infer<typeof createCampusLeadSchema>;
