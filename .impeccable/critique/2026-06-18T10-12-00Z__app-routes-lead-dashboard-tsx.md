---
target: app/routes/lead/dashboard.tsx
total_score: 29
p0_count: 0
p1_count: 3
timestamp: 2026-06-18T10-12-00Z
slug: app-routes-lead-dashboard-tsx
---
# Critique: app/routes/lead/dashboard.tsx

**Target:** Lead dashboard (student-facing)
**Register:** product
**Date:** 2026-06-18

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Strong — but the same status is shown 4× (step indicator, metric, progress card, action cards), slightly diluting clarity |
| 2 | Match System / Real World | 3 | Plain language throughout; `nextAction` sentences read human |
| 3 | User Control and Freedom | 3 | Withdraw available with confirm; no visible undo after shortlisting |
| 4 | Consistency and Standards | 3 | Component vocabulary consistent; state palette (done/active/locked/closed) reused cleanly |
| 5 | Error Prevention | 3 | Destructive withdraw has ConfirmButton; validation lives on the form routes |
| 6 | Recognition Rather Than Recall | 4 | Everything visible — status, steps, next action spelled out as a sentence |
| 7 | Flexibility and Efficiency | 2 | One rigid path; no keyboard shortcuts or accelerators (acceptable for audience, but no power path) |
| 8 | Aesthetic and Minimalist Design | 2 | 4 redundant progress representations + decorative hero layering; not minimal |
| 9 | Error Recovery | 3 | `actionData.error` → danger callout; success → success callout; both near the source |
| 10 | Help and Documentation | 3 | `nextAction` is genuine contextual help per state; no broader help |
| **Total** | | **29/40** | **Good — solid foundation, address weak areas** |

## Anti-Patterns Verdict

**Does this look AI-generated?** No.

**LLM assessment:** The interface does not trigger the absolute bans. No side-stripe borders (state is full borders + bg tints), no gradient text, no glassmorphism, no hero-metric template (MetricCard is one number + label + context, no gradient accent), no identical card grids (action cards vary by state), no eyebrow-on-every-section, no numbered scaffolding. The `01 / 02 / 03` on action cards is legitimate — it's a real ordered 3-step workflow, not decorative scaffolding. The uppercase tracked labels are scoped to metadata (metric labels, step markers, status), not section eyebrows. The console aesthetic is committed and consistent.

The one aesthetic risk: the hero stacks `vh-grid-bg` + `vh-wash-tr` (amber radial glow) + an uppercase tracked eyebrow. This is decorative layering on a page whose ethos is instrument-precision. It's not slop, but it's the one place the console relaxes into decoration. Borderline.

**Deterministic scan:** Clean. `detect.mjs` on `app/routes/lead/dashboard.tsx` and `app/components/shared` returned `[]` (exit 0). No contrast failures, no banned patterns, no slop families detected. No false positives to flag.

**Visual overlays:** Not available — no dev server running. Browser visualization skipped. Recommend re-running `/impeccable critique` against `localhost:5173/lead/dashboard` after `npm run dev` to catch computed-style issues (actual overflow at 320px, real contrast on tinted backgrounds) that source review can't see.

## Overall Impression

The dashboard's heart is in the right place: the `nextAction` one-liner is exactly the "what's next" signal PRODUCT.md demands, and it's written as a human sentence per state, not a status code. That's genuinely good design writing. The component system is consistent and the accessibility primitives (aria-current, role=progressbar, sr-only state labels) are present and correct.

The single biggest opportunity: **the page shows the same progress signal four times.** Step indicator, "Steps completed" metric, "Where you are in the workflow" progress card, and the action-card states all encode "you are on step 2 of 3." A student under deadline pressure shouldn't have to reconcile four representations of one fact. Consolidating these would lift the page from good to excellent without touching the aesthetic system.

## What's Working

1. **The `nextAction` state machine (lines 211–225).** Each status produces a specific, human, actionable sentence ("Complete the team profile questionnaire to unlock submission," not "Next: questionnaire"). This is the product's core job — answering "what's next" — done at the writing level. Rare and valuable.
2. **StepIndicator accessibility (step-indicator.tsx:92, 124–130).** `aria-current="step"` on the active item, `sr-only` state labels ("(completed)" / "(current step)" / "(pending)"), and a nav label with step number. A screen-reader user gets the same progress info as a sighted user. This is the bar.
3. **State palette on action cards (lines 378–401).** Four states (done/active/locked/closed) each with a full-border + bg-tint treatment + a labeled icon + a tone color. No side-stripes, no color-alone signaling. The vocabulary is consistent and reusable.

## Priority Issues

