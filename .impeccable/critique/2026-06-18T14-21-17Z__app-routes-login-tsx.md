---
target: app/routes/login.tsx
total_score: 30
p0_count: 1
p1_count: 3
timestamp: 2026-06-18T14-21-17Z
slug: app-routes-login-tsx
---
---
target: app/routes/login.tsx
total_score: 30
p0_count: 1
p1_count: 3
date: 2026-06-18
---

# Critique: /login (app/routes/login.tsx)

## Design Health Score

| #  | Heuristic                      | Score | Key Issue |
|----|--------------------------------|-------|-----------|
| 1  | Visibility of System Status    | 4     | Loader2 spin + "Signing in" on submit; error alert with shake; live event-phase dot. Solid. |
| 2  | Match System / Real World      | 4     | "Welcome back", "Use the credentials from your invite email" — plain, jargon-free. |
| 3  | User Control & Freedom        | 3     | Forgot-password link present; no "back" affordance or escape hatch from the auth dead-end. |
| 4  | Consistency & Standards       | 4     | Reuses Button/Input/Label/EventMark from the design system; one vocabulary. |
| 5  | Error Prevention              | 3     | HTML required + type=email client validation; no capslock warning; no inline validation before submit. |
| 6  | Recognition over Recall       | 4     | Email/password labels visible, icons reinforce, credentials-from-invite hint. |
| 7  | Flexibility & Efficiency      | 3     | No SSO, no magic-link, no "remember me". Tab order is correct (email→forgot→password→submit). |
| 8  | Aesthetic & Minimalist Design | 3     | Two real slop tells (hero eyebrow chip, form-side eyebrow) + amber-on-paper contrast miss. |
| 9  | Error Recovery                | 4     | Inline danger alert, shake, "Invalid email or password. Please try again." — clear and recoverable. |
| 10 | Help & Documentation          | 3     | "Ask your campus lead to invite your team" handles the no-account case; no support contact. |
| **Total** |                          | **30/40** | **Solid with clear polish opportunities** |

## Anti-Patterns Verdict

**Start here. Does this look AI-generated?** Partially.

**LLM assessment**: Two eyebrow-chip tells land the page in AI-scaffold territory. The hero panel carries `VisionHack · Edition 06` as a tracked-caps eyebrow directly above the h1 ("Build something real. Show it here.") — the canonical AI SaaS hero shape. The form side repeats the pattern at smaller scale: a `Sign in` tracked-caps eyebrow sits above the `Welcome back` h2. DESIGN.md explicitly bans "a tiny uppercase tracked eyebrow above every section" as the 2023 AI-scaffold kicker; the login page ships two of them. Beyond that, the rest of the composition reads as a deliberate, on-brand console: hairline edges, mono numerics, warm-paper chrome, amber reserved for one primary action. The slop is concentrated in the eyebrows, not diffused.

**Deterministic scan** (CLI `detect.mjs app/routes/login.tsx`): exit 0, no findings — the CLI detector operates on raw markup and the login is a React component returning JSX, so static analysis is limited here.

