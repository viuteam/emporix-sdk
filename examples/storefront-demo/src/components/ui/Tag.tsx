import type { ReactNode } from "react";

export function Tag({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return <span className={accent ? "tag tag--accent" : "tag"}>{children}</span>;
}
