import { cn } from "~/lib/utils";

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps page content with a fade-in + slide-up entrance animation.
 * Apply as the outermost wrapper in every route component's return value
 * so each page transition feels smooth.
 *
 * Uses tw-animate-css utilities (already installed).
 */
export function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <div
      className={cn(
        "animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Staggered animation wrapper for lists of cards.
 * Each child gets an increasing animation-delay so cards appear
 * sequentially instead of all at once.
 *
 * ```tsx
 * <StaggerList>
 *   {items.map((item, i) => (
 *     <StaggerItem key={i} index={i}>
 *       <Card>{item}</Card>
 *     </StaggerItem>
 *   ))}
 * </StaggerList>
 * ```
 */
export function StaggerList({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function StaggerItem({
  children,
  index,
}: {
  children: React.ReactNode;
  index: number;
}) {
  return (
    <div
      style={{ animationDelay: `${index * 60}ms` }}
      className="animate-in fade-in slide-in-from-bottom-2 duration-400 fill-mode-both"
    >
      {children}
    </div>
  );
}
