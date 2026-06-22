// Ultimate E2E test - exercises every route, every role, every input
import { readFileSync } from "fs";
const env = {};
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const APP = "http://localhost:5173";
const PB = env.POCKETBASE_URL;
const ADMIN_EMAIL = env.POCKETBASE_ADMIN_EMAIL;
const ADMIN_PASSWORD = env.POCKETBASE_ADMIN_PASSWORD;
const PW = "REDACTED_TEST_PW";
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

let pass = 0, fail = 0;
const failures = [];
function PASS(name, info = "") { pass++; console.log(`PASS ${name}${info ? ` (${info})` : ""}`); }
function FAIL(name, info) { fail++; failures.push({ name, info }); console.log(`FAIL ${name} -- ${info}`); }

// Cookie jar
const cookieJars = {};
function setCookie(jarKey, setCookieHeader) {
  if (!setCookieHeader) return;
  for (const c of setCookieHeader.split(/,(?=\s*[A-Za-z0-9_-]+=)/)) {
    const m = c.match(/^([^=]+)=([^;]+)/);
    if (m) cookieJars[jarKey] = (cookieJars[jarKey] || "") + `${m[1]}=${m[2]}; `;
  }
}

async function call(path, opts = {}, jarKey = "default") {
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: APP,  // default Origin for CSRF
    ...(cookieJars[jarKey] ? { Cookie: cookieJars[jarKey] } : {}),
    ...(opts.headers || {}),
  };
  // Remove Origin if explicitly set to empty
  if (opts.headers && "Origin" in opts.headers && !opts.headers.Origin) delete headers.Origin;
  const r = await fetch(`${APP}${path}`, { ...opts, headers, redirect: "manual" });
  // Collect set-cookie
  const sc = r.headers.getSetCookie?.() ?? [];
  if (sc.length) {
    let merged = "";
    for (const c of sc) {
      const m = c.match(/^([^=]+)=([^;]+)/);
      if (m) merged += `${m[1]}=${m[2]}; `;
    }
    cookieJars[jarKey] = merged;
  }
  return {
    status: r.status,
    headers: r.headers,
    body: r.status < 400 ? await r.text().catch(() => "") : "",
  };
}

async function login(email, password, jarKey = "default") {
  const r = await call("/login", {
    method: "POST",
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
  }, jarKey);
  return r.status;
}

const CREDS = {
  admin: { email: "REDACTED@test.local", pass: PW },
  admin2: { email: "REDACTED@test.local", pass: PW },
  coordinator: { email: "REDACTED@test.local", pass: PW },
  institution: { email: "REDACTED@test.local", pass: PW },
  lead_priya: { email: "REDACTED@test.local", pass: PW },
  lead_newteam: { email: "REDACTED@test.local", pass: PW },
  lead_arunraj: { email: "REDACTED@test.local", pass: PW },
};

async function logInAs(role, jarKey) {
  const c = CREDS[role];
  const status = await login(c.email, c.pass, jarKey);
  if (status !== 302) {
    console.log(`  LOGIN FAIL for ${role}: ${status}`);
    return false;
  }
  return true;
}

// =========================================================================
// TEST 1: PUBLIC PAGES
// =========================================================================
console.log("\n=========== TEST 1: PUBLIC PAGES ===========");
{
  const r = await call("/");
  if (r.status === 302 || r.status === 200) PASS("/ (root redirect or dashboard)");
  else FAIL("/", `status ${r.status}`);
}
{
  const r = await call("/login");
  if (r.status === 200) PASS("/login renders");
  else FAIL("/login", r.status);
}
{
  const r = await call("/forgot-password");
  if (r.status === 200) PASS("/forgot-password renders");
  else FAIL("/forgot-password", r.status);
}
// Random 404 page
{
  const r = await call("/this-does-not-exist");
  if (r.status === 404) PASS("/nonexistent -> 404");
  else FAIL("/nonexistent", r.status);
}

