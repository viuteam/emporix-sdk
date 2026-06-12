import type { QueryClient } from "@tanstack/react-query";
import { auth, type AuthContext, type EmporixClient } from "@viu/emporix-sdk";
import { emporixKey } from "./hooks/internal/query-keys";

/** Site/language discriminators for SSR prefetch keys. MUST mirror what the
 * client's `useReadSite()` will resolve to at hydration time — `null` when the
 * client mounts without a bound site (the default), the actual codes when the
 * provider is mounted with `initialSiteCode`/`initialLanguage`. */
export interface PrefetchSiteOpts {
  siteCode?: string | null;
  language?: string | null;
}

/**
 * Server-side prefetch of a product into a {@link QueryClient}, using the same
 * query key shape as `useProduct` (built through the shared `emporixKey`) so
 * client hydration is a cache hit. Pass `siteCode`/`language` to match a
 * provider mounted with a bound site; omit them when the client mounts without
 * one (both resolve to `null`, the `useReadSite()` default).
 * Create the `EmporixClient` once per server, never per request.
 */
export async function prefetchProduct(
  qc: QueryClient,
  client: EmporixClient,
  productId: string,
  authCtx: AuthContext = auth.anonymous(),
  opts: PrefetchSiteOpts = {},
): Promise<void> {
  await qc.prefetchQuery({
    queryKey: emporixKey("product", [productId], {
      tenant: client.tenant,
      authKind: authCtx.kind,
      siteCode: opts.siteCode ?? null,
      language: opts.language ?? null,
    }),
    queryFn: () => client.products.get(productId, undefined, authCtx),
  });
}

/**
 * Server-side prefetch of a cart. Pass the customer/anonymous context resolved
 * from the request (e.g. a token read from an httpOnly cookie). `activeCompanyId`
 * mirrors the B2B active legal entity carried in `useCart`'s key.
 */
export async function prefetchCart(
  qc: QueryClient,
  client: EmporixClient,
  cartId: string,
  authCtx: AuthContext,
  opts: PrefetchSiteOpts & { activeCompanyId?: string | null } = {},
): Promise<void> {
  await qc.prefetchQuery({
    queryKey: emporixKey("cart", [cartId, opts.activeCompanyId ?? null], {
      tenant: client.tenant,
      authKind: authCtx.kind,
      siteCode: opts.siteCode ?? null,
      language: opts.language ?? null,
    }),
    queryFn: () => client.carts.get(cartId, authCtx),
  });
}

/**
 * Server-side prefetch of a single customer order. Writes the same cache key
 * `useOrder(orderId)` reads, so client hydration is a cache hit. Note: `useOrder`
 * keys WITHOUT `siteCode` (language only) — keep in sync.
 */
export async function prefetchOrder(
  qc: QueryClient,
  client: EmporixClient,
  orderId: string,
  authCtx: AuthContext,
  opts: { saasToken?: string; language?: string | null } = {},
): Promise<void> {
  await qc.prefetchQuery({
    queryKey: emporixKey("orders", [orderId], {
      tenant: client.tenant,
      authKind: authCtx.kind,
      language: opts.language ?? null,
    }),
    queryFn: () =>
      client.orders.get(orderId, authCtx, opts.saasToken ? { saasToken: opts.saasToken } : {}),
  });
}
