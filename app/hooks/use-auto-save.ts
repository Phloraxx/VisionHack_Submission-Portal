import { useEffect, useRef, useCallback, useState } from "react";

/**
 * Auto-saves form state to sessionStorage at a given interval.
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
  /** Auto-save interval in ms (default: 5000). */
  intervalMs = 5000,
  /** Whether to auto-clear saved data when the component unmounts. */
  clearOnUnmount = false,
) {
  const dataRef = useRef<T | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Persist current data to sessionStorage
  const save = useCallback(
    (data: T) => {
      dataRef.current = data;
      if (typeof window === "undefined") return;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(data));
      } catch {
        // sessionStorage full or unavailable — silently fail
      }
    },
    [storageKey],
  );

  // Clear saved data
  const clearSaved = useCallback(() => {
    dataRef.current = null;
    if (typeof window === "undefined") return;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [storageKey]);

  // Periodic auto-save
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      if (dataRef.current !== null) {
        save(dataRef.current);
      }
    }, intervalMs);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (clearOnUnmount) clearSaved();
    };
  }, [intervalMs, clearOnUnmount, save, clearSaved]);

  return { savedData: initial, save, clearSaved } as const;
}
