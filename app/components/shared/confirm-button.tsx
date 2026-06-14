import { useState, useRef, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { AlertTriangle, Check, X } from "lucide-react";

interface ConfirmButtonProps {
  /** The text shown on the initial action button. */
  label: string;
  /** The confirmation message shown to the user. */
  confirmMessage?: string;
  /** Called when the user confirms the action. Return false to prevent submission. */
  onConfirm?: () => boolean | void;
  /** Visual variant of the button. */
  variant?: "default" | "outline" | "destructive" | "ghost";
  /** Additional classes for the button. */
  className?: string;
  /** When true, the button is disabled. */
  disabled?: boolean;
  /** The button type attribute. */
  type?: "submit" | "button";
  /** The form method attribute for the hidden form. */
  formMethod?: "post";
  /** Icon shown on the action button. */
  icon?: React.ReactNode;
  /** Hidden input name/value pairs for the form. */
  hiddenInputs?: Record<string, string>;
}

/**
 * A button that requires confirmation before performing a destructive action.
 *
 * First click shows a confirmation prompt inline. The user must click again
 * (or press Enter) to confirm, or click Cancel / press Escape to abort.
 *
 * When `type="submit"` and `hiddenInputs` are provided, a hidden form is
 * rendered inside the component for the final submission.
 */
export function ConfirmButton({
  label,
  confirmMessage = "Are you sure?",
  onConfirm,
  variant = "outline",
  className = "",
  disabled = false,
  type = "submit",
  formMethod = "post",
  icon,
  hiddenInputs,
}: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the Cancel button when entering confirmation mode
  useEffect(() => {
    if (confirming) {
      cancelRef.current?.focus();
    }
  }, [confirming]);

  // Reset on Escape
  useEffect(() => {
    if (!confirming) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConfirming(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [confirming]);

  const handleInitialClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setConfirming(true);
  };

  const handleConfirm = () => {
    if (onConfirm) {
      const result = onConfirm();
      if (result === false) {
        setConfirming(false);
        return;
      }
    }
    // If type=submit, the form will handle submission.
    // The parent should listen for the submit event.
    setConfirming(false);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(false);
  };

  if (confirming) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 ${className}`}
        role="alertdialog"
        aria-label={`Confirm: ${confirmMessage}`}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
        <span className="flex-1 text-xs font-medium text-destructive">
          {confirmMessage}
        </span>
        <button
          type={type}
          formMethod={formMethod}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-destructive px-2.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
          onClick={handleConfirm}
        >
          <Check className="h-3 w-3" />
          Yes
        </button>
        <button
          ref={cancelRef}
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted"
          onClick={handleCancel}
        >
          <X className="h-3 w-3" />
          No
        </button>
        {/* Hidden inputs for form submission */}
        {type === "submit" && hiddenInputs && Object.entries(hiddenInputs).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-50 ${className}`}
      disabled={disabled}
      onClick={handleInitialClick}
    >
      {icon}
      {label}
    </button>
  );
}
