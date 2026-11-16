#!/usr/bin/env node
/**
 * Integration test for the SQLite data layer.
 *
 * Why this exists
 * ---------------
 * The unit tests mock `app/lib/db.server`, so they validate none of the SQL:
 * not the placeholder order, not the dialect rewrites, not the scope
 * predicates, not the constraint error codes. This suite runs every repository
 * method against a real database file, which is how the port's four real bugs
 * were found:
 *
 *   1. INSERT … SELECT bind order — `teamId` was pushed before the SELECT-list
 *      values but appeared after them, silently writing wrong columns.
 *   2. ON DELETE RESTRICT reports SQLITE_CONSTRAINT_TRIGGER, not
 *      …_FOREIGNKEY, so a blocked delete surfaced as a 500.
 *   3. Booleans are INTEGER 0/1 — `value === true` read every flag as false.
 *   4. RETURNING cannot reference an alias the statement never declares.
 *
 * Each of those is covered by an assertion below that fails if it regresses.
 *
 * Self-contained: a fresh temp directory, `sqlite/schema.sql` applied up
 * front, fixtures written through the repositories themselves. No network, no
 * Postgres, no external services.
 *
 *   npm run test:integration
 */

import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = path.resolve(HERE, "..", "sqlite", "schema.sql");

// ---------------------------------------------------------------------------
// Setup — must happen before db.server is imported
// ---------------------------------------------------------------------------
// db.server reads SQLITE_PATH through getEnv() on first use, so the env has to
// be in place before the module is loaded. That is why the import below is
// dynamic rather than static.

const workDir = mkdtempSync(path.join(tmpdir(), "vh-integration-"));
const sqlitePath = path.join(workDir, "portal-test.db");

process.env.SQLITE_PATH = sqlitePath;
process.env.APP_JWT_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
process.env.UPLOADS_DIR = path.join(workDir, "uploads");

// Apply the schema explicitly so this suite owns its starting state instead of
// depending on the app's boot-time bootstrap. `user_version` is set the same
// way `ensureSchema` sets it, so db.server sees an initialised database.
{
	const bootstrap = new Database(sqlitePath);
	bootstrap.pragma("journal_mode = WAL");
	bootstrap.pragma("foreign_keys = ON");
	bootstrap.exec("BEGIN IMMEDIATE");
	try {
		bootstrap.exec(readFileSync(SCHEMA_FILE, "utf8"));
		bootstrap.pragma("user_version = 1");
		bootstrap.exec("COMMIT");
	} catch (err) {
		bootstrap.exec("ROLLBACK");
		throw err;
	}
	bootstrap.close();
}

const {
	users,
	teams,
	institutions,
	members,
	questionnaireResponses,
	statusTransitions,
	config,
	withTransaction,
	query,
	listAllMembers,
} = await import("../app/lib/db.server.ts");

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let pass = 0;
const fails = [];

function check(ok, label, detail) {
	if (ok) {
		pass++;
		console.log("  ok  ", label);
	} else {
		fails.push(label);
		console.log("  FAIL", label, detail ?? "");
	}
}

/**
 * Assert that `fn` throws, and that the error code matches.
 *
 * A regression in the error-code handling (bug class 2) surfaces here as a
 * named failure rather than as an unhandled exception that aborts the run.
 */
async function checkThrows(fn, codePattern, label) {
	try {
		await fn();
		check(false, label, "expected a throw, got none");
	} catch (err) {
		check(codePattern.test(err.code ?? err.message ?? ""), label, err.code ?? err.message);
	}
}

/**
 * Run `fn` and assert the predicate on its result.
 *
 * A throw counts as a failure with the same label, so a regression that makes
 * the statement itself invalid (bug classes 2 and 4) is reported as a named
 * assertion instead of aborting the whole run with a stack trace.
 */
async function checkResolves(fn, label, predicate) {
	try {
		const value = await fn();
		check(predicate(value), label, value);
	} catch (err) {
		check(false, label, `threw ${err.code ?? err.message}`);
	}
}

