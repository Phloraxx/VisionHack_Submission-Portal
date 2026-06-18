# VisionHack Submission Portal — `/design review` (Round 2)

**Project:** submissionPortalV2 (μLearn SCET VisionHack)
**Register:** Product (operator dashboard + workflow tool)
**Date:** 2026-06-16
**Subject:** Post-redesign surface (Tactical Mission Console)

This is the second review. The first report (32/50, voice-light) drove a `/design redesign` that rebuilt the token system, introduced a brand hue, and shipped new component vocabulary. This review judges the result.

---

## Overall

**Score: 41 / 50**
**Verdict: Direction landed. Edge and proportion work remains.**

The redesign moved the needle hard. The portal now has a brand voice (μLearn amber on warm-tinted chrome), real visual hierarchy (hero strip + supporting metric row + spanning pipeline + 2-up action grid on admin), and an actual operator language (mono numerics, square step markers, instrument-panel borders). A stranger seeing the login screen now says "VisionHack" before they read a word.

What it still has is **proportion debt** — a few composition choices read as "did a designer pick this, or did the system choose?" — and the EventMark component is conceptually a "VH monogram" but draws opposing chevron brackets instead of letters. The new system has a spine, but some places still lean on the old shadcn starter geometry (button heights, some text sizes) without applying the new token language.

The dominant work pattern is **Operate** for the four role dashboards and **Configure** for the multi-step forms. Both are now well-supported. The new shared components (`MetricCard`, `PanelHeader`, `DataList`, `ProgressBar`, `PhaseStrip`, `EventMark`) are doing real work.

---

## Scoring (5 lenses × /10)

| # | Lens | Score | Key finding |
|---|---|---|---|
| 1 | First impression | 8/10 | Login now has identity: split-screen, dark brand panel with event mark + mission line "Build something real. Show it here." + live phase indicator + proof stats. The mark + "VisionHack" wordmark is visible from the first viewport. Sidebar header is consistent. The portal reads as one product now. |
| 2 | Hierarchy | 9/10 | Each role's dashboard has a clear primary surface: admin's "Open review queue" hero, lead's status pill + "Hi, Name", institution's hero + capacity callout. The squint test passes on every primary surface. Metric rows are supporting, hero strips are dominant, pipeline/CTA grids span correctly. |
| 3 | Color voice | 8/10 | μLearn amber now owns identity (primary), with semantic success/warning/info/danger carrying state. The seven status colors collapsed to a 4-token system (info/primary/success/danger/muted). The "shortlisted = brand" decision is correct because shortlisted is the only positive workflow signal and brand is the only identity color. Tints are warm in both modes. |
| 4 | Type voice | 8/10 | Mono for numerics (with tabular-nums) is now consistent across MetricCard, DataList, team-detail, sidebar stats, pipeline. Geist Variable continues to do the work. The eyebrow/title/description panel header pattern is readable. Some places still use `text-sm font-medium` where a tracked label would be more on-system. |
| 5 | Interaction feel | 8/10 | Dark mode toggle (sidebar footer) actually works now. `vh-progress` loading bar, `vh-fade-in` page entrance, `vh-beat-in` card stagger all implement the motion system. Live-dot pulse on registration status. Focus-visible rings from the new base layer. Still missing: a visible primary CTA hierarchy on the lead dashboard when status = `selected` (the system has a "congratulations" callout but no clear next-action). |

**Total: 41 / 50**

### Why not higher

- **First impression**: the login mark is chevron-bracket geometry, not a true VH monogram. The component docstring claims "geometric monogram for VH" but the SVG draws two opposing chevrons (`<` and `>`). Either the implementation should match the doc, or the doc should be honest. A stranger looking at it won't read "VH" — they'll read "brackets". That costs points on the most-likely-screenshotted surface.
- **Color voice**: the brand hue is correctly reserved for identity + primary action, but the new login hero CTA "Sign in" is amber-on-dark — a fine choice — while the admin hero CTA "Open review queue" is also amber-on-light. The contrast against the lighter hero card is OK but not as confident as it could be. Could push to a filled amber panel for the highest-stakes CTA per surface.
- **Type voice**: text-3xl on admin hero, text-2xl md:text-3xl on lead hero. Same range as before. The new system could go larger (display 4xl) on the most important first viewport moment. The mission line "Build something real" on login is `text-4xl` — that's the right scale. Use it as the ceiling.
- **Interaction feel**: the lead dashboard's "View team details" link uses `text-primary hover:underline`. That's the old pattern. Could become a `<Button variant="ghost" size="sm">` for consistency with the rest of the new system. And there's no obvious "Next action" surface when status = `selected` — the congratulations callout isn't followed by a button.