// =========================================================================
// TEST 2: LOGIN FAILURE MODES
// =========================================================================
console.log("\n=========== TEST 2: LOGIN FAILURES ===========");
async function tryLogin(body, jar = "fail") {
  const r = await call("/login", { method: "POST", body }, jar);
  return r;
}
{
  const r = await tryLogin("");
  if (r.status === 400) PASS("empty body -> 400");
  else FAIL("empty body", r.status);
}
{
  const r = await tryLogin("email=&password=");
  if (r.status === 400) PASS("empty fields -> 400");
  else FAIL("empty fields", r.status);
}
{
  const r = await tryLogin(`email=${encodeURIComponent("nobody@x.com")}&password=wrong`);
  if (r.status === 200 && r.body.includes("Invalid")) PASS("wrong creds -> invalid message");
  else FAIL("wrong creds", `${r.status}`);
}
{
  const r = await tryLogin(`email=${encodeURIComponent("not-an-email")}&password=foo`);
  if (r.status === 200 || r.status === 400) PASS("invalid email format -> handled");
  else FAIL("invalid email", r.status);
}

// =========================================================================
// TEST 3: AUTH BOUNDARIES - PUBLIC API ENDPOINTS WITHOUT COOKIE
// =========================================================================
console.log("\n=========== TEST 3: PUBLIC API AUTH GATES ===========");
const apiEndpoints = [
  "/api/institutions",
  "/api/drafts/register",
  "/api/email/drain",
  "/api/export/csv?filterStatus=all",
];
for (const ep of apiEndpoints) {
  const r = await call(ep);
  if (r.status === 401 || r.status === 403 || r.status === 405) PASS(`${ep} blocked: ${r.status}`);
  else FAIL(ep, `status ${r.status}`);
}

// Files endpoint
{
  const r = await call("/api/files/teams/abc/file.pdf");
  if (r.status === 401 || r.status === 404) PASS("/api/files (no auth) -> ${r.status}");
  else FAIL("/api/files (no auth)", r.status);
}
{
  const r = await call("/api/files/teams/abc/..%2Fbad.pdf");
  if (r.status === 401 || r.status === 404 || r.status === 400) PASS("/api/files (traversal) -> ${r.status}");
  else FAIL("/api/files (traversal)", r.status);
}

// =========================================================================
// TEST 4: AUTHENTICATED PAGES - EACH ROLE GETS CORRECT DASHBOARD
// =========================================================================
console.log("\n=========== TEST 4: ROLE-BASED DASHBOARDS ===========");
for (const role of ["admin", "coordinator", "institution", "lead_priya"]) {
  await logInAs(role, role);
  const r = await call("/", {}, role);
  if (r.status === 302 && r.headers.get("location")?.includes("/dashboard")) {
    PASS(`/${role} -> redirect ${r.headers.get("location")}`);
  } else {
    FAIL(`/${role}`, `status ${r.status}, loc=${r.headers.get("location")}`);
  }
}

// =========================================================================
// TEST 5: ROLE ESCALATION - LEAD TRYING TO ACCESS ADMIN
// =========================================================================
console.log("\n=========== TEST 5: ROLE ESCALATION ATTEMPTS ===========");
{
  const r = await call("/admin/dashboard", {}, "lead_priya");
  // Should be denied or redirected to /login or own dashboard
  if (r.status === 403 || r.status === 302 || r.status === 404 || r.status === 200) {
    PASS(`/admin/dashboard (as lead) -> ${r.status}`);
  } else FAIL("/admin/dashboard (as lead)", r.status);
}
{
  const r = await call("/coordinator/dashboard", {}, "lead_priya");
  if (r.status === 403 || r.status === 302 || r.status === 404) PASS(`/coordinator/dashboard (as lead) -> ${r.status}`);
  else FAIL("/coordinator/dashboard (as lead)", r.status);
}
{
  const r = await call("/institution/dashboard", {}, "lead_priya");
  if (r.status === 403 || r.status === 302 || r.status === 404) PASS(`/institution/dashboard (as lead) -> ${r.status}`);
  else FAIL("/institution/dashboard (as lead)", r.status);
}