// Replaced with the real row's id once it exists: status_transitions carries an
// actor_user_id foreign key, so a synthetic id cannot be used as an actor.
let admin = { id: "22222222-2222-4222-8222-222222222222", role: "admin", institutionId: "" };

// ---------------------------------------------------------------------------
// institutions
// ---------------------------------------------------------------------------

console.log("\n== institutions ==");
const inst = await institutions.create(admin, {
	name: "Test Institute",
	district: "Ernakulam",
	code: "TEST-001",
	maxTeams: 10,
});
check(!!inst && inst.code === "TEST-001", "institutions.create", inst);
check(inst.maxTeams === 10 && inst.district === "Ernakulam", "create maps maxTeams/district", inst);
check(inst.created.endsWith("Z") && inst.created.includes("T"), "created is ISO UTC", inst.created);

const inst2 = await institutions.create(admin, { name: "Other", code: "TEST-002", maxTeams: 0 });
check(
	!!inst2 && inst2.maxTeams === 0 && inst2.district === "",
	"create with optional fields omitted",
	inst2,
);

const instList = await institutions.list(admin, { q: "test", perPage: 10 });
check(instList.totalItems === 2, "institutions.list LIKE q (case-insensitive)", instList.totalItems);
const instListCode = await institutions.list(admin, { q: "TEST-002" });
check(instListCode.totalItems === 1, "institutions.list q matches code", instListCode.totalItems);

check((await institutions.findByCode(admin, "TEST-001"))?.id === inst.id, "institutions.findByCode");
check((await institutions.getOne(admin, inst.id))?.id === inst.id, "institutions.getOne");
check((await institutions.getOne(admin, "not-a-uuid")) === null, "getOne rejects malformed id");

const locked = await institutions.lockForUpdate(admin, inst.id);
check(locked?.maxTeams === 10, "institutions.lockForUpdate", locked);

const instUpd = await institutions.update(admin, inst.id, { name: "Renamed Institute" });
check(instUpd?.name === "Renamed Institute", "institutions.update", instUpd?.name);
check(
	instUpd.updated !== inst.created,
	"updated_at trigger bumped on update",
	`${inst.created} -> ${instUpd.updated}`,
);

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

console.log("\n== users ==");
const lead = await users.create(admin, {
	email: "Priya@Test.Local",
	name: "Priya Raman",
	role: "lead",
	institutionId: inst.id,
	passwordHash: "hash-1",
});
check(!!lead && lead.email === "priya@test.local", "users.create lowercases email", lead);
check(lead.institutionId === inst.id, "users.create sets institutionId", lead.institutionId);

const found = await users.findByEmail("PRIYA@test.local");
check(
	found?.id === lead.id && found.passwordHash === "hash-1",
	"users.findByEmail case-insensitive + hash",
	found?.email,
);
check((await users.findById(lead.id))?.id === lead.id, "users.findById");
check((await users.findSessionUser(lead.id))?.passwordHash === "hash-1", "users.findSessionUser");
check(
	(await users.findById("00000000-0000-4000-8000-000000000000")) === null,
	"findById missing -> null",
);

const adminUser = await users.create(admin, {
	email: "admin@test.local",
	name: "Ada Admin",
	role: "admin",
	passwordHash: "hash-a",
});
const coordUser = await users.create(admin, {
	email: "coord@test.local",
	name: "Cody",
	role: "coordinator",
	passwordHash: "hash-c",
});
check(!!adminUser && !!coordUser, "users.create admin/coordinator (no institution)");
admin = { id: adminUser.id, role: "admin", institutionId: "" };