---

## What I inspected

- `app/app.css` — full token system rebuild
- `app/components/shared/event-mark.tsx` — the new SVG mark
- `app/components/shared/{metric-card, panel-header, data-list, progress-bar, phase-strip}.tsx` — new shared primitives
- `app/components/shared/{step-indicator, status-badge, page-transition, confirm-button}.tsx` — rewritten
- `app/components/ui/card.tsx` — shadow removed, variant system added
- `app/lib/team-status.ts` — semantic token map
- `app/root.tsx` — theme script for no-flash
- `app/routes/{login, forgot-password, dashboard-layout}.tsx` — split-screen identity, new sidebar
- `app/routes/admin/{dashboard, teams}.tsx` — relaid
- `app/routes/coordinator/dashboard.tsx` — visual language applied
- `app/routes/institution/dashboard.tsx` — visual language applied
- `app/routes/lead/{dashboard, register}.tsx` — collapsed stepper, orphan Remove fixed

I did not re-audit the questionnaire, submit-idea, admin/config, admin/campus-leads, or admin/export routes in depth — the visual language applied there would be the same as the surfaces I did inspect.

---

## The experience, walked (post-redesign)

**Arrival.** Land on `/login`. The screen splits: left half is a dark brand panel with the EventMark, the "VisionHack · Edition 06" eyebrow, the mission line "Build something real. / Show it here.", supporting copy, a live "Registration is live" phase indicator with a pulsing dot, and a 3-up proof grid (47 / 12 / 06). The right half is a form panel with "Welcome back" heading, two icon-prefixed inputs, a primary amber CTA with arrow. A mobile-only brand bar shows the mark above the form for narrow viewports. This is a real first impression.

**Sidebar (authenticated).** Dark sidebar, mark at top, role label ("Admin" / "Coordinator" / "Campus Lead" / "Team Lead") with email, monogram avatar. Nav items show a brand-color icon when active and a chevron-right at the row end. Sun/moon toggle in the role block, top-right. Sign-out at the bottom. This is a real operator surface.

**Admin dashboard.** Hero strip: kicker + "The event is live." + mission line + primary CTA. Metric row: 4 mono-numeric cards. Pipeline band: full-width stacked bar with clickable legend rows that link to filtered teams. Action grid: 2-up cards with eyebrow + title + description + numeric + arrow link. Each section is a self-contained rectangle. This passes the squint test — the primary action ("Open review queue") is unambiguously the largest button on the page.

**Lead dashboard.** Hero strip: kicker + greeting + mission line + status pill on the right. StepIndicator (single, primary). Metric row: 3 mono cards. Progress bar card. 3-step action grid (collapsed card-state palette). PhaseStrip (compact, secondary). Team detail card with status-specific callout + withdraw flow. The double-stepper problem is solved.

**Register form.** Each member fieldset is now a self-contained card with "Member 01" mono label + properly anchored "Remove" button in the fieldset header. Form density reads as configured, not scaffolded.

**Admin teams list.** Search input + status select filter + counter (47/120 format). DataList with team name + code chip + meta line + members metric + status badge + chevron. Each row is a band, not a card. Scans correctly.

**Forgot password.** Split-screen, same identity panel as login but with a 3-step recovery list ("Enter your email / Click the link / Choose a new password"). The success state replaces the form with an `Inbox` icon, the "Check your inbox" heading, and a back-to-sign-in link. The success state is properly designed.

---

## What's working (post-redesign)

