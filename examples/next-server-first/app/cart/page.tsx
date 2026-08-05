import Link from "next/link";
import { EmporixNotFoundError } from "@viu/emporix-sdk";
import { STORAGE_KEYS, emporixSessionHandle, withEmporixSession } from "@viu/emporix-sdk-next/session";
import { cartCoupons, cartLines, cartTotal, money } from "@viu/emporix-examples-shared";
import { STORE_OPT } from "../emporix";
import { ActionForm } from "../components/action-form";
import { Note, TitleBlock } from "../components/sheet";
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
function EmptyBag(): React.JSX.Element {
  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Session</p>
      <h1 style={{ marginBlock: "var(--s-2) var(--s-4)" }}>Your bag</h1>
      <p className="muted">
        No cart yet. Add something from the{" "}
        <Link href="/" className="u-underline">
          catalog
        </Link>
        .
      </p>
    </main>
  );
}

export default async function CartPage(): Promise<React.JSX.Element> {
  // emporixSessionHandle, not cookies(): it applies the __Host- prefix and the codec.
  // Reading raw would hand back ciphertext once EMPORIX_COOKIE_SECRET is set — a
  // cart id Emporix has never heard of.
  const handle = await emporixSessionHandle({ readOnly: true, ...STORE_OPT });
  const cartId = handle.get(STORAGE_KEYS.cartId);

  if (cartId === null) return <EmptyBag />;

  // ONE session for the cart and the names. A second `withEmporixSession` would
  // build its own guest client and redeem the same anonymous refresh token again.
  let page;
  try {
    page = await withEmporixSession(async (client, ctx) => {
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
  } catch (e) {
    // The same customer checked out on another device, which closed this cart.
    // Show the empty bag rather than an error boundary — the cart is gone, and
    // there is nothing the shopper could do about it.
    //
    // The id CANNOT be cleared here: this is a render, and a read-only handle
    // does not write. The next Server Action clears it (see actions/cart.ts),
    // and `addToCart` recovers on its own. Until then the header badge keeps the
    // stale count — the price of not spending a cart call per page view.
    if (!(e instanceof EmporixNotFoundError)) throw e;
    return <EmptyBag />;
  }
  const { lines, total, coupons, names } = page;

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Session</p>
      <h1 style={{ marginBlock: "var(--s-2) var(--s-4)" }}>Your bag</h1>
      {/* The id is httpOnly, so only the server can show it. Printed because
          watching it change across a login is the only way to see that the cart
          onboarding swapped the guest cart for the customer's — the items alone
          do not tell you, and that misreading cost a whole afternoon. */}
      <p className="muted" style={{ marginBottom: "var(--s-6)" }}>
        Cart <code>{cartId}</code>
      </p>

      {/* `.cart` puts the lines and the summary side by side as soon as there is
          room. Before, the summary sat under a single-column list, because the class
          was in the markup but defined nowhere. */}
      <div className="cart">
        <div>
          {lines.length === 0 ? (
            <p className="muted">Your bag is empty.</p>
          ) : (
            <ul className="cart__lines">
              {lines.map((l) => (
                <li key={l.id} className="cart__line">
                  <span style={{ fontWeight: 500 }}>
                    {names[l.productId] ?? l.productId}
                  </span>
                  <ActionForm action={setQuantity} submit="Update" className="cluster">
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
                      style={{ width: "4.5rem" }}
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
        </div>

        {/* This page gets no third column. The summary is the main thing rather than
            annotation — the total and the checkout belong in the content, not in the
            margin. So the title block hangs under the summary instead of getting a
            rail of its own. */}
        <div className="stack">
          <aside className="cart__summary surface">
            {/* `<h2>`, not `<h3>`: after this page's `<h1>`, h3 skips a level. */}
            <h2 style={{ fontSize: "var(--step-1)" }}>Summary</h2>

            <div className="stack" style={{ marginTop: "var(--s-4)" }}>
              <ActionForm action={applyCoupon} submit="Apply" className="stack">
                <p className="field">
                  <label className="field__label" htmlFor="code">
                    Coupon
                  </label>
                  <input id="code" className="input" name="code" />
                </p>
              </ActionForm>

              {coupons.map((c) => (
                <ActionForm key={c} action={removeCoupon} submit={`Remove ${c}`}>
                  <input type="hidden" name="code" value={c} />
                </ActionForm>
              ))}
            </div>

            <hr className="rule" style={{ marginBlock: "var(--s-5)" }} />
            <div className="cart__total">
              <span className="eyebrow">Total</span>
              <span className="price" style={{ fontSize: "var(--step-2)" }}>
                {total ? money(total.amount, total.currency) : "—"}
              </span>
            </div>
            {lines.length > 0 ? (
              <Link
                href="/checkout"
                className="btn btn--accent btn--block"
                style={{ marginTop: "var(--s-5)" }}
              >
                Checkout →
              </Link>
            ) : null}
          </aside>

          {/* The forms on this page carry NO redline bracket, deliberately: here every
              control is an `ActionForm` and therefore an island. Five brackets all
              saying the same thing say nothing — the bracket earns its place where it
              distinguishes something, so in the header and around the typeahead. */}
          <TitleBlock
            meta={{
              route: "/cart",
              render: "dynamic",
              because: "session cookie",
              islands: ["one per mutation form"],
            }}
          />
          <Note title="No optimistic update">
            Every mutation is a form post, and there is nothing in the browser holding
            cart state to update ahead of the server. That is the documented cost of
            this mode, not an omission.
          </Note>
        </div>
      </div>
    </main>
  );
}
