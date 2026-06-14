import { useEffect, useRef, useCallback } from "react";

/**
 * Auto-saves form state to localStorage at a given interval.
 *
 * On mount, restores any previously saved state. The saved state is
 * cleared when the form is successfully submitted (via `clearSaved()`)
 * or when `clearOnUnmount` is true.
 *
 * ```tsx
 * const { savedData, save, clearSaved } = useAutoSave<FormData>("my-form", 3000);
 * // savedData is the restored state (null if none)
 * // save(data) persists immediately
 * // clearSaved() wipes the saved state (call on successful submit)
 * ```
 */
export function useAutoSave<T>(
  /** Unique key used as the localStorage key. */
  key: string,
  /** Auto-save interval in ms (default: 5000). */
  intervalMs = 5000,
  /** Whether to auto-clear saved data when the component unmounts. */
  clearOnUnmount = false,
) {
  const dataRef = useRef<T | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore saved data on mount
  const savedData: T | null = (() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(`autosave:${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  })();

  // Persist current data to localStorage
  const save = useCallback(
    (data: T) => {
      dataRef.current = data;
      if (typeof window === "undefined") return;
      try {
        localStorage.setItem(`autosave:${key}`, JSON.stringify(data));
      } catch {
        // localStorage full or unavailable — silently fail
      }
    },
    [key],
  );

  // Clear saved data
  const clearSaved = useCallback(() => {
    dataRef.current = null;
    if (typeof window === "undefined") return;
    try {
      localStorage.removeItem(`autosave:${key}`);
    } catch {
      // ignore
    }
  }, [key]);

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

  return { savedData, save, clearSaved } as const;
}
