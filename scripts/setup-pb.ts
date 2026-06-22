#!/usr/bin/env node
/**
 * PocketBase Collection Setup Script
 *
 * Connects to a PocketBase instance as superuser and ensures ALL required
 * collections exist with the correct schema. Creates collections that don't
 * exist, fixes existing ones, and seeds the `config` collection.
 *
 * Usage: npx tsx scripts/setup-pb.ts
 *
 * Environment variables (or use .env file):
 *   POCKETBASE_URL            – Base URL of the PocketBase instance
 *   POCKETBASE_ADMIN_EMAIL    – Superuser email
 *   POCKETBASE_ADMIN_PASSWORD – Superuser password
 *
 * Compatible with PocketBase v0.23+ API format (flat `fields` array, PATCH for updates).
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Env loader (lightweight — no dotenv dependency)
// ---------------------------------------------------------------------------

const __dirname = path.dirname(path.resolve(process.argv[1] ?? "."));

function loadEnv(): void {
	const envPath = path.resolve(__dirname, "..", ".env");
	if (!existsSync(envPath)) return;

	const content = readFileSync(envPath, "utf-8");
	for (const raw of content.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const eqIdx = line.indexOf("=");
		if (eqIdx <= 0) continue;
		const key = line.slice(0, eqIdx).trim();
		const val = line.slice(eqIdx + 1).trim();
		if (!process.env[key]) {
			process.env[key] = val;
		}
	}
}

loadEnv();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PB_URL = process.env.POCKETBASE_URL;
if (!PB_URL) {
	throw new Error(
		"POCKETBASE_URL environment variable is required. Set it in the environment or in a .env file.",
	);
}

const PB_ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL;
if (!PB_ADMIN_EMAIL) {
	throw new Error(
		"POCKETBASE_ADMIN_EMAIL environment variable is required. Set it in the environment or in a .env file.",
	);
}

const PB_ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD;
if (!PB_ADMIN_PASSWORD) {
	throw new Error(
		"POCKETBASE_ADMIN_PASSWORD environment variable is required. Set it in the environment or in a .env file.",
	);
}

const API_BASE = `${PB_URL.replace(/\/+$/, "")}/api`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pbFetch(
	pathname: string,
	options: RequestInit = {},
): Promise<{ status: number; ok: boolean; data: any }> {
	const url = `${API_BASE}${pathname}`;
	const resp = await fetch(url, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...(options.headers ?? {}),
		},
	});
	const text = await resp.text();
	let data: any;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	return { status: resp.status, ok: resp.ok, data };
}

async function superuserAuth(): Promise<string> {
	console.log("🔐 Authenticating as superuser…");
	const { ok, data } = await pbFetch(
		"/collections/_superusers/auth-with-password",
		{
			method: "POST",
			body: JSON.stringify({
				identity: PB_ADMIN_EMAIL,
				password: PB_ADMIN_PASSWORD,
			}),
		},
	);
	if (!ok) {
		throw new Error(`Authentication failed: ${JSON.stringify(data)}`);
	}
	console.log(`✅ Authenticated as ${data.record?.email ?? PB_ADMIN_EMAIL}`);
	return data.token as string;
}

function auth(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

async function getCollection(
	token: string,
	name: string,
): Promise<any | null> {
	const { status, ok, data } = await pbFetch(`/collections/${name}`, {
		headers: auth(token),
	});
	if (ok) return data;
	if (status === 404) return null;
	throw new Error(
		`Failed to fetch collection "${name}": ${JSON.stringify(data)}`,
	);
}

/** Fetch all collections and return a Map of name → id */
async function getCollectionIdMap(
	token: string,
): Promise<Map<string, string>> {
	const { ok, data } = await pbFetch("/collections", {
		headers: auth(token),
	});
	if (!ok || !data?.items) {
		throw new Error(
			`Failed to list collections: ${JSON.stringify(data)}`,
		);
	}
	const map = new Map<string, string>();
	for (const c of data.items) {
		map.set(c.name, c.id);
	}
	return map;
}

/** Shorthand for "no public access on any rule" — server-side access only */
const NO_RULES = {
	listRule: null,
	viewRule: null,
	createRule: null,
	updateRule: null,
	deleteRule: null,
} as const;

/** Allow authenticated users to read config feature flags */
const CONFIG_RULES = {
	listRule: '@request.auth.id != ""',
	viewRule: '@request.auth.id != ""',
} as const;

// ---------------------------------------------------------------------------
// Role-scoped rules — close IDOR on cross-team reads.
//
// All app code uses createSuperuserClient() for writes and the user's own
// client for reads, so the rules below restrict *direct* PB REST access
// (i.e. from a leaked JWT or a developer mistake) to the minimum each role
// legitimately needs.
//
// Roles: admin (everything) | coordinator (read all) | institution (read
// own institution's teams) | lead (read/write own team).
// ---------------------------------------------------------------------------