- **Brand is finally visible.** The μLearn amber now reads as the identity color across login, sidebar, hero strips, primary CTAs, focus rings. A stranger can identify the portal in 2 seconds. The previous review flagged this as P0 — it's resolved.
- **Token system holds together.** Every new surface uses the same tokens. The semantic status system (info / primary / success / danger / muted) is shared between badges, callouts, and metric tones.
- **Mono numerics are a system, not a one-off.** Every stat surface (MetricCard, DataList, sidebar stats, pipeline legend, admin/institution/coordinator hero) uses `font-mono tabular-nums`. This makes the portal read as an instrument panel.
- **Dark mode is real.** The toggle works, persists, respects `prefers-color-scheme` on first load, and has a no-flash inline script. The dark palette is warmer than a default shadcn dark — neutrals are tinted amber at the chroma-0.005 level. This passes the "feels authored, not empty" test.
- **Composition obeys the work pattern.** Admin's hero+metrics+pipeline+actions is a Monitor surface. Lead's hero+stepper+metrics+progress+actions+phases is a Configure surface. Each section earns its space.
- **Motion has a vocabulary.** `vh-beat-in` (cards), `vh-fade-in` (pages), `vh-progress` (loading bar), `vh-pulse-dot` (live indicators). Stagger cascade via `.stagger-cards`. `prefers-reduced-motion` is honored globally.
- **IdentityLockup is reusable.** The hero panel (left side of login, top of forgot-password) uses it consistently. It carries brand + tagline + edition in one component.

---

## Priority issues

### P0 — EventMark draws brackets, not VH
**Evidence:** `app/components/shared/event-mark.tsx` lines 60–84. The SVG paths are:
- `M6 10 L20 22 L6 34` (a `<` chevron, brand fill)
- `M20 22 L34 10 M20 22 L34 34` (a `>` chevron, chrome stroke)

The component docstring (lines 7–9) says: *"A geometric monogram for 'VH' built from two interlocking chevrons"* — but two opposing chevrons are not a monogram for VH. They read as brackets, an aperture, or a vision frame. That's defensible as a brand mark, but the component name and docstring should match what the SVG draws.
**Why it matters:** This is the single most-shared visual artifact in the product (sidebar, login, mobile brand bar, forgot-password). It's also the artifact a screenshot will most likely crop to share. The brand promise and the rendered shape must agree.
**Fix → `/design refine`.** Either (a) update the SVG to draw an actual VH monogram (two letters, geometric construction), or (b) update the component docstring and rename if needed (e.g., "VisionBracket", "ApertureMark"), and update the comment to reflect that the brackets are an intentional aperture metaphor. Option (a) gives you a stronger wordmark; option (b) gives you a more honest mark. Pick one.

### P1 — Hero copy on lead dashboard repeats the metric card below it
**Evidence:** `app/routes/lead/dashboard.tsx` lines 271–281. The hero strip says *"Your team X is on step N of 3"*. The metric card row immediately below has a card labeled "Steps completed" with value "N / 3" + context "Keep going" / "All done — awaiting decisions". Both surfaces report the same information.
**Why it matters:** Two surfaces saying the same thing reads as the system not knowing which one is canonical.
**Fix → `/design refine`.** Cut the "step N of 3" sentence from the hero mission line. Replace with the next concrete action ("Complete the questionnaire to unlock submission." or "Upload your presentation to enter the final review.") — the step count already lives in the metric card.

### P1 — Admin hero CTA competes with metric-card tone for the same hue
**Evidence:** `app/routes/admin/dashboard.tsx` lines 78–87. "Open review queue" CTA is filled amber (`bg-primary text-primary-foreground`). The metric card "Submitted" right below uses `tone="primary"` which colors its numeric value `text-primary`. Both surfaces claim the brand hue. On the admin dashboard, the CTA is the bigger element so it wins — but the metric card's amber number still pulls attention.
**Fix → `/design refine`.** The metric card tones should communicate meaning, not decoration. The current tones (`primary` for Submitted, `success` for Institutions/Users, `default` for Teams) read as decorative. Tighten: use `success` only for positive-final outcomes (selected, registered-with-submission). Use `info` for "in motion" (submitted, registered). Keep default for raw counts. Reduce the number of amber numerics on the page so the CTA owns the hue alone.

