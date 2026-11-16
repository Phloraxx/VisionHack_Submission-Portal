import { z } from "zod";

/** Shared by the shortlist and unshortlist intents — the payload is identical. */
export const shortlistSchema = z.object({
	teamId: z.string().min(1, "Team ID is required"),
});

export const transitionTeamSchema = z.object({
	teamId: z.string().min(1, "Team ID is required"),
	toStatus: z.enum(["registered", "shortlisted", "selected", "rejected", "withdrawn"], {
		message: "Invalid target status",
	}),
});

export type ShortlistInput = z.infer<typeof shortlistSchema>;
export type TransitionTeamInput = z.infer<typeof transitionTeamSchema>;
