import { z } from "zod";

export const shortlistSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
});

export const unshortlistSchema = z.object({
  teamId: z.string().min(1, "Team ID is required"),
});

export type ShortlistInput = z.infer<typeof shortlistSchema>;
export type UnshortlistInput = z.infer<typeof unshortlistSchema>;