// §6.2: an institution may only invite a lead into its own institution.
const campusLead = await users.create(admin, {
	email: "campus@test.local",
	name: "Lakshmi",
	role: "institution",
	institutionId: inst.id,
	passwordHash: "hash-l",
});
const campusLeadActor = { id: campusLead.id, role: "institution", institutionId: inst.id };
const selfInvite = await users.create(campusLeadActor, {
	email: "newlead@test.local",
	name: "New Lead",
	role: "lead",
	institutionId: inst.id,
	passwordHash: "hash-n",
});
check(!!selfInvite, "institution may invite a lead into its own institution");
const crossInvite = await users.create(campusLeadActor, {
	email: "cross@test.local",
	name: "Cross",
	role: "lead",
	institutionId: inst2.id,
	passwordHash: "hash-x",
});
check(crossInvite === null, "institution may NOT invite into another institution", crossInvite);
const adminInvite = await users.create(campusLeadActor, {
	email: "badrole@test.local",
	name: "Bad",
	role: "admin",
	institutionId: inst.id,
	passwordHash: "hash-b",
});
check(adminInvite === null, "institution may NOT create an admin", adminInvite);

check((await users.count(admin)) === 5, "users.count as admin", await users.count(admin));
check(
	(await users.count(campusLeadActor)) >= 1,
	"users.count as campus lead",
	await users.count(campusLeadActor),
);

check((await users.findPasswordHashById(lead.id)) === "hash-1", "findPasswordHashById");
await users.updatePasswordHash(lead.id, "hash-2");
check((await users.findPasswordHashById(lead.id)) === "hash-2", "updatePasswordHash");
check(
	(await users.updatePasswordHashIfUnchanged(lead.id, "wrong", "hash-3")) === false,
	"updatePasswordHashIfUnchanged rejects stale",
);
check(
	(await users.updatePasswordHashIfUnchanged(lead.id, "hash-2", "hash-3")) === true,
	"updatePasswordHashIfUnchanged accepts match",
);
check((await users.findPasswordHashById(lead.id)) === "hash-3", "hash actually written");

// ---------------------------------------------------------------------------
// teams
// ---------------------------------------------------------------------------

console.log("\n== teams ==");
const team = await teams.create(admin, {
	name: "Team Priya",
	institutionId: inst.id,
	leaderUserId: lead.id,
	status: "registered",
	teamCode: "TP-001",
	statusChangedAt: "2026-01-15T09:00:00.000Z",
});
check(!!team && team.name === "Team Priya", "teams.create", team);
// Bug class 3: SQLite stores booleans as 0/1; the mapper must return a boolean.
check(
	team.questionnaireCompleted === false &&
		typeof team.questionnaireCompleted === "boolean",
	"questionnaireCompleted maps 0 -> false (real boolean)",
	team.questionnaireCompleted,
);
check(
	team.expand?.institutionId?.name === "Renamed Institute",
	"expand.institutionId joined",
	team.expand?.institutionId,
);
check(
	team.expand?.leaderUserId?.email === "priya@test.local",
	"expand.leaderUserId joined",
	team.expand?.leaderUserId,
);
check(
	team.statusChangedAt === "2026-01-15T09:00:00.000Z",
	"statusChangedAt round-trips",
	team.statusChangedAt,
);

// §6.2 create rules
const leadActor = { id: lead.id, role: "lead", institutionId: inst.id };
const leadSelfTeam = await teams.create(leadActor, {
	name: "Self Team",
	institutionId: inst.id,
	leaderUserId: lead.id,
	status: "registered",
});
check(!!leadSelfTeam, "lead may create their own team with status registered", leadSelfTeam);
// Remove it again so the downstream counts stay deterministic.
if (leadSelfTeam) await teams.delete(admin, leadSelfTeam.id);
const leadBadStatus = await teams.create(leadActor, {
	name: "Bad",
	institutionId: inst.id,
	leaderUserId: lead.id,
	status: "invited",
});
check(leadBadStatus === null, "lead cannot create with status invited", leadBadStatus);

