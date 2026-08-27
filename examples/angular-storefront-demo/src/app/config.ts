/**
 * Runtime demo configuration — entered on the setup screen, kept in
 * localStorage.
 *
 * The point is that **no credentials live in this source tree**. A tenant and a
 * public storefront client id are typed in at runtime, so the example can be
 * committed, built in CI and published without carrying anyone's configuration.
 * Same approach as `examples/storefront-demo`.
 */
export interface DemoConfig {
  tenant: string;
  storefrontClientId: string;
  host?: string;
  siteCode?: string;
  currency?: string;
  /** ISO country code for the pricing context (e.g. `CH`). Needed for price resolution. */
  targetLocation?: string;
  language?: string;
}

const KEY = "emporix.demo.config";
const TENANT_RE = /^[a-z][a-z0-9]+$/;

export function isValidTenant(t: string): boolean {
  const v = t.trim();
  return TENANT_RE.test(v) && v.length >= 3 && v.length <= 16;
}

/** Strip empty optionals — `exactOptionalPropertyTypes` is on repo-wide. */
export function normalizeConfig(c: DemoConfig): DemoConfig {
  const out: DemoConfig = {
    tenant: c.tenant.trim(),
    storefrontClientId: c.storefrontClientId.trim(),
  };
  if (c.host?.trim()) out.host = c.host.trim();
  if (c.siteCode?.trim()) out.siteCode = c.siteCode.trim();
  if (c.currency?.trim()) out.currency = c.currency.trim();
  if (c.targetLocation?.trim()) out.targetLocation = c.targetLocation.trim();
  if (c.language?.trim()) out.language = c.language.trim();
  return out;
}

function isValid(c: Partial<DemoConfig> | null): c is DemoConfig {
  return (
    c !== null &&
    typeof c.tenant === "string" &&
    isValidTenant(c.tenant) &&
    typeof c.storefrontClientId === "string" &&
    c.storefrontClientId.trim().length > 0
  );
}

export function readConfig(): DemoConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<DemoConfig>;
    return isValid(parsed) ? normalizeConfig(parsed) : null;
  } catch {
    // Corrupt or unreadable storage reads as "not configured", which lands the
    // visitor on the setup screen rather than a broken app.
    return null;
  }
}

export function writeConfig(c: DemoConfig): void {
  localStorage.setItem(KEY, JSON.stringify(normalizeConfig(c)));
}

export function clearConfig(): void {
  localStorage.removeItem(KEY);
}
