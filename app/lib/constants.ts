export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * All valid team statuses, in progression order.
 *
 * This is the single source of truth: the `TeamStatus` union in `types.ts`,
 * the `status` CHECK constraint in `postgres/schema.sql` and every UI list
 * derive from it.
 */
export const TEAM_STATUSES = [
	"invited",
	"registered",
	"shortlisted",
	"submitted",
	"selected",
	"rejected",
	"withdrawn",
] as const;
