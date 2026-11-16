import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — the loader only needs the session row and the feature flags.
// ---------------------------------------------------------------------------

vi.mock("~/lib/db.server", () => ({
	db: {},
	// `findById` is what the pre-fix loader used; keeping it in the mock means
	// this test fails if the loader ever goes back to it.
	users: { findSessionUser: vi.fn(), findById: vi.fn() },
}));

vi.mock("~/lib/config.server", () => ({
	getConfig: vi.fn(async () => ({ registration_open: true })),
}));

import type { LoaderFunctionArgs } from "react-router";
import { passwordFingerprint, resolveSession } from "~/lib/auth.server";
import { users } from "~/lib/db.server";
import { signJwt } from "~/lib/jwt.server";
import { loader } from "~/routes/login";

const mockFindSessionUser = vi.mocked(users.findSessionUser);
const mockFindById = vi.mocked(users.findById);

const USER_ID = "3f2b0000-0000-4000-8000-000000000001";
/** The hash the row holds now — a reset has already replaced the old one. */
const CURRENT_HASH = "$argon2id$v=19$m=65536,t=3,p=4$current";
const STALE_FINGERPRINT = passwordFingerprint("$argon2id$v=19$m=65536,t=3,p=4$previous");

const ROW = {
	id: USER_ID,
	email: "lead@example.edu",
	name: "Test Lead",
	role: "lead" as const,
	institutionId: "",
	created: "2026-01-01T00:00:00.000Z",
	updated: "2026-01-01T00:00:00.000Z",
	passwordHash: CURRENT_HASH,
};

/** A session cookie carrying `pwf`. */
function cookieWith(pwf: string): string {
	const token = signJwt({ id: USER_ID, role: "lead", pwf });
	return `__Host-pb_jwt=${token}`;
}

function loginRequest(cookie?: string): LoaderFunctionArgs {
	return {
		request: new Request("http://localhost/login", {
			headers: cookie ? { Cookie: cookie } : {},
		}),
		params: {},
		context: {},
	} as unknown as LoaderFunctionArgs;
}

beforeEach(() => {
	mockFindSessionUser.mockReset();
	mockFindSessionUser.mockResolvedValue(ROW);
	mockFindById.mockReset();
	mockFindById.mockResolvedValue(ROW);
});

/**
 * R-01 regression: the `/login` loader used to accept any signature-valid
 * token and redirect to the dashboard, while `resolveAuth` rejected the same
 * token on the `pwf` binding — so a browser holding a pre-reset cookie looped
 * /login → dashboard → /login until it hit ERR_TOO_MANY_REDIRECTS.
 */
describe("login loader", () => {
	it("renders the form for a token whose pwf no longer matches the row", async () => {
		const result = await loader(loginRequest(cookieWith(STALE_FINGERPRINT)));

		// Not a redirect: the login page is what the browser gets.
		expect(result).not.toBeInstanceOf(Response);
		expect(result).toMatchObject({ data: { registrationOpen: true } });
	});

	it("redirects to the dashboard for a live session", async () => {
		const thrown = await loader(loginRequest(cookieWith(passwordFingerprint(CURRENT_HASH)))).catch(
			(err: unknown) => err,
		);

		expect(thrown).toBeInstanceOf(Response);
		expect((thrown as Response).status).toBe(302);
		expect((thrown as Response).headers.get("Location")).toBe("/lead/dashboard");
	});

	it("renders the form when there is no cookie at all", async () => {
		const result = await loader(loginRequest());
		expect(result).not.toBeInstanceOf(Response);
		expect(mockFindSessionUser).not.toHaveBeenCalled();
	});

	/**
	 * The two paths cannot drift: the loader and `resolveAuth` both decide
	 * through `resolveSession`, so a token one rejects is rejected by both.
	 */
	it("rejects the same stale token that resolveAuth rejects", async () => {
		const token = signJwt({ id: USER_ID, role: "lead", pwf: STALE_FINGERPRINT });
		expect(await resolveSession(token)).toBeNull();

		const live = signJwt({ id: USER_ID, role: "lead", pwf: passwordFingerprint(CURRENT_HASH) });
		expect(await resolveSession(live)).not.toBeNull();
	});
});
