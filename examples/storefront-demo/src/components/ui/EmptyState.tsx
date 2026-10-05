import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="center-col empty-state">
      <h2 className="page-title">{title}</h2>
      {children ? <p className="muted">{children}</p> : null}
    </div>
  );
}
