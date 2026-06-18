---
name: Submission Portal V2
description: μLearn SCET submission portal — an operating console for team registration and idea submission.
colors:
  console-amber: "#c2820c"
  console-amber-bright: "#d99a1f"
  warm-paper: "#fbf8f1"
  deep-chrome: "#2a2620"
  chrome-surface: "#332f27"
  chrome-surface-2: "#3b372e"
  ink: "#2e2a22"
  ink-soft: "#7a7468"
  hairline: "#e3ddd0"
  hairline-dark: "#4a4538"
  destructive: "#9e2f1e"
  success: "#2f8a5a"
  warning: "#c89a2c"
  info: "#3a6da3"
typography:
  display:
    fontFamily: "'Geist Variable', 'Geist', ui-sans-serif, system-ui, sans-serif"
    fontWeight: 600
    letterSpacing: "-0.02em"
    lineHeight: "1.1"
  headline:
    fontFamily: "'Geist Variable', 'Geist', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    letterSpacing: "-0.01em"
    lineHeight: "1.25"
  title:
    fontFamily: "'Geist Variable', 'Geist', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    letterSpacing: "-0.01em"
    lineHeight: "1.4"
  body:
    fontFamily: "'Geist Variable', 'Geist', ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.55"
  label:
    fontFamily: "'Geist Variable', 'Geist', ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "0.06em"
    textTransform: "uppercase"
  mono:
    fontFamily: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontFeature: "tabular-nums"
    letterSpacing: "-0.01em"
rounded:
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
spacing:
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "8px"
components:
  button-primary:
    backgroundColor: "{colors.console-amber}"
    textColor: "#fbf8f1"
    rounded: "{rounded.lg}"
    padding: "6px 10px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "#a06b0a"
  button-outline:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "6px 10px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  button-destructive:
    backgroundColor: "rgba(158,47,30,0.1)"
    textColor: "{colors.destructive}"
    rounded: "{rounded.lg}"
  card-default:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "20px"
  card-elevated-hover:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.ink}"
  input-default:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "6px 10px"
    height: "32px"
  status-badge:
    rounded: "9999px"
    padding: "4px 8px"
  metric-card:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "20px"
---

# Design System: Submission Portal V2

## 1. Overview

**Creative North Star: "The Operating Console"**

This is an operating console, not a marketing site. A campus lead sits down under deadline pressure to register a team and submit an idea; the interface's job is to make state unambiguous — what's submitted, what's pending, what's next — and to stay out of the way otherwise. Every surface reads like an instrument panel: warm-tinted chrome, hairline edges that carry the depth, and a single amber signal reserved for identity and primary action. Motion is sharp and deliberate, never decorative. The console earns trust by being precise about state; it does not earn attention by being loud.

The system is dual-theme by necessity — students work in varied ambient light, from bright labs to dim dorm rooms — and both light (warm paper) and dark (deep chrome) are first-class. Neither is the "real" theme; both are the console at different times of day. μLearn amber is the one constant across them: a signal lamp that means "this is the action" or "this is the brand." It appears on ≤10% of any screen. Everything else is warm-tinted neutral, because pure grey reads as cold enterprise and the portal serves students, not accountants.

What this system explicitly rejects: dense enterprise grey, all-grey cramped IBM-style tooling with no visual relief (named in PRODUCT.md as the anti-reference). Also rejected — the inverse trap — heavy glassmorphism, gradient mesh heroes, and the 2023 AI-generated aesthetic. The console is committed, not trendy. Restraint is the personality, not the absence of one.

**Key Characteristics:**
- Console amber as the single signal — reserved for primary action and identity, never decoration
- Warm-tinted neutrals over pure grey; the warmth comes from the surface, not from saturation
- 1px hairline borders carry all depth; shadows are absent at rest
- Fixed rem type scale (not fluid); Geist in one family across headings, body, labels, and mono numerics
- Sharp-out motion (ease-out-quart), 150–250ms, never choreographed page-load sequences
- State is communicated by more than color — dot, label, and position carry it too

## 2. Colors

The palette is a single saturated signal on warm-tinted chrome. Amber is the only chromatic voice; the rest of the system is the same warm hue family at near-zero chroma, so the amber reads as a lamp on a neutral panel rather than one color among many.

### Primary
- **Console Amber** (`oklch(0.62 0.165 50)` / `#c2820c`): The signal. Primary actions (submit, confirm, advance), brand identity marks, the live status dot. In dark mode it brightens to `oklch(0.74 0.175 55)` (`#d99a1f`) so the lamp stays lit against chrome. Never used for decoration, never used on inactive states, never used as a background fill on large surfaces.

