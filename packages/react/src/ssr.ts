import type { QueryClient } from "@tanstack/react-query";
import { auth, type AuthContext, type EmporixClient } from "@viu/emporix-sdk";

/**
 * Server-side prefetch of a product into a {@link QueryClient}, using the same
 * query key shape as `useProduct` so client hydration is a cache hit.
 * Create the `EmporixClient` once per server, never per request.
 */
export async function prefetchProduct(
  qc: QueryClient,
  client: EmporixClient,
  productId: string,
  authCtx: AuthContext = auth.anonymous(),
): Promise<void> {
  await qc.prefetchQuery({
    queryKey: ["emporix", "product", productId, { tenant: client.tenant, authKind: authCtx.kind }],
    queryFn: () => client.products.get(productId, undefined, authCtx),
  });
}

/**
 * Server-side prefetch of a cart. Pass the customer/anonymous context resolved
 * from the request (e.g. a token read from an httpOnly cookie).
 */
export async function prefetchCart(
  qc: QueryClient,
  client: EmporixClient,
  cartId: string,
  authCtx: AuthContext,
): Promise<void> {
  await qc.prefetchQuery({
    queryKey: ["emporix", "cart", cartId, { tenant: client.tenant, authKind: authCtx.kind }],
    queryFn: () => client.carts.get(cartId, authCtx),
  });
}

/**
 * Server-side prefetch of a single customer order. Writes the same cache key
 * `useOrder(orderId)` reads, so client hydration is a cache hit.
 */
export async function prefetchOrder(
  qc: QueryClient,
  client: EmporixClient,
  orderId: string,
  authCtx: AuthContext,
  opts: { saasToken?: string } = {},
): Promise<void> {
  await qc.prefetchQuery({
    queryKey: ["emporix", "orders", orderId, { tenant: client.tenant, authKind: authCtx.kind }],
    queryFn: () =>
      client.orders.get(orderId, authCtx, opts.saasToken ? { saasToken: opts.saasToken } : {}),
  });
}