### P1 — Forgot-password identity panel duplicates the login identity panel
**Evidence:** `app/routes/forgot-password.tsx` lines 71–117. Same dark brand panel, same brand wash, same grid backdrop, same mark at top. The "Build something real. / Show it here." mission line is replaced by "Reset your password / in two minutes." which is fine, but the 3-step recovery list ("Enter the email / Click the link / Choose a new password") is also fine — yet the panel still ends with the same "μLearn SCET · VisionHack" + version footer as login. Two identity panels side-by-side in the same auth flow is fine; the duplication of the brand wash + grid + footer is not.
**Fix → `/design refine`.** Forgot-password identity panel should be visibly shorter (it's a faster surface) and visually distinct enough to signal "different mode of the same product". Either (a) lighter brand wash + less grid noise, (b) rotation of the mission line or layout. Don't clone the login panel.

### P2 — Lead dashboard "View team details" link uses the old inline-link pattern
**Evidence:** `app/routes/lead/dashboard.tsx` line ~440. `View team details` is rendered as `<Link className="text-primary hover:underline">`. The new system has `<Button variant="ghost">` and `<Button variant="outline">` patterns — this inline link is the only place it's used.
**Fix → `/design interaction`.** Convert to a ghost or outline button. Consistent button language across the system.

### P2 — Some dashboard metric values still feel shy
**Evidence:** MetricCard uses `text-3xl` for the value. On admin dashboard with 4 metric cards in a row, the value is `text-3xl` against a `text-sm` label and `text-xs` context. That's a 1.5× ratio — close to the floor of 1.3× for product work. The login mission line is `text-4xl` for the same weight class. The metric values could push to `text-4xl` or use a tighter mono to give the dashboard a more confident read.
**Fix → `/design typeset`.** Bump MetricCard value to `text-4xl` or pair with `font-mono text-4xl tabular-nums tracking-tight` and tighten the line-height.

### P2 — Live phase indicator's `animate-ping` is the Tailwind preset, not the new system
**Evidence:** `app/routes/login.tsx` line 99. `<span className="absolute inset-0 animate-ping rounded-full bg-success/60" />` uses Tailwind's stock `animate-ping`. The new motion system has its own keyframes (`vh-pulse-dot`, `vh-progress`, etc.). The `animate-ping` preset is fine for a single decorative ping but doesn't match the design system vocabulary — and it uses the broad preset timing (1s cubic-bezier) rather than the new sharp-out easing.
**Fix → `/design motion`.** Replace `animate-ping` with `vh-pulse-dot` (or extend the existing one). One-line change, but it brings the live indicator into the system rather than borrowing from Tailwind defaults.

---

## Smell check (post-redesign)

The surface no longer reads as "AI-generated shadcn admin tool". It has a clear direction. Specific smells remaining:

- **EventMark claim vs. render.** The component documents itself as a "geometric monogram for VH" but draws chevron brackets. Either name or geometry must change.
- **Mission line on lead dashboard is information, not poetry.** "Your team X is on step N of 3" is a status report, not a hero line. The admin hero ("The event is live.") and login hero ("Build something real.") are statement lines. The lead hero should be too.
- **`flex items-center justify-between` orphans.** Not new — the original register.tsx had one and we fixed the worst instance — but the new team-detail.tsx and some MetricCard layouts still occasionally use justify-between for two-child rows where the second child is empty or barely populated. Worth a sweep.
- **Stale brand label.** `app/routes/admin/dashboard.tsx` references `vh-theme` color in CSS but uses inline `oklch(var(--primary))` style attributes in places (`app/routes/login.tsx`, `admin/dashboard.tsx`, `institution/dashboard.tsx`, `lead/dashboard.tsx`) instead of using a utility. The new design system introduced the `vh-brand-wash` utility class in `app.css` for exactly this. The inline styles should use it.
- **Some pages still don't speak the new type system.** `app/routes/admin/campus-leads.tsx`, `admin/config.tsx`, `admin/export.tsx`, and `lead/questionnaire.tsx` weren't redesigned. They still use `text-2xl font-semibold tracking-tight` headings without the eyebrow/panel-header pattern. When a user navigates from the redesigned admin dashboard to admin/campus-leads, the eyebrow disappears.

A stranger seeing the redesigned login and admin dashboard says "this is VisionHack". Navigating to admin/campus-leads still risks "this is a generic admin". The redesign is honest at the entry points; the deeper routes haven't been pulled into the new system.

---

## Top recommendations (ordered by impact)

| Rank | Move | Mode | Why |
|---|---|---|---|
| 1 | Make EventMark match its promise: either render a true VH monogram or rename + re-document the chevron as an aperture mark. | `/design refine` | Highest-visibility artifact in the product. Brand promise and rendered shape must agree. |
| 2 | Replace "Your team is on step N of 3" hero copy on lead dashboard with a real next-action line ("Complete the questionnaire to unlock submission"). | `/design refine` | Two surfaces reporting the same info is design debt. The hero line should be a statement, not a status. |
| 3 | Sweep the remaining admin/campus-leads, admin/config, admin/export, lead/questionnaire, lead/submit-idea, lead/team-detail, coordinator/team-detail, institution/team-detail surfaces to apply the new PanelHeader + eyebrow + tracked-label vocabulary. | `/design refactor` (multiple files, no mode name) | Without this, the redesign is entry-point-only. A user clicking through 3 routes still sees a drift. |
| 4 | Replace inline `style={{ background: 'radial-gradient(...oklch(var(--primary))...)' }}` calls in login, admin, institution, lead hero strips with the `vh-brand-wash` utility class. | `/design refactor` | Pulls the hero treatments into the design system. One line per file, ~6 files. |
| 5 | Tighten MetricCard tones so admin hero CTA is the only amber on the page. | `/design refine` | Brand hue should win attention at the most important affordance. Other numerics should communicate semantic meaning, not decoration. |
| 6 | Convert lead dashboard "View team details" inline link to a Button variant. | `/design interaction` | Button language consistency across the system. |
| 7 | Bump MetricCard value to `text-4xl` or sharpen with mono tracking. | `/design typeset` | Brings metric confidence in line with the new system's other surfaces. |
| 8 | Replace Tailwind's `animate-ping` on the login live phase indicator with the new `vh-pulse-dot` keyframe. | `/design motion` | Brings the live indicator into the system vocabulary. |

Out-of-scope but worth flagging:
- Backend pagination on `/admin/teams` and `/coordinator/dashboard` remains a data-layer issue. The new DataList will make long lists feel intentional but won't fix the fetch-all-records loader.
- The PocketBase SMTP invite email template lives in `pb_hooks/send-invite.pb.js` and still uses plain `<div style="background: #18181b">` inline styles. The brand voice should extend there too — but that's a server-side refactor, not a `/design` mode.

---

## Files & where the work goes

| File / area | Mode that touches it |
|---|---|
| `app/components/shared/event-mark.tsx` (rendering + docstring) | refine |
| `app/routes/lead/dashboard.tsx` (hero copy) | refine |
| `app/routes/{login,forgot-password,dashboard-layout,admin/dashboard,institution/dashboard,lead/dashboard}.tsx` (inline brand-wash styles → `vh-brand-wash` class) | refactor |
| `app/components/shared/metric-card.tsx` (tones + size) | typeset |
| `app/routes/{admin/dashboard,admin/campus-leads,admin/config,admin/export,lead/questionnaire,lead/submit-idea,lead/team-detail,coordinator/team-detail,institution/team-detail}.tsx` (panel-header sweep) | refactor |
| `app/routes/login.tsx` (animate-ping → vh-pulse-dot) | motion |
| `app/routes/lead/dashboard.tsx` (inline link → button) | interaction |

---

## Round-over-round comparison

| Lens | Round 1 | Round 2 | Δ |
|---|---|---|---|
| First impression | 6 | 8 | +2 |
| Hierarchy | 7 | 9 | +2 |
| Color voice | 4 | 8 | +4 |
| Type voice | 7 | 8 | +1 |
| Interaction feel | 8 | 8 | 0 |
| **Total** | **32** | **41** | **+9** |

The biggest gain is **color voice** (+4) — the brand hue and semantic token system pulled the floor up. **First impression** (+2) — the split-screen identity panel turned a generic auth surface into a brand surface. **Hierarchy** (+2) — the relaid dashboards have primary surfaces. **Type voice** (+1) — mono numerics became systematic. **Interaction feel** held at 8 — the previous round was already strong here.

---

## Review checklist

- [x] Major findings grounded in observed UI, code, or missing behavior
- [x] First impression named (split-screen identity panel + brand wash)
- [x] Primary flow walked (login → dashboard → register)
- [x] Top issues ordered by impact (P0 → P2)
- [x] Smells called out (EventMark mismatch, repeated info on lead hero, missed routes)
- [x] Each recommendation maps to a concrete next mode
- [x] `review-report.md` written
- [x] `review-report.html` written