### Secondary (optional)
- **Console Amber Bright** (`oklch(0.74 0.175 55)` / `#d99a1f`): Dark-mode instance of the same amber. Not a second color; the same signal tuned for chrome. Sidebar primary and dark-mode rings use this.

### Tertiary (optional)
- Omitted. The system has one accent. Semantic roles below are intensity-based, not additional hues.

### Semantic (intensity-based, not status-by-hue)
- **Destructive** (`oklch(0.55 0.21 27)` / `#9e2f1e`): Errors, destructive confirmations. Used at 10–20% fill for badges, full for critical alerts.
- **Success** (`oklch(0.55 0.14 150)` / `#2f8a5a`): Submitted / confirmed state.
- **Warning** (`oklch(0.7 0.15 75)` / `#c89a2c`): Pending / attention. Deliberately close to amber but cooler in chroma direction so it doesn't compete with the brand signal.
- **Info** (`oklch(0.55 0.13 230)` / `#3a6da3`): Neutral informational, used sparingly in data viz and chart series.

### Neutral
- **Warm Paper** (`oklch(0.985 0.005 75)` / `#fbf8f1`): Light-mode body background. Very subtle amber chroma — warm, not cream. The tint is toward the brand hue, not toward warmth-by-default.
- **Ink** (`oklch(0.18 0.012 60)` / `#2e2a22`): Body text in light mode. Hits ≥4.5:1 against Warm Paper.
- **Ink Soft** (`oklch(0.48 0.015 60)` / `#7a7468`): Muted foreground — secondary labels, descriptions, placeholders. Tuned to 4.5:1, not the lazy grey default.
- **Deep Chrome** (`oklch(0.16 0.008 60)` / `#2a2620`): Dark-mode body background. The instrument panel.
- **Chrome Surface** (`oklch(0.2 0.008 60)` / `#332f27`): Cards and popovers in dark mode.
- **Chrome Surface 2** (`oklch(0.22 0.008 60)` / `#3b372e`): Elevated/active surfaces in dark mode.
- **Hairline** (`oklch(0.9 0.008 70)` / `#e3ddd0`): Light-mode borders. The 1px that carries all depth.
- **Hairline Dark** (`oklch(0.3 0.01 60)` / `#4a4538`): Dark-mode borders.

### Named Rules
**The One Signal Rule.** Console Amber appears on ≤10% of any given screen. It is reserved for the single primary action, current selection, and live status. If two amber elements compete on one screen, one is wrong.

**The Warmth-From-Surface Rule.** Warmth comes from the tinted neutral surface, never from a saturated wash. Do not add amber gradient washes "for personality." The console's warmth is ambient, not decorative.

**The No-Pure-Grey Rule.** Pure grey (`oklch(* 0 *)`) is forbidden for surfaces and text. Every neutral carries 0.005–0.015 chroma toward hue 60–75. Pure grey reads as enterprise cold; this portal serves students, not accountants (PRODUCT.md anti-reference).

## 3. Typography

**Display Font:** Geist Variable (with `ui-sans-serif, system-ui, sans-serif` fallback)
**Body Font:** Geist Variable (same family)
**Label/Mono Font:** Geist Mono (with `ui-monospace, SFMono-Regular, Menlo` fallback)

**Character:** One family, tuned in weight and feature settings. Product UI does not need display/body pairing — Geist carries headings, buttons, labels, body, and data with weight contrast doing the hierarchy work. The mono variant is reserved for numerics in tabular contexts (metric values, IDs, counts), where `tabular-nums` keeps columns aligned. No display fonts in UI labels or buttons (product ban).

### Hierarchy
- **Display** (600, clamp max ≤ 4rem, 1.1 line-height, -0.02em tracking): Hero/landing only. Ceiling respected — the console does not shout.
- **Headline** (600, 1.5rem, 1.25, -0.01em): Page titles, section leads inside dashboards.
- **Title** (600, 1rem, 1.4, -0.01em): Card titles, dialog headings, list item primaries.
- **Body** (400, 0.875rem, 1.55): Default body text. Line length capped 65–75ch in prose areas; data UI runs denser.
- **Label** (500, 0.6875rem, 0.06em tracking, uppercase): Metric labels, status badges, field labels. The uppercase tracked label is allowed here as a deliberate system voice for *metadata only* — never as a section eyebrow above every heading (that is the AI-slop ban).
- **Mono** (Geist Mono, tabular-nums, -0.01em): Numerics in metric cards, IDs, counts, timestamps.