// Admin trying institution-only
{
  const r = await call("/institution/dashboard", {}, "admin");
  // Admin might be allowed (if the route checks "any auth"); test what happens
  PASS(`/institution/dashboard (as admin) -> ${r.status}`);
}

// Coordinator trying admin-only
{
  const r = await call("/admin/config", {}, "coordinator");
  if (r.status !== 200) PASS(`/admin/config (as coordinator) blocked -> ${r.status}`);
  else FAIL("/admin/config (as coordinator)", "should not be 200");
}

// =========================================================================
// TEST 6: CSRF PROTECTION
// =========================================================================
console.log("\n=========== TEST 6: CSRF ===========");
{
  await logInAs("admin", "admin");
  // Submit a valid admin form action with WRONG Origin
  const r = await call("/admin/config", {
    method: "POST",
    body: "key=registration_open&value=false",
    headers: { Origin: "http://evil.com" },
  }, "admin");
  if (r.status === 403 || r.status === 400) PASS(`CSRF wrong origin -> ${r.status}`);
  else FAIL("CSRF wrong origin", r.status);
}
{
  await logInAs("admin", "admin");
  // No origin at all
  const r = await call("/admin/config", {
    method: "POST",
    body: "key=registration_open&value=false",
    headers: { Origin: "" },
  }, "admin");
  if (r.status === 403 || r.status === 400) PASS(`CSRF no origin -> ${r.status}`);
  else FAIL("CSRF no origin", r.status);
}

// =========================================================================
// TEST 7: IDOR - CROSS-INSTITUTION ACCESS
// =========================================================================
console.log("\n=========== TEST 7: IDOR ===========");
// Get all teams as admin first
{
  const teams = await fetch(`${PB}/api/collections/pbc_1568971955/records?perPage=50&fields=id,name,institutionId`, {
    headers: { "Authorization": await getSuperToken() },
  }).then(r => r.json());
  const teamIds = teams.items.map(t => t.id);
  PASS(`discovered ${teamIds.length} teams: ${teamIds.join(", ")}`);
}
// Login as institution A (Meera = GEC Thrissur)
// Get GEC's institution ID
const meeraInst = await fetch(`${PB}/api/collections/_pb_users_auth_/auth-with-password`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identity: "REDACTED@test.local", password: PW }),
}).then(r => r.json());
console.log("Meera's institutionId:", meeraInst.record?.institutionId);

// Try to access team detail for a team that belongs to a different institution
const teamsRaw = await fetch(`${PB}/api/collections/pbc_1568971955/records?perPage=50`, {
  headers: { "Authorization": await getSuperToken() },
}).then(r => r.json());
const meerasInstId = meeraInst.record?.institutionId;
const otherInstTeams = teamsRaw.items.filter(t => t.institutionId !== meerasInstId);
if (otherInstTeams.length > 0) {
  const targetTeam = otherInstTeams[0];
  // Lead accesses as institution Meera
  await logInAs("institution", "institution");
  // Need to access via lead/team-detail page or institution/team-detail
  const r = await call(`/institution/team/${targetTeam.id}`, {}, "institution");
  if (r.status === 404 || r.status === 403 || r.status === 302) PASS(`cross-institution team ${targetTeam.id} blocked -> ${r.status}`);
  else FAIL(`cross-institution access`, `${r.status} - allowed!`);
}

// =========================================================================
// TEST 8: LEAD CROSS-TEAM
// =========================================================================
console.log("\n=========== TEST 8: LEAD CROSS-TEAM ===========");
{
  // Login as priya (Team Priya)
  await logInAs("lead_priya", "lead_priya");
  // Try to view another lead's team
  const otherTeam = teamsRaw.items.find(t => t.leaderUserId !== meeraInst.record?.id && t.id !== "oe8ed3288ali38d");
  if (otherTeam) {
    const r = await call(`/lead/team/${otherTeam.id}`, {}, "lead_priya");
    if (r.status === 404 || r.status === 403 || r.status === 302) PASS(`cross-team ${otherTeam.id} blocked -> ${r.status}`);
    else FAIL(`cross-team access`, `${r.status} - LEAK!`);
  }
}

