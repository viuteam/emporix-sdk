/**
 * Every Emporix read this storefront makes, in one file.
 *
 * `@viu/emporix-sdk-angular` ships the foundation — `provideEmporix`,
 * `injectEmporixQuery`, `injectEmporixInfinite`, the site signals and the
 * customer session — but not yet the 33 injectables that mirror the React
 * hooks. Until they land, this is exactly what `docs/angular.md` tells you to
 * do: call the SDK through `injectEmporixQuery` yourself.
 *
 * So this file is two things at once. For the example it is the data layer. For
 * the package it is a blueprint: these wrappers are what `injectProduct`,
 * `injectCart` and the rest will look like, and writing them against a real
 * consumer first means the package's API is designed rather than guessed.
 *
 * Response *shapes* are not normalized here — `@viu/emporix-examples-shared`
 * already does that, framework-free, and getting it wrong is not hypothetical:
 * a cart line needs its price row echoed back on update, an order number lives
 * under `orderNumber` or in a mixin, and a matched price is keyed by `itemId` on
 * the wire but `itemRef` in the generated type.
 *
 * The one rule to keep in mind while reading: every signal read that should
 * drive a refetch sits **inside** the options callback. Read outside, the cache
 * key and the `enabled` gate freeze at construction.
 */
import type { Signal } from "@angular/core";
import {
  injectEmporix,
  injectEmporixInfinite,
  injectEmporixQuery,
} from "@viu/emporix-sdk-angular";
import { priceMatchItems, productName } from "@viu/emporix-examples-shared";
import type { Cart, Category, Order, PaginatedItems, PriceMatch, Product } from "@viu/emporix-sdk";

/** Catalog reads are shared across visitors and change rarely. */
const CATALOG_STALE = 60_000;

// ─── Catalog ────────────────────────────────────────────────────────────────

export function productQuery(id: Signal<string>) {
  const { client } = injectEmporix();
  return injectEmporixQuery<Product, readonly [string]>(() => ({
    resource: "product",
    args: [id()] as const,
    site: "full",
    mode: "read-auth",
    enabled: id() !== "",
    queryFn: (ctx) => client.products.get(id(), undefined, ctx),
    staleTime: CATALOG_STALE,
  }));
}

/**
 * The catalog, paginated. Pages start at 1 and stop when Emporix says so.
 *
 * `fetchPage` receives the page number — that is the whole difference between a
 * working infinite query and one that re-fetches page one forever.
 */
export function productsInfinite(pageSize = 12) {
  const { client } = injectEmporix();
  return injectEmporixInfinite<Product, readonly [number]>(() => ({
    resource: "products-infinite",
    args: [pageSize] as const,
    site: "full",
    mode: "read-auth",
    fetchPage: (pageNumber, ctx) => client.products.list({ pageNumber, pageSize }, ctx),
    staleTime: CATALOG_STALE,
  }));
}

/** Free-text search. Disabled while the term is empty, so typing costs nothing. */
export function productSearchQuery(term: Signal<string>, pageSize = 24) {
  const { client } = injectEmporix();
  return injectEmporixQuery<PaginatedItems<Product>, readonly [string]>(() => ({
    resource: "product-name-search",
    args: [term().trim()] as const,
    site: "full",
    mode: "read-auth",
    enabled: term().trim() !== "",
    queryFn: (ctx) => client.products.searchByName(term().trim(), { pageSize }, ctx),
    staleTime: CATALOG_STALE,
  }));
}

export function categoryQuery(id: Signal<string>) {
  const { client } = injectEmporix();
  return injectEmporixQuery<Category, readonly [string]>(() => ({
    resource: "category",
    args: [id()] as const,
    site: "language",
    mode: "read-auth",
    enabled: id() !== "",
    queryFn: (ctx) => client.categories.get(id(), ctx),
    staleTime: CATALOG_STALE,
  }));
}

/** Infinite product list for a category. Terminates on `hasNextPage: false`. */
export function productsInCategoryInfinite(categoryId: Signal<string>, pageSize = 12) {
  const { client } = injectEmporix();
  return injectEmporixInfinite<Product, readonly [string]>(() => ({
    resource: "products-in-category-infinite",
    args: [categoryId()] as const,
    site: "full",
    mode: "read-auth",
    enabled: categoryId() !== "",
    fetchPage: (pageNumber, ctx) =>
      client.categories.productsIn(categoryId(), { pageNumber, pageSize }, ctx),
    staleTime: CATALOG_STALE,
  }));
}

// ─── Prices ─────────────────────────────────────────────────────────────────

/**
 * Resolve prices for the products currently on screen.
 *
 * Separate from the product read on purpose: Emporix resolves price by currency,
 * site and target location, so a price is not a property of a product but of a
 * product *in a context*. Switching currency has to re-resolve prices without
 * re-fetching the catalog.
 */
