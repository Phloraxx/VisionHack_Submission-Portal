import { cn } from "~/lib/utils";

interface PageTransitionProps {
	children: React.ReactNode;
	className?: string;
}

/**
 * Page-level entrance wrapper. Uses the vh-fade-in keyframe from app.css.
 * The `key={location.pathname}` pattern in dashboard-layout re-mounts this
 * on each navigation, replaying the entrance.
 */
export function PageTransition({ children, className }: PageTransitionProps) {
	return <div className={cn("page-enter", className)}>{children}</div>;
}
