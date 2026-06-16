import { useState, useRef, useEffect } from "react";
import { cn } from "~/lib/utils";
import { AlertTriangle, Check, X } from "lucide-react";

interface ConfirmButtonProps {
  /** The text shown on the initial action button. */
  label: string;
  /** The confirmation message shown to the user. */
  confirmMessage?: string;
  /** Called when the user confirms. Return false to prevent the parent form from submitting. */
  onConfirm?: () => boolean | void;
  /** Visual variant of the button. */
  variant?: "outline" | "destructive";
  /** Additional classes for the button. */
  className?: string;
  /** When true, the button is disabled. */
  disabled?: boolean;
  /** Icon shown on the action button. */
  icon?: React.ReactNode;
}

/**
 * A button that requires inline confirmation before submitting the parent
 * form. First click reveals a Confirm + Cancel pair; Cancel uses Esc or
 * clicks elsewhere. Designed to live inside a `<Form method="post">` and
 * rely on the form's existing hidden inputs for the payload.
 */
export function ConfirmButton({
  label,
  confirmMessage = "Are you sure?",
  onConfirm,
  variant = "outline",
  className = "",
  disabled = false,
  icon,
}: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    if (!confirming) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [confirming]);

  const handleInitialClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setConfirming(true);
  };

  const handleConfirm = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Honor the documented contract: returning false from onConfirm
    // cancels the submit. The button is type="button" so it never
    // submits on its own — we submit the parent form explicitly only
    // when the callback allows it.
    if (onConfirm && onConfirm() === false) {
      setConfirming(false);
      return;
    }
    e.currentTarget.form?.requestSubmit();
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(false);
  };

  if (confirming) {
    return (
      <div
        className={cn(
          "pop-in flex items-center gap-2 rounded-md border border-danger/30 bg-danger/8 p-2",
          className,
        )}
        role="alertdialog"
        aria-label={`Confirm: ${confirmMessage}`}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
        <span className="flex-1 text-xs font-medium text-danger">
          {confirmMessage}
        </span>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md bg-danger px-2.5 text-xs font-medium text-danger-foreground hover:opacity-90"
          onClick={handleConfirm}
        >
          <Check className="h-3 w-3" />
          Confirm
        </button>
        <button
          ref={cancelRef}
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted"
          onClick={handleCancel}
        >
          <X className="h-3 w-3" />
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "vh-press inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-50",
        variant === "destructive" &&
          "border-danger/30 text-danger hover:bg-danger/8",
        className,
      )}
      disabled={disabled}
      onClick={handleInitialClick}
    >
      {icon}
      {label}
    </button>
  );
}
