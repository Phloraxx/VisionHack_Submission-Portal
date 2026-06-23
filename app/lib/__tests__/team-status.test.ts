import { describe, it, expect } from "vitest";
import { canTransition } from "../types";
import { getValidTransitions } from "../team-status";

// ---------------------------------------------------------------------------
// canTransition – valid forward transitions
// ---------------------------------------------------------------------------
describe("canTransition – valid transitions", () => {
	it("allows lead to go from invited → registered", () => {
		expect(canTransition("invited", "registered", "lead")).toBe(true);
	});

	it("allows institution to go from registered → shortlisted", () => {
		expect(canTransition("registered", "shortlisted", "institution")).toBe(true);
	});

	it("allows lead to go from shortlisted → submitted", () => {
		expect(canTransition("shortlisted", "submitted", "lead")).toBe(true);
	});

	it("allows admin to go from submitted → selected", () => {
		expect(canTransition("submitted", "selected", "admin")).toBe(true);
	});

	it("allows admin to go from submitted → rejected", () => {
		expect(canTransition("submitted", "rejected", "admin")).toBe(true);
	});

	it("allows lead to withdraw from registered", () => {
		expect(canTransition("registered", "withdrawn", "lead")).toBe(true);
	});

	it("allows admin to withdraw from submitted", () => {
		expect(canTransition("submitted", "withdrawn", "admin")).toBe(true);
	});

	it("allows institution to unshortlist (shortlisted → registered)", () => {
		expect(canTransition("shortlisted", "registered", "institution")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// canTransition – invalid transitions
// ---------------------------------------------------------------------------
describe("canTransition – invalid transitions", () => {
	it("rejects skipping states (invited → selected for lead)", () => {
		expect(canTransition("invited", "selected", "lead")).toBe(false);
	});

	it("rejects transition with wrong role (registered → shortlisted for lead)", () => {
		expect(canTransition("registered", "shortlisted", "lead")).toBe(false);
	});

	it("rejects transition with wrong role (submitted → selected for coordinator)", () => {
		expect(canTransition("submitted", "selected", "coordinator")).toBe(false);
	});

	it("rejects going backwards (selected → submitted for admin)", () => {
		expect(canTransition("selected", "submitted", "admin")).toBe(false);
	});

	it("rejects removed statuses (registered → questionnaire_submitted)", () => {
		// @ts-expect-error — `questionnaire_submitted` no longer exists
		expect(canTransition("registered", "questionnaire_submitted", "lead")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// canTransition – withdrawn (from non-terminal states)
// ---------------------------------------------------------------------------
describe("canTransition – withdrawn", () => {
	it("allows lead to withdraw from invited", () => {
		expect(canTransition("invited", "withdrawn", "lead")).toBe(true);
	});

	it("allows lead to withdraw from registered", () => {
		expect(canTransition("registered", "withdrawn", "lead")).toBe(true);
	});

	it("allows admin to withdraw from shortlisted", () => {
		expect(canTransition("shortlisted", "withdrawn", "admin")).toBe(true);
	});

	it("allows lead to withdraw from submitted", () => {
		expect(canTransition("submitted", "withdrawn", "lead")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// getValidTransitions
// ---------------------------------------------------------------------------
describe("getValidTransitions", () => {
	it("returns registered and withdrawn for invited + lead", () => {
		const transitions = getValidTransitions("invited", "lead");
		expect(transitions).toEqual(["registered", "withdrawn"]);
	});

	it("returns shortlisted for registered + institution", () => {
		const transitions = getValidTransitions("registered", "institution");
		expect(transitions).toEqual(["shortlisted"]);
	});

	it("returns selected + rejected + withdrawn for submitted + admin", () => {
		const transitions = getValidTransitions("submitted", "admin");
		// admin can select, reject, or withdraw
		expect(transitions).toEqual(["selected", "rejected", "withdrawn"]);
	});

	it("returns submitted and withdrawn for shortlisted + lead", () => {
		const transitions = getValidTransitions("shortlisted", "lead");
		expect(transitions).toEqual(["submitted", "withdrawn"]);
	});
});
