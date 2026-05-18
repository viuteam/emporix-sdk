import { EmporixClient, auth } from "@viu/emporix-sdk";

// Emporix product `name` is localized — a `{ [locale]: string }` map (or a
// plain string for some tenants). Render it defensively.
function displayName(name: unknown, fallback: string): string {
  if (typeof name === "string") return name;
  if (name && typeof name === "object") {
    const values = Object.values(name as Record<string, unknown>);
    if (typeof values[0] === "string") return values[0];
  }
  return fallback;
}

// Server Component: read the catalog directly with the SDK (one client/server).
const sdk = new EmporixClient({
  tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "mytenant",
  credentials: {
    backend: {
      clientId: process.env.EMPORIX_BACKEND_CLIENT_ID ?? "",
      secret: process.env.EMPORIX_BACKEND_CLIENT_SECRET ?? "",
    },
    storefront: { clientId: process.env.EMPORIX_STOREFRONT_CLIENT_ID ?? "" },
  },
  logger: false,
});

export default async function Page(): Promise<React.JSX.Element> {
  const page = await sdk.products.list({ pageSize: 12 }, auth.anonymous());
  return (
    <main>
      <h1>Catalog (RSC)</h1>
      <ul>
        {page.items.map((p) => (
          <li key={p.id}>{displayName(p.name, p.id ?? "")}</li>
        ))}
      </ul>
    </main>
  );
}
