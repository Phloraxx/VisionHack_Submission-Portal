# Product

## Register

product

## Users

Primary: campus leads (students) registering a team and submitting an idea through the μLearn SCET program. They arrive motivated, often on a deadline, on a mix of laptops and phones, sometimes on flaky campus Wi-Fi. The portal is the official submission channel — they need to move from "I have an idea" to "submitted and confirmed" with zero ambiguity about where they are in the flow.

Secondary: coordinators, institutions, and admins reviewing submissions, tracking progress across teams, and exporting data. Their oversight is light — they need legibility at a glance, not a heavy operations console.

The core job: a student goes from registration → team formation → idea submission → status tracking, and trusts the system enough to stop refreshing.

## Product Purpose

A submission portal for the μLearn SCET program that is the single source of truth for team registrations and idea submissions. Success looks like: a student completes the full submission flow without needing help, and an admin can see program-wide status and export clean data in under a minute. The interface earns trust by being precise about state — what's submitted, what's pending, what's next — rather than by being flashy.

## Brand Personality

Clinical · precise · trustworthy

The interface reads like an instrument panel, not a marketing site. Expert confidence: every screen answers "where am I, what's done, what's next" without decoration getting in the way. Calm under deadline pressure. μLearn amber is reserved for identity and primary action; the rest is warm-tinted chrome that gets out of the way. Motion is deliberate and sharp, never playful.

## Anti-references

- **Dense enterprise grey.** All-grey, cramped, IBM-style enterprise tooling with no visual relief. The portal is used by students under deadline, not by accountants all day — it needs warmth and air even at its most precise. Tinted neutrals over pure grey; breathing room over density.
- Avoid the inverse trap too: not heavy glassmorphism, gradient mesh, or confetti. The clinical direction is already committed in the tokens; the anti-reference is the grey enterprise reflex specifically.

## Design Principles

- **Show state, don't decorate it.** The whole product is about submission status. Every screen foregrounds what's submitted / pending / next. Status is the hero, not a footer badge.
- **Expert confidence under deadline.** Students hit this flow under time pressure. Pages must answer "am I done?" in the first second. No ambiguity, no buried confirmations, no decorative loading that hides progress.
- **Inherit the console, don't reinvent it.** The existing tokens (amber brand, warm-tinted chrome, 1px edge language, 3-beat motion) are committed. New work extends this vocabulary; it does not introduce a competing aesthetic.
- **One job per screen.** The submission flow is multi-step; each step owns one decision. Don't surface coordinator/admin concerns on the student path, or vice versa. Register-aware, not feature-dump.
- **Warmth through restraint, not saturation.** Clinical does not mean cold. Warm-tinted neutrals and reserved amber carry the warmth; the interface stays precise. No gradient washes to "add personality."

## Accessibility & Inclusion

WCAG 2.1 AA. Body text ≥4.5:1 contrast, large text ≥3:1, focus-visible rings on every interactive control (already in the token layer), full keyboard navigation through forms and the submission flow, and `prefers-reduced-motion` honored (the existing motion system already degrades to instant transitions). Status is communicated by more than color — icons, labels, and position carry it too, so color-blind users read state correctly.