const list = await teams.list(admin, { perPage: 10 });
check(list.totalItems === 1 && list.items[0].id === team.id, "teams.list as admin", list.totalItems);
check(list.totalPages === 1 && list.page === 1, "teams.list pagination meta", list);
const listQ = await teams.list(admin, { q: "priya" });
check(listQ.totalItems === 1, "teams.list q matches name", listQ.totalItems);
const listQCode = await teams.list(admin, { q: "TP-001" });
check(listQCode.totalItems === 1, "teams.list q matches team_code", listQCode.totalItems);
const listQLead = await teams.list(admin, { q: "priya@test.local" });
check(listQLead.totalItems === 1, "teams.list q matches lead email", listQLead.totalItems);
const listQInst = await teams.list(admin, { q: "renamed" });
check(listQInst.totalItems === 1, "teams.list q matches institution name", listQInst.totalItems);
const listStatus = await teams.list(admin, { status: ["registered", "shortlisted"] });
check(listStatus.totalItems === 1, "teams.list status IN (...)", listStatus.totalItems);
const listInst = await teams.list(admin, { institutionId: [inst.id, inst2.id] });
check(listInst.totalItems === 1, "teams.list institutionId IN (...)", listInst.totalItems);
const listBad = await teams.list(admin, { institutionId: "not-a-uuid" });
check(
	listBad.totalItems === 0 && listBad.items.length === 0,
	"teams.list malformed filter -> empty",
	listBad,
);
const listSort = await teams.list(admin, { sort: "-name" });
check(listSort.items.length === 1, "teams.list sort", listSort.items.length);

const agg = await teams.aggregate(admin);
check(agg.total === 1 && agg.byStatus.registered === 1, "teams.aggregate byStatus", agg);
check(
	agg.institutions === 1 && agg.byInstitution[inst.id].registered === 1,
	"teams.aggregate byInstitution",
	agg.byInstitution,
);

check((await teams.getOne(admin, team.id))?.id === team.id, "teams.getOne");
check((await teams.findByLeader(admin, lead.id))?.id === team.id, "teams.findByLeader");
check((await teams.countByInstitution(admin, inst.id)) === 1, "teams.countByInstitution as admin");
check((await teams.countByInstitution(campusLeadActor, inst.id)) === 1, "countByInstitution own inst");
check(
	(await teams.countByInstitution(campusLeadActor, inst2.id)) === 0,
	"countByInstitution other inst denied",
);

// Optimistic lock
const upd = await teams.update(
	admin,
	team.id,
	{ ideaTitle: "Idea", status: "shortlisted", statusChangedAt: "2026-02-01T00:00:00.000Z" },
	{ expectedStatus: "registered" },
);
check(upd?.status === "shortlisted" && upd.ideaTitle === "Idea", "teams.update with expectedStatus", upd);
const stale = await teams.update(admin, team.id, { status: "selected" }, { expectedStatus: "registered" });
check(stale === null, "teams.update rejects stale expectedStatus (409 path)", stale);
const noop = await teams.update(admin, team.id, {});
check(noop?.id === team.id, "teams.update empty patch returns current", noop?.id);

// Scope: another lead cannot see this team.
const otherLead = await users.create(admin, {
	email: "other@test.local",
	name: "Other",
	role: "lead",
	institutionId: inst2.id,
	passwordHash: "h",
});
const otherActor = { id: otherLead.id, role: "lead", institutionId: inst2.id };
check((await teams.getOne(otherActor, team.id)) === null, "foreign lead cannot read team (§6.2)");
check((await teams.list(otherActor)).totalItems === 0, "foreign lead sees no teams");
check(
	(await teams.update(otherActor, team.id, { name: "Hacked" })) === null,
	"foreign lead cannot update team",
);

// ---------------------------------------------------------------------------
// members
// ---------------------------------------------------------------------------

console.log("\n== members ==");
// Bug class 1: this statement is INSERT … SELECT … FROM teams. If the bind
// order regresses, these column assertions fail.
const m1 = await members.create(admin, {
	teamId: team.id,
	fullName: "Priya Raman",
	email: "Priya@Test.Local",
	phone: "9000000001",
	gender: "female",
	role: "lead",
});
check(!!m1 && m1.email === "priya@test.local", "members.create lowercases email", m1);
check(
	m1.fullName === "Priya Raman" && m1.phone === "9000000001" && m1.role === "lead",
	"members.create binds every column in order",
	m1,
);
const m2 = await members.create(admin, {
	teamId: team.id,
	fullName: "Dev Nair",
	email: "dev@test.local",
});
check(!!m2 && m2.phone === "" && m2.gender === "", "members.create optional -> ''", m2);

