import { useState, useCallback, useRef, useEffect, createContext, useContext, type ReactNode } from "react";
import "./Toast.css";

// ── Types ─────────────────────────────────────────────────────────

export interface ToastItem {
  id: string;
  message: string;
  level: "info" | "warn" | "error" | "success";
  durationMs?: number;
}

interface ToastContextValue {
  addToast: (message: string, level?: ToastItem["level"], durationMs?: number) => void;
}

// ── Context ───────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

// ── Provider + Container ──────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const addToast = useCallback((message: string, level: ToastItem["level"] = "info", durationMs = 5000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, level, durationMs }]);

    if (durationMs > 0) {
      const timer = setTimeout(() => removeToast(id), durationMs);
      timers.current.set(id, timer);
    }
  }, [removeToast]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast-item toast-${toast.level}`}
              onClick={() => removeToast(toast.id)}
            >
              <span className="toast-message">{toast.message}</span>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
