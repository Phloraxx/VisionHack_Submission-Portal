import { z } from "zod";

export const registerSchema = z
	.object({
		teamName: z
			.string()
			.min(1, "Team name is required")
			.max(100, "Team name must be at most 100 characters"),
		leadPhone: z
			.string()
			.min(1, "Lead phone is required")
			.max(20, "Lead phone must be at most 20 characters"),
		leadGender: z
			.string()
			.min(1, "Lead gender is required")
			.max(32, "Lead gender must be at most 32 characters"),
		leadRole: z
			.string()
			.min(1, "Lead role is required")
			.max(100, "Lead role must be at most 100 characters"),
		memberName: z
			.array(
				z
					.string()
					.min(1, "Member name is required")
					.max(200, "Member name must be at most 200 characters"),
			)
			.min(1)
			.max(5),
		memberEmail: z.array(
			z
				.string()
				.email("Invalid member email")
				.max(320, "Member email must be at most 320 characters"),
		),
		memberPhone: z.array(z.string().max(20, "Member phone must be at most 20 characters")),
		memberGender: z.array(z.string().max(32, "Member gender must be at most 32 characters")),
		memberRole: z.array(z.string().max(100, "Member role must be at most 100 characters")),
	})
	.refine(
		(data) => {
			const lengths = [
				data.memberName.length,
				data.memberEmail.length,
				data.memberPhone.length,
				data.memberGender.length,
				data.memberRole.length,
			];
			return lengths.every((l) => l === lengths[0]);
		},
		{
			message: "All member arrays must have the same length",
			path: ["memberName"],
		},
	)
	// `members` is unique on `(team_id, email)`, so two rows sharing an address
	// would raise 23505 and surface as a 500. Reject it as a field error.
	.refine(
		(data) => {
			const emails = data.memberEmail.map((email) => email.trim().toLowerCase());
			return new Set(emails).size === emails.length;
		},
		{
			message: "Each member must have a different email address",
			path: ["memberEmail"],
		},
	);

export type RegisterInput = z.infer<typeof registerSchema>;
