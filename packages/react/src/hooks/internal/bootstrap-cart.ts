import type { QueryClient } from "@tanstack/react-query";
import type { AuthContext, Cart, EmporixClient } from "@viu/emporix-sdk";

/**
 * Shared cart-bootstrap helper. Wraps `client.carts.getCurrent({create:true})`
 * in a `qc.fetchQuery` so concurrent callers (useActiveCart mount races, login
 * cart-onboarding) share one cache entry and trigger a single server call.
 *
 * Cache key omits `cartId` deliberately — bootstrap is the operation that
 * *creates* the cart-id. The fetched Cart's `id` is then written into the
 * storage by the caller; subsequent `useCart(id)` reads use their own
 * per-id cache key.
 *
 * `staleTime: Infinity` is safe because:
 *   - useActiveCart's effect gates on `storage.cartId !== null` — won't run
 *     bootstrap when storage already has one.
 *   - Logout / discard clears `storage.cartId` AND
 *     `qc.removeQueries(["emporix"])`, dropping the cache entry.
 *   - Default `gcTime: 5min` evicts naturally on idle.
 */
export async function bootstrapCart(opts: {
  qc: QueryClient;
  client: EmporixClient;
  ctx: AuthContext;
  siteCode: string;
  type?: string;
  legalEntityId?: string;
}): Promise<Cart | null> {
  return opts.qc.fetchQuery({
    queryKey: [
      "emporix",
      "cart-bootstrap",
      {
        tenant: opts.client.tenant,
        // ctx.kind is the discriminator of AuthContext — same string as the
        // legacy `authKind` param, derived directly so callers can't drift.
        authKind: opts.ctx.kind,
        siteCode: opts.siteCode,
        ...(opts.type !== undefined ? { type: opts.type } : {}),
        ...(opts.legalEntityId !== undefined ? { legalEntityId: opts.legalEntityId } : {}),
      },
    ],
    queryFn: () =>
      opts.client.carts.getCurrent(opts.ctx, {
        siteCode: opts.siteCode,
        ...(opts.type !== undefined ? { type: opts.type } : {}),
        ...(opts.legalEntityId !== undefined ? { legalEntityId: opts.legalEntityId } : {}),
        create: true,
      }),
    staleTime: Infinity,
  });
}
