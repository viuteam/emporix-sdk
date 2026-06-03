import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

type ToastKind = "info" | "success" | "error";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  notify: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++seq;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const api = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          right: "var(--gutter)",
          bottom: "var(--s-5)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--s-2)",
          zIndex: 50,
          maxWidth: "min(92vw, 26rem)",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className="reveal"
            style={{
              background: "var(--ink)",
              color: "var(--paper)",
              borderLeft: `3px solid ${t.kind === "error" ? "var(--oxblood)" : t.kind === "success" ? "var(--good)" : "var(--muted)"}`,
              padding: "var(--s-3) var(--s-4)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-2)",
              fontSize: "var(--step--1)",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

/** Best-effort message from an unknown thrown error. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return "Something went wrong.";
}
