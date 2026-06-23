import { Check } from "lucide-react";
import { Link } from "react-router";
import type { TeamStatus } from "~/lib/types";
import { cn } from "~/lib/utils";

export interface Step {
	id: string;
	label: string;
	completed: boolean;
	active: boolean;
	href?: string;
}

/**
 * Map a team status to which of the 3 lead-workflow steps are
 * completed / active / pending.
 *
 * Workflow: Register → Questionnaire → Submit Idea
 */
export function getLeadSteps(status: TeamStatus | null, currentPath: string): Step[] {
	const steps: Step[] = [
		{ id: "register", label: "Register", completed: false, active: false, href: "/lead/register" },
		{
			id: "questionnaire",
			label: "Questionnaire",
			completed: false,
			active: false,
			href: "/lead/questionnaire",
		},
		{
			id: "submit-idea",
			label: "Submit Idea",
			completed: false,
			active: false,
			href: "/lead/submit-idea",
		},
	];

	if (!status || status === "invited") {
		steps[0].active = true;
	} else if (status === "registered") {
		steps[0].completed = true;
		steps[1].active = true;
	} else if (status === "shortlisted") {
		steps[0].completed = true;
		steps[1].completed = true;
		steps[2].active = true;
	} else {
		steps[0].completed = true;
		steps[1].completed = true;
		steps[2].completed = true;
	}

	for (const step of steps) {
		if (currentPath.includes(`/lead/${step.id}`)) {
			step.active = true;
			break;
		}
	}

	return steps;
}

interface StepIndicatorProps {
	steps: Step[];
	currentStep?: number;
	totalSteps?: number;
	className?: string;
}

/**
 * Horizontal stepper with brand-tinted connector for completed segments.
 * Squares for active/completed (instrument panel feel), circles for pending.
 */
export function StepIndicator({ steps, currentStep, totalSteps, className }: StepIndicatorProps) {
	const activeIndex = steps.findIndex((s) => s.active);
	const stepNum = currentStep ?? (activeIndex >= 0 ? activeIndex + 1 : 1);
	const total = totalSteps ?? steps.length;

	return (
		<nav
			aria-label={`Progress: Step ${stepNum} of ${total}`}
			className={cn("rounded-md border border-border bg-card px-5 py-4", className)}
		>
			{/* Horizontal on sm+, vertical stack on mobile to avoid label overflow */}
			<ol className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-0">
				{steps.map((step, i) => {
					const isCompleted = step.completed;
					const isActive = step.active && !isCompleted;
					const isLast = i === steps.length - 1;
					const hasHref = Boolean(step.href);

					const marker = (
						<>
							<span
								className={cn(
									"flex h-7 w-7 items-center justify-center text-xs font-mono font-semibold transition-colors shrink-0",
									isCompleted
										? "bg-primary text-primary-foreground"
										: isActive
											? "border-2 border-primary text-primary"
											: "border border-border text-muted-foreground",
								)}
								aria-hidden="true"
							>
								{isCompleted ? (
									<Check className="h-3.5 w-3.5" strokeWidth={3} />
								) : (
									String(i + 1).padStart(2, "0")
								)}
							</span>
							<span
								className={cn(
									"text-sm whitespace-normal sm:whitespace-nowrap",
									isActive
										? "font-medium text-foreground"
										: isCompleted
											? "text-foreground/80"
											: "text-muted-foreground",
								)}
							>
								{step.label}
								<span className="sr-only">
									{isCompleted ? " (completed)" : isActive ? " (current step)" : " (pending)"}
								</span>
							</span>
						</>
					);

					const innerClass = cn(
						"flex items-center gap-3 shrink-0 rounded-md transition-colors",
						hasHref && "hover:bg-muted/50 focus-visible:bg-muted/50",
					);

					return (
						<li
							key={step.id}
							className={cn("flex items-center", isLast ? "" : "sm:flex-1")}
							aria-current={isActive ? "step" : undefined}
						>
							{hasHref ? (
								<Link
									to={step.href!}
									aria-label={`${step.label} — ${isCompleted ? "completed" : isActive ? "current step" : "pending"}`}
									className={innerClass}
								>
									{marker}
								</Link>
							) : (
								<span className={innerClass}>{marker}</span>
							)}

							{!isLast && (
								<div className="flex-1 mx-0 sm:mx-2 md:mx-4 hidden sm:block">
									<div
										className={cn(
											"h-px transition-colors",
											isCompleted ? "bg-primary" : "bg-border",
										)}
										aria-hidden="true"
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
