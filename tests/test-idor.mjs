/**
 * IDOR suite — app HTTP surface.
 *
 * Every request goes to the app itself: log in through `POST /login` (form-encoded, Origin-checked)
 * with a manual cookie jar, then hit the app's own routes and resource routes.
 *
 * Prerequisites:
 *   npm run seed:test     writes the fixture map the suite reads
 *   APP_URL               base URL of the running app (default :4173)
 *   FIXTURES_PATH         fixture map path (default /tmp/visionhack-test-fixtures.json)
 *
 * The app must allow APP_URL as an origin (`ALLOWED_ORIGINS`), because the
 * login action rejects a missing or mismatched `Origin` header with a 403.
 *
 * Exits non-zero on any FAIL.
 */

import { readFile } from "node:fs/promises";
import { env, exit } from "node:process";

const APP = (env.APP_URL || "http://localhost:4173").replace(/\/+$/, "");
const FIXTURES_PATH = env.FIXTURES_PATH || "/tmp/visionhack-test-fixtures.json";

/** Session cookie the app sets on a successful login. */
const COOKIE_NAME = "__Host-pb_jwt";

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

let failures = 0;

function pass(msg) {
	console.log("PASS:", msg);
}

function fail(msg) {
	failures++;
	console.log("FAIL:", msg);
}

function check(ok, msg, detail) {
	if (ok) pass(msg);
	else fail(detail ? `${msg} — ${detail}` : msg);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function loadFixtures() {
	try {
		return JSON.parse(await readFile(FIXTURES_PATH, "utf8"));
	} catch (err) {
		throw new Error(
			`Could not read fixtures from ${FIXTURES_PATH} (${err.message}). Run \`npm run seed:test\` first.`,
		);
	}
}

// ---------------------------------------------------------------------------
// Cookie jar + HTTP helpers
// ---------------------------------------------------------------------------

/** Every `Set-Cookie` value on a response, without a cookie-parsing dependency. */
function setCookieHeaders(res) {
	if (typeof res.headers.getSetCookie === "function") return res.headers.getSetCookie();
	const raw = res.headers.get("set-cookie");
	// The app's cookies carry no `Expires`, so a comma split is unambiguous.
	return raw ? raw.split(/,(?=\s*[^;=]+=)/) : [];
}

/** The session token from a login response, or null. */
function sessionToken(res) {
	for (const cookie of setCookieHeaders(res)) {
		const pair = cookie.split(";")[0];
		const eq = pair.indexOf("=");
		if (eq < 0) continue;
		if (pair.slice(0, eq).trim() === COOKIE_NAME) return pair.slice(eq + 1).trim();
	}
	return null;
}

/** `/login` allows 5 attempts per minute per IP bucket; wait out the window. */
const RATE_LIMIT_WAIT_MS = 65_000;

async function login(email, password) {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`${APP}/login`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Origin: APP,
				Accept: "text/html",
			},
			body: new URLSearchParams({ email, password }),
			redirect: "manual",
		});
		await res.text();

		if (res.status === 429 && attempt === 0) {
			// A re-run inside the rate-limit window would otherwise fail before
			// any assertion runs.
			console.log(`  (login rate-limited for ${email}; waiting ${RATE_LIMIT_WAIT_MS / 1000}s)`);
			await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
			continue;
		}
		if (res.status !== 302) {
			throw new Error(`login failed for ${email}: HTTP ${res.status}`);
		}
		const token = sessionToken(res);
		if (!token) throw new Error(`login for ${email} set no ${COOKIE_NAME} cookie`);
		return token;
	}
}

