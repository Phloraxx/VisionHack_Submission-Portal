import type { Role, TeamStatus } from "./types";

// ---------------------------------------------------------------------------
// Team Status State Machine
// ---------------------------------------------------------------------------

interface TransitionRule {
	from: TeamStatus[];
	to: TeamStatus[];
	allowedRoles: Role[];
}

const TRANSITION_RULES: TransitionRule[] = [
	// Lead transitions
	{ from: ["invited"], to: ["registered"], allowedRoles: ["lead"] },
	{ from: ["shortlisted"], to: ["submitted"], allowedRoles: ["lead"] },
	{
		from: ["invited", "registered", "shortlisted", "submitted"],
		to: ["withdrawn"],
		allowedRoles: ["lead", "admin"],
	},

	// Coordinator / Admin / Institution transitions
	{
		from: ["registered"],
		to: ["shortlisted"],
		allowedRoles: ["coordinator", "admin", "institution"],
	},
	{
		from: ["shortlisted"],
		to: ["registered"],
		allowedRoles: ["institution", "coordinator", "admin"],
	},

	// Admin-only transitions
	{ from: ["submitted"], to: ["selected"], allowedRoles: ["admin"] },
	{ from: ["submitted"], to: ["rejected"], allowedRoles: ["admin"] },
];

/**
 * Check whether a given status transition is allowed for a given role.
 *
 * ```ts
 * canTransition("invited", "registered", "lead")          // true
 * canTransition("registered", "shortlisted", "lead")      // false
 * canTransition("submitted", "selected", "admin")         // true
 * ```
 */
export function canTransition(from: TeamStatus, to: TeamStatus, role: Role): boolean {
	return TRANSITION_RULES.some(
		(rule) => rule.from.includes(from) && rule.to.includes(to) && rule.allowedRoles.includes(role),
	);
}
