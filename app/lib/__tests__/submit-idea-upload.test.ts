import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — everything except the uploads module, which is the subject.
// ---------------------------------------------------------------------------

vi.mock("~/lib/auth.server", () => ({
	requireRole: vi.fn(),
	getAuthFromCookie: vi.fn(() => "token"),
	setAuthCookie: vi.fn(() => "cookie"),
}));

vi.mock("~/lib/origin.server", () => ({ validateOrigin: vi.fn() }));

vi.mock("~/lib/config.server", () => ({
	getConfig: vi.fn(async () => ({ submission_open: true })),
}));

vi.mock("~/lib/team.server", () => ({ getLeadTeam: vi.fn() }));

vi.mock("~/lib/file-validation.server", () => ({
	validateFileSignature: vi.fn(async () => true),
}));

vi.mock("~/lib/db.server", () => ({
	teams: { update: vi.fn() },
	statusTransitions: { create: vi.fn() },
	withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

import { requireRole } from "~/lib/auth.server";
import { teams } from "~/lib/db.server";
import { resetEnvCache } from "~/lib/env.server";
import { getLeadTeam } from "~/lib/team.server";
import { action } from "~/routes/lead/submit-idea";

const USER_ID = "3f2b0000-0000-4000-8000-000000000001";
const TEAM_ID = "9a410000-0000-4000-8000-000000000002";
const PREVIOUS_FILE = "previous-deck.pdf";
const PREVIOUS_BYTES = "the submission the team already had";

let uploadsDir: string;
let teamDir: string;

/** The status a `data()` result carries. */
function statusOf(result: unknown): number | undefined {
	return (result as { init?: ResponseInit }).init?.status;
}

function submitRequest(filename: string): Request {
	const form = new FormData();
	form.set("ideaTitle", "A real idea");
	form.set("ideaDescription", "With a description");
	form.set("techStack", "TypeScript");
	form.set("file", new File([new TextEncoder().encode("%PDF-1.4 new bytes")], filename));
	return new Request("http://localhost/lead/submit-idea", { method: "POST", body: form });
}

beforeEach(async () => {
	uploadsDir = await mkdtemp(path.join(tmpdir(), "vh-uploads-"));
	process.env.UPLOADS_DIR = uploadsDir;
	resetEnvCache();

	teamDir = path.join(uploadsDir, "teams", TEAM_ID);
	await mkdir(teamDir, { recursive: true });
	await writeFile(path.join(teamDir, PREVIOUS_FILE), PREVIOUS_BYTES);

	vi.mocked(requireRole).mockResolvedValue({
		db: {} as never,
		user: {
			id: USER_ID,
			email: "lead@example.edu",
			name: "Test Lead",
			role: "lead",
			institutionId: "",
			created: "",
			updated: "",
		},
		token: "token",
	});
	vi.mocked(getLeadTeam).mockResolvedValue({
		id: TEAM_ID,
		name: "Team",
		institutionId: "",
		leaderUserId: USER_ID,
		teamCode: "",
		status: "shortlisted",
		statusChangedAt: "",
		questionnaireCompleted: true,
		ideaTitle: "",
		ideaDesc: "",
		ideaTechStack: "",
		submissionFile: PREVIOUS_FILE,
		created: "",
		updated: "",
	});
});

afterEach(async () => {
	await rm(uploadsDir, { recursive: true, force: true });
});

/**
 * R-20 regression: `saveTeamSubmission` used to unlink the previous file as
 * soon as the new bytes landed, and the 409 compensation then unlinked the new
 * one — so a lost optimistic lock destroyed the team's deliverable while
 * `teams.submission_file` still named the deleted file.
 */
describe("submit-idea upload ordering", () => {
	it("keeps the previous file intact when the optimistic lock is lost", async () => {
		vi.mocked(teams.update).mockResolvedValue(null);

		const result = await action({
			request: submitRequest("new-deck.pdf"),
			params: {},
		} as never);

		expect(statusOf(result)).toBe(409);
		// The row still names the previous file, so it must still be there —
		// and the orphaned upload must not be.
		expect(await readdir(teamDir)).toEqual([PREVIOUS_FILE]);
		expect(await readFile(path.join(teamDir, PREVIOUS_FILE), "utf8")).toBe(PREVIOUS_BYTES);
	});

	it("replaces the previous file once the update commits", async () => {
		vi.mocked(teams.update).mockResolvedValue({ id: TEAM_ID } as never);

		const result = await action({
			request: submitRequest("new-deck.pdf"),
			params: {},
		} as never);

		expect(statusOf(result)).toBe(200);
		expect(await readdir(teamDir)).toEqual(["new-deck.pdf"]);
	});
});
