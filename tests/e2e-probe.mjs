// Comprehensive probe - reads system state for test planning
import { readFileSync } from "fs";
const env = {};
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const PB = env.POCKETBASE_URL;
const ADMIN_EMAIL = env.POCKETBASE_ADMIN_EMAIL;
const ADMIN_PASSWORD = env.POCKETBASE_ADMIN_PASSWORD;
const APP = "http://localhost:5173";
let _superToken = null;
async function getSuperToken() {
  if (_superToken) return _superToken;
  const r = await fetch(`${PB}/api/admins/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const data = await r.json();
  _superToken = data.token;
  return _superToken;
}

async function call(path, opts = {}) {
  opts.headers = { ...(opts.headers || {}) };
  const r = await fetch(`${PB}${path}`, opts);
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function list(collection, query = "") {
  return call(`/api/collections/${collection}/records?perPage=500${query ? "&" + query : ""}`, {
    headers: { "Authorization": await getSuperToken() },
  });
}

const collections = ["users", "institutions", "teams", "members", "team_drafts", "email_outbox", "app_config"];
console.log("=== COUNTS ===");
for (const c of collections) {
  const data = await list(c);
  console.log(`  ${c}: ${data.body.totalItems ?? data.body.items?.length ?? "?"}`);
}

console.log("\n=== USERS ===");
const usersData = await list("users", 'fields=id,email,name,role,institutionId,verified');
for (const u of (usersData.body.items ?? [])) {
  console.log(`  ${u.role || "(empty)"} | ${u.email} | ${u.name} | inst=${u.institutionId || "-"} | verif=${u.verified}`);
}

console.log("\n=== INSTITUTIONS ===");
const instData = await list("institutions");
for (const i of (instData.body.items ?? [])) {
  console.log(`  ${i.id} | ${i.name} | ${i.district || "-"} | ${i.tier || "-"}`);
}

console.log("\n=== TEAMS ===");
const teamsData = await list("teams", "fields=id,teamName,teamCode,status,leadId,institutionId,questionnaire_completed,created");
for (const t of (teamsData.body.items ?? [])) {
  console.log(`  ${t.teamCode} | ${t.teamName} | ${t.status} | lead=${t.leadId} | inst=${t.institutionId} | q=${t.questionnaire_completed} | ${t.created}`);
}

console.log("\n=== MEMBERS ===");
const membersData = await list("members", "fields=id,teamId,name,email,isLead");
for (const m of (membersData.body.items ?? [])) {
  console.log(`  team=${m.teamId} | ${m.name} | ${m.email} | lead=${m.isLead}`);
}

console.log("\n=== DRAFTS ===");
const draftsData = await list("team_drafts");
for (const d of (draftsData.body.items ?? [])) {
  console.log(`  user=${d.user} | form=${d.formType} | updated=${d.updated}`);
}

console.log("\n=== OUTBOX ===");
const outboxData = await list("email_outbox");
for (const m of (outboxData.body.items ?? [])) {
  console.log(`  to=${m.to} | status=${m.status} | attempts=${m.attempts} | subj=${m.subject} | err=${(m.last_error || "").slice(0,60)}`);
}

console.log("\n=== CONFIG ===");
const cfgData = await list("app_config");
for (const c of (cfgData.body.items ?? [])) {
  console.log(`  ${c.key} = ${c.value}`);
}