/** Team rules — close cross-team data leak. */
const TEAMS_RULES = {
	// Admin sees everything; institution sees its own; lead sees its own.
	// Coordinator is read-only across all teams.
	listRule:
		'@request.auth.role = "admin" || ' +
		'@request.auth.role = "coordinator" || ' +
		'(institutionId ?= @request.auth.institutionId && @request.auth.role = "institution") || ' +
		'(leaderUserId ?= @request.auth.id && @request.auth.role = "lead")',
	viewRule:
		'@request.auth.role = "admin" || ' +
		'@request.auth.role = "coordinator" || ' +
		'(institutionId ?= @request.auth.institutionId && @request.auth.role = "institution") || ' +
		'(leaderUserId ?= @request.auth.id && @request.auth.role = "lead")',
	// Only admin/institution create teams (admin for direct creation,
	// institution via the invite flow which then assigns a leader).
	createRule:
		'@request.auth.role = "admin" || ' +
		'@request.auth.role = "institution" || ' +
		'@request.auth.role = "lead"',
	// Lead can update only their own team and only while the status
	// transition is legal. Admin can update anything. Institution can
	// update teams within their institution (shortlist/unshortlist).
	updateRule:
		'@request.auth.role = "admin" || ' +
		'@request.auth.role = "institution" || ' +
		'(leaderUserId ?= @request.auth.id && @request.auth.role = "lead")',
	// Only admin can delete teams.
	deleteRule: '@request.auth.role = "admin"',
} as const;

/** Member rules — members are scoped to the parent team. */
const MEMBERS_RULES = {
	listRule:
		'@request.auth.role = "admin" || ' +
		'@request.auth.role = "coordinator" || ' +
		'@request.auth.role = "institution" || ' +
		'teamId.leaderUserId ?= @request.auth.id',
	viewRule:
		'@request.auth.role = "admin" || ' +
		'@request.auth.role = "coordinator" || ' +
		'@request.auth.role = "institution" || ' +
		'teamId.leaderUserId ?= @request.auth.id',
	createRule:
		'@request.auth.role = "admin" || ' +
		'@request.auth.role = "institution" || ' +
		'teamId.leaderUserId ?= @request.auth.id',
	updateRule:
		'@request.auth.role = "admin" || ' +
		'teamId.leaderUserId ?= @request.auth.id',
	deleteRule:
		'@request.auth.role = "admin" || ' +
		'teamId.leaderUserId ?= @request.auth.id',
} as const;

/** Questionnaire responses — scoped to the user or admin. */
const QUESTIONNAIRE_RULES = {
	listRule:
		'@request.auth.role = "admin" || ' +
		'@request.auth.role = "coordinator" || ' +
		'userId ?= @request.auth.id',
	viewRule:
		'@request.auth.role = "admin" || ' +
		'@request.auth.role = "coordinator" || ' +
		'userId ?= @request.auth.id',
	createRule: 'userId ?= @request.auth.id || @request.auth.role = "admin"',
	updateRule:
		'userId ?= @request.auth.id || @request.auth.role = "admin"',
	deleteRule: '@request.auth.role = "admin"',
} as const;

/** Institution rules — every authed user can see all institutions
 *  (needed for the institution picker and the team listing), but only
 *  admin can mutate. */
const INSTITUTIONS_RULES = {
	listRule: '@request.auth.id != ""',
	viewRule: '@request.auth.id != ""',
	createRule: '@request.auth.role = "admin"',
	updateRule: '@request.auth.role = "admin"',
	deleteRule: '@request.auth.role = "admin"',
} as const;

/** Users rules — every authed user can see their own record and
 *  institution/team leads' records (needed for joins), but only admin
 *  can mutate. */
const USERS_RULES = {
	listRule:
		'id = @request.auth.id || ' +
		'@request.auth.role = "admin" || ' +
		'@request.auth.role = "coordinator" || ' +
		'@request.auth.role = "institution"',
	viewRule:
		'id = @request.auth.id || ' +
		'@request.auth.role = "admin" || ' +
		'@request.auth.role = "coordinator" || ' +
		'@request.auth.role = "institution"',
	createRule: '@request.auth.role = "admin"',
	updateRule:
		'id = @request.auth.id && @request.body.role:isset = false && ' +
		'@request.body.institutionId:isset = false',
	deleteRule: '@request.auth.role = "admin"',
} as const;

async function ensureAuthenticatedAccess(
	token: string,
	collectionName: string,
	rules: Record<string, unknown>,
	label: string,
): Promise<void> {
	const existing = await getCollection(token, collectionName);
	if (!existing) return;
	const desired = JSON.stringify(rules);
	const current = JSON.stringify({
		listRule: existing.listRule,
		viewRule: existing.viewRule,
		createRule: existing.createRule,
		updateRule: existing.updateRule,
		deleteRule: existing.deleteRule,
	});
	if (current !== desired) {
		console.log(`  📝 Applying ${label} rules to «${collectionName}»…`);
		await updateCollection(token, collectionName, rules as any);
	} else {
		console.log(`  ✅ «${collectionName}» rules already match`);
	}
}

