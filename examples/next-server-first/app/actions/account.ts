"use server";

import { revalidatePath } from "next/cache";
import type { AuthContext, EmporixClient } from "@viu/emporix-sdk";
import { STORAGE_KEYS, withEmporixSessionMutable } from "@viu/emporix-sdk-next/session";
import { SITE } from "../emporix";
import { describeError } from "../lib/describe-error";
import type { ActionState } from "../components/action-form";
import { missingField, readAddress } from "../lib/address-fields";
import { orderItems, priceForProduct, productYrn } from "@viu/emporix-examples-shared";
import { setCart } from "../lib/cart-session";
import { emporixOptions } from "../lib/site-context";

/**
 * Profile fields, measured rather than guessed: `firstName`, `lastName`,
 * `contactEmail`, `contactPhone` — read off
 * `storefront-demo/src/account/ProfileForm.tsx`, which runs against the real
 * tenant. `email` exists on the shape and is empty.
 */
export async function updateProfile(_state: ActionState, form: FormData): Promise<ActionState> {
  const firstName = String(form.get("firstName")).trim();
  const lastName = String(form.get("lastName")).trim();
  if (firstName === "" || lastName === "") return { error: "First and last name are required." };
  const contactEmail = String(form.get("contactEmail") ?? "").trim();
  const contactPhone = String(form.get("contactPhone") ?? "").trim();

  try {
    await withEmporixSessionMutable(
      // All four fields go out, empty ones included. Skipping the empty ones was
      // the first version and it was wrong: this form always submits all four, so
      // «empty» means the shopper cleared it — and a mistyped phone number could
      // never be removed. Skipping is right for a partial patch, not for a form
      // that shows every field it owns.
      (client, ctx) =>
        client.customers.update({ firstName, lastName, contactEmail, contactPhone }, ctx),
      await emporixOptions(),
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account");
  revalidatePath("/account/profile");
  return { error: null };
}

/**
 * `currentPassword`, not `oldPassword`. Measured against
 * `storefront-demo/src/account/PasswordForm.tsx:23`, where the call is live —
 * the wrong name yields a 400 whose body does not say which field it meant.
 */
export async function changePassword(_state: ActionState, form: FormData): Promise<ActionState> {
  const currentPassword = String(form.get("currentPassword"));
  const newPassword = String(form.get("newPassword"));
  if (newPassword.length < 8) return { error: "The new password needs at least 8 characters." };
  if (newPassword === currentPassword) return { error: "That is the current password." };

  try {
    await withEmporixSessionMutable(
      (client, ctx) => client.customers.changePassword({ currentPassword, newPassword }, ctx),
      await emporixOptions(),
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  // Nothing to revalidate: no rendered value changed.
  return { error: null };
}

/** The shared frame for the three address mutations. */
async function mutateAddresses(
  fn: (client: EmporixClient, ctx: AuthContext) => Promise<unknown>,
): Promise<ActionState> {
  try {
    await withEmporixSessionMutable((client, ctx) => fn(client, ctx), await emporixOptions());
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account/addresses");
  return { error: null };
}

export async function addAddress(_state: ActionState, form: FormData): Promise<ActionState> {
  const address = readAddress(form);
  const problem = missingField(address);
  if (problem !== null) return { error: problem };
  return mutateAddresses((client, ctx) => client.customers.addresses.add(address, ctx));
}

export async function updateAddress(_state: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id"));
  const address = readAddress(form);
  const problem = missingField(address);
  if (problem !== null) return { error: problem };
  return mutateAddresses((client, ctx) => client.customers.addresses.update(id, address, ctx));
}

export async function deleteAddress(_state: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id"));
  return mutateAddresses((client, ctx) => client.customers.addresses.remove(id, ctx));
}

/**
 * Cancels an order.
 *
 * `orders.cancel` takes an optional `saasToken`, and in this mode that token
 * lives in the session and must never reach the browser. Same mechanism as the
 * checkout, and the reason this has to be a Server Action rather than a fetch
 * from a client component.
 */
export async function cancelOrder(_state: ActionState, form: FormData): Promise<ActionState> {
  const orderId = String(form.get("orderId"));
  try {
    await withEmporixSessionMutable(async (client, ctx, jar) => {
      const saasToken = jar.get(STORAGE_KEYS.saasToken);
      await client.orders.cancel(orderId, ctx, saasToken !== null ? { saasToken } : {});
    }, await emporixOptions());
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account/orders");
  revalidatePath(`/account/orders/${orderId}`);
  return { error: null };
}

/**
 * Puts an order's lines back into the cart.
 *
 * Prices are resolved fresh rather than copied off the order: Emporix requires a
 * `priceId` on internal cart items, and an order's price row can be months old.
 * What the shopper pays is today's price, which is also the only one the cart will
 * accept.
 */
export async function reorder(_state: ActionState, form: FormData): Promise<ActionState> {
  const orderId = String(form.get("orderId"));
  try {
    await withEmporixSessionMutable(async (client, ctx, jar) => {
      const order = await client.orders.get(orderId, ctx);
      const lines = orderItems(order).filter((i) => i.productId !== "" && i.quantity > 0);
      if (lines.length === 0) throw new Error("This order has no items to reorder.");

      const matches = await client.prices.matchByContext(
        {
          items: lines.map((i) => ({
            itemId: { itemType: "PRODUCT", id: i.productId },
            quantity: { quantity: i.quantity },
          })),
        },
        ctx,
      );

      const items = lines.flatMap((i) => {
        const price = priceForProduct(matches, i.productId);
        // A product that lost its price cannot go back in the cart. Skipping it
        // silently would be worse than saying so.
        if (price?.priceId === undefined) return [];
        return [
          {
            itemYrn: productYrn(client.tenant, i.productId),
            quantity: i.quantity,
            price: {
              priceId: price.priceId,
              originalAmount: price.amount,
              effectiveAmount: price.amount,
              currency: price.currency,
            },
          },
        ];
      });
      if (items.length === 0) throw new Error("None of these products is priced today.");

      let cartId = jar.get(STORAGE_KEYS.cartId);
      if (cartId === null) {
        // `getCurrent({ create: true })`, not `create`: a customer may hold only
        // one open cart and a blind create answers 409.
        const cart = await client.carts.getCurrent(ctx, { siteCode: SITE.siteCode, create: true });
        cartId = cart?.id ?? null;
        if (cartId === null) throw new Error("Emporix returned no cart.");
      }
      // A bare array, not `{ items }` — `addItemsBatch` sends the body as given.
      await client.carts.addItemsBatch(cartId, items, ctx);
      setCart(jar, cartId, await client.carts.get(cartId, ctx));
    }, await emporixOptions());
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/cart");
  revalidatePath("/");
  return { error: null };
}
