import { useState } from "react";
import type { FormEvent } from "react";
import { Field } from "../components/ui/Field";
import { Button } from "../components/ui/Button";
import { isValidTenant, type DemoConfig } from "./useDemoConfig";

const env = import.meta.env;

export function SetupScreen({ onSubmit }: { onSubmit: (c: DemoConfig) => void }) {
  const [tenant, setTenant] = useState<string>(env.VITE_DEMO_DEFAULT_TENANT ?? "");
  const [clientId, setClientId] = useState<string>(env.VITE_DEMO_DEFAULT_STOREFRONT_CLIENT_ID ?? "");
  const [host, setHost] = useState("");
  const [siteCode, setSiteCode] = useState("");
  const [currency, setCurrency] = useState("");
  const [touched, setTouched] = useState(false);

  const tenantError = touched && !isValidTenant(tenant) ? "Lowercase, 3–16 chars (a–z, 0–9)." : undefined;
  const clientError = touched && !clientId.trim() ? "Required." : undefined;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!isValidTenant(tenant) || !clientId.trim()) return;
    onSubmit({ tenant, storefrontClientId: clientId, host, siteCode, currency });
  }

  return (
    <main className="container" style={{ maxWidth: "44rem", paddingBlock: "var(--s-8)" }}>
      <p className="eyebrow reveal">Emporix · Storefront Demo</p>
      <h1 className="reveal" style={{ marginBlock: "var(--s-3) var(--s-4)", fontSize: "var(--step-3)" }}>
        Connect your <span style={{ fontStyle: "italic", color: "var(--oxblood)" }}>tenant</span>
      </h1>
      <p className="muted reveal" style={{ maxWidth: "52ch", marginBottom: "var(--s-5)" }}>
        Enter a tenant and its <strong>storefront client id</strong> (public — no secret). Everything
        runs in your browser using anonymous + customer tokens.
      </p>

      <div
        className="reveal"
        role="alert"
        style={{
          border: "1px solid var(--oxblood)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--s-4)",
          marginBottom: "var(--s-6)",
          background: "color-mix(in oklab, var(--oxblood) 7%, var(--paper))",
        }}
      >
        <strong className="serif" style={{ color: "var(--oxblood)" }}>Live tenant.</strong>{" "}
        <span className="muted">
          This demo talks to a real Emporix tenant and can place <strong>real orders</strong>. Use a
          test / sandbox tenant.
        </span>
      </div>

      <form onSubmit={submit} className="stack reveal" noValidate>
        <Field
          label="Tenant"
          value={tenant}
          onChange={(e) => setTenant(e.target.value)}
          placeholder="viu"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          {...(tenantError ? { error: tenantError } : {})}
        />
        <Field
          label="Storefront client id"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="public storefront client id"
          {...(clientError ? { error: clientError } : {})}
        />
        <details>
          <summary className="eyebrow" style={{ cursor: "pointer", paddingBlock: "var(--s-2)" }}>
            Advanced (optional)
          </summary>
          <div className="stack" style={{ marginTop: "var(--s-3)" }}>
            <Field label="Host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="https://api.emporix.io" />
            <Field label="Site code" value={siteCode} onChange={(e) => setSiteCode(e.target.value)} placeholder="main" />
            <Field label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="CHF" />
          </div>
        </details>
        <div style={{ marginTop: "var(--s-4)" }}>
          <Button type="submit" variant="accent">Enter the store →</Button>
        </div>
      </form>
    </main>
  );
}
