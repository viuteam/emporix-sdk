import { STORAGE_KEYS, sessionCookieJar, withEmporixSession } from "@viu/emporix-sdk-next/session";
import { EMPORIX, STORE_OPT } from "../emporix";

/**
 * A guest cart READ in a Server Component.
 *
 * This is the case the plan flags as unproven: the read-only jar cannot persist
 * a rotated anonymous session. If Emporix invalidates the old anonymous refresh
 * token on use, the SECOND load of this page fails. Reload twice to find out.
 */
export default async function CartPage(): Promise<React.JSX.Element> {
  // sessionCookieJar, not cookies(): it applies the __Host- prefix and the
  // codec. Reading raw would hand back ciphertext once EMPORIX_COOKIE_SECRET is
  // set — a cart id that Emporix has never heard of.
  const jar = await sessionCookieJar({ readOnly: true, ...STORE_OPT });
  const cartId = jar.get(STORAGE_KEYS.cartId);
  const cart =
    cartId === null
      ? null
      : await withEmporixSession((client, ctx) => client.carts.get(cartId, ctx), EMPORIX);

  return (
    <main>
      <h1>Cart</h1>
      {cart === null ? (
        <p>
          No cart yet. Add something from the <a href="/">catalog</a>.
        </p>
      ) : (
        <>
          {/* The id is httpOnly, so only the server can show it. Visible here
              because watching it change across a login is the only way to see
              that cart onboarding actually swapped the guest cart for the
              customer's — the items alone do not tell you. */}
          <p>
            Cart <code>{cartId}</code> — {cart.items?.length ?? 0} item(s)
          </p>
          <ul>
            {(cart.items ?? []).map((i, idx) => (
              <li key={i.id ?? idx}>
                {i.itemYrn} × {i.quantity}
              </li>
            ))}
          </ul>
          <a href="/checkout">Checkout</a>
        </>
      )}
    </main>
  );
}
