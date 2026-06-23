import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Auto-saves form state to sessionStorage using a debounced write.
 *
 * sessionStorage survives page refresh but is cleared on tab close —
 * the right scope for a form draft (PII shouldn't persist across sessions
 * or be accessible to other same-origin scripts the way localStorage is).
 *
 * On mount, restores any previously saved state. The saved state is
 * cleared when `clearSaved()` is called (after a successful submit) or
 * when `clearOnUnmount` is true.
 */
export function useAutoSave<T>(
	/** Unique key used as the storage key. */
	key: string,
	/** Whether to auto-clear saved data when the component unmounts. */
	clearOnUnmount = false,
) {
	const dataRef = useRef<T | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const storageKey = `autosave:${key}`;

	// Restore saved data once on mount (lazy initializer — does NOT re-read
	// or re-parse sessionStorage on every render).
	const [initial] = useState<T | null>(() => {
		if (typeof window === "undefined") return null;
		try {
			const raw = sessionStorage.getItem(storageKey);
			return raw ? (JSON.parse(raw) as T) : null;
		} catch {
			return null;
		}
	});

	// Persist current data to sessionStorage (debounced — 500ms after last call).
	const save = useCallback(
		(data: T) => {
			dataRef.current = data;
			if (typeof window === "undefined") return;
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => {
				try {
					sessionStorage.setItem(storageKey, JSON.stringify(dataRef.current));
				} catch {
					if (import.meta.env.DEV) {
						console.warn("useAutoSave: sessionStorage.setItem failed", storageKey);
					}
				}
			}, 500);
		},
		[storageKey],
	);

	// Clear saved data
	const clearSaved = useCallback(() => {
		dataRef.current = null;
		if (timerRef.current) clearTimeout(timerRef.current);
		if (typeof window === "undefined") return;
		try {
			sessionStorage.removeItem(storageKey);
		} catch {
			// ignore
		}
	}, [storageKey]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
			if (clearOnUnmount) clearSaved();
		};
	}, [clearOnUnmount, clearSaved]);

	return { savedData: initial, save, clearSaved } as const;
}