**Browser detector** (injected `http://localhost:8400/detect.js`, ran `window.impeccableDetect()`):
- **`hero-eyebrow-chip`** (slop, warning) on `div.space-y-3 > p.text-[11px].font-medium` — "eyebrow chip (tracked-caps) 'VisionHack · Edition 06' above h1". Confirms the LLM read.
- **`tiny-text`** (quality, warning) on `div.hidden.border-t > span:nth-of-type(1)` — "11px body text" in the desktop footer ("Secure · Authenticated via PocketBase"). Footer chrome at 11px.
- Notably **did NOT flag** the form-side `Sign in` eyebrow (h2, not h1 — detector's hero-eyebrow rule keys on h1). That's a detector blind spot, not a pass.

**Visual overlays**: Overlays were injected successfully via `http://localhost:8400/detect.js`; the detector ran in-page. The live server has been stopped.

## Overall Impression

A competent, on-brand auth surface that inherits the console vocabulary cleanly and gets the hard parts right (error state, phase indicator, mobile collapse, keyboard order). It trips on the two spots where the design system's own anti-slop rules were not enforced: the hero eyebrow chip and the form-side eyebrow. Fix those and the amber-button-text contrast, and this is a trustworthy login.

## What's Working

1. **Error state is textbook.** `role="alert"`, danger color at 4.84:1 contrast on an 8% danger fill, `vh-shake` animation, clear copy ("Invalid email or password. Please try again."). Peak-end rule: the error moment is the peak, and it's handled with care.
2. **Live event-phase indicator on the left panel.** Pulls `registration_open` / `questionnaire_open` / `submission_open` from `app_config` at load, renders a pulsing dot (success/info/warning/muted by phase) with a label AND detail line — color-blind safe per the design system's "more than color" rule. This is the console's "show state, don't decorate it" principle executed well.
3. **Mobile layout collapse is structural, not fluid.** At 390px the left identity panel hides (`md:flex`), a mobile brand bar appears (`md:hidden`), the desktop footer hides (`lg:flex`), and the form takes full width. No broken in-between state.

## Priority Issues

- **[P1] Hero eyebrow chip — AI slop tell**
  - **Why it matters**: The tracked-caps "VisionHack · Edition 06" eyebrow above the h1 is the single most recognizable AI-generated UI shape. DESIGN.md bans it explicitly. A design-literate viewer clocks it in under a second.
  - **Fix**: Drop the eyebrow. Integrate the edition into the h1 or the IdentityLockup tagline (which already says "Submission Portal · μLearn SCET"). If the edition number must stay, put it in the footer line or the metric strip ("Edition 06" is already the third metric card — redundant).
  - **Suggested command**: `/impeccable quieter`

- **[P1] Form-side "Sign in" eyebrow — same tell at smaller scale**
  - **Why it matters**: The `Sign in` tracked-caps eyebrow above the `Welcome back` h2 repeats the hero pattern on the form panel. Two eyebrows on one screen is the reflex the skill bans.
  - **Fix**: Remove the eyebrow. The h2 "Welcome back" is sufficient hierarchy; the identity panel already established the event. If a kicker is needed, make it a sentence, not tracked-caps metadata.
  - **Suggested command**: `/impeccable quieter`

- **[P0] Amber button text fails 4.5:1 contrast**
  - **Why it matters**: The primary "Sign in" button uses `--primary-foreground` (oklch 0.99 0.005 75) on `--primary` amber (oklch 0.62 0.165 50). Measured ratio: **3.76:1** — fails WCAG AA for body text (needs 4.5:1) and barely passes large-text (3:1). Button text is 14px medium = normal text, not large. This is the primary action on the page.
  - **Fix**: Either darken the amber to push contrast (e.g. oklch 0.55 0.16 50 gives ~4.6:1), or lighten the foreground to near-white (oklch 0.995 0.003 75 is already close — the issue is the amber isn't dark enough). The cleanest fix is a slightly darker amber for light-mode primary, keeping the bright variant for dark mode.
  - **Suggested command**: `/impeccable harden`

- **[P2] Amber accent text on warm paper fails normal-text contrast**
  - **Why it matters**: `text-primary` on warm paper measures **3.70:1**. Passes for large text (≥18px or bold ≥14px) — the h1 span "Show it here." is fine. But the `Forgot?` link is 12px normal text turning amber on hover, and would fail at 3.70:1 if it used amber. Currently `Forgot?` uses `muted-foreground` (6.28:1, pass) and only goes amber on hover — the hover state is the failure. The form-side "Sign in" eyebrow at 11px amber would also fail if it were amber (it's currently amber `text-primary`).
  - **Fix**: Either reserve amber text for large/bold contexts only, or introduce a darker "amber-ink" token for small amber text on warm paper.
  - **Suggested command**: `/impeccable harden`

- **[P2] Footer tiny-text (11px) below 12px floor**
  - **Why it matters**: The desktop footer ("Secure · Authenticated via PocketBase" / "4 roles · 7 statuses") renders at 11px. Detector flagged `tiny-text`. On high-DPI screens this is hard to read, and it's chrome text a user might actually want (security confirmation).
  - **Fix**: Bump to 12px minimum. 11px tracked-caps is within the design system's label scale (0.6875rem ≈ 11px) but the footer is prose, not a metadata label — it should use body or a small-body token.
  - **Suggested command**: `/impeccable typeset`

## Persona Red Flags

**Jordan (First-Timer)**: Arrives at /login from an invite email, doesn't know if they're in the right place. The left panel answers "what is this" (VisionHack, Submission Portal, μLearn SCET) — good. But the form says "Use the credentials from your invite email" with no visible "didn't get the email?" recovery path. If the invite email is in spam, Jordan is stuck. The "Ask your campus lead to invite your team" line at the bottom is for the no-account case, not the no-credentials case. **Red flag: no recovery path for the missing-invite scenario.**

**Alex (Power User)**: Tab order is correct (email→forgot→password→submit), focus-visible ring renders on keyboard focus (2px outline, ink color), Enter submits. But there's no `autocomplete="username"` on the email field (it has `email` which is close), no `remember me`, no SSO shortcut. The 32px input height is tight for a power user typing fast — `vh-touch-row` only activates on coarse pointers, so desktop Alex gets a 32px input. **Red flag: no capslock warning on the password field; 32px desktop inputs are on the small side for fast typing.**

**Sam (Screen Reader)**: `role="alert"` on the error is correct — it will announce. Labels are associated via `htmlFor`/`id`. The phase indicator uses color + label + detail, good. But the left panel's quick-stats have no `aria-label` on the metric containers — the number "06" next to "Edition" is read as "06 Edition" without context. The `EventMark`/`IdentityLockup` SVGs need `aria-hidden` or a label. **Red flag: metric cards in the identity panel lack accessible names.**

## Minor Observations

- The "Forgot?" link target is `/forgot-password` — good that it exists, but it's a 12px link competing with the "Password" label in the same row. The label/link pairing is tight (space-y-1.5 above, justify-between on the row). Acceptable but dense.
- The identity panel's quick-stats strip uses a 3-col `gap-px` grid with `bg-sidebar-border` between cells — a 1px hairline divider built from the gap. Clever and on-brand (edge-carries-depth rule).
- `vh-pulse-dot` on the phase dot: the `bg-success/60` opacity class on the outer ring may not animate cleanly — the keyframe animates `opacity` on the whole span, not the bg color. Verified the dot is visible at rest.
- The `EventMark` and `IdentityLockup` components are imported but their internal contrast/size wasn't audited here — they're shared components, review them separately.
- The form's `max-w-sm` (24rem) keeps line length well within 65-75ch — good.

## Questions to Consider

- Is the left identity panel earning its 50% of the screen on a login page? A student under deadline wants the form. The panel is brand-building; the form is the job. What if the panel were narrower (40%) or the form were centered full-width with the identity as a slim header?
- The phase indicator is the most "console" element here — it answers "where is the event right now?" Should it be more prominent than a footer-style card on the left panel? It's the one piece of live data a returning user might check before signing in.
- "Ask your campus lead to invite your team" is the only on-ramp explanation. Is that the actual signup flow, or is there a `/register` route the link should point to? Currently it's plain text, not a link.
