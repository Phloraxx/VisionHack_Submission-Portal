import type { TEAM_STATUSES } from "./constants";

export type TeamStatus = (typeof TEAM_STATUSES)[number];

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
	ideaTitle?: string;
	ideaDesc?: string;
	ideaTechStack?: string;
	submissionFile?: string;
	questionnaireCompleted?: boolean;
	statusChangedAt?: string;
	created: string;
	updated: string;
}

/**
 * Shape returned by loaders — raw `TeamRecord` plus `expand` fields
 * joined by the repository. Use this everywhere a component reads
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