### Named Rules
**The One Family Rule.** Geist in weights 400/500/600 is the entire type system. Do not introduce a second sans, a serif, or a display face. Hierarchy is weight + size + tracking, never family contrast.

**The Mono-For-Numerics Rule.** Any number that sits in a column, a metric, or a data table uses Geist Mono with `tabular-nums`. Prose numbers stay in Geist Variable. This is the only place the mono variant appears.

**The No-Fluid-Headings Rule.** Product UI uses a fixed rem scale, not clamp(). A fluid h1 that shrinks in a sidebar looks worse, not better. Responsive behavior is structural (collapse sidebar, stack grids), not typographic.

## 4. Elevation

This system has no shadows at rest. Depth is carried entirely by 1px hairline borders and tonal layering (surface → chrome-surface → chrome-surface-2 in dark; warm-paper → white-card in light). The border is the structure; the background tint is the layer.

Shadows appear only as a response to state, and only on interactive surfaces: a subtle ambient lift on hover/focus for cards and elevated panels. The lift is never a drop shadow on a flat card at rest — that is the enterprise-grey reflex. State changes border color toward foreground (`hover:border-foreground/15`) and, in the elevated variant, may add a soft ambient shadow. That is the entire shadow vocabulary.

### Shadow Vocabulary
- **Ambient Lift** (`box-shadow: 0 4px 24px rgba(0,0,0,0.06)` light / `0 4px 24px rgba(0,0,0,0.3)` dark): Hover/focus only on interactive cards and popovers. Never at rest.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to state (hover, focus, elevation). A resting card with a drop shadow has failed the console.

**The Edge-Carries-Depth Rule.** Where two surfaces meet, a 1px hairline border separates them — not a shadow, not a gradient, not a blur. The border is the depth language.

## 5. Components

Component philosophy: refined and restrained. Tight defaults (h-8 buttons, 32px inputs), mono numerics, sharp-out motion. Every interactive component has the full state set: default, hover, focus-visible, active, disabled, loading, error. Inconsistent vocabulary across screens is a product ban — the save button looks the same everywhere.

### Buttons
- **Shape:** Gently rounded (8px / `rounded-lg`). Tight 32px default height (`h-8`), 24px xs, 28px sm, 36px lg.
- **Primary:** Console Amber bg, Warm Paper text. `hover:bg-primary/80` (darkens toward `#a06b0a`). `motion-safe:active:scale-[0.97]` — the press is felt, not seen.
- **Hover / Focus:** Border shifts toward foreground; `focus-visible:ring-3 focus-visible:ring-ring/50` (amber ring at 50%). Focus ring is the keyboard user's reality, never removed.
- **Outline:** Warm Paper bg, Hairline border, hover → muted bg. The default secondary action.
- **Ghost:** Transparent bg, hover → muted bg. For inline actions in dense rows.
- **Destructive:** 10% destructive fill, destructive text. Never a full red button — the console restrains even destruction.
- **Link:** Primary-colored text, underline on hover. For tertiary navigation.

### Chips / Badges
- **Style:** Pill (`rounded-full`), 20px height, 10px–12px text, uppercase tracked label variant for metadata.
- **Status Badge:** Pill + colored dot (6px) + label. The dot is the state signal; the label carries it for color-blind users (more-than-color rule). Semantic role colors only (info/primary/success/danger/muted), never raw amber for status.
- **State:** Default / hover (via `[a]:hover:bg-*`) / focus-visible. Compact variant for dense lists (10px text, tighter padding).

### Cards / Containers
- **Corner Style:** 8px (`rounded-lg`). Sharp enough to read as a panel, not a tile.
- **Background:** Warm Paper / Chrome Surface. White card on warm-paper bg in light mode for a one-step tonal lift.
- **Shadow Strategy:** None at rest. `elevated` variant adds `hover:border-foreground/15` — the border does the work.
- **Border:** 1px Hairline / Hairline Dark. This is the structure.
- **Internal Padding:** 20px default (`p-5`), 16px sm (`p-4`). Footer is full-bleed: `border-t -mx-5 px-5` so the divider spans the card.
- **Nested cards are always wrong** (absolute ban). Use `variant="flat"` (no border) inside a parent card.

