import { cn } from "~/lib/utils";

interface PanelHeaderProps {
  /** Section kicker — uppercase, tracked, small. */
  eyebrow?: string;
  /** Section title — large, tight. */
  title: string;
  /** Optional supporting copy below the title. */
  description?: string;
  /** Right-aligned action area (e.g., a "View all" link). */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * A section header used to introduce a major panel.
 * Renders a small brand-color kicker, a title, an optional description,
 * and a right-aligned action slot.
 */
export function PanelHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-end justify-between gap-4 mb-5",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
            {eyebrow}
          </p>
        )}
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
