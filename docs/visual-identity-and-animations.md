# VisionHack Portal — Visual Identity & Animation Guide

> Reference document for the UI/UX overhaul. All code snippets are copy-paste ready
> but have NOT been applied to the codebase. Apply in the priority order listed in
> **§6 Implementation Order**.

---

## 1. Current State Assessment

### What's already good

| Aspect | Status |
|---|---|
| Tailwind CSS v4 with OKLCH tokens | ✅ Full dark/light mode |
| shadcn/ui `radix-nova` style | ✅ All components styled |
| Geist font (body) | ✅ Loaded via `@fontsource-variable/geist` |
| `tw-animate-css` plugin | ✅ Already imported in `app.css` |
| Responsive layout | ✅ Mobile sidebar overlay |
| Consistent spacing (`gap-4`, `space-y-6`) | ✅ |

### What makes it look "AI-generated"

- **`baseColor: "neutral"`** in `components.json` — pure grayscale, no brand identity
- **Default shadcn sidebar** — navy-blue accent (`oklch(0.488 0.243 264.376)`), dark gray background
- **Geist everywhere** — Vercel's default, used by every Next.js project
- **Bare login page** — single card on gray background, no branding
- **No micro-interactions** — cards don't respond to hover, no page transitions
- **Bare empty states** — tiny Lucide icons, no personality

---

## 2. Brand Identity

### 2.1 Color Palette

Replace the neutral `--primary` with a VisionHack-branded electric blue → violet spectrum.

**Current** (`app/app.css`):
```css
--primary: oklch(0.205 0 0);        /* near-black */
--primary-foreground: oklch(0.985 0 0);  /* white */
```

**Target** (`app/app.css`):
```css
/* VisionHack brand — electric blue */
--primary: oklch(0.55 0.22 265);           /* #3B82F6 territory, vibrant */
--primary-foreground: oklch(0.985 0 0);     /* white */

/* Sidebar uses a darker shade of the brand blue */
--sidebar-primary: oklch(0.45 0.20 265);
--sidebar-primary-foreground: oklch(0.985 0 0);
```

**Also update the dark mode primary** (`app/app.css`, inside `.dark { }`):
```css
.dark {
  --primary: oklch(0.70 0.18 265);           /* lighter blue for dark bg */
  --primary-foreground: oklch(0.145 0 0);     /* near-black text */

  --sidebar-primary: oklch(0.45 0.20 265);
  --sidebar-primary-foreground: oklch(0.985 0 0);
}
```

**Status colors stay as-is** — they're semantic (yellow=invited, blue=registered, green=shortlisted, purple=submitted, emerald=selected, red=rejected, gray=withdrawn) and work perfectly.

### 2.2 Font Pairing

**Keep**: Geist for body text, forms, data tables.

**Add**: `@fontsource/space-grotesk` for headings — geometric, modern, hackathon vibe.

```bash
npm install @fontsource/space-grotesk
```

**`app/app.css`** — add the import and heading font-family:
```css
@import "@fontsource-variable/geist";
@import "@fontsource/space-grotesk";  /* ← ADD */

@theme inline {
  --font-sans: 'Geist Variable', 'Geist', ui-sans-serif, system-ui, sans-serif;
  --font-heading: 'Space Grotesk', 'Geist Variable', ui-sans-serif, system-ui, sans-serif;
}
```

Then in **`app/root.tsx`**, add a global heading style inline or via a `<style>` tag:
```css
h1, h2, h3, h4 {
  font-family: 'Space Grotesk', 'Geist Variable', ui-sans-serif, system-ui, sans-serif;
  letter-spacing: -0.02em;  /* tighter for geometric fonts */
}
```

**Restart Vite** after installing the font — `@fontsource` packages serve from `node_modules`.

### 2.3 Border Radius

Slightly tighter radius for a more modern feel (current is `0.625rem`):

```css
--radius: 0.5rem;  /* was 0.625rem */
```

All shadcn components derive their border-radius from this token.

---

## 3. Login Page Redesign

**Current**: Bare card on gray background. No branding, no personality.

**Target**: Split layout — left 40% branded hero panel, right 60% login form.

### `app/routes/login.tsx` — replace the component