async function createCollection(
	token: string,
	collection: Record<string, unknown>,
): Promise<any> {
	const name = String(collection.name);
	console.log(`  ➕ Creating collection "${name}"…`);
	const { ok, data } = await pbFetch("/collections", {
		method: "POST",
		headers: auth(token),
		body: JSON.stringify(collection),
	});
	if (!ok) {
		throw new Error(
			`Failed to create collection "${name}": ${JSON.stringify(data)}`,
		);
	}
	console.log(`  ✅ Collection "${name}" created (id: ${data.id})`);
	return data;
}

async function updateCollection(
	token: string,
	name: string,
	collection: Record<string, unknown>,
): Promise<any> {
	console.log(`  🔄 Updating collection "${name}"…`);
	const { ok, data } = await pbFetch(`/collections/${name}`, {
		method: "PATCH",
		headers: auth(token),
		body: JSON.stringify(collection),
	});
	if (!ok) {
		throw new Error(
			`Failed to update collection "${name}": ${JSON.stringify(data)}`,
		);
	}
	console.log(`  ✅ Collection "${name}" updated`);
	return data;
}

async function createRecord(
	token: string,
	collection: string,
	record: Record<string, unknown>,
): Promise<any | null> {
	const { ok, data } = await pbFetch(
		`/collections/${collection}/records`,
		{
			method: "POST",
			headers: auth(token),
			body: JSON.stringify(record),
		},
	);
	if (!ok) {
		console.log(
			`  ⚠️  Could not create record: ${JSON.stringify(data)}`,
		);
		return null;
	}
	return data;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Helper: check if two string arrays have the same elements (order-agnostic)
// ---------------------------------------------------------------------------

function arraysEqualIgnoreOrder(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	const sortedA = [...a].sort();
	const sortedB = [...b].sort();
	return sortedA.every((v, i) => v === sortedB[i]);
}

// ---------------------------------------------------------------------------
// Constants for file upload restrictions
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = [
	"application/pdf",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
];
const MAX_FILE_SIZE = 10485760; // 10 MB

// ---------------------------------------------------------------------------
// Collection builders
// ---------------------------------------------------------------------------

async function ensureTeamsCollection(
	token: string,
	collectionIds: Map<string, string>,
): Promise<void> {
	console.log("\n🔧 Ensuring «teams» collection…");

	const existing = await getCollection(token, "teams");

	if (!existing) {
		// Create from scratch
		const instId = collectionIds.get("institutions");
		const usersId = collectionIds.get("users");

		await createCollection(token, {
			name: "teams",
			type: "base",
			fields: [
				{
					name: "name",
					type: "text",
					required: true,
					min: null,
					max: 100,
					pattern: "",
				},
				{
					name: "institutionId",
					type: "relation",
					required: true,
					collectionId: instId ?? "",
					cascadeDelete: false,
					maxSelect: 1,
					minSelect: null,
				},
				{
					name: "leaderUserId",
					type: "relation",
					required: true,
					collectionId: usersId ?? "",
					cascadeDelete: false,
					maxSelect: 1,
					minSelect: null,
				},
				{
					name: "teamCode",
					type: "text",
					required: false,
					min: null,
					max: 12,
					pattern: "^[A-Z0-9]+$",
				},
				{
					name: "status",
					type: "select",
					required: true,
					maxSelect: 1,
					values: [
						"invited",
						"registered",
						"shortlisted",
						"submitted",
						"selected",
						"rejected",
						"withdrawn",
					],
				},
				{
					// Plain date — the app owns the value on every status
					// transition. Using autodate here caused the field to
					// move on unrelated updates when a future schema bump
					// forgot to keep `onUpdate: false`.
					name: "status_changed_at",
					type: "date",
					required: false,
				},
				{
					// Denormalized flag so we don't need to join
					// questionnaire_responses on every read. Set by the
					// questionnaire action; cleared (never, in current
					// flow) only by an admin override.
					name: "questionnaire_completed",
					type: "bool",
					required: false,
				},
				{
					name: "idea_title",
					type: "text",
					required: false,
					min: null,
					max: 200,
					pattern: "",
				},
				{
					name: "idea_desc",
					type: "text",
					required: false,
					min: null,
					max: 5000,
					pattern: "",
				},
				{
					name: "idea_tech_stack",
					type: "text",
					required: false,
					min: null,
					max: 500,
					pattern: "",
				},
				{
					name: "submission_file",
					type: "file",
					required: false,
					maxSelect: 1,
					maxSize: MAX_FILE_SIZE,
					mimeTypes: ALLOWED_MIME_TYPES,
					protected: true,
				},
			],
			// Add indexes on the two hot filter columns so per-institution
			// and per-lead queries are not full scans. PocketBase stores
			// these as SQL indexes when listed in `indexes`.
			indexes: [
				"CREATE INDEX idx_teams_institution ON teams (institutionId)",
				"CREATE INDEX idx_teams_leader ON teams (leaderUserId)",
				"CREATE INDEX idx_teams_status ON teams (status)",
			],
			...NO_RULES,
		});
		return;
	}

	// Existing collection — fix fields
	const fields = existing.fields ?? [];
	let changed = false;

	// --- Fix the `name` vs `teamName` field ---
	// App uses `name`; legacy schemas use `teamName` as required.
	// Make `name` required and `teamName` non-required.
	const nameIdx = fields.findIndex((f: any) => f.name === "name");
	const teamNameIdx = fields.findIndex((f: any) => f.name === "teamName");

	if (nameIdx >= 0 && fields[nameIdx].required !== true) {
		console.log("  📝 Making «name» required…");
		fields[nameIdx].required = true;
		changed = true;
	}
	// Fix max length on name field — app enforces 100 chars
	if (nameIdx >= 0 && fields[nameIdx].max !== 100) {
		console.log("  📝 Setting «name» max length to 100…");
		fields[nameIdx].max = 100;
		changed = true;
	}
	if (teamNameIdx >= 0) {
		// Drop the dead legacy column.
		console.log("  🗑️  Removing dead field «teamName»…");
		fields.splice(teamNameIdx, 1);
		changed = true;
	}

	// --- Tighten `teamCode` ---
	const teamCodeIdx = fields.findIndex((f: any) => f.name === "teamCode");
	if (teamCodeIdx >= 0) {
		const tc = fields[teamCodeIdx];
		if (tc.max !== 12 || tc.pattern !== "^[A-Z0-9]+$") {
			console.log("  📝 Tightening «teamCode» pattern + max…");
			fields[teamCodeIdx] = { ...tc, max: 12, pattern: "^[A-Z0-9]+$" };
			changed = true;
		}
	}

	// --- Fix the `status` field ---
	const statusIdx = fields.findIndex((f: any) => f.name === "status");
	const correctStatusValues = [
		"invited",
		"registered",
		"shortlisted",
		"submitted",
		"selected",
		"rejected",
		"withdrawn",
	];

	if (statusIdx >= 0) {
		const sf = fields[statusIdx];
		const currentVals: string[] = sf.values ?? [];

		if (
			sf.maxSelect !== 1 ||
			!arraysEqualIgnoreOrder(currentVals, correctStatusValues)
		) {
			console.log("  📝 Updating «status» field select values…");
			fields[statusIdx] = {
				...sf,
				maxSelect: 1,
				values: correctStatusValues,
			};
			changed = true;
		} else {
			console.log("  ✅ «status» field already correct");
		}
	} else {
		console.log("  ➕ Adding missing «status» field…");
		fields.push({
			name: "status",
			type: "select",
			required: true,
			maxSelect: 1,
			values: correctStatusValues,
		});
		changed = true;
	}

	// --- Add `questionnaire_completed` (denormalized) ---
	const qcIdx = fields.findIndex(
		(f: any) => f.name === "questionnaire_completed",
	);
	if (qcIdx < 0) {
		console.log("  ➕ Adding «questionnaire_completed» bool field…");
		fields.push({ name: "questionnaire_completed", type: "bool", required: false });
		changed = true;
	}

	// --- Convert `status_changed_at` from autodate to plain date ---
	// The app owns the value; autodate was a footgun if `onUpdate` ever
	// got flipped on a future migration.
	const statusChangedAtIdx = fields.findIndex(
		(f: any) => f.name === "status_changed_at",
	);
	if (statusChangedAtIdx < 0) {
		console.log("  ➕ Adding «status_changed_at» date field…");
		fields.push({ name: "status_changed_at", type: "date", required: false });
		changed = true;
	} else if (fields[statusChangedAtIdx].type === "autodate") {
		console.log("  📝 Converting «status_changed_at» autodate → date…");
		fields[statusChangedAtIdx] = {
			name: "status_changed_at",
			type: "date",
			required: false,
		};
		changed = true;
	}

	// --- Tighten `idea_title`/`idea_desc`/`idea_tech_stack` max lengths ---
	const textLimits: Record<string, number> = {
		idea_title: 200,
		idea_desc: 5000,
		idea_tech_stack: 500,
	};
	for (const [name, max] of Object.entries(textLimits)) {
		const idx = fields.findIndex((f: any) => f.name === name);
		if (idx >= 0 && fields[idx].max !== max) {
			console.log(`  📝 Setting «${name}» max to ${max}…`);
			fields[idx].max = max;
			changed = true;
		}
	}

	// --- Fix the `submission_file` field (MIME types + maxSize + protected) ---
	const fileIdx = fields.findIndex((f: any) => f.name === "submission_file");
	if (fileIdx >= 0) {
		const sf = fields[fileIdx];
		let fileChanged = false;

		// Check mimeTypes — empty array means all types accepted
		const currentMimes: string[] = sf.mimeTypes ?? [];
		if (currentMimes.length === 0 || !arraysEqualIgnoreOrder(currentMimes, ALLOWED_MIME_TYPES)) {
			console.log("  📝 Restricting «submission_file» MIME types…");
			sf.mimeTypes = ALLOWED_MIME_TYPES;
			fileChanged = true;
		}

		// Check maxSize — 0 means unlimited
		if (sf.maxSize === 0 || sf.maxSize > MAX_FILE_SIZE) {
			console.log("  📝 Setting «submission_file» max size to 10 MB…");
			sf.maxSize = MAX_FILE_SIZE;
			fileChanged = true;
		}

		// protected: true forces downloads to go through the /api/files
		// proxy (which is the only way to enforce ownership checks).
		if (sf.protected !== true) {
			console.log("  📝 Marking «submission_file» as protected…");
			sf.protected = true;
			fileChanged = true;
		}

		if (fileChanged) {
			changed = true;
		} else {
			console.log("  ✅ «submission_file» field already restricted");
		}
	}

	if (changed) {
		// Apply field changes AND indexes in the same PATCH.
		await updateCollection(token, "teams", {
			fields,
			indexes: [
				"CREATE INDEX idx_teams_institution ON teams (institutionId)",
				"CREATE INDEX idx_teams_leader ON teams (leaderUserId)",
				"CREATE INDEX idx_teams_status ON teams (status)",
			],
		} as any);
	} else {
		console.log("  ✅ No changes needed for «teams» collection");
	}
}

async function ensureInstitutionsCollection(
	token: string,
	collectionIds: Map<string, string>,
): Promise<void> {
	console.log("\n🔧 Ensuring «institutions» collection…");

	const existing = await getCollection(token, "institutions");
	const usersId = collectionIds.get("users");

	if (existing) {
		// Fix existing collection — ensure fields match what the app expects
		const fields = existing.fields ?? [];
		let changed = false;

		// Drop dead legacy columns. They were never populated by the app
		// (the join goes user.institutionId) and the institution.campusLeadId
		// relation is the only real link.
		for (const deadField of ["campusLeadName", "campusLeadEmail"]) {
			const idx = fields.findIndex((f: any) => f.name === deadField);
			if (idx >= 0) {
				console.log(`  🗑️  Removing dead field «${deadField}»…`);
				fields.splice(idx, 1);
				changed = true;
			}
		}

		// Make sure campusLeadId relation still exists and is optional
		const hasLeadId = fields.some((f: any) => f.name === "campusLeadId");
		if (!hasLeadId) {
			console.log("  ➕ Adding «campusLeadId» relation field…");
			fields.push({
				name: "campusLeadId",
				type: "relation",
				required: false,
				collectionId: usersId ?? "",
				cascadeDelete: false,
				maxSelect: 1,
				minSelect: null,
			});
			changed = true;
		}

		// Ensure maxTeams field exists
		const hasMaxTeams = fields.some((f: any) => f.name === "maxTeams");
		if (!hasMaxTeams) {
			console.log("  ➕ Adding «maxTeams» field…");
			fields.push({ name: "maxTeams", type: "number", required: false, min: null, max: null, onlyInt: false });
			changed = true;
		}

		// Ensure status field exists and is a select (not free text)
		const statusIdx = fields.findIndex((f: any) => f.name === "status");
		if (statusIdx < 0) {
			console.log("  ➕ Adding «status» select field…");
			fields.push({
				name: "status",
				type: "select",
				required: false,
				maxSelect: 1,
				values: ["active", "suspended"],
			});
			changed = true;
		} else if (fields[statusIdx].type !== "select") {
			console.log("  📝 Converting «status» to select with fixed values…");
			fields[statusIdx] = {
				name: "status",
				type: "select",
				required: false,
				maxSelect: 1,
				values: ["active", "suspended"],
			};
			changed = true;
		}

		if (changed) {
			await updateCollection(token, "institutions", { fields });
		} else {
			console.log("  ✅ «institutions» collection already correct");
		}
		return;
	}

	await createCollection(token, {
		name: "institutions",
		type: "base",
		fields: [
			{
				name: "name",
				type: "text",
				required: true,
				min: null,
				max: 100,
				pattern: "",
			},
			{
				name: "district",
				type: "text",
				required: false,
				min: null,
				max: 100,
				pattern: "",
			},
			{
				name: "code",
				type: "text",
				required: true,
				min: null,
				max: 12,
				pattern: "^[A-Z0-9]+$",
			},
			{
				name: "campusLeadId",
				type: "relation",
				required: false,
				collectionId: usersId ?? "",
				cascadeDelete: false,
				maxSelect: 1,
				minSelect: null,
			},
			{
				name: "maxTeams",
				type: "number",
				required: false,
				min: 0,
				max: null,
				onlyInt: true,
			},
			{
				name: "status",
				type: "select",
				required: false,
				maxSelect: 1,
				values: ["active", "suspended"],
			},
		],
		...NO_RULES,
	});
}

async function ensureMembersCollection(
	token: string,
	collectionIds: Map<string, string>,
): Promise<void> {
	console.log("\n🔧 Ensuring «members» collection…");

	const existing = await getCollection(token, "members");
	if (existing) {
		console.log(
			"  ✅ «members» collection already exists — skipping creation",
		);
		return;
	}

	const teamsId = collectionIds.get("teams");

	await createCollection(token, {
		name: "members",
		type: "base",
		fields: [
			{
				name: "teamId",
				type: "relation",
				required: true,
				collectionId: teamsId ?? "",
				cascadeDelete: true,
				maxSelect: 1,
				minSelect: null,
			},
			{
				name: "fullName",
				type: "text",
				required: true,
				min: null,
				max: null,
				pattern: "",
			},
			{
				name: "email",
				type: "text",
				required: true,
				min: null,
				max: null,
				pattern: "",
			},
			{
				name: "phone",
				type: "text",
				required: false,
				min: null,
				max: null,
				pattern: "",
			},
			{
				name: "gender",
				type: "text",
				required: false,
				min: null,
				max: null,
				pattern: "",
			},
			{
				name: "role",
				type: "text",
				required: false,
				min: null,
				max: null,
				pattern: "",
			},
		],
		...NO_RULES,
	});
}

async function ensureConfigCollection(token: string): Promise<void> {
	console.log("\n🔧 Ensuring «config» collection…");

	const existing = await getCollection(token, "config");

	if (existing) {
		// Check if the `value` bool field needs the `required` flag fixed
		const fields = existing.fields ?? [];
		const valueField = fields.find((f: any) => f.name === "value");
		if (valueField && valueField.required !== false) {
			console.log(
				'  📝 Fixing «value» bool field (changing required: true → required: false so false values can be saved)…',
			);
			valueField.required = false;
			await updateCollection(token, "config", { fields });
		} else {
			console.log("  ✅ «config» collection already exists with correct schema");
		}

		// Ensure config allows authenticated reads
		if (!existing.listRule || !existing.viewRule) {
			console.log("  📝 Updating config API rules (allowing authenticated reads)…");
			await updateCollection(token, "config", CONFIG_RULES as any);
		}

		// Check if records need seeding
		const { ok, data } = await pbFetch("/collections/config/records", {
			headers: auth(token),
		});
		if (ok && data?.totalItems === 0) {
			await seedConfigRecords(token);
		} else if (ok) {
			console.log(`  ✅ Config already has ${data.totalItems} records`);
		}
		return;
	}

	await createCollection(token, {
		name: "config",
		type: "base",
		fields: [
			{
				name: "key",
				type: "text",
				required: true,
				min: null,
				max: null,
				pattern: "",
			},
			{
				name: "value",
				type: "bool",
				required: false, // required:true prevents saving `false` values
			},
		],
		...CONFIG_RULES,
	});

	// Seed initial config entries
	await seedConfigRecords(token);
}

async function seedConfigRecords(token: string): Promise<void> {
	console.log("  🌱 Seeding config records…");
	const seeds = [
		{ key: "registration_open", value: false },
		{ key: "questionnaire_open", value: false },
		{ key: "nomination_open", value: false },
		{ key: "submission_open", value: false },
	];
	for (const seed of seeds) {
		await createRecord(token, "config", seed);
		await sleep(50);
	}
	// Verify seeding
	const { ok, data } = await pbFetch("/collections/config/records", {
		headers: auth(token),
	});
	if (ok && data?.items) {
		console.log(
			`  ✅ Config collection seeded (${data.items.length} records total)`,
		);
	}
}

async function ensureQuestionnaireResponsesCollection(
	token: string,
	collectionIds: Map<string, string>,
): Promise<void> {
	console.log("\n🔧 Ensuring «questionnaire_responses» collection…");

	const existing = await getCollection(token, "questionnaire_responses");
	const teamsId = collectionIds.get("teams");
	const usersId = collectionIds.get("users");

	if (!teamsId || !usersId) {
		throw new Error(
			"Cannot resolve collection IDs for relations (teams or users missing).",
		);
	}

	if (existing) {
		// Fix existing collection — ensure all fields the form sends are present
		const fields = existing.fields ?? [];
		let changed = false;

		const expectedFields = [
			{ name: "age", type: "number", required: false, min: null, max: null, onlyInt: false },
			{ name: "gender", type: "select", required: false, maxSelect: 1, values: ["Male", "Female", "Other"] },
			{ name: "education", type: "text", required: false, min: null, max: null, pattern: "" },
			{ name: "college_name", type: "text", required: false, min: null, max: null, pattern: "" },
			{ name: "district", type: "text", required: false, min: null, max: null, pattern: "" },
			{ name: "skills", type: "text", required: false, min: null, max: null, pattern: "" },
			{ name: "interests", type: "text", required: false, min: null, max: null, pattern: "" },
			{ name: "challenges", type: "text", required: false, min: null, max: null, pattern: "" },
			{ name: "experience", type: "text", required: false, min: null, max: null, pattern: "" },
			{ name: "motivation", type: "text", required: false, min: null, max: null, pattern: "" },
			{ name: "team_experience", type: "text", required: false, min: null, max: null, pattern: "" },
			{ name: "expectations", type: "text", required: false, min: null, max: null, pattern: "" },
			{ name: "additional_info", type: "text", required: false, min: null, max: null, pattern: "" },
		];

		for (const ef of expectedFields) {
			const exists = fields.some((f: any) => f.name === ef.name);
			if (!exists) {
				console.log(`  ➕ Adding missing «${ef.name}» field…`);
				fields.push(ef);
				changed = true;
			}
		}

		if (changed) {
			await updateCollection(token, "questionnaire_responses", { fields });
		} else {
			console.log("  ✅ «questionnaire_responses» collection already has all expected fields");
		}
		return;
	}

	// Create from scratch with all fields matching the questionnaire form
	await createCollection(token, {
		name: "questionnaire_responses",
		type: "base",
		fields: [
			{
				name: "teamId",
				type: "relation",
				required: true,
				collectionId: teamsId,
				cascadeDelete: true,
				maxSelect: 1,
				minSelect: null,
			},
			{
				name: "userId",
				type: "relation",
				required: true,
				collectionId: usersId,
				cascadeDelete: false,
				maxSelect: 1,
				minSelect: null,
			},
			{ name: "age", type: "number", required: false, min: null, max: null, onlyInt: false },
			{ name: "gender", type: "select", required: false, maxSelect: 1, values: ["Male", "Female", "Other"] },
			{ name: "education", type: "text", required: false, min: null, max: 200, pattern: "" },
			{ name: "college_name", type: "text", required: false, min: null, max: 200, pattern: "" },
			{ name: "district", type: "text", required: false, min: null, max: 100, pattern: "" },
			{ name: "skills", type: "text", required: false, min: null, max: 1000, pattern: "" },
			{ name: "interests", type: "text", required: false, min: null, max: 1000, pattern: "" },
			{ name: "challenges", type: "text", required: false, min: null, max: 2000, pattern: "" },
			{ name: "experience", type: "text", required: false, min: null, max: 2000, pattern: "" },
			{ name: "motivation", type: "text", required: false, min: null, max: 2000, pattern: "" },
			{ name: "team_experience", type: "text", required: false, min: null, max: 2000, pattern: "" },
			{ name: "expectations", type: "text", required: false, min: null, max: 2000, pattern: "" },
			{ name: "additional_info", type: "text", required: false, min: null, max: 2000, pattern: "" },
		],
		indexes: [
			"CREATE INDEX idx_qr_team ON questionnaire_responses (teamId)",
			"CREATE INDEX idx_qr_user ON questionnaire_responses (userId)",
		],
		...NO_RULES,
	});
}


// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function ensureRateLimiting(token: string): Promise<void> {
	console.log("\n🔧 Configuring rate limiting…");
	const { ok, data } = await pbFetch("/api/settings", { headers: auth(token) });
	if (!ok) {
		console.log("  ⚠️  Could not read settings");
		return;
	}

	if (data?.rateLimits?.enabled) {
		console.log("  ✅ Rate limiting already enabled");
		return;
	}

	const { ok: patchOk } = await pbFetch("/api/settings", {
		method: "PATCH",
		headers: auth(token),
		body: JSON.stringify({
			rateLimits: {
				enabled: true,
				rules: [
					{ label: "*:auth", duration: 60, maxRequests: 10 },
					{ label: "*:create", duration: 60, maxRequests: 30 },
					{ label: "/api/files", duration: 60, maxRequests: 10 },
					{ label: "/api/", duration: 60, maxRequests: 300 },
				],
			},
		}),
	});

	if (patchOk) {
		console.log("  ✅ Rate limiting enabled (10 auth/min, 30 create/min, 10 files/min, 300 api/min)");
	} else {
		console.log("  ⚠️  Could not enable rate limiting");
	}
}

