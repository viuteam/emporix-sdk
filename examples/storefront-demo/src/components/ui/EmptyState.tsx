import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="center-col" style={{ padding: "var(--s-7) 0", gap: "var(--s-3)" }}>
      <h3 className="serif">{title}</h3>
      {children ? <p className="muted" style={{ maxWidth: "32ch" }}>{children}</p> : null}
    </div>
  );
}
