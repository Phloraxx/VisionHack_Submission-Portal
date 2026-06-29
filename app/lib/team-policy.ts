import { canTransition } from "./transitions";
import type { Role, TeamStatus } from "./types";

// ---------------------------------------------------------------------------
// Centralized team transition policy
export const QUESTIONNAIRE_ALLOWED_STATUSES: readonly TeamStatus[] = [
	"registered",
	"shortlisted",
	"submitted",
];

/**
 * Whether a team in the given status may submit or update a questionnaire.
 */
export function canSubmitQuestionnaire(status: TeamStatus): boolean {
	return (QUESTIONNAIRE_ALLOWED_STATUSES as readonly TeamStatus[]).includes(status);
}

/**
 * Whether a lead may submit an idea from the given status.
 * Delegates to the transition rule: only "shortlisted" → "submitted" is allowed.
 */
export function canSubmitIdea(status: TeamStatus): boolean {
	return canTransition(status, "submitted", "lead");
}

/**
 * Whether the given role may withdraw from the given status.
 * Delegates to the generic transition check.
 */
export function canWithdraw(status: TeamStatus, role: Role): boolean {
	return canTransition(status, "withdrawn", role);
}
