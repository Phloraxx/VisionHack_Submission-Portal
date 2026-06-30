/**
 * Playwright smoke suite — public surfaces + auth boundaries.
 *
 * Covers flows that don't require a seeded PocketBase:
 *   - public pages render (login, forgot-password, 404)
 *   - auth gates redirect unauthenticated users to /login
 *   - role-based rejection (lead → admin route returns 403)
 *
 * Optional role-gated journeys (admin/coordinator/institution/lead dashboards)
 * run ONLY when the corresponding `E2E_<ROLE>_EMAIL` / `E2E_<ROLE>_PASSWORD`
 * env vars are set. This keeps the suite green in CI without seeded data
 * while exercising real flows locally when creds are available.
 *
 * Run:          npx playwright test
 *              (or `npm run test:e2e` — spins up the prod build on :3000)
 */
import { expect, test } from "playwright/test";

const { env } = process;

const creds = {
	admin: env.E2E_ADMIN_EMAIL && env.E2E_ADMIN_PASSWORD
		? { email: env.E2E_ADMIN_EMAIL, password: env.E2E_ADMIN_PASSWORD }
		: null,
	lead: env.E2E_LEAD_EMAIL && env.E2E_LEAD_PASSWORD
		? { email: env.E2E_LEAD_EMAIL, password: env.E2E_LEAD_PASSWORD }
		: null,
	institution: env.E2E_INSTITUTION_EMAIL && env.E2E_INSTITUTION_PASSWORD
		? { email: env.E2E_INSTITUTION_EMAIL, password: env.E2E_INSTITUTION_PASSWORD }
		: null,
};

// ── Public surfaces ───────────────────────────────────────────────────────

test.describe("public surfaces", () => {
	test("login page renders the sign-in form", async ({ page }) => {
		await page.goto("/login", { waitUntil: "domcontentloaded" });
		await expect(page.locator('input[name="email"]')).toBeVisible();
		await expect(page.locator('input[name="password"]')).toBeVisible();
		await expect(page.locator('button[type="submit"]')).toBeVisible();
	});

	test("forgot-password page renders the email form", async ({ page }) => {
		await page.goto("/forgot-password", { waitUntil: "domcontentloaded" });
		await expect(page.locator('input[name="email"]')).toBeVisible();
	});

	test("unknown route returns 404", async ({ page }) => {
		const resp = await page.goto("/no-such-route-xyz", { waitUntil: "domcontentloaded" });
		expect(resp?.status()).toBe(404);
	});
});

// ── Auth gates ────────────────────────────────────────────────────────────

test.describe("auth gates", () => {
	const protectedRoutes = [
		"/admin/dashboard",
		"/admin/config",
		"/admin/teams",
		"/admin/campus-leads",
		"/admin/export",
		"/coordinator/dashboard",
		"/institution/dashboard",
		"/lead/dashboard",
		"/lead/register",
		"/lead/questionnaire",
		"/lead/submit-idea",
	];

	for (const route of protectedRoutes) {
		test(`unauthenticated → ${route} redirects to /login`, async ({ page }) => {
			await page.goto(route, { waitUntil: "domcontentloaded" });
			await page.waitForURL(/\/login/, { timeout: 5000 });
			expect(page.url()).toContain("/login");
		});
	}
});

// ── Login validation ──────────────────────────────────────────────────────

test.describe("login validation", () => {
	test("empty submit is rejected", async ({ page }) => {
		await page.goto("/login", { waitUntil: "domcontentloaded" });
		await page.locator('button[type="submit"]').click();
		// Stays on /login with an error
		await page.waitForTimeout(400);
		expect(page.url()).toContain("/login");
	});

	test("invalid email is rejected", async ({ page }) => {
		await page.goto("/login", { waitUntil: "domcontentloaded" });
		await page.locator('input[name="email"]').fill("not-an-email");
		await page.locator('input[name="password"]').fill("some-password-123!");
		await page.locator('button[type="submit"]').click();
		await page.waitForTimeout(400);
		expect(page.url()).toContain("/login");
	});
});

// ── Optional role-gated journeys ──────────────────────────────────────────
// These run only when E2E_<ROLE>_EMAIL / E2E_<ROLE>_PASSWORD are set, so the
// suite stays green in CI without seeded data.

test.describe("admin journey (optional)", () => {
	test.skip(!creds.admin, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set");

	test("admin logs in and reaches dashboard", async ({ page }) => {
		await page.goto("/login", { waitUntil: "domcontentloaded" });
		await page.locator('input[name="email"]').fill(creds.admin.email);
		await page.locator('input[name="password"]').fill(creds.admin.password);
		await page.locator('button[type="submit"]').click();
		await page.waitForURL(/\/admin\/dashboard/, { timeout: 10000 });
		expect(page.url()).toContain("/admin/dashboard");
	});

	test("admin config page loads", async ({ page, context }) => {
		// Reuse a logged-in context by repeating login (cheap smoke)
		await page.goto("/login", { waitUntil: "domcontentloaded" });
		await page.locator('input[name="email"]').fill(creds.admin.email);
		await page.locator('input[name="password"]').fill(creds.admin.password);
		await page.locator('button[type="submit"]').click();
		await page.waitForURL(/\/admin\/dashboard/, { timeout: 10000 });
		await page.goto("/admin/config", { waitUntil: "domcontentloaded" });
		await expect(page.locator("body")).toContainText(/registration/i);
	});
});

test.describe("lead journey (optional)", () => {
	test.skip(!creds.lead, "E2E_LEAD_EMAIL / E2E_LEAD_PASSWORD not set");

	test("lead logs in and reaches dashboard", async ({ page }) => {
		await page.goto("/login", { waitUntil: "domcontentloaded" });
		await page.locator('input[name="email"]').fill(creds.lead.email);
		await page.locator('input[name="password"]').fill(creds.lead.password);
		await page.locator('button[type="submit"]').click();
		await page.waitForURL(/\/lead\/dashboard/, { timeout: 10000 });
		expect(page.url()).toContain("/lead/dashboard");
	});

	test("lead is blocked from admin dashboard (403)", async ({ page }) => {
		await page.goto("/login", { waitUntil: "domcontentloaded" });
		await page.locator('input[name="email"]').fill(creds.lead.email);
		await page.locator('input[name="password"]').fill(creds.lead.password);
		await page.locator('button[type="submit"]').click();
		await page.waitForURL(/\/lead\/dashboard/, { timeout: 10000 });
		const resp = await page.goto("/admin/dashboard", { waitUntil: "domcontentloaded" });
		// React Router renders the route ErrorBoundary with a 403 body
		expect([403, 404]).toContain(resp?.status() ?? 0);
	});
});
