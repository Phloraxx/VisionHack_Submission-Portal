import { z } from "zod";

export const questionnaireSchema = z.object({
	age: z.string().min(1, "Age is required"),
	gender: z.string().min(1, "Gender is required"),
	education: z.string().min(1, "Education is required").max(200, "Education must be at most 200 characters"),
	college_name: z.string().min(1, "College name is required").max(200, "College name must be at most 200 characters"),
	district: z.string().min(1, "District is required").max(100, "District must be at most 100 characters"),
	skills: z.string().max(1000, "Skills must be at most 1000 characters").optional(),
	interests: z.string().max(1000, "Interests must be at most 1000 characters").optional(),
	challenges: z.string().max(2000, "Challenges must be at most 2000 characters").optional(),
	experience: z.string().max(2000, "Experience must be at most 2000 characters").optional(),
	motivation: z.string().max(2000, "Motivation must be at most 2000 characters").optional(),
	team_experience: z
		.string()
		.max(2000, "Team experience must be at most 2000 characters")
		.optional(),
	expectations: z.string().max(2000, "Expectations must be at most 2000 characters").optional(),
	additional_info: z
		.string()
		.max(2000, "Additional info must be at most 2000 characters")
		.optional(),
	year_of_graduation: z.string().optional(),
});

export type QuestionnaireInput = z.infer<typeof questionnaireSchema>;