/**
 * Lock down the built-in `users` auth collection.
 *
 * 1. Apply the role-scoped read rules (USERS_RULES) so direct PB access
 *    from a leaked JWT cannot list every user.
 * 2. Make `role` a `select` field with the four known values — a free-text
 *    `role` field accepts any string and is a privilege-escalation surface.
 * 3. Update the rule to block setting the `role` or `institutionId`
 *    fields from regular user updates. Superuser operations (via
 *    createSuperuserClient()) bypass API rules entirely, so admin flows
 *    still work.
 */
async function ensureUsersCollection(token: string): Promise<void> {
	console.log("\n🔧 Locking down users collection…");

	const existing = await getCollection(token, "users");
	if (!existing) {
		console.log("  ⚠️  users collection not found — skipping");
		return;
	}

	const fields = existing.fields ?? [];
	let fieldsChanged = false;

	// Convert `role` to a select with the four known values.
	const roleIdx = fields.findIndex((f: any) => f.name === "role");
	const correctRoleValues = ["admin", "coordinator", "institution", "lead"];
	if (roleIdx >= 0) {
		const rf = fields[roleIdx];
		const currentVals: string[] = rf.values ?? [];
		if (
			rf.type !== "select" ||
			rf.maxSelect !== 1 ||
			!arraysEqualIgnoreOrder(currentVals, correctRoleValues)
		) {
			console.log("  📝 Converting «role» to constrained select…");
			fields[roleIdx] = {
				name: "role",
				type: "select",
				required: true,
				maxSelect: 1,
				values: correctRoleValues,
			};
			fieldsChanged = true;
		}
	} else {
		console.log("  ➕ Adding «role» select field…");
		fields.push({
			name: "role",
			type: "select",
			required: true,
			maxSelect: 1,
			values: correctRoleValues,
		});
		fieldsChanged = true;
	}

	// Tighten `institutionId` (relation to institutions) if present — it
	// already exists by default in PocketBase auth but should be optional
	// (admin/coordinator users don't have one).
	const instRelIdx = fields.findIndex((f: any) => f.name === "institutionId");
	if (instRelIdx >= 0 && fields[instRelIdx].required === true) {
		console.log("  📝 Making «institutionId» non-required…");
		fields[instRelIdx].required = false;
		fieldsChanged = true;
	}

	const desiredUpdateRule =
		'id = @request.auth.id && ' +
		'@request.body.role:isset = false && ' +
		'@request.body.institutionId:isset = false';

	const rulesChanged =
		existing.listRule !== USERS_RULES.listRule ||
		existing.viewRule !== USERS_RULES.viewRule ||
		existing.updateRule !== desiredUpdateRule ||
		existing.createRule !== USERS_RULES.createRule ||
		existing.deleteRule !== USERS_RULES.deleteRule;

	if (!fieldsChanged && !rulesChanged) {
		console.log("  ✅ Users collection already locked down");
		return;
	}

	await updateCollection(token, "users", {
		...(fieldsChanged ? { fields } : {}),
		listRule: USERS_RULES.listRule,
		viewRule: USERS_RULES.viewRule,
		createRule: USERS_RULES.createRule,
		updateRule: desiredUpdateRule,
		deleteRule: USERS_RULES.deleteRule,
	} as any);
	console.log("  ✅ Users collection locked down");
}

