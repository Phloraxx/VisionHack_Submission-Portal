import type { InstitutionRecord, MemberRecord, TeamRecord, UserRecord } from "~/lib/types";

export function buildUser(overrides: Partial<UserRecord> = {}): UserRecord {
	return {
		id: `user_${Math.random().toString(36).slice(2, 10)}`,
		email: "test@example.com",
		name: "Test User",
		role: "lead",
		institutionId: "inst_123",
		created: new Date().toISOString(),
		updated: new Date().toISOString(),
		...overrides,
	};
}

export function buildTeam(overrides: Partial<TeamRecord> = {}): TeamRecord {
	return {
		id: `team_${Math.random().toString(36).slice(2, 10)}`,
		name: "Test Team",
		institutionId: "inst_123",
		leaderUserId: "user_123",
		status: "registered",
		created: new Date().toISOString(),
		updated: new Date().toISOString(),
		...overrides,
	};
}

export function buildMember(overrides: Partial<MemberRecord> = {}): MemberRecord {
	return {
		id: `member_${Math.random().toString(36).slice(2, 10)}`,
		teamId: "team_123",
		fullName: "Test Member",
		email: "member@example.com",
		phone: "1234567890",
		gender: "Male",
		role: "Developer",
		created: new Date().toISOString(),
		updated: new Date().toISOString(),
		...overrides,
	};
}

export function buildInstitution(overrides: Partial<InstitutionRecord> = {}): InstitutionRecord {
	return {
		id: `inst_${Math.random().toString(36).slice(2, 10)}`,
		name: "Test Institution",
		district: "Test District",
		code: "TEST001",
		campusLeadId: "user_123",
		maxTeams: 5,
		status: "active",
		created: new Date().toISOString(),
		updated: new Date().toISOString(),
		...overrides,
	};
}
