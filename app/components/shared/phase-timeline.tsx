import { Calendar, CheckCircle2, Circle } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhaseTimelineProps {
  /** Whether each phase is currently open (active). */
  phases: {
    label: string;
    open: boolean;
  }[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * A horizontal phase timeline showing which event phases are active.
 *
 * Used on the lead dashboard to give participants visibility into the
 * hackathon schedule at a glance.
 *
 * ```tsx
 * <PhaseTimeline phases={[
 *   { label: "Registration", open: registrationOpen },
 *   { label: "Questionnaire", open: questionnaireOpen },
 *   { label: "Nomination", open: nominationOpen },
 *   { label: "Submission", open: submissionOpen },
 * ]} />
 * ```
 */
export function PhaseTimeline({ phases }: PhaseTimelineProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Event Phases</span>
      </div>
      <div className="flex items-center gap-0">
        {phases.map((phase, i) => {
          const isLast = i === phases.length - 1;
          return (
            <div
              key={phase.label}
              className={`flex items-center ${isLast ? "" : "flex-1"}`}
            >
              <div className="flex flex-col items-center shrink-0">
                {phase.open ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground/40" />
                )}
                <span
                  className={`mt-1 text-[10px] font-medium whitespace-nowrap ${
                    phase.open ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
                  }`}
                >
                  {phase.label}
                </span>
              </div>
              {!isLast && (
                <div className="flex-1 mx-1">
                  <div
                    className={`h-0.5 rounded-full ${
                      phase.open ? "bg-emerald-500" : "bg-muted"
                    }`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
