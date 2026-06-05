import { useCallback, useState } from "react";

/** Runtime demo configuration — entered on the setup screen, kept in localStorage. */
export interface DemoConfig {
  tenant: string;
  storefrontClientId: string;
  host?: string;
  siteCode?: string;
  currency?: string;
  /** ISO country code for the pricing context (e.g. `DE`). Needed for price resolution. */
  targetLocation?: string;
}

const KEY = "emporix.demo.config";
const TENANT_RE = /^[a-z][a-z0-9]+$/;

export function isValidTenant(t: string): boolean {
  const v = t.trim();
  return TENANT_RE.test(v) && v.length >= 3 && v.length <= 16;
}

/** Strip empty optionals (keeps exactOptionalPropertyTypes happy). */
export function normalizeConfig(c: DemoConfig): DemoConfig {
  const out: DemoConfig = {
    tenant: c.tenant.trim(),
    storefrontClientId: c.storefrontClientId.trim(),
  };
  if (c.host?.trim()) out.host = c.host.trim();
  if (c.siteCode?.trim()) out.siteCode = c.siteCode.trim();
  if (c.currency?.trim()) out.currency = c.currency.trim();
  if (c.targetLocation?.trim()) out.targetLocation = c.targetLocation.trim();
  return out;
}

function isValid(c: Partial<DemoConfig> | null): c is DemoConfig {
  return (
    !!c &&
    typeof c.tenant === "string" &&
    isValidTenant(c.tenant) &&
    typeof c.storefrontClientId === "string" &&
    c.storefrontClientId.trim().length > 0
  );
}

export function readConfig(): DemoConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DemoConfig>;
    return isValid(parsed) ? normalizeConfig(parsed) : null;
  } catch {
    return null;
  }
}

export function writeConfig(c: DemoConfig): void {
  localStorage.setItem(KEY, JSON.stringify(normalizeConfig(c)));
}

export function clearConfig(): void {
  localStorage.removeItem(KEY);
}

export function useDemoConfig() {
  const [config, setConfig] = useState<DemoConfig | null>(() => readConfig());
  const save = useCallback((c: DemoConfig) => {
    const n = normalizeConfig(c);
    writeConfig(n);
    setConfig(n);
  }, []);
  const reset = useCallback(() => {
    clearConfig();
    setConfig(null);
  }, []);
  // Persist a partial change WITHOUT triggering a client rebuild — used to
  // remember the active currency for the next reload.
  const persist = useCallback(
    (partial: Partial<DemoConfig>) => {
      if (config) writeConfig({ ...config, ...partial });
    },
    [config],
  );
  return { config, save, reset, persist };
}
