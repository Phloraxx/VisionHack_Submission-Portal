import type { TeamStatus } from "~/lib/types";
import { STATUS_LABELS, STATUS_COLORS } from "~/lib/team-status";

interface StatusBadgeProps {
  /** The team status to display. */
  status: TeamStatus;
  /** Optional override for the label text. */
  label?: string;
  /** Whether to show the dot indicator. Defaults to `true`. */
  showDot?: boolean;
  /** Additional CSS classes. */
  className?: string;
}

/**
 * A reusable status badge that renders a colored pill with an optional dot
 * indicator based on the team's status.
 *
 * Uses `STATUS_LABELS` and `STATUS_COLORS` from `team-status.ts` for
 * consistent styling across the application.
 *
 * ```tsx
 * <StatusBadge status="shortlisted" />
 * <StatusBadge status="under_review" label="In Review" showDot={false} />
 * ```
 */
export function StatusBadge({
  status,
  label,
  showDot = true,
  className = "",
}: StatusBadgeProps) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.invited;
  const displayLabel = label ?? STATUS_LABELS[status] ?? status;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${colors.bg} ${colors.text} ${className}`}
    >
      {showDot && <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />}
      {displayLabel}
    </span>
  );
}