```tsx
export default function Login() {
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const loaderData = useLoaderData() as { registrationOpen: boolean };
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="flex min-h-screen">
      {/* Left — Brand Hero */}
      <div className="hidden lg:flex lg:w-5/12 xl:w-2/5 relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-violet-700">
        {/* Animated background mesh */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-white/20 blur-3xl animate-pulse" />
          <div className="absolute bottom-1/3 right-1/4 w-72 h-72 rounded-full bg-violet-300/30 blur-2xl animate-pulse"
               style={{ animationDelay: "1s" }} />
        </div>

        {/* Content */}
        <div className="relative flex flex-col justify-between p-12 text-white">
          <div>
            {/* Logo */}
            <div className="mb-16">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 text-xl font-bold backdrop-blur-sm">
                VH
              </div>
            </div>

            {/* Tagline */}
            <h1 className="text-4xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              VisionHack
            </h1>
            <p className="mt-2 text-lg font-medium text-blue-200" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              2026
            </p>
            <p className="mt-8 text-sm leading-relaxed text-blue-100/80 max-w-sm">
              The ultimate hackathon experience. Build, innovate, and
              showcase your ideas to the world.
            </p>
          </div>

          {/* Footer */}
          <div className="text-xs text-blue-200/60">
            <p>Submission Portal v2</p>
            <p className="mt-1">© {new Date().getFullYear()} µLearn</p>
          </div>
        </div>
      </div>

      {/* Right — Login Form */}
      <div className="flex flex-1 items-center justify-center bg-muted/30 p-4">
        <Card size="sm" className="w-full max-w-sm">
          {/* (rest of the form stays exactly the same) */}
        </Card>
      </div>
    </div>
  );
}
```

### Desktop-only split layout

The left panel is `hidden lg:flex` — on mobile, only the form shows (no scrolling past a hero). This is the correct mobile UX for a login page.

---

## 4. Sidebar Personality

### `app/routes/dashboard-layout.tsx` — logo section

**Current**:
```tsx
<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-[10px] font-bold text-primary-foreground">
  VH
</div>
```

**Replace with** (gradient brand mark):
```tsx
<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-[10px] font-bold text-white shadow-sm">
  VH
</div>
```

### Role badge

After the role label (`<p>Admin</p>` / `<p>Coordinator</p>` etc.), add a colored badge:

```tsx
{/* After the role label paragraph in the sidebar nav section */}
{user.role === "admin" && (
  <span className="ml-auto rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
    Admin
  </span>
)}
{/* Repeat for coordinator, institution, lead with appropriate colors */}
```

---

## 5. Empty State Illustrations

Replace bare `<Lightbulb className="h-12 w-12 opacity-30" />` patterns with branded placeholder cards.

### Pattern — reusable empty state

```tsx
// In a shared location: app/components/shared/empty-state.tsx
import { type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-violet-50 dark:from-blue-950/30 dark:to-violet-950/30">
          <Icon className="h-8 w-8 text-blue-600 dark:text-blue-400" />
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        {action && <div className="mt-4">{action}</div>}
      </CardContent>
    </Card>
  );
}
```

**Usage** (replace patterns like `institution/dashboard.tsx:672-678`):
```tsx
<EmptyState
  icon={Lightbulb}
  title="No teams registered yet"
  description="Use the invite form above to invite team leads to the platform."
/>
```

---

## 6. Animation Framework

### Decision: No Framer Motion

`tw-animate-css` (already installed) + CSS transitions cover 100% of dashboard needs. Add Framer Motion **only** if count-up animations or layout transitions become critical. Current bundle is zero-cost.

### 6.1 Reduced Motion (Accessibility Baseline)

**Add to `app/app.css`**:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This is the industry-standard pattern (Tailwind, Bootstrap, Material Design). One CSS block disables **all** animations for users who have `prefers-reduced-motion: reduce` enabled in their OS.

### 6.2 Skeleton Loading

Create the component (`app/components/ui/skeleton.tsx`):

```tsx
import { cn } from "~/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
```

**Usage** (inside an `Await` or during `navigation.state === "loading"`):
```tsx
<div className="space-y-4">
  <Skeleton className="h-4 w-3/4" />
  <Skeleton className="h-4 w-1/2" />
  <Skeleton className="h-4 w-5/6" />
</div>
```

### 6.3 Count-Up Hook

Create `app/hooks/use-count-up.ts`:

```tsx
import { useState, useEffect, useRef } from "react";

/**
 * Animates a number from 0 to `end` over `duration` ms.
 * Only starts when the element scrolls into view.
 */
export function useCountUp(end: number, duration = 800) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || started.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          started.current = true;
          observer.disconnect();

          let start = 0;
          const increment = end / (duration / 16);
          const timer = setInterval(() => {
            start += increment;
            if (start >= end) {
              setCount(end);
              clearInterval(timer);
            } else {
              setCount(Math.floor(start));
            }
          }, 16);

          return () => clearInterval(timer);
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [end, duration]);

  return { count, ref };
}
```

**Usage** (in stat cards):
```tsx
const { count, ref } = useCountUp(totalTeams, 1000);

<Card>
  <CardContent className="pt-4 text-center">
    <p className="text-xs text-muted-foreground">Total Teams</p>
    <p className="text-2xl font-bold tabular-nums" ref={ref}>{count}</p>
  </CardContent>
</Card>
```

`tabular-nums` ensures the number width doesn't change as digits tick up (prevents layout shift).

### 6.4 Page Fade-In