### [P1] Progress shown four times — cognitive load, violates "one job per screen"
**What:** The same "you are on step 2 of 3" fact is rendered by (a) StepIndicator, (b) the "Steps completed" MetricCard, (c) the entire "Where you are in the workflow" ProgressBar Card, and (d) the action-card states.
**Why it matters:** PRODUCT.md's principle "One job per screen" and "Show state, don't decorate it" are directly violated by repetition. A deadline-pressured student must visually reconcile four encodings of one fact. The ProgressBar Card in particular adds a whole Card + 1px bar that communicates nothing the StepIndicator didn't already show — it's the "card as lazy answer" the design guidance warns against.
**Fix:** Pick one primary representation (the StepIndicator is the strongest — it's labeled, accessible, and shows sequence). Demote the others: remove the "Steps completed" MetricCard (redundant) or repurpose it for a genuinely different metric (e.g., "Days to deadline"); remove the standalone ProgressBar Card entirely, or fold its bar into the StepIndicator's container as a single secondary affordance. Keep the action cards — they encode *actionability* (which step can I click), not just progress, so they earn their place.
**Suggested command:** `/impeccable distill app/routes/lead/dashboard.tsx`

### [P1] StepIndicator labels `whitespace-nowrap` — overflow risk at 320px
**What:** `step-indicator.tsx:115` forces step labels to never wrap, while connectors use `flex-1 mx-2 sm:mx-4`. On a 320px viewport, three nowrap labels ("Register" + "Questionnaire" + "Submit Idea") plus markers plus connectors can exceed the row width.
**Why it matters:** "Text that overflows its container" is an absolute ban. The viewport is part of the design. A student on a phone is exactly the deadline-pressured user this page serves.
**Fix:** Test at 320px and 360px. Likely fix: allow labels to wrap to a second line on mobile (`whitespace-normal` at `sm:` breakpoint, or collapse labels to markers-only on `< sm` with an sr-only full label), or switch to a vertical stepper on narrow widths.
**Suggested command:** `/impeccable adapt app/components/shared/step-indicator.tsx`

### [P1] MetricCard misuse for non-numeric institution name
**What:** `dashboard.tsx:328–333` passes `institutionName` (a string, potentially "Sree Chitra Tirunal College of Engineering") as the `value` of a MetricCard. The component renders value as `font-mono text-4xl tabular-nums` (metric-card.tsx:69) — a style designed for numerics.
**Why it matters:** A long institution name in 4xl mono will overflow the card or wrap into an ugly multi-line block. The DESIGN.md "Mono-For-Numerics Rule" is explicit: mono is for numerics only. This is a component used against its own design contract.
**Fix:** Either (a) replace the Institution MetricCard with a plain Row/label-value pair (the page already has a `Row` component for exactly this), or (b) add a `format="text"` variant to MetricCard that drops the mono/4xl treatment for string values. Option (a) is simpler and more honest.
**Suggested command:** `/impeccable distill app/routes/lead/dashboard.tsx`

### [P2] Hero decorative layering vs console ethos
**What:** The hero stacks `vh-grid-bg` (grid backdrop at opacity 30) + `vh-wash-tr` (amber radial glow) + an uppercase tracked eyebrow ("VisionHack · 2026 · Team"). Combined, this is the one place the instrument-panel aesthetic relaxes into decoration.
**Why it matters:** PRODUCT.md's "Warmth through restraint, not saturation" and the DESIGN.md "Warmth-From-Surface Rule" say warmth comes from the tinted surface, not from washes. The grid-bg + amber wash is "adding personality" via decoration, which the principle explicitly forbids. It's not slop, but it's off-doctrine.
**Fix:** Keep one or the other, not both. The grid-bg reads as instrument-panel texture (on-brand); the amber wash reads as a glow (off-brand for a console). Drop the `vh-wash-tr` div. Or, if the wash stays, drop the grid-bg. The eyebrow is defensible as a single named kicker (voice, not scaffolding) — keep it.
**Suggested command:** `/impeccable quieter app/routes/lead/dashboard.tsx`

### [P2] "Closed" action-card state uses warning tint — semantic mismatch
**What:** `dashboard.tsx:382` maps `closed` → `border-warning/30 bg-warning/5`. But a phase being closed (registration window not open yet, or past) is informational, not a warning. Warning implies "something needs your attention"; closed implies "this isn't available right now."
**Why it matters:** Semantic-color misuse erodes the meaning of the semantic vocabulary. If warning means both "act now" and "not available," users stop reading it as actionable.
**Fix:** Use a neutral/muted treatment for `closed` (e.g., `border-border bg-muted/30`), reserving warning for genuinely time-pressured states. Or introduce an `info` tint for "not yet open" and reserve `closed` styling for "past."
**Suggested command:** `/impeccable clarify app/routes/lead/dashboard.tsx`

## Persona Red Flags

### Alex (Power User) — dashboard/admin persona
**Primary action:** Check status and jump straight to the next actionable step.
**Red flags:**
- No keyboard path to the action cards. A power user tabbing through hits the hero, then the step indicator (not actionable), then metrics (not actionable), then the progress card (not actionable), before reaching the "Continue" button on the active action card. That's ~15 tab stops of non-actionable chrome before the one thing they want to click. Consider a skip-link or making the active action card's button the first focusable element.
- No "jump to current step" affordance. Alex knows they're on step 2; they want one click to step 2's page. The action cards provide this, but only after scanning. The StepIndicator markers are not links — making them links would give Alex a direct path.
- Withdraw is 7 scroll-heights down. Fine for a rare destructive action, but Alex would want it in a menu, not buried.

### Sam (Accessibility-Dependent User) — dashboard/admin persona
**Primary action:** Complete the next step using keyboard + screen reader.
**Red flags:**
- StepIndicator is genuinely accessible (aria-current, sr-only labels) — this passes.
- The status pill in the hero uses a colored dot + text label, so color isn't the only signal — passes the more-than-color rule.
- The MetricCard "Steps completed" value "2 / 3" is in mono tabular-nums with no aria-label — a screen reader may read "2 slash 3" which is okay but not great. Consider `aria-label="2 of 3 steps completed"`.
- The action cards' state (Completed/Available/Locked/Closed) is conveyed by text label + icon, not color alone — passes. But the icon-only state marker (CheckCircle2, ArrowRight, Lock, Clock) has no `aria-label` on the SVG; the adjacent text label carries it, so this is okay, but the icon should be `aria-hidden` to avoid double-announcement.
- No visible focus style test at 200% zoom — can't verify without the running app. Re-run critique against localhost to confirm.

### Priya (Deadline-pressured student) — project-specific persona
**Profile:** Campus lead, 11pm the night before shortlisting closes, on a phone, on flaky campus Wi-Fi. Needs to know "am I done, and if not, what's the one thing I do next" in under 5 seconds.
**Behaviors:** Scans don't read. Thumb-scrolls. Will abandon if the next action isn't obvious instantly. Treats the page as a status check, not a browsing experience.
**Red flags:**
- The `nextAction` sentence is perfect for Priya — but it's the third element in the hero, after the eyebrow and the "Hi, {name}" greeting. Priya scanning for "what do I do" has to skip past her own name to find it. Consider promoting `nextAction` visually (it's currently `text-sm text-muted-foreground` — muted) or making it the hero's primary text, with the greeting secondary.
- Four progress representations mean Priya's 5-second scan picks up "2/3" from the metric, then "2/3" from the progress card, then has to reconcile with the step indicator. Each representation is a cognitive tax on a user who has no cognitive budget left. This is the P1 redundancy issue, seen through Priya's eyes.
- The PhaseStrip (event-level phases) competes for attention with Priya's own progress. "Is submission open globally?" matters to her, but it's a 5th time-signal on a screen where she wants one. Consider moving it below the fold or into a secondary tab.
- The hero's decorative grid + glow loads on every visit. On 3G, even small background CSS adds up. Priya's on flaky Wi-Fi. The decoration isn't worth her latency.

