import { useEffect, useRef } from "react";
import { toast } from "sonner";

interface ActionToastData {
  success?: boolean;
  error?: string;
}

interface UseActionToastOptions {
  /** Message (or factory) shown when the action succeeds. */
  success?: string | (() => string);
  /**
   * Message shown on error. Defaults to the action's own `error` string.
   * Pass a value to override it.
   */
  error?: string;
}

/**
 * Fire success / error toasts in response to an action result, exactly
 * once per transition. Replaces the copy-pasted `useRef` + `useEffect`
 * toast boilerplate that lived in several route components.
 */
export function useActionToast(
  actionData: ActionToastData | undefined,
  options: UseActionToastOptions = {},
): void {
  const prevSuccess = useRef(false);
  const prevError = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (actionData?.success && !prevSuccess.current) {
      const msg =
        typeof options.success === "function"
          ? options.success()
          : options.success ?? "Saved.";
      toast.success(msg);
    }
    prevSuccess.current = !!actionData?.success;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData?.success]);

  useEffect(() => {
    if (actionData?.error && actionData.error !== prevError.current) {
      toast.error(options.error ?? actionData.error);
    }
    prevError.current = actionData?.error;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData?.error]);
}