const many = await members.createMany(admin, team.id, [
	{ teamId: team.id, fullName: "A", email: "a@test.local", phone: "1", gender: "male", role: "member" },
	{ teamId: team.id, fullName: "B", email: "b@test.local", phone: "2", gender: "female", role: "member" },
]);
check(many === 2, "members.createMany multi-row CTE", many);
const manyDenied = await members.createMany(otherActor, team.id, [
	{ teamId: team.id, fullName: "C", email: "c@test.local" },
]);
check(manyDenied === 0, "members.createMany scope denial", manyDenied);

const mList = await members.list(admin, { teamId: team.id });
check(mList.totalItems === 4, "members.list by teamId", mList.totalItems);
const mListIds = await members.list(admin, { teamIds: [team.id] });
check(mListIds.totalItems === 4, "members.list teamIds IN (...)", mListIds.totalItems);
const mListInst = await members.list(admin, { institutionId: inst.id });
check(mListInst.totalItems === 4, "members.list institutionId", mListInst.totalItems);
const mListQ = await members.list(admin, { perPage: 2 });
check(mListQ.items.length === 2 && mListQ.totalPages === 2, "members.list pagination", mListQ);
check((await listAllMembers(admin)).length === 4, "listAllMembers pages through", (await listAllMembers(admin)).length);
const counts = await members.countByTeams(admin, [team.id]);
check(counts[team.id] === 4, "members.countByTeams", counts);

const mUpd = await members.update(admin, m2.id, { fullName: "Dev N.", phone: "" });
check(mUpd?.fullName === "Dev N." && mUpd.phone === "", "members.update NULLIF empty -> ''", mUpd);
const mUpdDenied = await members.update(otherActor, m2.id, { fullName: "Hacked" });
check(mUpdDenied === null, "members.update scope denial", mUpdDenied);
const mNoop = await members.update(admin, m1.id, {});
check(mNoop?.id === m1.id, "members.update empty patch reads current", mNoop?.id);

check((await members.delete(otherActor, m2.id)) === false, "members.delete scope denial");
check((await members.delete(admin, m2.id)) === true, "members.delete");
const removed = await members.deleteByTeam(admin, team.id);
check(removed === 3, "members.deleteByTeam EXISTS rewrite", removed);
check((await members.list(admin, { teamId: team.id })).totalItems === 0, "roster empty after deleteByTeam");

// ---------------------------------------------------------------------------
// questionnaire_responses
// ---------------------------------------------------------------------------

console.log("\n== questionnaire_responses ==");
// Bug class 1 again: INSERT … SELECT … FROM teams with 19 bound values.
const qr = await questionnaireResponses.upsert(leadActor, {
	teamId: team.id,
	userId: lead.id,
	age: 21,
	gender: "female",
	education: "B.Tech",
	collegeName: "Test Institute",
	district: "Ernakulam",
	skills: "TS",
	interests: "tools",
	challenges: "scope",
	experience: "2 hackathons",
	motivation: "build",
	teamExperience: "yes",
	expectations: "MARKER-VALUE",
	additionalInfo: "none",
	yearOfGraduation: "2027",
});
check(!!qr && qr.age === 21, "questionnaire.upsert insert", qr);
check(qr.expectations === "MARKER-VALUE" && qr.yearOfGraduation === "2027", "upsert maps fields", qr);
check(qr.collegeName === "Test Institute" && qr.teamExperience === "yes", "upsert camelCase mapping", qr);
check(typeof qr.createdAt === "string" && qr.createdAt.endsWith("Z"), "questionnaire createdAt is ISO", qr.createdAt);

