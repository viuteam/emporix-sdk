import { auth } from "@viu/emporix-sdk";
import { emporix } from "./emporix";

// Emporix product `name` is localized — a `{ [locale]: string }` map (or a
// plain string for some tenants). Render it defensively.
// (Intentionally duplicated in examples/vite-spa/src/App.tsx — examples are
//  kept self-contained so each is copy-paste-friendly.)
function displayName(name: unknown, fallback: string): string {
  if (typeof name === "string") return name;
  if (name && typeof name === "object") {
    const values = Object.values(name as Record<string, unknown>);
    if (typeof values[0] === "string") return values[0];
  }
  return fallback;
}

export default async function Page(): Promise<React.JSX.Element> {
  // Memoized per process by getEmporixClient — never a client per request.
  // This GET is tagged `emporix:products` automatically.
  const sdk = emporix();
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