async function request(path, options = {}) {
	const { token, method = "GET", accept = "text/html", body, headers = {} } = options;
	const requestHeaders = { Accept: accept, ...headers };
	if (token) requestHeaders.Cookie = `${COOKIE_NAME}=${token}`;

	const res = await fetch(`${APP}${path}`, {
		method,
		headers: requestHeaders,
		body,
		redirect: "manual",
	});
	return { status: res.status, text: await res.text(), headers: res.headers };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const fixtures = await loadFixtures();
const { teams, users, institution, questionnaire } = fixtures;
const PASSWORD = fixtures.password;

console.log(`App:      ${APP}`);
console.log(`Fixtures: ${FIXTURES_PATH}`);

// Four logins — one under the 5/minute login limit, leaving a slot of margin.
const priyaToken = await login(users.priya.email, PASSWORD);
const adminToken = await login(users.admin.email, PASSWORD);
const coordToken = await login(users.coordinator.email, PASSWORD);
const campusToken = await login(users.campusLead.email, PASSWORD);

// ── 1. Teams: lead reads her own team ─────────────────────────────────────
console.log("\n=== 1. Teams: Priya (lead) reads her own team ===");
const ownTeam = await request(`/teams/${teams.priya.id}`, { token: priyaToken });
console.log("Priya → own team:", ownTeam.status);
check(ownTeam.status === 200, "Priya can read her own team", `HTTP ${ownTeam.status}`);
check(ownTeam.text.includes(teams.priya.name), "Own team page renders the team name");

// ── 2. Teams: lead reads another lead's team ──────────────────────────────
console.log("\n=== 2. Teams: Priya (lead) reads Meera's team ===");
const crossTeam = await request(`/teams/${teams.meera.id}`, { token: priyaToken });
console.log("Priya → Meera's team:", crossTeam.status);
check(
	[403, 404].includes(crossTeam.status),
	"Priya cannot read another lead's team",
	`HTTP ${crossTeam.status}`,
);
check(!crossTeam.text.includes(teams.meera.name), "Cross-team response leaks no team data");

// ── 3. Teams: admin reads any team ────────────────────────────────────────
console.log("\n=== 3. Teams: Admin reads any team ===");
const adminTeam = await request(`/teams/${teams.meera.id}`, { token: adminToken });
console.log("Admin → Meera's team:", adminTeam.status);
check(adminTeam.status === 200, "Admin can read any team", `HTTP ${adminTeam.status}`);

// ── 4. Teams: coordinator reads any team ──────────────────────────────────
console.log("\n=== 4. Teams: Coordinator reads any team ===");
const coordTeam = await request(`/teams/${teams.meera.id}`, { token: coordToken });
console.log("Coordinator → Meera's team:", coordTeam.status);
check(coordTeam.status === 200, "Coordinator can read any team", `HTTP ${coordTeam.status}`);

// ── 5. Teams: campus lead reads a team in her institution ─────────────────
console.log("\n=== 5. Teams: Campus lead reads a team in her institution ===");
const campusTeam = await request(`/teams/${teams.priya.id}`, { token: campusToken });
console.log("Campus lead → Priya's team:", campusTeam.status);
check(
	campusTeam.status === 200,
	"Campus lead can read a team in her institution",
	`HTTP ${campusTeam.status}`,
);

// ── 6. Members: the roster is scoped to the team ──────────────────────────
console.log("\n=== 6. Members: Priya's roster is scoped to her team ===");
const priyaRoster = fixtures.members.priyaTeam.map((m) => m.fullName);
const meeraRoster = fixtures.members.meeraTeam.map((m) => m.fullName);

const ownNames = priyaRoster.filter((name) => ownTeam.text.includes(name));
check(
	ownNames.length === priyaRoster.length,
	`Priya's team page lists all ${priyaRoster.length} of her members`,
	`found ${ownNames.length}`,
);
const leakedToPriya = meeraRoster.filter((name) => ownTeam.text.includes(name));
check(
	leakedToPriya.length === 0,
	"Priya's team page lists no member of another team",
	`leaked: ${leakedToPriya.join(", ")}`,
);

const meeraNames = meeraRoster.filter((name) => adminTeam.text.includes(name));
check(
	meeraNames.length === meeraRoster.length,
	"Meera's team page lists her own members",
	`found ${meeraNames.length}/${meeraRoster.length}`,
);
const leakedToMeera = priyaRoster.filter((name) => adminTeam.text.includes(name));
check(
	leakedToMeera.length === 0,
	"Meera's team page lists no member of Priya's team",
	`leaked: ${leakedToMeera.join(", ")}`,
);

// ── 7. Questionnaire: scoped to the owning team ───────────────────────────
console.log("\n=== 7. Questionnaire: Priya's response is scoped to her team ===");
check(
	ownTeam.text.includes(questionnaire.marker),
	"Priya's team page shows her questionnaire answer",
);
check(
	!adminTeam.text.includes(questionnaire.marker),
	"Meera's team page shows no questionnaire answer from Priya's team",
);

// ── 8. File: lead tries another team's submission ─────────────────────────
console.log("\n=== 8. File: Priya tries Meera's submission file ===");
const filePath = `/api/files/teams/${teams.meera.id}/${teams.meera.submissionFile}`;
const priyaFile = await request(filePath, { token: priyaToken, accept: "*/*" });
console.log("Priya → Meera's file:", priyaFile.status);
check(
	[403, 404].includes(priyaFile.status),
	"File proxy blocks a cross-team download",
	`HTTP ${priyaFile.status}`,
);

// ── 9. File: admin reads any team's file ──────────────────────────────────
console.log("\n=== 9. File: Admin reads any team's file ===");
const adminFile = await request(filePath, { token: adminToken, accept: "*/*" });
console.log("Admin → Meera's file:", adminFile.status);
check(adminFile.status === 200, "Admin can download any team's file", `HTTP ${adminFile.status}`);
check(
	(adminFile.headers.get("content-type") || "").includes("application/pdf"),
	"Admin download is served as a PDF",
	adminFile.headers.get("content-type") || "(no content-type)",
);

// ── 10. File: campus lead reads a file in her institution ─────────────────
console.log("\n=== 10. File: Campus lead reads a file in her institution ===");
const campusFile = await request(filePath, { token: campusToken, accept: "*/*" });
console.log("Campus lead → Meera's file:", campusFile.status);
check(
	campusFile.status === 200,
	"Campus lead can download a file in her institution",
	`HTTP ${campusFile.status}`,
);

// ── 11. /api/institutions: lead gets her own institution, no code ─────────
console.log("\n=== 11. /api/institutions: lead gets her own institution, no code ===");
const leadInst = await request("/api/institutions", {
	token: priyaToken,
	accept: "application/json",
});
const leadInstBody = JSON.parse(leadInst.text);
console.log("Lead sees:", leadInstBody.institutions?.length ?? 0, "institution(s)");
check(leadInst.status === 200, "Lead can read /api/institutions", `HTTP ${leadInst.status}`);
check(
	leadInstBody.institutions?.length === 1,
	"Lead sees exactly one institution",
	`saw ${leadInstBody.institutions?.length}`,
);
check(
	leadInstBody.institutions?.[0]?.id === institution.id,
	"Lead sees her own institution",
	leadInstBody.institutions?.[0]?.id,
);
check(
	!("code" in (leadInstBody.institutions?.[0] ?? {})),
	"Lead's payload omits the institution code",
);

// ── 12. /api/institutions: admin gets the full list with codes ────────────
console.log("\n=== 12. /api/institutions: admin gets the full list with codes ===");
const adminInst = await request("/api/institutions", {
	token: adminToken,
	accept: "application/json",
});
const adminInstBody = JSON.parse(adminInst.text);
console.log("Admin sees:", adminInstBody.institutions?.length ?? 0, "institution(s)");
check(adminInst.status === 200, "Admin can read /api/institutions", `HTTP ${adminInst.status}`);
check(
	(adminInstBody.institutions?.length ?? 0) >= 1,
	"Admin sees the institution list",
	`saw ${adminInstBody.institutions?.length}`,
);
check(
	adminInstBody.institutions?.every((i) => typeof i.code === "string" && i.code.length > 0),
	"Admin payload includes institution codes",
);
check(
	adminInstBody.institutions?.some((i) => i.code === institution.code),
	"Admin list contains the fixture institution code",
);

// ── 13. /api/institutions: coordinator gets the full list with codes ──────
console.log("\n=== 13. /api/institutions: coordinator gets the full list with codes ===");
const coordInst = await request("/api/institutions", {
	token: coordToken,
	accept: "application/json",
});
const coordInstBody = JSON.parse(coordInst.text);
console.log("Coordinator sees:", coordInstBody.institutions?.length ?? 0, "institution(s)");
check(
	coordInst.status === 200,
	"Coordinator can read /api/institutions",
	`HTTP ${coordInst.status}`,
);
check(
	coordInstBody.institutions?.every((i) => typeof i.code === "string" && i.code.length > 0),
	"Coordinator payload includes institution codes",
);

// ── 14. /api/institutions: unauthenticated is rejected ────────────────────
console.log("\n=== 14. /api/institutions: unauthenticated is rejected ===");
const anonInst = await request("/api/institutions", { accept: "application/json" });
console.log("Anonymous → /api/institutions:", anonInst.status);
check(
	anonInst.status === 401,
	"Unauthenticated /api/institutions is rejected",
	`HTTP ${anonInst.status}`,
);

// ── 15. CSV export: admin ─────────────────────────────────────────────────
console.log("\n=== 15. CSV export: admin ===");
const csv = await request("/api/export/csv?filterStatus=all", {
	token: adminToken,
	accept: "text/csv",
});
console.log("CSV (admin):", csv.status, "bytes:", csv.text.length);
check(csv.status === 200, "Admin can export CSV", `HTTP ${csv.status}`);
check(csv.text.includes(teams.meera.name), "CSV contains the submitted team");

// ── 16. CSV export: lead is rejected ──────────────────────────────────────
console.log("\n=== 16. CSV export: lead is rejected ===");
const csvLead = await request("/api/export/csv?filterStatus=all", {
	token: priyaToken,
	accept: "text/csv",
});
console.log("CSV (lead):", csvLead.status);
check(csvLead.status === 403, "Lead cannot export CSV", `HTTP ${csvLead.status}`);

// ── 17. Write escalation: lead cannot transition another team ─────────────
console.log("\n=== 17. Write escalation: lead cannot transition another team ===");
const escalate = await request(`/teams/${teams.meera.id}`, {
	token: priyaToken,
	method: "POST",
	accept: "text/html",
	headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: APP },
	body: new URLSearchParams({ intent: "transition", toStatus: "shortlisted" }),
});
console.log("Priya → POST transition:", escalate.status);
check(escalate.status === 403, "Lead cannot run a status transition", `HTTP ${escalate.status}`);

