import { cn } from "~/lib/utils";

interface ProgressBarProps {
	value: number;
	max?: number;
	/** Display label shown above the bar. */
	label?: string;
	/** Display context — shown next to the label (e.g., "2 / 3 steps"). */
	context?: string;
	/** Color tone for the fill. */
	tone?: "primary" | "success" | "info" | "danger";
	className?: string;
}

const TONE_FILL: Record<NonNullable<ProgressBarProps["tone"]>, string> = {
	primary: "bg-primary",
	success: "bg-success",
	info: "bg-info",
	danger: "bg-danger",
};

/**
 * Linear progress bar with optional label and context.
 * Used for "X / Y steps" indicators on the team dashboard.
 */
export function ProgressBar({
	value,
	max = 100,
	label,
	context,
	tone = "primary",
	className,
}: ProgressBarProps) {
	const pct = Math.min(100, Math.max(0, (value / max) * 100));

	return (
		<div className={cn("space-y-1.5", className)}>
			{(label || context) && (
				<div className="flex items-baseline justify-between text-xs">
					{label && <span className="text-muted-foreground">{label}</span>}
					{context && (
						<span className="font-mono font-medium tabular-nums text-foreground">{context}</span>
					)}
				</div>
			)}
			<div
				className="relative h-1 w-full overflow-hidden rounded-full bg-muted"
				role="progressbar"
				aria-valuenow={value}
				aria-valuemin={0}
				aria-valuemax={max}
			>
				<div
					className={cn(
						"h-full rounded-full transition-[width] duration-700 ease-out",
						TONE_FILL[tone],
					)}
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}
