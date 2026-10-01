"use server";

import { revalidatePath } from "next/cache";
import {
  EmporixNotFoundError,
  errorFromResponse,
  type AuthContext,
  type Cart,
  type CartCommand,
  type CartCommandResult,
  type CartExecuteResult,
  type EmporixClient,
} from "@viu/emporix-sdk";
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

    // The add and the read-back in ONE request: the chain ends with `GetCart`, so the
    // count comes back with the write instead of costing a second billed call. That
    // count is what buys a shell that costs zero calls on every OTHER page view.
    const addAndRead: CartCommand[] = [{ type: "AddCartItem", data: item }, { type: "GetCart" }];
    let chain: CartExecuteResult;
    try {
      chain = await client.carts.execute(cartId, addAndRead, ctx);
    } catch (e) {
      // The same customer checking out on another device CLOSED this cart, and
      // this session still holds its id. Only the 404 tells us — so add first
      // and recover once, rather than verifying the cart on every add, which
      // would cost a billed call each time for the rare case.
      //
      // No cart read first, unlike `mutateCart`: this 404 is the cart's. The add
      // names no line and no coupon, and what else it can miss — the product,
      // the price — answers 400 (measured on `viu` 2026-09-30). The chain stops
      // at the failed add (`onError` defaults to `fail`) and throws that 404.
      if (!(e instanceof EmporixNotFoundError)) throw e;
      clearCart(handle);
      cartId = await freshCart(client, ctx, handle);
      chain = await client.carts.execute(cartId, addAndRead, ctx);
    }
    setCart(handle, cartId, chain.results.at(-1)?.data as Cart);
  }, await emporixOptions());
  // The ROUTE PATTERN, not a URL: these pages moved under `/[lang]/…` on 2026-08-06 and
  // `revalidatePath("/cart")` has pointed at nothing since. The pattern form covers both
  // languages, which matters because a Server Action gets no route params — see the
  // «How far `lang` is threaded» section of the design record.
  revalidatePath("/[lang]/cart", "page");
  revalidatePath("/[lang]", "page");
}

/** A chain command that answered 2xx. */
function succeeded(r: CartCommandResult | undefined): boolean {
  return r !== undefined && r.code >= 200 && r.code < 300;
}

/** The error the failed command's REST call would have thrown. */
function commandError(r: CartCommandResult | undefined): Error {
  return r === undefined
    ? new Error("Emporix answered the chain without a result for this command.")
    : errorFromResponse(r.code, `${r.type} → ${r.code}`, r.data);
}

/**
 * The shared frame for every cart mutation: find the cart, send the mutation and a
 * cart read as ONE request, pull the count forward, revalidate — and return the error
 * instead of throwing it.
 *
 * One frame rather than four copies, because the count and the two
 * `revalidatePath` calls are exactly the kind of thing that drifts when repeated.
 */
async function mutateCart(command: CartCommand): Promise<ActionState> {
  try {
    await withEmporixSessionMutable(async (client, ctx, handle) => {
      const cartId = handle.get(STORAGE_KEYS.cartId);
      if (cartId === null) throw new Error("No cart to change.");
      // The mutation and the cart read go out as one chain, and `resume` runs the read
      // even when the mutation fails. The count comes from that read, not from the
      // mutation's answer: those answers carry no `id` — an earlier version passed one
      // straight to setCart and a quantity change deleted the cart out of the session —
      // and their `items` is just as unverified.
      //
      // The read also settles what a failure meant. A 404 does not say WHAT is gone:
      // Emporix answers a line another tab already removed, and a coupon code it does
      // not know, with the same 404 as a cart a checkout closed elsewhere — measured on
      // `viu` 2026-09-30. Only the cart read is unambiguous: its 404 drops the id;
      // anything else keeps it, with the read's count when there is one. Dropped here,
      // inside the mutable pass, so the next page view starts from an empty bag instead
      // of the same 404 forever; the wrapper flushes even though this throws.
      const [write, read] = (
        await client.carts.execute(cartId, [command, { type: "GetCart" }], ctx, { onError: "resume" })
      ).results;
      if (read !== undefined && succeeded(read)) setCart(handle, cartId, read.data as Cart);
      else if (read?.code === 404) clearCart(handle);
      if (!succeeded(write)) throw commandError(write);
      if (!succeeded(read)) throw commandError(read);
    }, await emporixOptions());
  } catch (e) {
    return { error: describeError(e) };
  }
  // The ROUTE PATTERN, not a URL: these pages moved under `/[lang]/…` on 2026-08-06 and
  // `revalidatePath("/cart")` has pointed at nothing since. The pattern form covers both
  // languages, which matters because a Server Action gets no route params — see the
  // «How far `lang` is threaded» section of the design record.
  revalidatePath("/[lang]/cart", "page");
  revalidatePath("/[lang]", "page");
  return { error: null };
}

/**
 * The form-shaped add, so a product tile can use `ActionForm` like every other cart
 * mutation in this demo.
 *
 * Two things come out of that. The shell learns the cart changed — `ActionForm` signals
 * it, and the header badge is a client island that cannot see a Server Action otherwise.
 * And a failed add becomes an inline message instead of an error page, which is what the
 * four mutations below have done all along.
 */
export async function addToCartAction(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await addToCart(String(form.get("productId")));
  } catch (e) {
    return { error: describeError(e) };
  }
  return { error: null };
}

export async function setQuantity(_state: ActionState, form: FormData): Promise<ActionState> {
  const itemId = String(form.get("itemId"));
  const quantity = Number(form.get("quantity"));
  // Checked here, not just by the input's `min`: the number arrives from a form
  // and `<input min>` is a hint to the browser, not a guarantee to the server.
  if (!Number.isInteger(quantity) || quantity < 1) return { error: "Quantity must be 1 or more." };
  // `partial: true` sends the quantity alone. Without it the update replaces the
  // whole line and Emporix wants `itemYrn` and the price row back with it.
  return mutateCart({ type: "UpdateCartItem", data: { quantity }, options: { itemId, partial: true } });
}

export async function removeLine(_state: ActionState, form: FormData): Promise<ActionState> {
  const itemId = String(form.get("itemId"));
  return mutateCart({ type: "DeleteCartItem", options: { itemId } });
}

export async function applyCoupon(_state: ActionState, form: FormData): Promise<ActionState> {
  const code = String(form.get("code")).trim();
  if (code === "") return { error: "Enter a coupon code." };
  return mutateCart({ type: "ApplyCartDiscount", data: { code } });
}

export async function removeCoupon(_state: ActionState, form: FormData): Promise<ActionState> {
  const code = String(form.get("code"));
  return mutateCart({ type: "DeleteCartDiscounts", options: { codes: [code] } });
}