// ── 18. Unauthenticated team read redirects to /login ─────────────────────
console.log("\n=== 18. Unauthenticated /teams/<id> redirects to /login ===");
const anonTeam = await request(`/teams/${teams.priya.id}`, { accept: "text/html" });
const anonLocation = anonTeam.headers.get("location") || "";
console.log("Anonymous → team:", anonTeam.status, "→", anonLocation);
check(
	anonTeam.status === 302 && anonLocation.includes("/login"),
	"Unauthenticated team read redirects to /login",
	`HTTP ${anonTeam.status} → ${anonLocation}`,
);

// ---------------------------------------------------------------------------
// Dropped from the legacy REST suite
// ---------------------------------------------------------------------------
//
// * `GET /api/collections/{teams,members,questionnaire_responses}/records` —
//   the legacy backend's collection listing. The app exposes no equivalent
//   JSON list
//   endpoint; the same scoping is asserted through `/teams/<id>` (the roster
//   and the questionnaire render server-side) and `/api/institutions`.
// * `PATCH /api/collections/users/records/<id>` with `{ role: "admin" }` —
//   the legacy backend's update rule was the only thing rejecting a
//   self-promotion.
//   No app route writes `users.role`; the nearest write surface is the
//   `/teams/<id>` action, covered by case 17.
// * `GET <legacy-base-url>/api/files/teams/<id>/<file>` — replaced by the app's
//   own `/api/files/...` proxy (cases 8-10).
//
// Known gap: the fixture set has a single institution, so there is no
// cross-institution team to probe — the campus lead legitimately sees both
// teams. Cross-institution denial lives in the `teamScope` predicate in
// `app/lib/db.server.ts`; add a second institution to the seed to assert it
// end-to-end.

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
exit(failures === 0 ? 0 : 1);
