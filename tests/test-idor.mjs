// Node-based IDOR test using fetch
const PB = "http://vision-hack-pocketbase-gz1pzq-3a236c-144-24-114-90.sslip.io";

async function auth(email, password) {
  const r = await fetch(`${PB}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!r.ok) throw new Error(`auth failed: ${r.status}`);
  const data = await r.json();
  return data.token;
}

async function getCollection(token, collection, params = "") {
  const r = await fetch(`${PB}/api/collections/${collection}/records?${params}`, {
    headers: { Authorization: token },
  });
  return { status: r.status, data: r.ok ? await r.json() : null };
}

async function getOne(token, collection, id) {
  const r = await fetch(`${PB}/api/collections/${collection}/records/${id}`, {
    headers: { Authorization: token },
  });
  return r.status;
}

function pass(msg) { console.log("PASS:", msg); }
function fail(msg) { console.log("FAIL:", msg); }

const priyaToken = await auth("REDACTED@test.local", "REDACTED_TEST_PW");
const adminToken = await auth("REDACTED@test.local", "REDACTED_TEST_PW");
const meeraToken = await auth("REDACTED@test.local", "REDACTED_TEST_PW");

console.log("\n=== 1. Teams: Priya (lead) reads teams ===");
const r1 = await getCollection(priyaToken, "teams", "perPage=50");
console.log("Priya sees:", r1.data?.items?.length ?? 0, "teams");
if (r1.status === 200) {
  for (const t of r1.data.items) {
    const mine = t.leaderUserId === "4zgrmq5ggi5uppw" ? "OWN" : "OTHER";
    console.log(`  [${mine}] ${t.name} - leader: ${t.leaderUserId}`);
  }
  const others = r1.data.items.filter(t => t.leaderUserId !== "4zgrmq5ggi5uppw");
  if (others.length === 0) pass("Priya only sees her own team");
  else fail(`Priya can see ${others.length} other teams`);
}

console.log("\n=== 2. Teams: Admin reads teams ===");
const r2 = await getCollection(adminToken, "teams", "perPage=50");
console.log("Admin sees:", r2.data?.items?.length ?? 0, "teams");
if (r2.data?.items?.length > 1) pass("Admin sees all teams");

console.log("\n=== 3. Teams: Coordinator reads teams ===");
const coordToken = await auth("REDACTED@test.local", "REDACTED_TEST_PW");
const r3 = await getCollection(coordToken, "teams", "perPage=50");
console.log("Coordinator sees:", r3.data?.items?.length ?? 0, "teams");

console.log("\n=== 4. Members: Priya (lead) reads members ===");
const r4 = await getCollection(priyaToken, "members", "perPage=50");
console.log("Priya sees:", r4.data?.items?.length ?? 0, "members");
if (r4.data?.items?.length === 0) pass("Priya sees no members (her team has none)");
else {
  for (const m of r4.data.items) console.log(`  ${m.fullName} - teamId: ${m.teamId}`);
}

console.log("\n=== 5. Members: Meera (institution) reads members ===");
const r5 = await getCollection(meeraToken, "members", "perPage=50");
console.log("Meera sees:", r5.data?.items?.length ?? 0, "members");

console.log("\n=== 6. Members: Admin reads all members ===");
const r6 = await getCollection(adminToken, "members", "perPage=50");
console.log("Admin sees:", r6.data?.items?.length ?? 0, "members");

console.log("\n=== 7. Questionnaire: Priya reads own responses ===");
const r7 = await getCollection(priyaToken, "questionnaire_responses", "perPage=50");
console.log("Priya sees:", r7.data?.items?.length ?? 0, "questionnaire responses");
for (const q of r7.data?.items ?? []) {
  console.log(`  userId: ${q.userId} - teamId: ${q.teamId}`);
}

console.log("\n=== 8. File: Priya tries Anoop's file ===");
const fileUrl = `${PB}/api/files/teams/e9fjb8rr7p74y20/test.pdf`;
const r8 = await fetch(fileUrl, { headers: { Authorization: priyaToken } });
console.log("Priya → Anoop's file:", r8.status);
if (r8.status === 403 || r8.status === 404) pass("File proxy blocks");

console.log("\n=== 9. File: Admin reads any team file ===");
const r9 = await fetch(fileUrl, { headers: { Authorization: adminToken } });
console.log("Admin → Anoop's file:", r9.status);

console.log("\n=== 10. CSV export: admin ===");
const csvResp = await fetch("http://localhost:5173/api/export/csv?filterStatus=all", {
  headers: { Cookie: `pb_jwt=${adminToken}` },
});
console.log("CSV (admin):", csvResp.status, "bytes:", (await csvResp.text()).length);

console.log("\n=== 11. Update role escalation test: Priya tries to set role to admin ===");
const updateResp = await fetch(`${PB}/api/collections/users/records/4zgrmq5ggi5uppw`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Authorization: priyaToken },
  body: JSON.stringify({ role: "admin" }),
});
const updateBody = await updateResp.json();
console.log("Priya → role:admin:", updateResp.status);
if (updateResp.status === 400) pass("Role escalation blocked");

console.log("\n=== 12. Cross-team submission download via app's file proxy ===");
// Get any submission_file. First need to find a team that has one.
const allTeams = await getCollection(adminToken, "teams", "perPage=50&fields=id,submission_file");
const withFile = allTeams.data?.items?.find(t => t.submission_file && t.submission_file.length);
if (withFile) {
  console.log(`Team ${withFile.id} has file: ${withFile.submission_file}`);
  // Priya tries to download another team's file
  const f = withFile.submission_file.split(",")[0].trim();
  const crossResp = await fetch(`http://localhost:5173/api/files/teams/${withFile.id}/${f}`, {
    headers: { Cookie: `pb_jwt=${priyaToken}` },
  });
  console.log(`Priya → ${withFile.id}/${f}:`, crossResp.status);
  if (crossResp.status === 403 || crossResp.status === 404) pass("App file proxy blocks cross-team");
} else {
  console.log("No teams have submission files to test");
}
