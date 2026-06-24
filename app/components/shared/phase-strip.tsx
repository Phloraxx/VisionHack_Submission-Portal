import { cn } from "~/lib/utils";

export interface PhaseStripProps {
	phases: {
		label: string;
		open: boolean;
		detail?: string;
	}[];
	className?: string;
}

/**
 * Compact horizontal strip showing event phases with live/open indicators.
 * Uses CSS divide-x for borders between items — no index-based logic.
 */
export function PhaseStrip({ phases, className }: PhaseStripProps) {
	return (
		<ul
			className={cn(
				"grid grid-cols-2 sm:flex sm:items-stretch rounded-md border border-border bg-card divide-x-0 sm:divide-x divide-border overflow-hidden",
				className,
			)}
			aria-label="Event phases"
		>
			{phases.map((phase, idx) => {
				const isOpen = phase.open;
				const needsBottomBorder = phases.length > 2 && idx < 2;
				return (
					<li
						key={phase.label}
						className={cn(
							"flex-1 px-3 py-2.5 min-w-0",
							needsBottomBorder && "border-b border-border sm:border-b-0",
						)}
					>
						<div className="flex items-center gap-2">
							<span
								className={cn(
									"h-1.5 w-1.5 rounded-full shrink-0",
									isOpen ? "bg-success live-dot" : "bg-muted-foreground/40",
								)}
								aria-hidden="true"
							/>
							<span
								className={cn(
									"text-[11px] font-medium uppercase tracking-wider truncate",
									isOpen ? "text-foreground" : "text-muted-foreground",
								)}
							>
								{phase.label}
							</span>
						</div>
						{phase.detail && (
							<p className="mt-0.5 text-[10px] text-muted-foreground truncate">{phase.detail}</p>
						)}
					</li>
				);
			})}
		</ul>
	);
}
