"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { STORAGE_KEYS, withEmporixSessionMutable } from "@viu/emporix-sdk-next/bff";
import { EMPORIX } from "../emporix";

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
 * `carts.create` returns `CartCreated` with `.cartId` — not `.id`, which is what
 * `carts.getCurrent` returns. The two shapes are not interchangeable.
 */
export async function addToCart(productId: string): Promise<void> {
  await withEmporixSessionMutable(async (client, ctx) => {
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

    const jar = await cookies();
    let cartId = jar.get(STORAGE_KEYS.cartId)?.value ?? null;
    if (cartId === null) {
      const created = await client.carts.create({ currency: match.currency }, ctx);
      cartId = created.cartId;
      jar.set(STORAGE_KEYS.cartId, cartId, { httpOnly: true, sameSite: "lax", path: "/" });
    }

    await client.carts.addItem(
      cartId,
      {
        itemYrn: `urn:yaas:hybris:product:product:${client.tenant};${productId}`,
        quantity: 1,
        price: {
          priceId: match.priceId,
          originalAmount: amount,
          effectiveAmount: amount,
          currency: match.currency,
        },
      },
      ctx,
    );
  }, EMPORIX);
  revalidatePath("/cart");
  revalidatePath("/");
}