export function priceQuery(products: Signal<readonly Product[]>) {
  const { client } = injectEmporix();
  return injectEmporixQuery<PriceMatch[], readonly [readonly string[]]>(() => {
    const items = priceMatchItems([...products()]);
    return {
      resource: "match-prices",
      args: [items.map((i) => i.itemId.id)] as const,
      site: "full",
      mode: "read-auth",
      enabled: items.length > 0,
      queryFn: (ctx) => client.prices.matchByContext({ items }, ctx),
      staleTime: 30_000,
    };
  });
}

// ─── Cart ───────────────────────────────────────────────────────────────────

export function cartQuery(cartId: Signal<string | null>) {
  const { client } = injectEmporix();
  return injectEmporixQuery<Cart, readonly [string | null]>(() => ({
    resource: "cart",
    args: [cartId()] as const,
    site: "full",
    mode: "read-auth",
    enabled: cartId() !== null,
    queryFn: (ctx) => client.carts.get(cartId() as string, ctx),
  }));
}

// ─── Checkout ───────────────────────────────────────────────────────────────

/**
 * Payment modes for the storefront.
 *
 * `read-auth`, not `customer`: the frontend payment-modes endpoint needs a
 * bearer token but no customer scope, so guests see the configured modes too.
 * Gating this on a customer token would hide payment options from every guest
 * checkout.
 */
export function paymentModesQuery() {
  const { client } = injectEmporix();
  return injectEmporixQuery<unknown, readonly []>(() => ({
    resource: "payment-modes",
    args: [] as const,
    site: "none",
    mode: "read-auth",
    queryFn: (ctx) => client.payments.listPaymentModes(ctx),
    staleTime: 5 * 60_000,
  }));
}

export function shippingZonesQuery(siteCode: Signal<string | null>) {
  const { client } = injectEmporix();
  return injectEmporixQuery<unknown, readonly [string | null]>(() => ({
    resource: "shipping-zones",
    args: [siteCode()] as const,
    site: "none",
    mode: "read-auth",
    enabled: siteCode() !== null,
    queryFn: (ctx) =>
      client.shipping.listZones(
        siteCode() as string,
        { expand: "methods,fees", activeMethods: "true" },
        ctx,
      ),
    staleTime: 5 * 60_000,
  }));
}

// ─── Account ────────────────────────────────────────────────────────────────

/**
 * The customer's orders, one page at a time.
 *
 * Page-number pagination rather than infinite, deliberately: an order history is
 * a table you jump around in, not a feed you scroll. `page` is a signal read
 * inside the options callback, so changing it re-keys and refetches — and each
 * page keeps its own cache entry, which is what makes going back instant.
 *
 * `customer` mode, so nothing is fetched for a guest.
 */
export function myOrdersQuery(page: Signal<number>, pageSize = 10) {
  const { client } = injectEmporix();
  return injectEmporixQuery<PaginatedItems<Order>, readonly [number, number]>(() => ({
    resource: "my-orders",
    args: [page(), pageSize] as const,
    site: "none",
    mode: "customer",
    queryFn: (ctx) => client.orders.listMine(ctx, { pageNumber: page(), pageSize }),
  }));
}

/**
 * Display names for cart lines.
 *
 * A cart item carries only an `itemYrn`, no product details, so a line whose
 * stored snapshot has no name renders blank without this. The React demo solves
 * it the same way — one bulk read, keyed on the sorted id set so two carts with
 * the same products share the entry.
 */
export function productNamesQuery(productIds: Signal<readonly string[]>) {
  const { client } = injectEmporix();
  return injectEmporixQuery<Record<string, string>, readonly [string]>(() => {
    const ids = [...new Set(productIds().filter(Boolean))].sort();
    return {
      resource: "product-names",
      args: [ids.join(",")] as const,
      site: "language",
      mode: "read-auth",
      enabled: ids.length > 0,
      queryFn: async (ctx) => {
        const products = await client.products.searchByIds(ids, undefined, ctx);
        const map: Record<string, string> = {};
        for (const p of products) {
          const id = (p as { id?: string }).id;
          if (id !== undefined) map[id] = productName(p);
        }
        return map;
      },
      staleTime: 5 * 60_000,
    };
  });
}

export function orderQuery(id: Signal<string>) {
  const { client } = injectEmporix();
  return injectEmporixQuery<Order, readonly [string]>(() => ({
    resource: "order",
    args: [id()] as const,
    site: "none",
    mode: "customer",
    enabled: id() !== "",
    queryFn: (ctx) => client.orders.get(id(), ctx),
  }));
}
