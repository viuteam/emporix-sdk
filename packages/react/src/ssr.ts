import type { QueryClient } from "@tanstack/react-query";
import { auth, type AuthContext, type EmporixClient } from "@viu/emporix-sdk";
import { emporixKey, siteMeta, type SiteFields } from "./hooks/internal/query-keys";

export {
  createServerStorage,
  serverAuth,
  type ServerCookieJar,
} from "./storage/server";

/** Site/language discriminators for SSR prefetch keys. MUST mirror what the
 * client's `useReadSite()` will resolve to at hydration time — `null` when the
 * client mounts without a bound site (the default), the actual codes when the
 * provider is mounted with `initialSiteCode`/`initialLanguage`. */
export interface PrefetchSiteOpts {
  siteCode?: string | null;
  language?: string | null;
}

export type { SiteFields };

/**
 * Everything needed to reproduce a read hook's query key on the server.
 *
 * `resource`, `args` and `site` must match the hook's own descriptor — see the
 * table in `docs/react.md`. A mismatch is a silent cache miss: no error, just a
 * second fetch after hydration.
 */
export interface PrefetchEmporixOpts<T, TArgs extends readonly unknown[]> {
  client: EmporixClient;
  /** The hook's `resource` literal, e.g. `"product"`. */
  resource: string;
  /** The hook's `args` tuple, e.g. `[productId]`. */
  args: TArgs;
  /** Which site discriminators the hook puts in its key. */
  site: SiteFields;
  /** Defaults to `auth.anonymous()`. Use `serverAuth(storage)` to mirror the client. */
  auth?: AuthContext;
  /** Must match what the client provider binds; `null` (the default) = unbound. */
  siteCode?: string | null;
  language?: string | null;
  queryFn: (ctx: AuthContext) => Promise<T>;
}

/**
 * Server-side prefetch for any read hook whose key is built with `emporixKey`.
 * Writes the same cache entry the hook reads, so client hydration is a cache
 * hit. Create the `EmporixClient` once per server, never per request.
 *
 * `useAvailability` / `useAvailabilities` are NOT supported — their keys predate
 * `emporixKey` and use a different shape. See `docs/react.md`.
 */
export async function prefetchEmporix<T, TArgs extends readonly unknown[]>(
  qc: QueryClient,
  opts: PrefetchEmporixOpts<T, TArgs>,
): Promise<void> {
  const ctx = opts.auth ?? auth.anonymous();
  await qc.prefetchQuery({
    queryKey: emporixKey(opts.resource, opts.args, {
      tenant: opts.client.tenant,
      authKind: ctx.kind,
      ...siteMeta(opts.site, opts.siteCode ?? null, opts.language ?? null),
    }),
    queryFn: () => opts.queryFn(ctx),
  });
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
  await prefetchEmporix(qc, {
    client,
    resource: "product",
    args: [productId],
    site: "full",
    auth: authCtx,
    siteCode: opts.siteCode ?? null,
    language: opts.language ?? null,
    queryFn: (ctx) => client.products.get(productId, undefined, ctx),
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
  await prefetchEmporix(qc, {
    client,
    resource: "cart",
    args: [cartId, opts.activeCompanyId ?? null],
    site: "full",
    auth: authCtx,
    siteCode: opts.siteCode ?? null,
    language: opts.language ?? null,
    queryFn: (ctx) => client.carts.get(cartId, ctx),
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
  await prefetchEmporix(qc, {
    client,
    resource: "orders",
    args: [orderId],
    site: "language",
    auth: authCtx,
    language: opts.language ?? null,
    queryFn: (ctx) =>
      client.orders.get(orderId, ctx, opts.saasToken ? { saasToken: opts.saasToken } : {}),
  });
}
