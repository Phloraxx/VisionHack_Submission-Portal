import { canTransition } from "./transitions";
import type { Role, TeamStatus } from "./types";

/**
 * Team status labels, semantic tokens, and transition helpers.
 *
 * The new system uses semantic role colors (warning / info / success / danger)
 * rather than seven unique hues. This keeps the brand accent (μLearn amber)
 * free to carry identity rather than be buried inside status semantics.
 *
 *  - invited     → neutral   (waiting on action)
 *  - registered  → info      (acknowledged, in motion)
 *  - shortlisted → brand     (selected for next round — uses the brand hue
 *                             because it's the only positive system signal)
 *  - submitted   → info-deep (work is in review)
 *  - selected    → success   (final outcome: yes)
 *  - rejected    → danger    (final outcome: no)
 *  - withdrawn   → neutral   (out of the system)
 */

const ALL_STATUSES: TeamStatus[] = [
	"invited",
	"registered",
	"shortlisted",
	"submitted",
	"selected",
	"rejected",
	"withdrawn",
];

export function getValidTransitions(currentStatus: TeamStatus, role: Role): TeamStatus[] {
	return ALL_STATUSES.filter((next) => canTransition(currentStatus, next, role));
}

export const STATUS_LABELS: Record<TeamStatus, string> = {
	invited: "Invited",
	registered: "Registered",
	shortlisted: "Shortlisted",
	submitted: "Submitted",
	selected: "Selected",
	rejected: "Not selected",
	withdrawn: "Withdrawn",
};

/**
 * Semantic CSS class tokens for each status.
 *
 * The "soft" variant is for surfaces (low-contrast wash).
 * The "solid" variant is for high-contrast indicators (badges, dots).
 */
export interface StatusToken {
	/** Tailwind utility classes for the soft/pill surface variant. */
	pill: string;
	/** Single class for the dot indicator. */
	dot: string;
	/** Foreground utility for inline text + icons. */
	ink: string;
}

export const STATUS_COLORS: Record<TeamStatus, StatusToken> = {
	invited: {
		pill: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
		dot: "bg-muted-foreground",
		ink: "text-muted-foreground",
	},
	registered: {
		pill: "bg-info/10 text-info ring-1 ring-inset ring-info/30",
		dot: "bg-info",
		ink: "text-info",
	},
	shortlisted: {
		pill: "bg-primary/12 text-primary ring-1 ring-inset ring-primary/30",
		dot: "bg-primary",
		ink: "text-primary",
	},
	submitted: {
		pill: "bg-info/15 text-info ring-1 ring-inset ring-info/40",
		dot: "bg-info",
		ink: "text-info",
	},
	selected: {
		pill: "bg-success/10 text-success ring-1 ring-inset ring-success/30",
		dot: "bg-success",
		ink: "text-success",
	},
	rejected: {
		pill: "bg-danger/10 text-danger ring-1 ring-inset ring-danger/30",
		dot: "bg-danger",
		ink: "text-danger",
	},
	withdrawn: {
		pill: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
		dot: "bg-muted-foreground",
		ink: "text-muted-foreground",
	},
};