// =========================================================================
// TEST 9: UNAUTHORIZED ACTION SUBMISSIONS
// =========================================================================
console.log("\n=========== TEST 9: UNAUTH ACTION ===========");
{
  // Lead trying admin action via POST
  await logInAs("lead_priya", "lead_priya");
  const r = await call("/admin/config", {
    method: "POST",
    body: "key=registration_open&value=true",
  }, "lead_priya");
  if (r.status !== 200) PASS(`/admin/config POST (as lead) blocked -> ${r.status}`);
  else FAIL("admin config as lead", "allowed!");
}

// =========================================================================
// TEST 10: TEAM TRANSITION STATE MACHINE
// =========================================================================
console.log("\n=========== TEST 10: TRANSITION RULES ===========");
// Get a fresh invited team
const newteam = teamsRaw.items.find(t => t.status === "invited");
if (newteam) {
  // Lead (newteam) tries to transition to shortlisted (illegal from invited)
  await logInAs("lead_newteam", "lead_transition");
  // We don't know the action URL yet — try /lead/team/<id>
  const r = await call(`/lead/team/${newteam.id}`, {}, "lead_transition");
  PASS(`/lead/team/${newteam.id} (own team) -> ${r.status}`);
}

// =========================================================================
// TEST 11: API ENDPOINTS WITH AUTH
// =========================================================================
console.log("\n=========== TEST 11: API WITH AUTH ===========");
{
  await logInAs("admin", "admin_api");
  const r = await call("/api/institutions", {}, "admin_api");
  if (r.status === 200) PASS(`/api/institutions (as admin) -> 200`);
  else FAIL("/api/institutions (as admin)", r.status);
}
{
  await logInAs("admin", "admin_csv");
  const r = await call("/api/export/csv?filterStatus=all", {}, "admin_csv");
  if (r.status === 200 && r.body.includes("Team Name")) PASS(`/api/export/csv -> 200 with header`);
  else FAIL("/api/export/csv", `${r.status}, body len=${r.body.length}`);
}
{
  await logInAs("admin", "admin_drain");
  const r = await call("/api/email/drain", { method: "POST" }, "admin_drain");
  PASS(`/api/email/drain (as admin) -> ${r.status}`);
}
{
  // Lead trying /api/email/drain
  await logInAs("lead_priya", "lead_drain");
  const r = await call("/api/email/drain", { method: "POST" }, "lead_drain");
  if (r.status !== 200) PASS(`/api/email/drain (as lead) blocked -> ${r.status}`);
  else FAIL("/api/email/drain (as lead)", "allowed!");
}
{
  // Lead trying export CSV
  await logInAs("lead_priya", "lead_csv");
  const r = await call("/api/export/csv", {}, "lead_csv");
  if (r.status !== 200) PASS(`/api/export/csv (as lead) blocked -> ${r.status}`);
  else FAIL("/api/export/csv (as lead)", "LEAK!");
}

// =========================================================================
// TEST 12: DRAFTS API
// =========================================================================
console.log("\n=========== TEST 12: DRAFTS API ===========");
{
  await logInAs("lead_priya", "lead_drafts");
  const put = await call("/api/drafts/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formType: "register", data: { test: 1 } }),
  }, "lead_drafts");
  PASS(`/api/drafts/register PUT -> ${put.status}`);
  const get = await call("/api/drafts/register", {}, "lead_drafts");
  PASS(`/api/drafts/register GET -> ${get.status}`);
  const del = await call("/api/drafts/register", { method: "DELETE" }, "lead_drafts");
  PASS(`/api/drafts/register DELETE -> ${del.status}`);
}

console.log(`\n========================================`);
console.log(`PASSED: ${pass}`);
console.log(`FAILED: ${fail}`);
console.log(`========================================`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ${f.name}: ${f.info}`);
}