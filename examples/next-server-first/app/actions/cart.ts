"use server";

import { revalidatePath } from "next/cache";
import {
  SESSION_MAX_AGE,
  STORAGE_KEYS,
  withEmporixSessionMutable,
} from "@viu/emporix-sdk-next/session";
import { EMPORIX, SITE } from "../emporix";

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
export async function addToCart(productId: string): Promise<void> {
  await withEmporixSessionMutable(async (client, ctx, jar) => {
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

    // The jar the wrapper hands over, not one of our own: a second jar mints a
    // second session id and needs its own flush.
    let cartId = jar.get(STORAGE_KEYS.cartId);
    if (cartId === null) {
      // `getCurrent({ create: true })`, not `create`: a customer may hold only
      // one open cart, and a blind create answers 409 when they already have
      // one — which is exactly what happens after a checkout closed the last.
      const cart = await client.carts.getCurrent(ctx, { siteCode: SITE.siteCode, create: true });
      cartId = cart?.id ?? null;
      if (cartId === null) throw new Error("Emporix returned no cart");
      jar.set(STORAGE_KEYS.cartId, cartId, SESSION_MAX_AGE.cartId);
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
