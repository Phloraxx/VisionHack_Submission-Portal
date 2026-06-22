import { z } from "zod";

export const questionnaireSchema = z.object({
  age: z.string().optional(),
  gender: z.string().optional(),
  education: z.string().max(200, "Education must be at most 200 characters").optional(),
  college_name: z.string().max(200, "College name must be at most 200 characters").optional(),
  district: z.string().max(100, "District must be at most 100 characters").optional(),
  year_of_graduation: z.string().optional(),
  skills: z.string().max(1000, "Skills must be at most 1000 characters").optional(),
  interests: z.string().max(1000, "Interests must be at most 1000 characters").optional(),
  challenges: z.string().max(2000, "Challenges must be at most 2000 characters").optional(),
  experience: z.string().max(2000, "Experience must be at most 2000 characters").optional(),
  motivation: z.string().max(2000, "Motivation must be at most 2000 characters").optional(),
  team_experience: z.string().max(2000, "Team experience must be at most 2000 characters").optional(),
  expectations: z.string().max(2000, "Expectations must be at most 2000 characters").optional(),
  additional_info: z.string().max(2000, "Additional info must be at most 2000 characters").optional(),
});

export type QuestionnaireInput = z.infer<typeof questionnaireSchema>;
