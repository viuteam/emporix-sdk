import type { Metadata } from "next";
import Link from "next/link";
import { EmporixNotFoundError, pickFee, resolveZone, type Address } from "@viu/emporix-sdk";
import { money, pickText } from "@viu/emporix-examples-shared";
import { STORAGE_KEYS, emporixSessionHandle, withEmporixSession } from "@viu/emporix-sdk-next/session";
import { SITE, STORE_OPT } from "../emporix";
import { Note, Sheet } from "../components/sheet";
import { submitCheckout } from "../actions/checkout";
import { siteContext, emporixOptions } from "../lib/site-context";

/** Per visitor — see the reasoning on `app/cart/page.tsx`. */
export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: true },
};

/** No cart, or one that Emporix no longer has. Same dead end for the shopper. */
function NoCart(): React.JSX.Element {
  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Step 2 of 2</p>
      <h1 style={{ marginBlock: "var(--s-2) var(--s-4)" }}>Checkout</h1>
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

/**
 * A field with a real `<label>`.
 *
 * All eight fields used to carry nothing but a `placeholder`. A placeholder is not a
 * label: it disappears as soon as you type, screen readers do not announce it
 * reliably, and anyone checking their entries afterwards can no longer see what goes
 * in which field. `.field__label` already existed in global.css for exactly this.
 */
function Field({
  name,
  label: text,
  type = "text",
  required = false,
  defaultValue = "",
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
}): React.JSX.Element {
  return (
    <p className="field">
      <label className="field__label" htmlFor={`f-${name}`}>
        {text}
      </label>
      <input
        id={`f-${name}`}
        name={name}
        type={type}
        className="input"
        required={required}
        defaultValue={defaultValue}
      />
    </p>
  );
}

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
  if (cartId === null) return <NoCart />;

  // ONE session, five parallel calls. Five separate withEmporixSession calls
  // would build five guest clients and redeem the same anonymous refresh token
  // five times over — see session-client.ts, newGuestClient.
  let data;
  try {
    data = await withEmporixSession(async (c, ctx) => {
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
  } catch (e) {
    // Checked out on another device: that closed this cart, and the id in this
    // session died with it. Offering a checkout form for a cart that no longer
    // exists is worse than saying so — the submit would 404 anyway.
    if (!(e instanceof EmporixNotFoundError)) throw e;
    return <NoCart />;
  }
  const { cart, modes, zones, addresses, me } = data;

  const total = cart.totalPrice?.amount ?? 0;
  // ponytail: the zone is resolved for the configured country only. Typing a
  // different country leaves this radio list stale — the action re-resolves and
  // wins. Upgrade path: a separate GET form for the country, or a client island.
  const zone = resolveZone(zones, targetLocation);
  const methods = zone?.methods ?? [];
  const saved = addresses.find((a) => a.isDefault) ?? addresses[0];

  const currency = cart.totalPrice?.currency ?? "";
  const items = cart.items?.length ?? 0;

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <Sheet
        meta={{
          route: "/checkout",
          render: "dynamic",
          because: "session cookie · searchParams",
        }}
        rail={
          <>
            <Note title="One session, five calls">
              The cart, the payment modes, the shipping zones, the saved addresses and
              the profile are read in a single <code>withEmporixSession</code>. Five
              separate calls would build five guest clients and redeem the same
              anonymous refresh token five times over.
            </Note>
            <Note title="Errors travel in the URL">
              This form redirects back with an <code>error</code> query parameter
              instead of holding state in a client component. It needs no JavaScript —
              and it writes error text into a shareable URL, which is a defect rather
              than a cosmetic difference. Both shapes are in this demo on purpose; the
              cart uses the other one.
            </Note>
          </>
        }
      >
        <p className="eyebrow">Step 2 of 2</p>
        <h1 style={{ marginBlock: "var(--s-2) var(--s-4)" }}>Checkout</h1>
        {error !== undefined && error !== "" ? (
          <p role="alert" className="tag tag--accent" style={{ marginBottom: "var(--s-4)" }}>
            {error}
          </p>
        ) : null}
        <p className="muted" style={{ marginBottom: "var(--s-6)" }}>
          {items} {items === 1 ? "item" : "items"} ·{" "}
          <span className="price">{money(total, currency)}</span>
        </p>

      {/* `.form-col` bounds the column. Without it the fields were as wide as the
          viewport — measured at 1440px, that is 1'190px for a postcode. */}
      <form action={submitCheckout} className="form-col form-col--wide">
        <fieldset className="fgroup">
          <legend className="fgroup__title serif">Contact</legend>
          <div className="stack">
            <Field
              name="email"
              label="Email"
              type="email"
              required
              defaultValue={pickText(me?.contactEmail, "")}
            />
            <div className="field-row field-row--even">
              <Field
                name="firstName"
                label="First name"
                required
                defaultValue={pickText(me?.firstName, "")}
              />
              <Field
                name="lastName"
                label="Last name"
                required
                defaultValue={pickText(me?.lastName, "")}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="fgroup">
          <legend className="fgroup__title serif">Address</legend>
          {saved ? (
            <p className="muted" style={{ marginBottom: "var(--s-4)" }}>
              Prefilled from your account.
            </p>
          ) : null}
          <div className="stack">
            <div className="field-row">
              <Field name="street" label="Street" required defaultValue={saved?.street ?? ""} />
              <Field name="streetNumber" label="Number" defaultValue={saved?.streetNumber ?? ""} />
            </div>
            <div className="field-row field-row--even">
              <Field name="zipCode" label="Postcode" required defaultValue={saved?.zipCode ?? ""} />
              <Field name="city" label="City" required defaultValue={saved?.city ?? ""} />
            </div>
            <Field
              name="country"
              label="Country"
              required
              defaultValue={saved?.country ?? targetLocation}
            />
          </div>
        </fieldset>

        <fieldset className="fgroup">
          <legend className="fgroup__title serif">Shipping</legend>
          {methods.length === 0 ? (
            <p className="muted">No configured method for {targetLocation} — free shipping applies.</p>
          ) : (
            methods.map((m, i) => (
              <label key={m.id} className="cluster" style={{ gap: "var(--s-3)" }}>
                <input type="radio" name="methodId" value={m.id} defaultChecked={i === 0} />
                <span>{label(m.name, m.id)}</span>
                <span className="price muted" style={{ marginLeft: "auto" }}>
                  {money(pickFee(m.fees, total)?.cost.amount ?? 0, currency)}
                </span>
              </label>
            ))
          )}
        </fieldset>

        <fieldset className="fgroup">
          <legend className="fgroup__title serif">Payment</legend>
          {modes.length === 0 ? (
            <p className="muted">
              No configured payment mode — the order goes out with the <code>custom</code> provider
              and lands in <code>IN_CHECKOUT</code>.
            </p>
          ) : (
            modes.map((m, i) => (
              <label key={m.id ?? i} className="cluster" style={{ gap: "var(--s-3)" }}>
                <input type="radio" name="modeId" value={m.id ?? ""} defaultChecked={i === 0} />
                <span>{m.code ?? m.id ?? "mode"}</span>
              </label>
            ))
          )}
        </fieldset>

        {/* «Place order» becomes «Order placed» on the page it leads to — the same
            word through the whole flow. */}
        <button
          type="submit"
          className="btn btn--accent btn--block"
          style={{ marginTop: "var(--s-6)" }}
        >
          Place order
        </button>
        </form>
      </Sheet>
    </main>
  );
}
