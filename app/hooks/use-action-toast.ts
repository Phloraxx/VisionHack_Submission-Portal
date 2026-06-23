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
 * Fire success / error toasts in response to an action result.
 * Uses a ref to prevent duplicate toasts when React Router returns a new
 * actionData object reference on every render.
 */
export function useActionToast(
	actionData: ActionToastData | undefined,
	options: UseActionToastOptions = {},
): void {
	const prevRef = useRef(actionData);
	useEffect(() => {
		if (actionData && actionData !== prevRef.current) {
			prevRef.current = actionData;
			if (actionData.success) {
				const msg =
					typeof options.success === "function" ? options.success() : (options.success ?? "Saved.");
				toast.success(msg);
			} else if (actionData.error) {
				toast.error(options.error ?? actionData.error);
			}
		}
	}, [actionData]);
}