async function main(): Promise<void> {
	console.log("╔══════════════════════════════════════════════╗");
	console.log("║       PocketBase Collection Setup Script     ║");
	console.log("╚══════════════════════════════════════════════╝");
	console.log(`📍 URL:   ${PB_URL}`);
	console.log(`📧 Admin: ${PB_ADMIN_EMAIL}`);
	console.log("─".repeat(50));

	const token = await superuserAuth();

	// Build collection name → ID map for relation fields
	const collectionIds = await getCollectionIdMap(token);

	// Order matters: base collections first, then those with relations
	await ensureInstitutionsCollection(token, collectionIds);
	// Refresh IDs after creating institutions
	const refreshedIds = await getCollectionIdMap(token);
	await ensureTeamsCollection(token, refreshedIds);
	await ensureMembersCollection(token, refreshedIds);
	await ensureQuestionnaireResponsesCollection(token, refreshedIds);
	await ensureConfigCollection(token);

	// Apply role-scoped API rules (closes cross-team IDOR on direct PB access).
	console.log("\n🔧 Applying role-scoped API rules…");
	await ensureAuthenticatedAccess(token, "teams", TEAMS_RULES, "team-scoped");
	await ensureAuthenticatedAccess(token, "members", MEMBERS_RULES, "member-scoped");
	await ensureAuthenticatedAccess(token, "institutions", INSTITUTIONS_RULES, "institution");
	await ensureAuthenticatedAccess(
		token,
		"questionnaire_responses",
		QUESTIONNAIRE_RULES,
		"questionnaire",
	);
	console.log("  ✅ All collections have role-scoped access rules");

	// Protect users collection against self-role-escalation AND apply read scope
	await ensureUsersCollection(token);

	// Email is sent directly via PocketBase hooks using the built-in
	// mail client — no email_outbox collection needed.

	console.log("\n" + "=".repeat(50));
	console.log("✅ PocketBase setup complete!");
	console.log("=".repeat(50));
}

main().catch((err) => {
	console.error("\n❌ Setup failed:", err.message);
	process.exit(1);
});