const qr2 = await questionnaireResponses.upsert(leadActor, {
	teamId: team.id,
	userId: lead.id,
	age: 22,
	expectations: "MARKER-VALUE-2",
});
check(qr2?.id === qr.id, "upsert ON CONFLICT keeps one row", qr2?.id);
check(qr2.expectations === "MARKER-VALUE-2" && qr2.age === 22, "upsert DO UPDATE applied", qr2);
check((await questionnaireResponses.getByTeam(admin, team.id))?.id === qr.id, "getByTeam");
check((await questionnaireResponses.getByTeam(otherActor, team.id)) === null, "getByTeam scope denial");

const qrUpd = await questionnaireResponses.update(leadActor, qr.id, {
	challenges: "new challenge",
	age: 23,
});
check(qrUpd?.challenges === "new challenge" && qrUpd.age === 23, "questionnaire.update EXISTS rewrite", qrUpd);
const qrUpdDenied = await questionnaireResponses.update(otherActor, qr.id, { challenges: "hacked" });
check(qrUpdDenied === null, "questionnaire.update scope denial", qrUpdDenied);

await checkThrows(
	() => questionnaireResponses.create(admin, { teamId: team.id, userId: lead.id, age: 30 }),
	/UNIQUE/i,
	"questionnaire.create raises unique(team_id)",
);

// ---------------------------------------------------------------------------
// status_transitions
// ---------------------------------------------------------------------------

console.log("\n== status_transitions ==");
// Bug class 4: this INSERT … RETURNING must name real columns. The Postgres
// version used `RETURNING s.id` with no `s` alias and threw on every call.
let st;
try {
	st = await statusTransitions.create(admin, {
		teamId: team.id,
		fromStatus: "registered",
		toStatus: "shortlisted",
		at: "2026-02-01T00:00:00.000Z",
	});
} catch (err) {
	check(false, "statusTransitions.create RETURNING", `threw ${err.code ?? err.message}`);
}
if (st) {
	check(
		st.fromStatus === "registered" && st.toStatus === "shortlisted",
		"statusTransitions.create RETURNING",
		st,
	);
	check(
		typeof st.id === "string" && st.id.length === 36,
		"RETURNING yields the generated id",
		st.id,
	);
	check(st.actorUserId === admin.id && st.role === "admin", "transition actor from session", st);
	check(st.at === "2026-02-01T00:00:00.000Z", "transition at round-trips", st.at);
}
const stDenied = await statusTransitions.create(otherActor, {
	teamId: team.id,
	fromStatus: "shortlisted",
	toStatus: "selected",
});
check(stDenied === null, "transition scope denial", stDenied);
const stEmpty = await statusTransitions.create(admin, {
	teamId: team.id,
	fromStatus: "",
	toStatus: "registered",
});
check(stEmpty?.fromStatus === "", "transition allows '' from_status (CHECK)", stEmpty);

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

console.log("\n== config ==");
// Bug class 3: the schema seeds value=0; the mapper must return `false`, not 0.
const flag = await config.get("registration_open");
check(
	flag?.value === false && typeof flag.value === "boolean",
	"config.get seeded flag is false (real boolean)",
	flag,
);
check((await config.get("schema_version")) === null, "config.get skips schema_version");
check((await config.get("_internal")) === null, "config.get skips _ prefixed");
const up = await config.upsert(admin, "registration_open", true);
check(up?.value === true && typeof up.value === "boolean", "config.upsert true", up);
const upDenied = await config.upsert(leadActor, "registration_open", false);
check(upDenied === null, "config.upsert admin only", upDenied);
const toggled = await config.toggle(admin, "registration_open");
check(toggled?.value === false, "config.toggle NOT value", toggled);
const toggledBack = await config.toggle(admin, "registration_open");
check(toggledBack?.value === true, "config.toggle back", toggledBack);
check((await config.get("registration_open"))?.value === true, "config.get reflects toggle");

// ---------------------------------------------------------------------------
// query() + withTransaction
// ---------------------------------------------------------------------------

console.log("\n== query() + withTransaction ==");
const raw = await query("SELECT count(*) AS count FROM teams");
check(raw.rows[0].count === 1, "query() returns { rows }", raw.rows);

