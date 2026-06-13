import { Loader2 } from "lucide-react";

interface LoadingSpinnerProps {
  /** Size of the spinner — defaults to `"md"`. */
  size?: "sm" | "md" | "lg";
  /** Optional label shown below the spinner. */
  label?: string;
  /** When `true`, renders as a full-screen centered overlay. */
  fullScreen?: boolean;
}

const sizeClasses: Record<NonNullable<LoadingSpinnerProps["size"]>, string> = {
  sm: "h-4 w-4",
  md: "h-8 w-8",
  lg: "h-12 w-12",
};

/**
 * A simple animated loading spinner built with Tailwind and Lucide's `Loader2`
 * icon.
 *
 * **Basic usage:**
 * ```tsx
 * <LoadingSpinner />
 * ```
 *
 * **With a label:**
 * ```tsx
 * <LoadingSpinner label="Loading teams…" />
 * ```
 *
 * **Full-screen overlay:**
 * ```tsx
 * <LoadingSpinner fullScreen label="Please wait…" />
 * ```
 */
export function LoadingSpinner({
  size = "md",
  label,
  fullScreen = false,
}: LoadingSpinnerProps) {
  const spinner = (
    <div className="flex flex-col items-center gap-3">
      <Loader2
        className={`animate-spin text-muted-foreground ${sizeClasses[size]}`}
      />
      {label && (
        <p className="text-sm text-muted-foreground">{label}</p>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        {spinner}
      </div>
    );
  }

  return spinner;
}
