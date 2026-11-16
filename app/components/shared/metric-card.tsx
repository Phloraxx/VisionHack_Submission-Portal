import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/utils";

interface MetricCardProps {
	label: string;
	value: string | number;
	/** Short subtitle/context line. */
	context?: string;
	/** Optional icon — small, top-right. */
	icon?: LucideIcon;
	/** Tone for the value color (used sparingly). */
	tone?: "default" | "primary" | "success" | "danger" | "warning" | "info";
	className?: string;
}

const TONE_VALUE: Record<NonNullable<MetricCardProps["tone"]>, string> = {
	default: "text-foreground",
	primary: "text-primary",
	success: "text-success",
	danger: "text-danger",
	warning: "text-warning",
	info: "text-info",
};

/**
 * A single-stat card for dashboards.
 * Designed for 4-up grids — label/value/context stacked, icon top-right.
 * Numerics use the mono family and tabular-nums.
 */
export function MetricCard({
	label,
	value,
	context,
	icon: Icon,
	tone = "default",
	className,
}: MetricCardProps) {
	return (
		<div
			className={cn(
				"group flex flex-col gap-3 rounded-lg border border-border bg-card p-5",
				"transition-colors hover:border-foreground/15",
				className,
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
					{label}
				</span>
				{Icon && (
					<Icon
						className="h-3.5 w-3.5 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground"
						strokeWidth={2}
					/>
				)}
			</div>
			<div className="flex items-baseline gap-2">
				<span
					className={cn(
						"font-mono text-4xl font-semibold tabular-nums tracking-tight leading-none",
						TONE_VALUE[tone],
					)}
				>
					{value}
				</span>
			</div>
			{context && <p className="text-xs text-muted-foreground leading-snug">{context}</p>}
		</div>
	);
}
