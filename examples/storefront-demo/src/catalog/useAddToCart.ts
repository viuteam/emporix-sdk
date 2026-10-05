import { useActiveCart, useCartCommands, useEmporix } from "@viu/emporix-sdk-react";
import { productYrn, type PriceVM } from "../lib/adapters";
import { useToast, errorMessage } from "../app/Toasts";

/**
 * Adds a priced product in one request: the add, then the calculated cart, which
 * the hook writes straight into the cart cache.
 *
 * `create: true` bootstraps the visitor's cart on the first page that offers
 * «Add to cart», once per visitor, as the product page always did. Call this
 * hook once per page (the grid, the buy bar), never per card: twelve cards
 * bootstrapping at the same time would create twelve carts.
 */
export function useAddToCart() {
  const { client } = useEmporix();
  const { data: cart } = useActiveCart({ create: true });
  const cartId = (cart as { id?: string } | null)?.id;
  const chain = useCartCommands(cartId);
  const { notify } = useToast();

  async function add(productId: string, productName: string, price: PriceVM, quantity: number): Promise<void> {
    // Emporix requires a priceId on internal-type cart items.
    if (!price.priceId) return;
    try {
      await chain.mutateAsync({
        commands: [
          {
            type: "AddCartItem",
            data: {
              itemYrn: productYrn(client.tenant, productId),
              quantity,
              price: {
                priceId: price.priceId,
                originalAmount: price.amount,
                effectiveAmount: price.amount,
                currency: price.currency,
              },
            },
          },
          { type: "GetCart" },
        ],
      });
      notify(`Added ${quantity} × ${productName} to your cart`, "success");
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  return { add, isPending: chain.isPending };
}
