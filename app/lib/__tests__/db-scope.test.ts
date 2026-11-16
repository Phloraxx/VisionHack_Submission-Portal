import { describe, expect, it } from "vitest";
import {
	type ActingUser,
	institutionScope,
	memberCreateScope,
	memberWriteScope,
	questionnaireScope,
	teamScope,
} from "../db.server";

/**
 * The §6.2 scope predicates are the only authorization the database layer
 * applies, so they are asserted directly here as well as end-to-end by the
 * IDOR suite.
 */

/** A stand-in for the `$n` placeholder factory: records the bound values. */
function paramSpy() {
	const params: unknown[] = [];
	const p = (value: unknown) => {
		params.push(value);
		return `$${params.length}`;
	};
	return { params, p };
}

const admin: ActingUser = { id: "admin-1", role: "admin", institutionId: "" };
const coordinator: ActingUser = { id: "coord-1", role: "coordinator", institutionId: "" };
const campusLead: ActingUser = { id: "lead-1", role: "institution", institutionId: "inst-1" };
const campusLeadNoInst: ActingUser = { id: "lead-2", role: "institution", institutionId: "" };
const teamLead: ActingUser = { id: "user-1", role: "lead", institutionId: "inst-1" };

describe("teamScope", () => {
	it("lets admin and coordinator see every team", () => {
		expect(teamScope(admin, paramSpy().p)).toBe("TRUE");
		expect(teamScope(coordinator, paramSpy().p)).toBe("TRUE");
	});

	it("scopes a campus lead to her own institution", () => {
		const { p, params } = paramSpy();
		expect(teamScope(campusLead, p)).toBe("t.institution_id = $1");
		expect(params).toEqual(["inst-1"]);
	});

	it("denies a campus lead with no institution", () => {
		expect(teamScope(campusLeadNoInst, paramSpy().p)).toBe("FALSE");
	});

	it("scopes a team lead to the teams she leads", () => {
		const { p, params } = paramSpy();
		expect(teamScope(teamLead, p)).toBe("t.leader_user_id = $1");
		expect(params).toEqual(["user-1"]);
	});

	it("honours the table alias", () => {
		expect(teamScope(teamLead, paramSpy().p, "teams")).toBe("teams.leader_user_id = $1");
	});
});

describe("institutionScope", () => {
	it("lets admin and coordinator see every institution", () => {
		expect(institutionScope(admin, paramSpy().p)).toBe("TRUE");
		expect(institutionScope(coordinator, paramSpy().p)).toBe("TRUE");
	});

	it("scopes everyone else to their own institution", () => {
		expect(institutionScope(campusLead, paramSpy().p)).toBe("i.id = $1");
		expect(institutionScope(teamLead, paramSpy().p)).toBe("i.id = $1");
	});

	it("denies a user with no institution", () => {
		expect(institutionScope(campusLeadNoInst, paramSpy().p)).toBe("FALSE");
	});
});

describe("questionnaireScope", () => {
	it("lets admin and coordinator read every response", () => {
		expect(questionnaireScope(admin, paramSpy().p)).toBe("TRUE");
		expect(questionnaireScope(coordinator, paramSpy().p)).toBe("TRUE");
	});

	it("scopes a campus lead to her institution's teams", () => {
		expect(questionnaireScope(campusLead, paramSpy().p)).toBe("t.institution_id = $1");
	});

	it("scopes a lead to her own response", () => {
		expect(questionnaireScope(teamLead, paramSpy().p)).toBe("q.user_id = $1");
	});
});

describe("memberCreateScope", () => {
	it("lets admin write any roster", () => {
		expect(memberCreateScope(admin, paramSpy().p)).toBe("TRUE");
	});

	it("scopes a campus lead to her institution's teams", () => {
		expect(memberCreateScope(campusLead, paramSpy().p)).toBe("t.institution_id = $1");
	});

	it("scopes a team lead to her own team", () => {
		expect(memberCreateScope(teamLead, paramSpy().p)).toBe("t.leader_user_id = $1");
	});

	it("denies a coordinator", () => {
		expect(memberCreateScope(coordinator, paramSpy().p)).toBe("FALSE");
	});
});

describe("memberWriteScope", () => {
	it("lets admin write any roster", () => {
		expect(memberWriteScope(admin, paramSpy().p)).toBe("TRUE");
	});

	it("scopes a team lead to her own team", () => {
		expect(memberWriteScope(teamLead, paramSpy().p)).toBe("t.leader_user_id = $1");
	});

	it("denies campus leads and coordinators", () => {
		expect(memberWriteScope(campusLead, paramSpy().p)).toBe("FALSE");
		expect(memberWriteScope(coordinator, paramSpy().p)).toBe("FALSE");
	});
});
