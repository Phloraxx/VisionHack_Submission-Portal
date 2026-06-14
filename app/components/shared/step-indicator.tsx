import { Check } from "lucide-react";
import type { TeamStatus } from "~/lib/types";

// ---------------------------------------------------------------------------
// Step definition
// ---------------------------------------------------------------------------

export interface Step {
  /** URL path segment for this step, e.g. "register" */
  id: string;
  /** Short label, e.g. "Register" */
  label: string;
  /** Whether this step is completed */
  completed: boolean;
  /** Whether this step is currently active */
  active: boolean;
}

// ---------------------------------------------------------------------------
// Helpers — determine step state from team status
// ---------------------------------------------------------------------------

/**
 * Map a team status to which of the 3 lead-workflow steps are
 * completed / active / pending.
 *
 * Workflow: Register → Questionnaire → Submit Idea
 *
 * - invited:    step 1 active  (register your team)
 * - registered: step 1 done, step 2 active  (questionnaire)
 * - shortlisted: step 1 done, step 2 done, step 3 active  (submit idea)
 * - submitted/selected/rejected: all 3 done
 */
export function getLeadSteps(
  status: TeamStatus | null,
  currentPath: string,
): Step[] {
  const steps: Step[] = [
    { id: "register",      label: "Register",      completed: false, active: false },
    { id: "questionnaire", label: "Questionnaire",  completed: false, active: false },
    { id: "submit-idea",   label: "Submit Idea",    completed: false, active: false },
  ];

  if (!status) {
    // No team yet — only Register is active
    steps[0].active = true;
  } else if (status === "invited") {
    steps[0].active = true;
  } else if (status === "registered") {
    steps[0].completed = true;
    steps[1].active = true;
  } else if (status === "shortlisted") {
    steps[0].completed = true;
    steps[1].completed = true;
    steps[2].active = true;
  } else {
    // submitted, selected, rejected — all done
    steps[0].completed = true;
    steps[1].completed = true;
    steps[2].completed = true;
  }

  // Override: the route we're currently on is "active" (visual only)
  for (const step of steps) {
    if (currentPath.includes(`/lead/${step.id}`)) {
      step.active = true;
      break;
    }
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface StepIndicatorProps {
  steps: Step[];
  /** Current step number (1-based), used for the aria-label. Auto-detected. */
  currentStep?: number;
  /** Total steps (defaults to steps.length). */
  totalSteps?: number;
}

/**
 * A horizontal step indicator (stepper) following USWDS patterns with
 * full WCAG 2.1 AA accessibility.
 *
 * - Completed steps show a checkmark in a filled circle.
 * - The active step has a prominent filled circle and `aria-current="step"`.
 * - Pending steps are gray and visually subdued.
 * - Screen readers get "Step X of Y" context via aria-label.
 */
export function StepIndicator({
  steps,
  currentStep,
  totalSteps,
}: StepIndicatorProps) {
  const activeIndex = steps.findIndex((s) => s.active);
  const stepNum = currentStep ?? (activeIndex >= 0 ? activeIndex + 1 : 1);
  const total = totalSteps ?? steps.length;

  return (
    <nav aria-label={`Progress: Step ${stepNum} of ${total}`}>
      <ol className="flex items-center gap-0" role="list">
        {steps.map((step, i) => {
          const isCompleted = step.completed;
          const isActive = step.active && !isCompleted;
          const isLast = i === steps.length - 1;

          return (
            <li
              key={step.id}
              className={`flex items-center ${isLast ? "" : "flex-1"}`}
              aria-current={isActive ? "step" : undefined}
            >
              {/* Step circle + label */}
              <div className="flex flex-col items-center shrink-0">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    isCompleted
                      ? "bg-primary text-primary-foreground"
                      : isActive
                        ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                        : "bg-muted text-muted-foreground"
                  }`}
                  aria-hidden="true"
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={`mt-1.5 text-xs font-medium whitespace-nowrap ${
                    isActive
                      ? "text-foreground"
                      : isCompleted
                        ? "text-foreground/70"
                        : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                  {/* Screen-reader status */}
                  <span className="sr-only">
                    {isCompleted ? " (completed)" : isActive ? " (current step)" : " (pending)"}
                  </span>
                </span>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div className="flex-1 mx-2 mt-[-0.75rem]">
                  <div
                    className={`h-0.5 rounded-full transition-colors ${
                      isCompleted ? "bg-primary" : "bg-muted"
                    }`}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
