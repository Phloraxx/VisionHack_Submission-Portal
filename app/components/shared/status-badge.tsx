import { cn } from "~/lib/utils";
import type { TeamStatus } from "~/lib/types";
import { STATUS_LABELS, STATUS_COLORS } from "~/lib/team-status";

interface StatusBadgeProps {
  /** The team status to display. */
  status: TeamStatus;
  /** Optional override for the label text. */
  label?: string;
  /** Whether to show the dot indicator. Defaults to `true`. */
  showDot?: boolean;
  /** Compact variant — smaller, single-line, for dense lists. */
  compact?: boolean;
  /** Additional CSS classes. */
  className?: string;
}

/**
 * Status badge — pill with a colored dot and uppercase tracking.
 * Uses semantic role colors (info / primary / success / danger / muted).
 */
export function StatusBadge({
  status,
  label,
  showDot = true,
  compact = false,
  className = "",
}: StatusBadgeProps) {
  const colors = STATUS_COLORS[status];
  const displayLabel = label ?? STATUS_LABELS[status] ?? status;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        compact
          ? "px-1.5 py-0.5 text-[10px] tracking-wider uppercase"
          : "px-2 py-0.5 text-xs",
        colors.pill,
        className,
      )}
    >
      {showDot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full shrink-0",
            colors.dot,
          )}
          aria-hidden="true"
        />
      )}
      {displayLabel}
    </span>
  );
}
