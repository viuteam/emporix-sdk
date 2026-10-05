import type { ReactNode } from "react";

type Tone = "warning" | "danger" | "success";

/**
 * A tinted box for things the shopper must not miss. Warnings and errors are
 * announced (`role="alert"`); a success is polite (`role="status"`).
 */
export function Alert({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === "success" ? "status" : "alert"}>
      {children}
    </div>
  );
}