const before = (await query("SELECT count(*) AS c FROM members")).rows[0].c;
try {
	await withTransaction(async () => {
		await members.create(admin, { teamId: team.id, fullName: "Tx", email: "tx@test.local" });
		throw new Error("boom");
	});
} catch (err) {
	check(err.message === "boom", "withTransaction rethrows");
}
const after = (await query("SELECT count(*) AS c FROM members")).rows[0].c;
check(after === before, "withTransaction ROLLBACK discarded the write", `${before} -> ${after}`);

const committed = await withTransaction(async () => {
	const created = await members.create(admin, {
		teamId: team.id,
		fullName: "Tx2",
		email: "tx2@test.local",
	});
	await teams.update(admin, team.id, { ideaDesc: "in-tx" });
	return created;
});
check(!!committed, "withTransaction COMMIT returns value");
check((await query("SELECT count(*) AS c FROM members")).rows[0].c === before + 1, "COMMIT persisted");

// Concurrency: the mutex must serialise a transaction that awaits non-db I/O
// against ordinary queries (the campus-lead invite hashes argon2 inside one).
const concurrent = await Promise.all([
	withTransaction(async () => {
		await members.create(admin, { teamId: team.id, fullName: "Slow", email: "slow@test.local" });
		await new Promise((r) => setTimeout(r, 25));
		await members.create(admin, { teamId: team.id, fullName: "Slow2", email: "slow2@test.local" });
		return "tx";
	}),
	query("SELECT count(*) AS c FROM members"),
	query("SELECT count(*) AS c FROM teams"),
	members.list(admin, { teamId: team.id }),
]);
check(concurrent[0] === "tx", "concurrent transaction completed");
check(Array.isArray(concurrent[3].items), "concurrent reads returned rows");
const slowCount = (await query("SELECT count(*) AS c FROM members WHERE email LIKE 'slow%'")).rows[0].c;
check(slowCount === 2, "both slow writes committed", slowCount);

// ---------------------------------------------------------------------------
// FK / CHECK enforcement
// ---------------------------------------------------------------------------

console.log("\n== FK / CHECK enforcement ==");
// `INSERT ... SELECT ... FROM teams WHERE t.id = ?` yields zero rows for a
// missing team, so the write is a no-op rather than an FK error.
const missingTeam = await members.create(admin, {
	teamId: "11111111-1111-4111-8111-111111111999",
	fullName: "X",
	email: "x@test.local",
});
check(missingTeam === null, "members.create on a missing team inserts nothing", missingTeam);

// A direct insert with a dangling FK must still be rejected by the engine.
await checkThrows(
	() =>
		query("INSERT INTO members (id, team_id, full_name, email) VALUES (?, ?, ?, ?)", [
			"12121212-1212-4212-8212-121212121212",
			"11111111-1111-4111-8111-111111111999",
			"X",
			"x@test.local",
		]),
	/SQLITE_CONSTRAINT_FOREIGNKEY/,
	"FK enforced by the engine",
);

// Bug class 2: SQLite implements ON DELETE RESTRICT as an internal trigger, so
// a blocked delete raises SQLITE_CONSTRAINT_TRIGGER. `isForeignKeyViolation`
// must treat that as "not deleted" rather than letting it become a 500.
await checkResolves(
	() => institutions.delete(admin, inst.id),
	"institutions.delete blocked by FK -> false (not a 500)",
	(delInst) => delInst === false,
);
const delTeam = await teams.delete(admin, team.id);
check(delTeam === true, "teams.delete cascades");
check((await query("SELECT count(*) AS c FROM members")).rows[0].c === 0, "members cascaded on team delete");
check(
	(await query("SELECT count(*) AS c FROM status_transitions")).rows[0].c === 0,
	"status_transitions cascaded",
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n==== ${pass} passed, ${fails.length} failed ====`);
if (fails.length) {
	console.log("FAILED:\n  - " + fails.join("\n  - "));
	console.log(`\nDatabase kept for inspection: ${sqlitePath}`);
	process.exitCode = 1;
} else {
	rmSync(workDir, { recursive: true, force: true });
}
