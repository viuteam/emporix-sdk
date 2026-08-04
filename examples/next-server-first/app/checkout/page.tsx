import { pickFee, resolveZone, type Address } from "@viu/emporix-sdk";
import { pickText } from "@viu/emporix-examples-shared";
import { STORAGE_KEYS, emporixSessionHandle, withEmporixSession } from "@viu/emporix-sdk-next/session";
import { SITE, STORE_OPT } from "../emporix";
import { submitCheckout } from "../actions/checkout";
import { siteContext, emporixOptions } from "../lib/site-context";

/** `LocalizedValue` is `string | Record<string, string>`. Pick something showable. */
function label(name: string | Record<string, string> | undefined, fallback: string): string {
  if (typeof name === "string") return name;
  if (name) return Object.values(name)[0] ?? fallback;
  return fallback;
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<React.JSX.Element> {
  const { error } = await searchParams;
  // The shipping country comes from the session context now, not a module
  // constant — same source the Emporix calls below bind.
  const { targetLocation } = await siteContext();
  const cartId = (await emporixSessionHandle({ readOnly: true, ...STORE_OPT })).get(
    STORAGE_KEYS.cartId,
  );
  if (cartId === null) {
    return (
      <main>
        <h1>Checkout</h1>
        <p>
          No cart yet. Add something from the <a href="/">catalog</a>.
        </p>
      </main>
    );
  }

  // ONE session, five parallel calls. Five separate withEmporixSession calls
  // would build five guest clients and redeem the same anonymous refresh token
  // five times over — see session-client.ts, newGuestClient.
  const { cart, modes, zones, addresses, me } = await withEmporixSession(async (c, ctx) => {
    const [cart, modes, zones, addresses, me] = await Promise.all([
      c.carts.get(cartId, ctx),
      c.payments.listPaymentModes(ctx),
      c.shipping.listZones(SITE.siteCode, { expand: "methods,fees", activeMethods: "true" }, ctx),
      // A guest throws EmporixAuthError locally, an expired token 401s. Both
      // mean "no saved addresses", and neither deserves a second code path.
      c.customers.addresses.list(ctx).catch(() => [] as Address[]),
      // Same story for the profile: a guest has none, and then the contact
      // fields simply start empty. Added because a logged-in shopper was
      // retyping their own name into a form the server could fill.
      c.customers.me(ctx).catch(() => undefined),
    ]);
    return { cart, modes, zones, addresses, me };
  }, await emporixOptions());

  const total = cart.totalPrice?.amount ?? 0;
  // ponytail: the zone is resolved for the configured country only. Typing a
  // different country leaves this radio list stale — the action re-resolves and
  // wins. Upgrade path: a separate GET form for the country, or a client island.
  const zone = resolveZone(zones, targetLocation);
  const methods = zone?.methods ?? [];
  const saved = addresses.find((a) => a.isDefault) ?? addresses[0];

  return (
    <main>
      <h1>Checkout</h1>
      {error ? <p role="alert">Error: {error}</p> : null}
      <p>
        {cart.items?.length ?? 0} item(s), total {total} {cart.totalPrice?.currency ?? ""}
      </p>

      <form action={submitCheckout}>
        <fieldset>
          <legend>Contact</legend>
          <input
            name="email"
            type="email"
            placeholder="email"
            required
            defaultValue={pickText(me?.contactEmail, "")}
          />
          <input
            name="firstName"
            placeholder="first name"
            required
            defaultValue={pickText(me?.firstName, "")}
          />
          <input
            name="lastName"
            placeholder="last name"
            required
            defaultValue={pickText(me?.lastName, "")}
          />
        </fieldset>

        <fieldset>
          <legend>Address{saved ? " (prefilled from your account)" : ""}</legend>
          <input name="street" placeholder="street" required defaultValue={saved?.street ?? ""} />
          <input name="streetNumber" placeholder="no." defaultValue={saved?.streetNumber ?? ""} />
          <input name="zipCode" placeholder="zip" required defaultValue={saved?.zipCode ?? ""} />
          <input name="city" placeholder="city" required defaultValue={saved?.city ?? ""} />
          <input
            name="country"
            placeholder="country"
            required
            defaultValue={saved?.country ?? targetLocation}
          />
        </fieldset>

        <fieldset>
          <legend>Shipping</legend>
          {methods.length === 0 ? (
            <p>No configured method for {targetLocation} — free shipping applies.</p>
          ) : (
            methods.map((m, i) => (
              <label key={m.id}>
                <input type="radio" name="methodId" value={m.id} defaultChecked={i === 0} />
                {label(m.name, m.id)} — {pickFee(m.fees, total)?.cost.amount ?? 0}
              </label>
            ))
          )}
        </fieldset>

        <fieldset>
          <legend>Payment</legend>
          {modes.length === 0 ? (
            <p>
              No configured payment mode — the order goes out with the <code>custom</code> provider
              and lands in <code>IN_CHECKOUT</code>.
            </p>
          ) : (
            modes.map((m, i) => (
              <label key={m.id ?? i}>
                <input type="radio" name="modeId" value={m.id ?? ""} defaultChecked={i === 0} />
                {m.code ?? m.id ?? "mode"}
              </label>
            ))
          )}
        </fieldset>

        <button type="submit">Place order</button>
      </form>
    </main>
  );
}
