import { getEmporixClient } from "@viu/emporix-sdk-next";
import { CONTEXT, PRICED_CATEGORY } from "./emporix";
import { Typeahead } from "./typeahead";
import { addToCart } from "./actions/cart";

function label(name: unknown): string {
  if (typeof name === "string") return name;
  if (name !== null && typeof name === "object") {
    const first = Object.values(name as Record<string, unknown>)[0];
    if (typeof first === "string") return first;
  }
  return "(unnamed)";
}

/**
 * Catalog reads use the MEMOIZED, TAGGED client — not withEmporixSession.
 * withEmporixSession in a Server Component gets a read-only cookie jar, so the
 * anonymous session it obtains cannot be persisted and the next render would log
 * in again. Catalog data needs no stable session, so the process-wide token is
 * both correct and cheaper.
 */
export default async function Home(): Promise<React.JSX.Element> {
  const client = getEmporixClient({ context: CONTEXT });
  const page = await client.categories.productsIn(PRICED_CATEGORY, { pageSize: 12 }, undefined);

  async function add(formData: FormData): Promise<void> {
    "use server";
    await addToCart(String(formData.get("productId")));
  }

  return (
    <main>
      <h1>Catalog</h1>
      <p>
        Products from the category known to carry prices. Adding needs a price —
        Emporix requires a <code>priceId</code> on internal cart items.
      </p>
      <Typeahead />
      <ul>
        {page.items.map((p) => (
          <li key={p.id}>
            {label(p.name)} — {p.code}{" "}
            <form action={add} style={{ display: "inline" }}>
              <input type="hidden" name="productId" value={p.id} />
              <button type="submit">Add to cart</button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
