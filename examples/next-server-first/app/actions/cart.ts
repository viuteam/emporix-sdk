"use server";

import { revalidatePath } from "next/cache";
import { EmporixNotFoundError, type AuthContext, type EmporixClient } from "@viu/emporix-sdk";
import {
  STORAGE_KEYS,
  withEmporixSessionMutable,
  type EmporixSessionHandle,
} from "@viu/emporix-sdk-next/session";
import { clearCart, setCart } from "../lib/cart-session";
import { describeError } from "../lib/describe-error";
import type { ActionState } from "../components/action-form";
import { SITE } from "../emporix";
import { emporixOptions } from "../lib/site-context";

/** The matched-price fields the cart needs. Read loosely — the generated type is wider. */
interface MatchedPrice {
  priceId?: string;
  currency?: string;
  effectiveValue?: number;
  totalValue?: number;
}

/**
 * Adds a product to the guest or customer cart.
 *
 * The price is resolved HERE, on the server, because Emporix requires a
 * `priceId` on internal-type cart items — and not every product has a price in
 * every context. A product without one cannot be added, which is a real
 * condition rather than an error to swallow.
 *
 * The cart itself comes from `carts.getCurrent({ create: true })`, which returns
 * a `Cart` with `.id`. `carts.create` would return `CartCreated` with `.cartId`
 * — different shape, and it 409s for a customer who already has an open cart.
 */
/**
 * `getCurrent({ create: true })`, persisted. Not `create`: a customer may hold
 * only one open cart, and a blind create answers 409 when they already have one
 * — which is exactly what happens after a checkout closed the last.
 */
async function freshCart(
  client: EmporixClient,
  ctx: AuthContext,
  handle: EmporixSessionHandle,
): Promise<string> {
  const cart = await client.carts.getCurrent(ctx, { siteCode: SITE.siteCode, create: true });
  const id = cart?.id ?? null;
  if (id === null) throw new Error("Emporix returned no cart");
  // setCart, not handle.set: it writes the shell's line count alongside the id.
  setCart(handle, id, cart ?? undefined);
  return id;
}

export async function addToCart(productId: string): Promise<void> {
  await withEmporixSessionMutable(async (client, ctx, handle) => {
    const matches = await client.prices.matchByContext(
      { items: [{ itemId: { itemType: "PRODUCT", id: productId }, quantity: { quantity: 1 } }] },
      ctx,
    );
    const match = matches[0] as MatchedPrice | undefined;
    const amount = match?.effectiveValue ?? match?.totalValue;
    if (!match?.priceId || amount === undefined || !match.currency) {
      throw new Error(
        `No price for product ${productId} in this context. Not every product is priced — ` +
          "use one from the category the README names.",
      );
    }

    const item = {
      itemYrn: `urn:yaas:hybris:product:product:${client.tenant};${productId}`,
      quantity: 1,
      price: {
        priceId: match.priceId,
        originalAmount: amount,
        effectiveAmount: amount,
        currency: match.currency,
      },
    };

    // The handle the wrapper hands over, not one of our own: a second handle mints a
    // second session id and needs its own flush.
    let cartId = handle.get(STORAGE_KEYS.cartId);
    if (cartId === null) cartId = await freshCart(client, ctx, handle);

    try {
      await client.carts.addItem(cartId, item, ctx);
    } catch (e) {
      // The same customer checking out on another device CLOSED this cart, and
      // this session still holds its id. Only the 404 tells us — so add first
      // and recover once, rather than verifying the cart on every add, which
      // would cost a billed call each time for the rare case.
      if (!(e instanceof EmporixNotFoundError)) throw e;
      clearCart(handle);
      cartId = await freshCart(client, ctx, handle);
      await client.carts.addItem(cartId, item, ctx);
    }

    // `addItem` returns nothing useful, so read the cart back for the count.
    // One extra GET per add, which is what buys a shell that costs zero calls on
    // every OTHER page view.
    setCart(handle, cartId, await client.carts.get(cartId, ctx));
  }, await emporixOptions());
  revalidatePath("/cart");
  revalidatePath("/");
}

/**
 * The shared frame for every cart mutation: find the cart, mutate it, pull the
 * count forward, revalidate — and return the error instead of throwing it.
 *
 * One frame rather than four copies, because the count and the two
 * `revalidatePath` calls are exactly the kind of thing that drifts when repeated.
 */
async function mutateCart(
  fn: (client: EmporixClient, ctx: AuthContext, cartId: string) => Promise<unknown>,
): Promise<ActionState> {
  try {
    await withEmporixSessionMutable(async (client, ctx, handle) => {
      const cartId = handle.get(STORAGE_KEYS.cartId);
      if (cartId === null) throw new Error("No cart to change.");
      try {
        await fn(client, ctx, cartId);
        // Re-read rather than trusting what the mutation answered. Those answers
        // carry no `id` — the earlier version passed one straight to setCart and a
        // quantity change deleted the cart out of the session. Their `items` is
        // just as unverified, so this pays one GET per mutation for a count that
        // is actually right.
        setCart(handle, cartId, await client.carts.get(cartId, ctx));
      } catch (e) {
        // Closed elsewhere. Drop it here, inside the mutable pass, so the next
        // page view starts from an empty bag instead of the same 404 forever.
        // The wrapper flushes even though this rethrows.
        if (e instanceof EmporixNotFoundError) clearCart(handle);
        throw e;
      }
    }, await emporixOptions());
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/cart");
  revalidatePath("/");
  return { error: null };
}

export async function setQuantity(_state: ActionState, form: FormData): Promise<ActionState> {
  const itemId = String(form.get("itemId"));
  const quantity = Number(form.get("quantity"));
  // Checked here, not just by the input's `min`: the number arrives from a form
  // and `<input min>` is a hint to the browser, not a guarantee to the server.
  if (!Number.isInteger(quantity) || quantity < 1) return { error: "Quantity must be 1 or more." };
  return mutateCart((client, ctx, cartId) =>
    // `partial: true` sends the quantity alone. Without it the PUT replaces the
    // whole line and Emporix wants `itemYrn` and the price row back with it.
    client.carts.updateItem(cartId, itemId, { quantity }, ctx, { partial: true }),
  );
}

export async function removeLine(_state: ActionState, form: FormData): Promise<ActionState> {
  const itemId = String(form.get("itemId"));
  return mutateCart((client, ctx, cartId) => client.carts.removeItem(cartId, itemId, ctx));
}

export async function applyCoupon(_state: ActionState, form: FormData): Promise<ActionState> {
  const code = String(form.get("code")).trim();
  if (code === "") return { error: "Enter a coupon code." };
  return mutateCart((client, ctx, cartId) => client.carts.applyCoupon(cartId, code, ctx));
}

export async function removeCoupon(_state: ActionState, form: FormData): Promise<ActionState> {
  const code = String(form.get("code"));
  return mutateCart((client, ctx, cartId) => client.carts.removeCoupon(cartId, code, ctx));
}
