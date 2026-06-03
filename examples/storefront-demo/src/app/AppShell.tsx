import type { ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { TelemetryHUD } from "./TelemetryHUD";

export function AppShell({
  tenant,
  onReset,
  children,
}: {
  tenant: string;
  onReset: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <Header />
      <main style={{ minHeight: "62vh" }}>{children}</main>
      <Footer tenant={tenant} onReset={onReset} />
      <TelemetryHUD />
    </>
  );
}