## Minor Observations

- `dashboard.tsx:278` — `user.name.split(" ")[0]` greeting assumes a name with a space. If `name` is empty or single-token, it still works but the greeting degrades. Low risk.
- `dashboard.tsx:319` — "Steps completed" MetricCard uses `tone="primary"` (amber value). The DESIGN.md One Signal Rule reserves amber for primary action + identity; coloring a metric value amber is decoration. Use `tone="default"` or `tone="info"`.
- `dashboard.tsx:357` — ProgressBar tone switches on `selected`/`rejected`/`primary`. Reasonable, but the progress card itself is a candidate for removal (see P1).
- `step-indicator.tsx:110` — `String(i + 1).padStart(2, "0")` produces "01", "02", "03" as step markers. Legitimate (real sequence), not the banned scaffolding. Fine.
- `dashboard.tsx:540` — "You will not be able to rejoin after withdrawing." is good clear copy under the destructive button. Keep.
- No `text-wrap: balance` on the h1 greeting or h3 card titles — DESIGN.md general rule. Minor.
- The `Callout` component (lines 578–595) is local to this file, not in the shared components. If other routes need callouts, extract it; otherwise fine.

## Questions to Consider

- What if the StepIndicator markers were links, so a power user could jump directly to step N's page from the dashboard?
- Does the "Where you are in the workflow" progress card need to exist at all once the StepIndicator is the primary representation?
- What if the hero led with the `nextAction` sentence and demoted the greeting — would Priya find her answer one second faster?
- Is the PhaseStrip (event phases) actually used by students, or is it admin information that leaked onto the student dashboard?
- Would a vertical layout on mobile (step indicator stacks, action cards stack) read faster for a thumb-scanning student than the current horizontal-then-grid layout?
