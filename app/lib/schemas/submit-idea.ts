import { z } from "zod";

/**
 * The idea text fields. The presentation file is validated separately in the
 * action (`validateFileSignature`), because Zod cannot inspect a `File`'s
 * bytes and the browser MIME type is advisory.
 */
export const submitIdeaSchema = z.object({
	ideaTitle: z
		.string()
		.min(1, "Idea title is required")
		.max(200, "Idea title must be at most 200 characters"),
	ideaDescription: z
		.string()
		.min(1, "Idea description is required")
		.max(5000, "Idea description must be at most 5000 characters"),
	techStack: z
		.string()
		.min(1, "Tech stack is required")
		.max(500, "Tech stack must be at most 500 characters"),
});

export type SubmitIdeaInput = z.infer<typeof submitIdeaSchema>;
