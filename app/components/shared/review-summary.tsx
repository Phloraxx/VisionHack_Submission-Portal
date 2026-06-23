import { ChevronDown, ChevronUp, ClipboardList } from "lucide-react";
import { cn } from "~/lib/utils";

interface ReviewSummaryProps {
	open: boolean;
	onToggle: (open: boolean) => void;
	children: React.ReactNode;
	label?: string;
	className?: string;
}

/**
 * Collapsible review summary card — used before form submission to let
 * users preview their entries. Shared between register and submit-idea forms.
 */
export function ReviewSummary({
	open,
	onToggle,
	children,
	label = "Review your details before submitting",
	className,
}: ReviewSummaryProps) {
	return (
		<div
			className={cn(
				"border-dashed transition-colors rounded-lg border bg-card",
				open ? "border-primary/40" : "border-border",
				className,
			)}
		>
			<button
				type="button"
				className="flex w-full items-center justify-between p-4 text-left"
				onClick={() => onToggle(!open)}
			>
				<div className="flex items-center gap-2">
					<ClipboardList className="h-4 w-4 text-muted-foreground" />
					<span className="text-sm font-medium">{label}</span>
				</div>
				{open ? (
					<ChevronUp className="h-4 w-4 text-muted-foreground" />
				) : (
					<ChevronDown className="h-4 w-4 text-muted-foreground" />
				)}
			</button>
			{open && (
				<div className="border-t px-4 pb-4">
					<div className="mt-3 space-y-3 text-sm">{children}</div>
				</div>
			)}
		</div>
	);
}