### Inputs / Fields
- **Style:** 1px Hairline border, transparent bg (in dark: `bg-input/30`), 8px radius, 32px height.
- **Focus:** Border → ring color, `ring-3 ring-ring/50`. Amber ring, never a blue browser default.
- **Error / Disabled:** `aria-invalid:border-destructive aria-invalid:ring-destructive/20`. Disabled: `bg-input/50 opacity-50`.
- **Placeholder:** Muted foreground at 4.5:1, not the lazy grey default.

### Navigation
- **Sidebar:** Deep Chrome bg (`--sidebar`), Warm Paper text, Console Amber Bright for active item and primary. 1px Hairline Dark borders. Drawer slides with `--vh-ease-glide` (320ms).
- **Active state:** Amber-tinted bg or amber left-edge — never a side-stripe border >1px (absolute ban). Use a full bg tint.
- **Mobile:** Collapses to a drawer; hamburger uses the `drawer-slide` motion.

### Metric Card (signature component)
- **Shape:** 8px radius, 1px Hairline border, Warm Paper bg, 20px padding. Designed for 4-up grids (`repeat(auto-fit, minmax(280px, 1fr))`).
- **Layout:** Label (uppercase tracked, Ink Soft) top-left, icon (3.5px, muted) top-right, value (Geist Mono, 4xl, tabular-nums, tone-colored) below, context line (xs, muted) bottom.
- **Tone:** Value color is `tone`-controlled (default/primary/success/danger/warning/info), used sparingly — default is Ink, tone only when the number means something.
- **Hover:** `hover:border-foreground/15` — the border acknowledges the cursor.
- **This is not the hero-metric template** (absolute ban). No gradient accent, no supporting stat cluster. One number, one label, one context line. That is the entire metric.

## 6. Do's and Don'ts

### Do:
- **Do** reserve Console Amber for the single primary action per screen and live status. Its rarity is the point (The One Signal Rule).
- **Do** carry depth with 1px Hairline borders, never shadows at rest (The Edge-Carries-Depth Rule).
- **Do** tint every neutral 0.005–0.015 chroma toward hue 60–75. Warmth from surface, not saturation (The Warmth-From-Surface Rule).
- **Do** use Geist Mono with `tabular-nums` for every numeric in a column, metric, or data table (The Mono-For-Numerics Rule).
- **Do** communicate status with dot + label + position, not color alone — color-blind users read state correctly.
- **Do** honor `prefers-reduced-motion`: every animation degrades to instant/crossfade (already in the token layer).
- **Do** keep body text ≥4.5:1 against its background; bump Ink Soft toward Ink if contrast is even close.
- **Do** use the uppercase tracked Label style for *metadata only* (metric labels, status, field labels) — it is a deliberate system voice, not a section eyebrow.

### Don't:
- **Don't** use pure grey (`oklch(* 0 *)`) for surfaces or text. This is the "dense enterprise grey" anti-reference from PRODUCT.md — the portal serves students, not accountants.
- **Don't** add a `border-left` or `border-right` greater than 1px as a colored stripe on cards, list items, callouts, or alerts (absolute ban — side-stripe borders).
- **Don't** use `background-clip: text` with a gradient (absolute ban — gradient text). Emphasis is weight or size, single solid color.
- **Don't** use glassmorphism / decorative blur cards as a default (absolute ban). Rare and purposeful, or nothing.
- **Don't** build the hero-metric template: big number + small label + supporting stats + gradient accent (absolute ban). One number, one label, one context — that is the Metric Card.
- **Don't** repeat identical icon-heading-text cards in a grid (absolute ban). Vary the cards or use a different pattern.
- **Don't** put a tiny uppercase tracked eyebrow above every section (absolute ban — the 2023 AI-scaffold kicker). The Label style is for metadata, not section scaffolding.
- **Don't** number sections `01 / 02 / 03` as default scaffolding (absolute ban). Numbers earn their place only in a real ordered sequence.
- **Don't** let heading text overflow its container at any breakpoint. Test long words at narrow widths; reduce clamp max or rewrite copy.
- **Don't** use heavy glassmorphism, gradient mesh, or confetti — the inverse trap of the grey-enterprise anti-reference. The console is committed restraint, not either extreme.
- **Don't** invent a second font family. Geist in three weights is the entire system (The One Family Rule).
- **Don't** animate CSS layout properties. Transform and opacity only; ease-out-quart, 150–250ms, no bounce.
- **Don't** ship a component without the full state set (default/hover/focus/active/disabled/loading/error). Half a state machine is half a component.
