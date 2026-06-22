import { z } from "zod";

/**
 * Optional file field — Zod doesn't natively handle File objects,
 * so we use `z.any()` with a refinement.
 */
const optionalFile = z
  .any()
  .optional()
  .refine((v) => v === undefined || v instanceof File, {
    message: "Expected a File or undefined",
  });

export const submitIdeaSchema = z.object({
  ideaTitle: z.string().min(1, "Idea title is required").max(200, "Idea title must be at most 200 characters"),
  ideaDescription: z.string().min(1, "Idea description is required").max(5000, "Idea description must be at most 5000 characters"),
  techStack: z.string().min(1, "Tech stack is required").max(500, "Tech stack must be at most 500 characters"),
  file: optionalFile,
});

export type SubmitIdeaInput = z.infer<typeof submitIdeaSchema>;
