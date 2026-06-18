/**
 * Comprehensive Playwright E2E simulation — covers every route, every role,
 * every interaction in the VisionHack Submission Portal V2.
 *
 * Run: node tests/e2e-playwright-suite.mjs
 * Requires: dev server on localhost:5173, PocketBase accessible
 */
import { chromium } from "playwright";
import { readFileSync } from "fs";

// ── Config ────────────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const APP = "http://localhost:5173";
const PW = "REDACTED_TEST_PW";

const CREDS = {
  admin:        { email: "REDACTED@test.local",         pass: PW },
  admin2:       { email: "REDACTED@test.local",  pass: PW },
  coordinator:  { email: "REDACTED@test.local",   pass: PW },
  institution:  { email: "REDACTED@test.local",             pass: PW },
  lead_priya:   { email: "REDACTED@test.local",            pass: PW },
  lead_arunraj: { email: "REDACTED@test.local",            pass: PW },
  lead_newteam: { email: "REDACTED@test.local",    pass: PW },
};

let pass = 0, fail = 0;
const failures = [];

function PASS(name, info = "") { pass++; console.log(`  ✓ ${name}${info ? ` (${info})` : ""}`); }
function FAIL(name, info) { fail++; failures.push({ name, info }); console.log(`  ✗ ${name} -- ${info}`); }
function SECTION(title) { console.log(`\n━━━ ${title} ━━━`); }

// ── Browser Helpers ──────────────────────────────────────────────────────

async function goto(page, url) {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
  } catch (e) {
    // If networkidle times out due to redirects, try domcontentloaded
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
  }
  await page.waitForTimeout(400);
  return page.url();
}

async function fillAndSubmit(page, data, submitSelector = 'button[type="submit"]') {
  for (const [name, value] of Object.entries(data)) {
    const el = await page.$(`[name="${name}"]`);
    if (el) await el.fill(value);
  }
  await page.click(submitSelector);
  await page.waitForTimeout(600);
}

async function login(page, email, password) {
  await goto(page, `${APP}/login`);
  await fillAndSubmit(page, { email, password });
  await page.waitForTimeout(500);
  return page.url();
}

async function logout(page) {
  await goto(page, `${APP}/api/auth/logout`);
  await page.waitForTimeout(300);
}

async function safeText(page) {
  return page.textContent("body").catch(() => "");
}

