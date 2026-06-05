import type { ReactNode } from "react";
import { useDemoConfig, type DemoConfig } from "./useDemoConfig";
import { SetupScreen } from "./SetupScreen";

export function ConfigGate({
  children,
}: {
  children: (
    config: DemoConfig,
    reset: () => void,
    persist: (partial: Partial<DemoConfig>) => void,
  ) => ReactNode;
}) {
  const { config, save, reset, persist } = useDemoConfig();
  if (!config) return <SetupScreen onSubmit={save} />;
  return <>{children(config, reset, persist)}</>;
}
