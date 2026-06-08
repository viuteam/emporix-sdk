import { useCustomerSession } from "@viu/emporix-sdk-react";
import { readMixin } from "@viu/emporix-mixins";
import { mixins } from "../../mixins/generated/registry";

/**
 * Demonstrates `@viu/emporix-mixins`: the typed registry was generated from this
 * tenant's Schema Service (`emporix-mixins pull && generate`, committed under
 * `src/mixins/generated`). Below: the generated mixin schemas, plus a typed read
 * of the customer's `favoriteProducts` mixin via `readMixin`.
 */
export function Mixins() {
  const { customer } = useCustomerSession();
  const fav = customer ? readMixin(customer, mixins.favoriteProducts) : undefined;

  return (
    <main className="container" style={{ maxWidth: "52rem", paddingBlock: "var(--s-7)" }}>
      <p className="eyebrow">Developer · Mixins</p>
      <h2 className="serif" style={{ marginBlock: "var(--s-2) var(--s-3)" }}>
        Mixin schemas
      </h2>
      <p className="muted" style={{ marginBottom: "var(--s-5)" }}>
        Generated from this tenant&rsquo;s Schema Service by{" "}
        <code>@viu/emporix-mixins</code> — typed registry committed under{" "}
        <code>src/mixins/generated</code>.
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--step--1)" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
            <th style={{ padding: "var(--s-2)" }}>Key</th>
            <th style={{ padding: "var(--s-2)" }}>Entity</th>
            <th style={{ padding: "var(--s-2)" }}>Version</th>
          </tr>
        </thead>
        <tbody>
          {Object.values(mixins).map((m) => (
            <tr key={m.key} data-testid={`mixin-${m.key}`} style={{ borderBottom: "1px solid var(--line)" }}>
              <td style={{ padding: "var(--s-2)", fontFamily: "monospace" }}>{m.key}</td>
              <td style={{ padding: "var(--s-2)" }}>{m.entity}</td>
              <td style={{ padding: "var(--s-2)" }}>v{m.version}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: "var(--s-6)" }}>
        <p className="eyebrow">Typed read — customer.favoriteProducts</p>
        {customer ? (
          <p data-testid="fav-read">
            {fav ? `${fav.products?.length ?? 0} favorite product(s) on your profile.` : "No favoriteProducts mixin set on your profile."}
          </p>
        ) : (
          <p className="muted">Sign in to see a typed customer-mixin read.</p>
        )}
      </div>
    </main>
  );
}