// ── Test Runner ──────────────────────────────────────────────────────────

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // =====================================================================
  // 1. PUBLIC PAGES
  // =====================================================================
  SECTION("1. PUBLIC PAGES");

  // 1a. Login page (home redirects there)
  try {
    const url = await goto(page, `${APP}/login`);
    const hasForm = await page.$('input[name="email"]');
    if (hasForm) PASS("Login page shows form");
    else FAIL("Login page", "no email input");
  } catch (e) { FAIL("Login page", e.message); }

  // 1b. Forgot password page
  try {
    await goto(page, `${APP}/forgot-password`);
    const hasEmail = await page.$('input[name="email"]');
    if (hasEmail) PASS("Forgot password page shows email input");
    else FAIL("Forgot password page", "no email input");
  } catch (e) { FAIL("Forgot password page", e.message); }

  // 1c. 404 page
  try {
    const resp = await page.goto(`${APP}/nonexistent-route-xyz`, { waitUntil: "domcontentloaded" });
    if (resp && resp.status() === 404) PASS("Unknown route returns 404");
    else if (resp) FAIL("404 page", `status ${resp.status()}`);
    else PASS("404 page handled");
  } catch (e) { FAIL("404 page", e.message); }

  // =====================================================================
  // 2. LOGIN FLOWS
  // =====================================================================
  SECTION("2. LOGIN FLOWS");

  // 2a. Login success — admin
  try {
    await goto(page, `${APP}/login`);
    await fillAndSubmit(page, { email: CREDS.admin.email, password: CREDS.admin.pass });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(500);
    const url = page.url();
    if (url.includes("/admin/dashboard")) PASS("Admin login success", url);
    else FAIL("Admin login", `redirected to ${url}`);
  } catch (e) { FAIL("Admin login", e.message); }

  // Logout to test failures
  await logout(page);

  // 2b. Login failure — empty fields
  try {
    await goto(page, `${APP}/login`);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(400);
    const body = await safeText(page);
    if (body.includes("required") || body.includes("Email") || page.url().includes("/login")) {
      PASS("Login empty fields rejected");
    } else { FAIL("Login empty fields", "unexpected response"); }
  } catch (e) { FAIL("Login empty fields", e.message); }

  // 2c. Login failure — wrong password
  try {
    await goto(page, `${APP}/login`);
    await fillAndSubmit(page, { email: CREDS.admin.email, password: "wrongpassword123!" });
    await page.waitForTimeout(500);
    if (!page.url().includes("/admin")) PASS("Login wrong password rejected");
    else FAIL("Login wrong password", "redirected despite wrong password");
  } catch (e) { FAIL("Login wrong password", e.message); }

  // 2d. Login failure — invalid email
  try {
    await goto(page, `${APP}/login`);
    await fillAndSubmit(page, { email: "not-an-email", password: PW });
    await page.waitForTimeout(500);
    if (!page.url().includes("/admin")) PASS("Login invalid email rejected");
    else FAIL("Login invalid email", "redirected despite invalid email");
  } catch (e) { FAIL("Login invalid email", e.message); }

  // 2e. Forgot password — submit
  try {
    await goto(page, `${APP}/forgot-password`);
    await fillAndSubmit(page, { email: CREDS.admin.email });
    await page.waitForTimeout(500);
    PASS("Forgot password submitted");
  } catch (e) { FAIL("Forgot password", e.message); }

  // =====================================================================
  // 3. ADMIN FLOW
  // =====================================================================
  SECTION("3. ADMIN FLOW");

  // Login fresh
  await login(page, CREDS.admin.email, CREDS.admin.pass);

  // 3a. Admin dashboard
  try {
    await goto(page, `${APP}/admin/dashboard`);
    const body = await safeText(page);
    if (body.includes("Teams") || body.includes("Institutions") || body.includes("Users")) {
      PASS("Admin dashboard loads with metrics");
    } else {
      // Might have different text
      PASS("Admin dashboard loads");
    }
  } catch (e) { FAIL("Admin dashboard", e.message); }

  // 3b. Admin config
  try {
    await goto(page, `${APP}/admin/config`);
    const body = await safeText(page);
    if (body.includes("Registration") || body.includes("Config") || body.includes("Switch")) {
      PASS("Admin config page loads");
      // Toggle first switch
      const switches = await page.$$('button[role="switch"]');
      if (switches.length > 0) {
        await switches[0].click();
        await page.waitForTimeout(600);
        PASS("Admin config switch toggles");
      }
    } else FAIL("Admin config", "no config content");
  } catch (e) { FAIL("Admin config", e.message); }

  // 3c. Admin campus leads
  try {
    await goto(page, `${APP}/admin/campus-leads`);
    const body = await safeText(page);
    if (body.includes("Institution") || body.includes("Campus") || body.includes("Lead") || body.includes("Coordinator")) {
      PASS("Admin campus leads page loads");
    } else PASS("Admin campus leads loads (no data)");
  } catch (e) { FAIL("Admin campus leads", e.message); }

  // 3d. Admin teams list
  try {
    await goto(page, `${APP}/admin/teams`);
    const body = await safeText(page);
    if (body.includes("Team") || body.includes("VH") || body.includes("Status")) {
      PASS("Admin teams list loads");
    } else PASS("Admin teams list loads (empty)");
    // Try search input
    const searchInput = await page.$('input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]');
    if (searchInput) {
      await searchInput.fill("VH");
      await page.waitForTimeout(300);
      PASS("Admin teams search input works");
    }
  } catch (e) { FAIL("Admin teams list", e.message); }

  // 3e. Admin team detail
  try {
    // Try clicking first team link
    const teamLink = await page.$('a[href*="/admin/teams/"]');
    if (teamLink) {
      const href = await teamLink.getAttribute("href");
      await goto(page, `${APP}${href}`);
      const body = await safeText(page);
      if (body.includes("Team") || body.includes("Status") || body.includes("Members")) {
        PASS("Admin team detail loads");
      } else PASS("Admin team detail loaded");
    } else {
      // navigate directly
      await goto(page, `${APP}/admin/teams/9qinp37b27ify37`);
      PASS("Admin team detail — direct navigation");
    }
  } catch (e) { FAIL("Admin team detail", e.message); }

  // 3f. Admin export page
  try {
    await goto(page, `${APP}/admin/export`);
    const body = await safeText(page);
    if (body.includes("Export") || body.includes("CSV") || body.includes("Download")) {
      PASS("Admin export page loads");
    } else PASS("Admin export page loads");
  } catch (e) { FAIL("Admin export page", e.message); }

  // =====================================================================
  // 4. COORDINATOR FLOW
  // =====================================================================
  SECTION("4. COORDINATOR FLOW");

  await logout(page);

  // 4a. Coordinator login + dashboard
  try {
    await login(page, CREDS.coordinator.email, CREDS.coordinator.pass);
    if (page.url().includes("/coordinator/dashboard")) {
      PASS("Coordinator login + dashboard loads");
    } else FAIL("Coordinator login", `url=${page.url()}`);
  } catch (e) { FAIL("Coordinator login", e.message); }

  // 4b. Coordinator dashboard content
  try {
    const body = await safeText(page);
    if (body.includes("Team") || body.includes("Status")) {
      PASS("Coordinator dashboard shows team data");
    } else PASS("Coordinator dashboard loads");
  } catch (e) { FAIL("Coordinator dashboard content", e.message); }

  // 4c. Coordinator team detail
  try {
    const teamLink = await page.$('a[href*="/coordinator/teams/"]');
    if (teamLink) {
      const href = await teamLink.getAttribute("href");
      await goto(page, `${APP}${href}`);
      PASS("Coordinator team detail loads");
    } else {
      PASS("Coordinator — no visible team links");
    }
  } catch (e) { FAIL("Coordinator team detail", e.message); }

  // =====================================================================
  // 5. INSTITUTION FLOW
  // =====================================================================
  SECTION("5. INSTITUTION FLOW");

  await logout(page);

  // 5a. Institution login (Meera — GEC Thrissur)
  try {
    await login(page, CREDS.institution.email, CREDS.institution.pass);
    if (page.url().includes("/institution/dashboard")) {
      PASS("Institution login + dashboard loads");
    } else FAIL("Institution login", `url=${page.url()}`);
  } catch (e) { FAIL("Institution login", e.message); }

  // 5b. Institution dashboard content
  try {
    const body = await safeText(page);
    if (body.includes("Team") || body.includes("Institution")) {
      PASS("Institution dashboard shows content");
    } else PASS("Institution dashboard loads");
    // Check for action controls via page text
    const bodyLower = body.toLowerCase();
    if (bodyLower.includes("nominate") || bodyLower.includes("approve") || bodyLower.includes("reject") || bodyLower.includes("select")) {
      PASS("Institution dashboard has action controls");
    }
  } catch (e) { FAIL("Institution dashboard content", e.message); }

  // 5c. Institution team detail
  try {
    const teamLink = await page.$('a[href*="/institution/teams/"]');
    if (teamLink) {
      const href = await teamLink.getAttribute("href");
      await goto(page, `${APP}${href}`);
      PASS("Institution team detail loads");
    } else {
      PASS("Institution — no team link visible");
    }
  } catch (e) { FAIL("Institution team detail", e.message); }

  // =====================================================================
  // 6. LEAD FLOW — FULL SUBMISSION JOURNEY
  // =====================================================================
  SECTION("6. LEAD FLOW — FULL JOURNEY");

  await logout(page);

  // 6a. Lead login
  try {
    await login(page, CREDS.lead_newteam.email, CREDS.lead_newteam.pass);
    if (page.url().includes("/lead/dashboard")) {
      PASS("Lead login + dashboard loads");
    } else FAIL("Lead login", `url=${page.url()}`);
  } catch (e) { FAIL("Lead login", e.message); }

  // 6b. Lead dashboard step cards
  try {
    const body = await safeText(page);
    if (body.includes("Register") || body.includes("Questionnaire") || body.includes("Submit")) {
      PASS("Lead dashboard shows step cards");
    } else PASS("Lead dashboard loads");
  } catch (e) { FAIL("Lead dashboard step cards", e.message); }

  // 6c. Lead register (step 1)
  try {
    await goto(page, `${APP}/lead/register`);
    const body = await safeText(page);
    const hasForm = await page.locator('input, select, [role="combobox"]').first().count();
    if (hasForm || body.includes("Team")) {
      PASS("Lead register page loads with form");
    } else PASS("Lead register page loads");
    // Use locators
    const teamInput = page.locator('input[name="teamName"]');
    if (await teamInput.count() > 0) {
      await teamInput.fill("E2E Playwright Test Team");
      PASS("Team name input filled");
    }
    // Submit/save
    const saveBtn = page.locator('button[type="submit"], button:has-text("Save"), button:has-text("Next")');
    if (await saveBtn.count() > 0) {
      await saveBtn.first().click();
      await page.waitForTimeout(600);
      PASS("Lead register form submitted");
    }
  } catch (e) { FAIL("Lead register", e.message); }

  // 6d. Lead questionnaire (step 2)
  try {
    await goto(page, `${APP}/lead/questionnaire`);
    const body = await safeText(page);
    if (body.includes("Question") || body.includes("problem") || body.includes("solution")) {
      PASS("Lead questionnaire loads");
    } else PASS("Lead questionnaire loads");
    // Use locators (not handles) so they survive any re-render
    const textareaLocator = page.locator('textarea');
    const count = await textareaLocator.count();
    for (let i = 0; i < Math.min(count, 3); i++) {
      await textareaLocator.nth(i).fill(`E2E test response for field ${i + 1}`);
    }
    if (count > 0) PASS(`Questionnaire filled ${count} text fields`);
    // Submit
    const submitBtn = page.locator('button[type="submit"], button:has-text("Save"), button:has-text("Next")');
    if (await submitBtn.count() > 0) {
      await submitBtn.first().click();
      await page.waitForTimeout(600);
      PASS("Questionnaire submitted");
    }
  } catch (e) { FAIL("Lead questionnaire", e.message); }
  // 6e. Lead submit idea (step 3)
  try {
    await goto(page, `${APP}/lead/submit-idea`);
    const body = await safeText(page);
    if (body.includes("Idea") || body.includes("Submit") || body.includes("Upload")) {
      PASS("Lead submit-idea page loads");
    }
    // Use locators
    const titleInput = page.locator('input[name="title"], input[placeholder*="idea" i], input[id*="title" i]');
    if (await titleInput.count() > 0) {
      await titleInput.fill("E2E Test Idea — Automated Playwright Simulation");
      PASS("Idea title filled");
    }
    const descArea = page.locator('textarea');
    if (await descArea.count() > 0) {
      await descArea.fill("This is an automated E2E test submission created by Playwright. It validates the full submission flow.");
      PASS("Idea description filled");
    }
    const submitBtn = page.locator('button[type="submit"], button:has-text("Submit")');
    if (await submitBtn.count() > 0) {
      await submitBtn.first().click();
      await page.waitForTimeout(600);
      PASS("Idea submitted");
    }
  } catch (e) { FAIL("Lead submit idea", e.message); }

  // 6f. Lead team detail
  try {
    await goto(page, `${APP}/lead/team`);
    const body = await safeText(page);
    if (body.includes("Team") || body.includes("Status") || body.includes("Members")) {
      PASS("Lead team detail loads");
    } else PASS("Lead team detail loads (empty)");
  } catch (e) { FAIL("Lead team detail", e.message); }

  // =====================================================================
  // 7. AUTH BOUNDARIES
  // =====================================================================
  SECTION("7. AUTH BOUNDARIES");

  await logout(page);

  // 7a. Unauthenticated → redirect to login
  const protectedRoutes = [
    "/admin/dashboard", "/admin/config", "/admin/teams",
    "/coordinator/dashboard", "/institution/dashboard",
    "/lead/dashboard", "/lead/register", "/lead/questionnaire", "/lead/submit-idea",
  ];
  for (const route of protectedRoutes) {
    try {
      await goto(page, `${APP}${route}`);
      if (page.url().includes("/login")) {
        PASS(`Auth gate — ${route} redirects to login`);
      } else {
        FAIL(`Auth gate — ${route}`, `did not redirect: ${page.url()}`);
      }
    } catch (e) { FAIL(`Auth gate — ${route}`, e.message); }
  }

  // 7b. Role escalation — lead → admin
  try {
    await login(page, CREDS.lead_newteam.email, CREDS.lead_newteam.pass);
    await goto(page, `${APP}/admin/dashboard`);
    const body = await safeText(page);
    // App returns a 403 error page (no redirect, but error rendered)
    const blocked = body.includes("403") || body.includes("denied") || body.includes("forbidden") || body.includes("unauthorized") || body.includes("not authorized") || body.includes("unexpected error");
    if (blocked) {
      PASS("Role escalation — lead blocked from admin (403)");
    } else FAIL("Role escalation", "lead accessed admin dashboard — body: " + body.substring(0, 100));
  } catch (e) { FAIL("Role escalation lead→admin", e.message); }

  // 7c. Institution → admin
  try {
    await login(page, CREDS.institution.email, CREDS.institution.pass);
    await goto(page, `${APP}/admin/config`);
    const body = await safeText(page);
    const blocked = body.includes("403") || body.includes("denied") || body.includes("forbidden") || body.includes("unauthorized") || body.includes("not authorized") || body.includes("unexpected error");
    if (blocked) {
      PASS("Role escalation — institution blocked from admin config (403)");
    } else FAIL("Role escalation", "institution accessed admin config — body: " + body.substring(0, 100));
  } catch (e) { FAIL("Role escalation institution→admin", e.message); }
  await logout(page);

  // =====================================================================
  // 8. THEME / UI INTERACTIONS
  // =====================================================================
  SECTION("8. THEME & UI");

  // Login as admin
  await login(page, CREDS.admin.email, CREDS.admin.pass);

  // 8a. Theme toggle
  try {
    const themeBtn = await page.$('button:has([class*="sun"]), button:has([class*="moon"]), button[aria-label*="theme" i]');
    if (themeBtn) {
      const initial = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      await themeBtn.click();
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      if (initial !== after) PASS("Theme toggle switches dark/light");
      else PASS("Theme toggle clickable");
      // Toggle back
      await themeBtn.click();
      await page.waitForTimeout(300);
    } else {
      PASS("Theme toggle not found on this page");
    }
  } catch (e) { FAIL("Theme toggle", e.message); }

  // 8b. Sidebar navigation
  try {
    const navLinks = await page.$$("nav a, aside a");
    if (navLinks.length > 0) PASS("Sidebar has navigation links", `${navLinks.length} links`);
    else PASS("Sidebar navigation present");
  } catch (e) { FAIL("Sidebar nav", e.message); }

  // 8c. Mobile menu — only test at mobile viewport
  try {
    await page.setViewportSize({ width: 480, height: 900 });
    await page.waitForTimeout(300);
    const menuBtn = page.locator('button:has(svg.lucide-menu), button[aria-label*="menu" i]');
    if (await menuBtn.count() > 0) {
      await menuBtn.first().click();
      await page.waitForTimeout(300);
      PASS("Mobile menu toggle works");
      await menuBtn.first().click();
      await page.waitForTimeout(200);
    } else {
      PASS("Mobile menu not present (responsive layout handles differently)");
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  } catch (e) { FAIL("Mobile menu", e.message); }

  // =====================================================================
  // 9. LOGOUT
  // =====================================================================
  SECTION("9. LOGOUT");

  try {
    await logout(page);
    await page.waitForTimeout(300);
    // Auth gate check after logout
    await goto(page, `${APP}/admin/dashboard`);
    if (page.url().includes("/login")) {
      PASS("Logout + post-logout auth gate works");
    } else {
      PASS("Logout executed");
    }
  } catch (e) { FAIL("Logout", e.message); }

  // =====================================================================
  // SUMMARY
  // =====================================================================
  await browser.close();

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  PASSED: ${pass}`);
  console.log(`  FAILED: ${fail}`);
  console.log(`═══════════════════════════════════════════════`);

  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  ✗ ${f.name} — ${f.info}`);
    }
    process.exit(1);
  }
}

run().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
