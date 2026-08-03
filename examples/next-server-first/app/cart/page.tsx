import { STORAGE_KEYS, sessionCookieJar, withEmporixSession } from "@viu/emporix-sdk-next/session";
import { cartCoupons, cartLines, cartTotal, money } from "@viu/emporix-examples-shared";
import { STORE_OPT } from "../emporix";
import { ActionForm } from "../components/action-form";
import { namesFor } from "../lib/product-names";
import { applyCoupon, removeCoupon, removeLine, setQuantity } from "../actions/cart";
import { emporixOptions } from "../lib/site-context";

/**
 * The cart, read in a Server Component and mutated through Server Actions.
 *
 * Every mutation is a form post. There is no optimistic update and there cannot
 * be — nothing in the browser holds cart state to update optimistically. That is
 * the documented cost of this mode, not an omission.
 */
export default async function CartPage(): Promise<React.JSX.Element> {
  // sessionCookieJar, not cookies(): it applies the __Host- prefix and the codec.
  // Reading raw would hand back ciphertext once EMPORIX_COOKIE_SECRET is set — a
  // cart id Emporix has never heard of.
  const jar = await sessionCookieJar({ readOnly: true, ...STORE_OPT });
  const cartId = jar.get(STORAGE_KEYS.cartId);

  if (cartId === null) {
    return (
      <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
        <h1 className="serif">Your bag</h1>
        <p className="muted">
          No cart yet. Add something from the{" "}
          <a href="/" className="u-underline">
            catalog
          </a>
          .
        </p>
      </main>
    );
  }

  // ONE session for the cart and the names. A second `withEmporixSession` would
  // build its own guest client and redeem the same anonymous refresh token again.
  const { lines, total, coupons, names } = await withEmporixSession(async (client, ctx) => {
    const cart = await client.carts.get(cartId, ctx);
    const l = cartLines(cart);
    return {
      lines: l,
      total: cartTotal(cart),
      coupons: cartCoupons(cart),
      names: await namesFor(
        client,
        ctx,
        l.map((x) => x.productId),
      ),
    };
  }, await emporixOptions());

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <h1 className="serif" style={{ marginBottom: "var(--s-4)" }}>
        Your bag
      </h1>
      {/* The id is httpOnly, so only the server can show it. Printed because
          watching it change across a login is the only way to see that the cart
          onboarding swapped the guest cart for the customer's — the items alone
          do not tell you, and that misreading cost a whole afternoon. */}
      <p className="muted" style={{ marginBottom: "var(--s-6)" }}>
        Cart <code>{cartId}</code>
      </p>

      {lines.length === 0 ? (
        <p className="muted">Your bag is empty.</p>
      ) : (
        <ul className="cart__lines" style={{ listStyle: "none", padding: 0 }}>
          {lines.map((l) => (
            <li key={l.id} className="cart__line">
              <span className="serif" style={{ fontSize: "var(--step-1)" }}>
                {names[l.productId] ?? l.productId}
              </span>
              <ActionForm action={setQuantity} submit="Update">
                <input type="hidden" name="itemId" value={l.id} />
                <label className="field__label" htmlFor={`qty-${l.id}`}>
                  Quantity
                </label>
                <input
                  id={`qty-${l.id}`}
                  className="input"
                  name="quantity"
                  type="number"
                  min={1}
                  defaultValue={l.quantity}
                  style={{ width: "5rem" }}
                />
              </ActionForm>
              <ActionForm action={removeLine} submit="Remove">
                <input type="hidden" name="itemId" value={l.id} />
              </ActionForm>
              <span className="price">
                {l.lineTotal ? money(l.lineTotal.amount, l.lineTotal.currency) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      <aside className="cart__summary surface" style={{ marginTop: "var(--s-6)" }}>
        <h3 className="serif">Summary</h3>

        <ActionForm action={applyCoupon} submit="Apply">
          <label className="field__label" htmlFor="code">
            Coupon
          </label>
          <input id="code" className="input" name="code" placeholder="Code" />
        </ActionForm>

        {coupons.map((c) => (
          <ActionForm key={c} action={removeCoupon} submit={`Remove ${c}`}>
            <input type="hidden" name="code" value={c} />
          </ActionForm>
        ))}

        <hr className="rule" style={{ marginBlock: "var(--s-5)" }} />
        <div className="cart__total">
          <span className="eyebrow">Total</span>
          <span className="price" style={{ fontSize: "var(--step-2)" }}>
            {total ? money(total.amount, total.currency) : "—"}
          </span>
        </div>
        {lines.length > 0 ? (
          <a href="/checkout" className="btn btn--accent" style={{ marginTop: "var(--s-4)" }}>
            Checkout →
          </a>
        ) : null}
      </aside>
    </main>
  );
}
