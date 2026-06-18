// Setup: enable registration, create test data
import { readFileSync } from "fs";
const env = {};
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const APP = "http://localhost:5173";
const PB = env.POCKETBASE_URL;
const SUPER = env.POCKETBASE_SUPER_TOKEN;
const PW = "REDACTED_TEST_PW";

let cookies = "";
async function call(path, opts = {}) {
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: APP,
    ...(cookies ? { Cookie: cookies } : {}),
    ...(opts.headers || {}),
  };
  const r = await fetch(`${APP}${path}`, { ...opts, headers, redirect: "manual" });
  const sc = r.headers.getSetCookie?.() ?? [];
  for (const c of sc) {
    const m = c.match(/^([^=]+)=([^;]+)/);
    if (m) cookies += `${m[1]}=${m[2]}; `;
  }
  return { status: r.status, body: r.status < 400 ? await r.text().catch(() => "") : "", headers: r.headers };
}

// Login as admin
const r1 = await call("/login", { method: "POST", body: "email=REDACTED@test.local&password=" + PW });
console.log(`admin login: ${r1.status}, loc=${r1.headers.get("location")}`);

// Enable registration
const r2 = await call("/admin/config", { method: "POST", body: "key=registration_open&value=true" });
console.log(`enable registration: ${r2.status}, body: ${r2.body.slice(0, 200)}`);

const r3 = await call("/admin/config", { method: "POST", body: "key=questionnaire_open&value=true" });
console.log(`enable questionnaire: ${r3.status}`);

const r4 = await call("/admin/config", { method: "POST", body: "key=submission_open&value=true" });
console.log(`enable submission: ${r4.status}`);

// Verify
const cfg = await fetch(`${PB}/api/collections/pbc_3818476082/records?perPage=10`, { headers: { "Authorization": SUPER } }).then(r => r.json());
console.log("\nCurrent config:");
for (const c of cfg.items) {
  console.log(`  ${c.key} = ${c.value}`);
}