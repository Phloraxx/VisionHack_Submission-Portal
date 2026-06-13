import { canTransition } from "./types";
import type { TeamStatus, Role } from "./types";

/**
 * Team status labels, colors, and transition helpers.
 *
 * Re-exports the state machine from types.ts and adds presentation
 * helpers (Tailwind color classes, human-readable labels) consumed
 * by UI components across all dashboards.
 */
export { canTransition as canTransitionTo } from "./types";

/**
 * Return all valid next statuses for a given current status and role.
 */
export function getValidTransitions(
  currentStatus: TeamStatus,
  role: Role,
): TeamStatus[] {
  const allStatuses: TeamStatus[] = [
    "invited",
    "registered",
    "shortlisted",
    "submitted",
    "selected",
    "rejected",
    "withdrawn",
  ];

  return allStatuses.filter((next) =>
    canTransition(currentStatus, next, role),
  );
}

/**
 * Human-readable labels for each team status.
 */
export const STATUS_LABELS: Record<TeamStatus, string> = {
  invited: "Invited",
  registered: "Registered",
  shortlisted: "Shortlisted",
  submitted: "Submitted",
  selected: "Selected",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/**
 * Tailwind color classes for status badges.
 * Note: `cssVar` removed — use Tailwind border classes instead of inline styles.
 */
export const STATUS_COLORS: Record<
  TeamStatus,
  { bg: string; text: string; dot: string }
> = {
  invited: {
    bg: "bg-yellow-100 dark:bg-yellow-900/30",
    text: "text-yellow-800 dark:text-yellow-300",
    dot: "bg-yellow-500",
  },
  registered: {
    bg: "bg-blue-100 dark:bg-blue-900/30",
    text: "text-blue-800 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  shortlisted: {
    bg: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-800 dark:text-green-300",
    dot: "bg-green-500",
  },
  submitted: {
    bg: "bg-purple-100 dark:bg-purple-900/30",
    text: "text-purple-800 dark:text-purple-300",
    dot: "bg-purple-500",
  },
  selected: {
    bg: "bg-emerald-100 dark:bg-emerald-900/30",
    text: "text-emerald-800 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  rejected: {
    bg: "bg-red-100 dark:bg-red-900/30",
    text: "text-red-800 dark:text-red-300",
    dot: "bg-red-500",
  },
  withdrawn: {
    bg: "bg-gray-100 dark:bg-gray-800/50",
    text: "text-gray-700 dark:text-gray-300",
    dot: "bg-gray-500",
  },
};
