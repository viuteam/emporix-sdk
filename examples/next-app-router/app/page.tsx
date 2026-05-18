import { EmporixClient, auth } from "@viu/emporix-sdk";

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
          <li key={p.id}>{p.name ?? p.id}</li>
        ))}
      </ul>
    </main>
  );
}
