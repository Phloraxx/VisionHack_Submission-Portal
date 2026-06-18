// Test email send + drain
import { readFileSync } from "fs";
const env = {};
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const APP = "http://localhost:5173";
const PB = env.POCKETBASE_URL;
const SUPER = env.POCKETBASE_SUPER_TOKEN;

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
const r1 = await call("/login", { method: "POST", body: "email=REDACTED@test.local&password=REDACTED_TEST_PW" });
console.log(`login: ${r1.status}`);

// Create a direct email_outbox record (simulating what sendEmail does)
const create = await fetch(`${PB}/api/collections/pbc_1088766598/records`, {
  method: "POST",
  headers: { "Authorization": SUPER, "Content-Type": "application/json" },
  body: JSON.stringify({
    to: "test-recipient@blackbox-test.com",
    subject: "Test from drain test",
    html: "<h1>Hi</h1><p>Testing the drain.</p>",
    status: "pending",
  }),
});
console.log(`create: ${create.status}`);
const rec = await create.json();
console.log(`id: ${rec.id}`);

// Trigger drain
const drain = await call("/api/email/drain", { method: "POST" });
console.log(`drain: ${drain.status} ${drain.body.slice(0, 200)}`);

// Check outbox
const outbox = await fetch(`${PB}/api/collections/pbc_1088766598/records?perPage=5`, {
  headers: { "Authorization": SUPER },
}).then(r => r.json());
for (const m of (outbox.items ?? [])) {
  console.log(`  ${m.id} | to=${m.to} | status=${m.status} | attempts=${m.attempts} | next_attempt_at=${m.next_attempt_at || "-"}`);
}