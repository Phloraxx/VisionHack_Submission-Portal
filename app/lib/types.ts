export type TeamStatus =
	| "invited"
	| "registered"
	| "shortlisted"
	| "submitted"
	| "selected"
	| "rejected"
	| "withdrawn";

export type Role = "admin" | "coordinator" | "institution" | "lead";

export interface UserRecord {
	id: string;
	email: string;
	name: string;
	role: Role;
	institutionId: string;
	created: string;
	updated: string;
}

export interface TeamRecord {
	id: string;
	name: string;
	institutionId: string;
	leaderUserId: string;
	teamCode?: string;
	status: TeamStatus;
	membersCount?: number;
	institutionName?: string;
	teamLeadName?: string;
	teamLeadEmail?: string;
	idea_title?: string;
	idea_desc?: string;
	idea_tech_stack?: string;
	submission_file?: string;
	questionnaire_completed?: boolean;
	status_changed_at?: string;
	created: string;
	updated: string;
}

/**
 * Shape returned by loaders — raw `TeamRecord` plus `expand` fields
 * joined from PocketBase. Use this everywhere a component reads
 * `team.expand.*`.
 */
export interface TeamView extends TeamRecord {
	expand?: {
		institutionId?: { id: string; name: string; district?: string; code?: string };
		leaderUserId?: { id: string; name: string; email: string };
	};
}

export interface MemberRecord {
	id: string;
	teamId: string;
	fullName: string;
	email: string;
	phone: string;
	gender: string;
	role: string;
	created: string;
	updated: string;
}

export interface InstitutionRecord {
	id: string;
	name: string;
	district: string;
	code: string;
	campusLeadId: string;
	maxTeams: number;
	status: string;
	created: string;
	updated: string;
}

export interface ConfigRecord {
	id: string;
	key: string;
	value: boolean;
	created: string;
	updated: string;
}

export interface QuestionnaireResponseRecord {
	id: string;
	teamId: string;
	userId: string;
	[field: string]: unknown;
	created: string;
	updated: string;
}

// ---------------------------------------------------------------------------
// Team Status State Machine  —  MOVED to ./transitions
// ---------------------------------------------------------------------------
//
// Runtime code (canTransition, TRANSITION_RULES, TransitionRule) has been
// moved to `app/lib/transitions.ts` to keep this file purely for type
// definitions. Please import from `~/lib/transitions` instead.
//
// These re-exports are provided for migration and will be removed in a
// future commit.
// ---------------------------------------------------------------------------
/**
 * @deprecated Import from `~/lib/transitions` instead.
 */
export { canTransition } from "./transitions";
