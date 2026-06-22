import { z } from "zod";

export const createCampusLeadSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name must be at most 100 characters"),
  email: z.string().email("Invalid email address"),
  district: z.string().max(100, "District must be at most 100 characters"),
  code: z
    .string()
    .min(1, "Code is required")
    .max(12, "Code must be at most 12 characters")
    .regex(/^[A-Z0-9]+$/, "Code must contain only uppercase letters and digits"),
  maxTeams: z.coerce.number().min(0, "Max teams must be 0 or greater"),
});

export type CreateCampusLeadInput = z.infer<typeof createCampusLeadSchema>;
