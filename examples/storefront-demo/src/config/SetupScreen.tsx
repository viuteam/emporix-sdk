import { useState } from "react";
import type { FormEvent } from "react";
import { Field, SelectField } from "../components/ui/Field";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";
import { RadioCard } from "../components/ui/RadioCard";
import { catId, catLabel } from "../lib/adapters";
import { countryName } from "../lib/countries";
import { errorMessage } from "../app/Toasts";
import { isValidTenant, type DemoConfig } from "./useDemoConfig";
import { loadTenantChoices, siteContext, type TenantChoices } from "./connect";

const env = import.meta.env;

/**
 * Step 1 connects (tenant + public client id, checked by an anonymous sign-in);
 * step 2 picks the site, whose currency and home country become the price
 * context, and optionally the category that fills the home page.
 */
export function SetupScreen({ onSubmit }: { onSubmit: (c: DemoConfig) => void }) {
  const [tenant, setTenant] = useState<string>(env.VITE_DEMO_DEFAULT_TENANT ?? "");
  const [clientId, setClientId] = useState<string>(env.VITE_DEMO_DEFAULT_STOREFRONT_CLIENT_ID ?? "");
  const [host, setHost] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [choices, setChoices] = useState<TenantChoices | null>(null);
  const [siteCode, setSiteCode] = useState("");
  const [featured, setFeatured] = useState("");

  const tenantError = touched && !isValidTenant(tenant) ? "Lowercase, 3–16 chars (a–z, 0–9)." : undefined;
  const clientError = touched && !clientId.trim() ? "Required." : undefined;

  async function connect(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!isValidTenant(tenant) || !clientId.trim()) return;
    setBusy(true);
    setConnectError(null);
    try {
      const next = await loadTenantChoices({
        tenant: tenant.trim(),
        storefrontClientId: clientId.trim(),
        host: host.trim() || undefined,
      });
      setChoices(next);
      setSiteCode((next.sites.find((s) => s.default) ?? next.sites[0])?.code ?? "");
    } catch (err) {
      setConnectError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function enter(e: FormEvent) {
    e.preventDefault();
    const site = choices?.sites.find((s) => s.code === siteCode);
    onSubmit({
      tenant,
      storefrontClientId: clientId,
      host,
      ...(site ? siteContext(site) : {}),
      ...(featured ? { featuredCategoryId: featured } : {}),
    });
  }

  return (
    <main className="container setup">
      <p className="eyebrow">Emporix · Storefront Demo</p>
      <h1 className="setup__title">Connect your tenant</h1>
      <p className="muted setup__lead">
        Enter a tenant and its <strong>storefront client id</strong> (public, no secret). Everything runs in your
        browser with anonymous and customer tokens.
      </p>
      <Alert tone="warning">
        <strong>Live tenant.</strong> This demo talks to a real Emporix tenant and can place <strong>real orders</strong>.
        Use a test or sandbox tenant.
      </Alert>

      {choices === null ? (
        <form onSubmit={connect} className="stack setup__form" noValidate>
          <Field
            label="Tenant"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            placeholder="your-tenant"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            error={tenantError}
          />
          <Field
            label="Storefront client id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="public storefront client id"
            error={clientError}
          />
          <details className="setup__advanced">
            <summary>Advanced (optional)</summary>
            <Field label="Host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="https://api.emporix.io" />
          </details>
          {connectError ? (
            <Alert tone="danger">
              <strong>Couldn't connect.</strong> {connectError}
            </Alert>
          ) : null}
          <div>
            <Button type="submit" variant="accent" disabled={busy}>
              {busy ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={enter} className="stack setup__form">
          <fieldset className="setup__sites">
            <legend className="field__label">Site</legend>
            {choices.sites.length === 0 ? (
              <Alert tone="warning">This tenant reports no active site. You can enter the store, but prices may not resolve.</Alert>
            ) : (
              <div className="radio-list">
                {choices.sites.map((s) => (
                  <RadioCard
                    key={s.code}
                    name="site"
                    value={s.code}
                    checked={siteCode === s.code}
                    onChange={setSiteCode}
                    title={s.name}
                    description={`${s.code} · ${s.currency} · ships to ${s.shipToCountries.map(countryName).join(", ")}`}
                    aside={s.default ? "Default" : undefined}
                  />
                ))}
              </div>
            )}
          </fieldset>
          <SelectField label="Featured category (optional)" value={featured} onChange={(e) => setFeatured(e.target.value)}>
            <option value="">None: show the first products</option>
            {choices.categories.map((c) => (
              <option key={catId(c)} value={catId(c)}>
                {catLabel(c)}
              </option>
            ))}
          </SelectField>
          <p className="field__hint">Fills the home page. Pick a category whose products have a price on this site.</p>
          <div className="cluster">
            <Button type="submit" variant="accent">
              Enter the store
            </Button>
            <Button type="button" variant="ghost" onClick={() => setChoices(null)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