Add to the `<main>` wrapper in `dashboard-layout.tsx`:

```tsx
<main className="flex-1 p-4 md:p-6 lg:p-8 animate-in fade-in duration-300">
  <Outlet />
</main>
```

### 6.5 Card Hover Lift

Standardize hover behavior on all clickable cards. Replace `transition-shadow hover:shadow-md` with:

```tsx
<Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md cursor-pointer">
```

Files to update:
- `admin/dashboard.tsx` (quick-action cards)
- `admin/teams.tsx` (team cards)
- `coordinator/dashboard.tsx` (team/institution cards)
- `admin/export.tsx` (download card)
- `lead/dashboard.tsx` (quick-action cards)

### 6.6 Error Shake

**Add to `app/app.css`**:
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
  20%, 40%, 60%, 80% { transform: translateX(4px); }
}

.animate-shake {
  animation: shake 0.3s ease-in-out;
}
```

**Usage** — on the error message div, triggered by `actionData?.error`:
```tsx
{actionData?.error && (
  <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive animate-shake" role="alert">
    {actionData.error}
  </div>
)}
```

### 6.7 Auto-Save Indicator

Add to `app/hooks/use-auto-save.ts` — show a brief "Saved" indicator after each save:

```tsx
// Inside the hook, add:
const [showSaved, setShowSaved] = useState(false);

// After a successful save:
const save = useCallback((data: T) => {
  // ... existing save logic ...
  setShowSaved(true);
  setTimeout(() => setShowSaved(false), 1500);
}, [key]);

// Return it:
return { savedData, save, clearSaved, showSaved };
```

Then render in the form:
```tsx
{showSaved && (
  <span className="animate-in fade-in slide-in-from-top-1 text-xs text-emerald-600">
    Draft saved
  </span>
)}
```

---

## 7. Animation Duration Reference

| Element | Current Duration | Recommended | Rationale |
|---|---|---|---|
| Hover/focus transitions | `duration-200` (200ms) | Same | Fast enough for instant feel |
| Sidebar open/close | `duration-200` | Same | Correct — already set |
| Select dropdown enter/exit | `duration-100` | Same | Correct — already set |
| Progress bar (lead dashboard) | `duration-500` | `duration-300` | 500ms feels sluggish |
| Stat counter animation | — | 800–1200ms | Long enough to read |
| Skeleton pulse | (animate-pulse default) | Same | 2s default is correct |
| Page fade-in | — | `duration-300` | Subtle, not distracting |
| Card hover lift | — | `duration-200` | Matches other hover states |
| Error shake | — | 300ms | One cycle only |
| Auto-save indicator | — | 300ms fade-in, 1.5s visible | Quick feedback |

---

## 8. Implementation Order (Priority)

Apply in this order — each step is independently shippable and makes the portal better:

| # | Step | Files Touched | Effort |
|---|---|---|---|
| 1 | `@media (prefers-reduced-motion)` block | `app/app.css` | 1 CSS block |
| 2 | Brand color + border-radius | `app/app.css` | 5 CSS variables |
| 3 | Heading font (Space Grotesk) | `package.json`, `app/app.css`, `app/root.tsx` | 1 `npm install` + 2 files |
| 4 | Skeleton component | `app/components/ui/skeleton.tsx` | New file |
| 5 | Count-up hook | `app/hooks/use-count-up.ts` | New file |
| 6 | Page fade-in | `app/routes/dashboard-layout.tsx` | 1 className |
| 7 | Card hover lift | 5 route files | 5 className changes |
| 8 | Login page redesign | `app/routes/login.tsx` | 1 component rewrite |
| 9 | Sidebar brand mark + role badge | `app/routes/dashboard-layout.tsx` | 2 elements |
| 10 | Empty state component | New file + 3 route files | 1 component + 3 replacements |
| 11 | Error shake keyframe + usage | `app/app.css` + all form files | 1 CSS + grep-replace |
| 12 | Auto-save indicator | `app/hooks/use-auto-save.ts` | 3 lines |

---

## 9. References

- [NNGroup — Progress Indicators](https://www.nngroup.com/articles/progress-indicators/) — animation timing research
- [W3C WAI — Multi-page Forms](https://www.w3.org/WAI/tutorials/forms/multi-page/) — step indicator patterns
- [USWDS — Step Indicator](https://designsystem.digital.gov/components/step-indicator/) — WCAG 2.1 AA stepper
- [shadcn/ui — Tailwind v4 migration](https://ui.shadcn.com/docs/tailwind-v4) — `tw-animate-css` usage
- [shadcn/ui — Skeleton component](https://ui.shadcn.com/docs/components/skeleton) — pulse animation pattern
- [MDN — prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) — accessibility media query
- [WCAG 2.2 — 2.3.3 Animation from Interactions](https://www.w3.org/TR/WCAG22/#animation-from-interactions) — accessibility requirement
