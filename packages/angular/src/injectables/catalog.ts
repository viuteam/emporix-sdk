import { computed, type Injector, type Signal } from "@angular/core";
import type {
  CreateInfiniteQueryResult,
  CreateQueryResult,
  InfiniteData,
} from "@tanstack/angular-query-experimental";
import { injectEmporix } from "../provide";
import { injectEmporixInfinite, injectEmporixQuery } from "../inject-query";
import type {
  Category,
  EmporixClient,
  PaginatedItems,
  Product,
  QueryFor,
} from "@viu/emporix-sdk";

/**
 * Two return types the SDK does not export by name, derived from the methods
 * instead of guessed at.
 *
 * `Awaited<ReturnType<…>>` cannot drift: if the facade's return shape changes,
 * these follow. Both were originally written as `Category[]` and `Media[]` and the
 * typecheck rejected both — the tree returns nodes with children, and the media
 * endpoint paginates.
 */
type CategoryTreeResult = Awaited<ReturnType<EmporixClient["categories"]["tree"]>>;
/** One subtree, from `categories.getTree` — a node, not an array of them. */
type CategoryNodeResult = Awaited<ReturnType<EmporixClient["categories"]["getTree"]>>;
/** One entry of the product DTO's own `productMedia` array. */
type ProductMedia = NonNullable<(Product & { productMedia?: unknown[] })["productMedia"]>[number];

/**
 * Catalog reads.
 *
 * Every `site`, `mode` and `staleTime` here is copied from the React hook of the
 * same name rather than re-decided: the cache key must match across bindings, and
 * `site: "full"` versus `"language"` is part of that key. A read that carries the
 * wrong discriminators looks fine and quietly serves one site's catalog under
 * another site's key.
 *
 * `1 minute` for products, `5 minutes` for category structure — catalog listings
 * move with promotions, the tree does not.
 */
const PRODUCTS_STALE = 60_000;
const CATEGORIES_STALE = 5 * 60_000;

/** Options every catalog read accepts. */
export interface CatalogOpts {
  /** Passed through to the injectable's own injection-context requirement. */
  injector?: Injector;
  /** ANDed with the internal gate. */
  enabled?: boolean;
}

const pass = (o: CatalogOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};

// ─── Products ───────────────────────────────────────────────────────────────

/** One product by id. Disabled while the id is empty. */
export function injectProduct(
  id: Signal<string>,
  opts: CatalogOpts = {},
): CreateQueryResult<Product> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Product, readonly [string]>(
    () => ({
      resource: "product",
      args: [id()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && id() !== "",
      queryFn: (ctx) => client.products.get(id(), undefined, ctx),
      staleTime: PRODUCTS_STALE,
    }),
    pass(opts),
  );
}

/** One page of products. `totalCount` lands in the key — a totals request cannot be served a page that lacks them. */
export function injectProducts(
  params: Signal<{ pageNumber?: number; pageSize?: number; totalCount?: boolean }>,
  opts: CatalogOpts = {},
): CreateQueryResult<PaginatedItems<Product>> {
  const { client } = injectEmporix();
  return injectEmporixQuery<
    PaginatedItems<Product>,
    readonly [{ pageNumber?: number; pageSize?: number; totalCount?: boolean }]
  >(
    () => ({
      resource: "products",
      args: [params()] as const,
      site: "full",
      mode: "read-auth",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.products.list(params(), ctx),
      staleTime: PRODUCTS_STALE,
    }),
    pass(opts),
  );
}

/** The product list, paginated. Terminates on the server's `hasNextPage`. */
export function injectProductsInfinite(
  pageSize: Signal<number>,
  opts: CatalogOpts = {},
): CreateInfiniteQueryResult<InfiniteData<PaginatedItems<Product>, number>> {
  const { client } = injectEmporix();
  return injectEmporixInfinite<Product, readonly [number]>(
    () => ({
      resource: "products-infinite",
      args: [pageSize()] as const,
      site: "full",
      mode: "read-auth",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      fetchPage: (pageNumber, ctx) =>
        client.products.list({ pageNumber, pageSize: pageSize() }, ctx),
      staleTime: PRODUCTS_STALE,
    }),
    pass(opts),
  );
}

/** One product by its `code` (URL slug). Disabled while the code is empty. */
export function injectProductByCode(
  code: Signal<string>,
  opts: CatalogOpts = {},
): CreateQueryResult<Product> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Product, readonly [string]>(
    () => ({
      resource: "product-by-code",
      args: [code()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && code() !== "",
      queryFn: (ctx) => client.products.getByCode(code(), ctx),
      staleTime: PRODUCTS_STALE,
    }),
    pass(opts),
  );
}

/**
 * Free-text product search by name (builds the Emporix `name:(~…)` filter).
 *
 * Disabled while the term is blank rather than searching for nothing — an empty
 * typeahead keystroke should cost no billed call.
 *
 * Named after React's `useProductNameSearch`, and deliberately not
 * `injectProductSearch`: that name belongs to the filter search below, which is
 * a different endpoint. Getting these two the wrong way round is invisible —
 * both answer `PaginatedItems<Product>`.
 */
export function injectProductNameSearch(
  term: Signal<string>,
  params: Signal<{ pageNumber?: number; pageSize?: number }> = (() => ({})) as Signal<{
    pageNumber?: number;
    pageSize?: number;
  }>,
  opts: CatalogOpts = {},
): CreateQueryResult<PaginatedItems<Product>> {
  const { client } = injectEmporix();
  return injectEmporixQuery<
    PaginatedItems<Product>,
    readonly [string, { pageNumber?: number; pageSize?: number }]
  >(
    () => ({
      resource: "product-name-search",
      args: [term().trim(), params()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && term().trim() !== "",
      queryFn: (ctx) => client.products.searchByName(term().trim(), params(), ctx),
      staleTime: PRODUCTS_STALE,
    }),
    pass(opts),
  );
}

/**
 * A built Emporix filter query against products. Disabled while the filter is
 * empty. Matches React's `useProductSearch`.
 */
export function injectProductSearch(
  query: Signal<QueryFor<"PRODUCT"> | undefined>,
  params: Signal<{ pageNumber?: number; pageSize?: number; totalCount?: boolean }>,
  opts: CatalogOpts = {},
): CreateQueryResult<PaginatedItems<Product>> {
  const { client } = injectEmporix();
  return injectEmporixQuery<PaginatedItems<Product>, readonly [string, unknown]>(
    () => {
      const q = query();
      // The stringified filter is the key, not the builder object: two builders
      // that produce the same filter must share one cache entry.
      const asString = q === undefined ? "" : String(q);
      return {
        resource: "product-search",
        args: [asString, params()] as const,
        site: "full",
        mode: "read-auth",
        enabled: (opts.enabled ?? true) && asString.trim() !== "",
        queryFn: (ctx) => client.products.search(q as QueryFor<"PRODUCT">, params(), ctx),
        staleTime: PRODUCTS_STALE,
      };
    },
    pass(opts),
  );
}

/**
 * A product's media, derived from the product read — **not** a Media-Service call.
 *
 * `client.media.listForProduct` defaults to a service-account context and needs a
 * server-only scope, so a storefront calling it gets nothing back. The product DTO
 * already carries `productMedia`; reading it costs no extra request.
 *
 * This is why the return is a `Signal`, not a query result: there is no request of
 * its own to report on. Use the product query's `isPending()` for loading state.
 *
 * The first version of this function did call the Media Service, and the symptom
 * was a permanently pending image with no error — the React hook of the same name
 * carries the same warning for the same reason.
 */
export function injectProductMedia(
  productId: Signal<string>,
  opts: CatalogOpts = {},
): Signal<ProductMedia[] | undefined> {
  const product = injectProduct(productId, opts);
  return computed(
    () => (product.data() as { productMedia?: ProductMedia[] } | undefined)?.productMedia,
  );
}

/**
 * Bulk-fetches products by `code`.
 *
 * **Order is not guaranteed** — the SDK chunks the request, so re-index by
 * `code` if the caller depends on order. Disabled while `codes` is empty; the
 * facade short-circuits there too, but gating avoids an empty cache entry.
 */
export function injectProductsByCodes(
  codes: Signal<readonly string[]>,
  opts: CatalogOpts & { chunkSize?: number } = {},
): CreateQueryResult<Product[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Product[], readonly [string]>(
    () => {
      // Sorted and joined: the same set in a different order is the same query,
      // and the facade de-duplicates anyway.
      const list = [...codes()].sort();
      return {
        resource: "products-by-codes",
        args: [list.join(",")] as const,
        site: "full",
        mode: "read-auth",
        enabled: (opts.enabled ?? true) && list.length > 0,
        queryFn: (ctx) =>
          client.products.searchByCodes(
            list,
            opts.chunkSize !== undefined ? { chunkSize: opts.chunkSize } : {},
            ctx,
          ),
        staleTime: PRODUCTS_STALE,
      };
    },
    pass(opts),
  );
}

/**
 * Every VARIANT child of a PARENT_VARIANT product, flattened across pages.
 *
 * The facade loads all pages and answers `[]` rather than throwing when there
 * are none, so there is no infinite variant of this read to add.
 */
export function injectVariantChildren(
  parentVariantId: Signal<string>,
  params: Signal<{ pageSize?: number }>,
  opts: CatalogOpts = {},
): CreateQueryResult<Product[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Product[], readonly [string, { pageSize?: number }]>(
    () => ({
      resource: "variant-children",
      args: [parentVariantId(), params()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && parentVariantId() !== "",
      queryFn: (ctx) => client.products.listVariantChildren(parentVariantId(), params(), ctx),
      staleTime: PRODUCTS_STALE,
    }),
    pass(opts),
  );
}

// ─── Categories ─────────────────────────────────────────────────────────────

/** One category by id. */
export function injectCategory(
  id: Signal<string>,
  opts: CatalogOpts = {},
): CreateQueryResult<Category> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Category, readonly [string]>(
    () => ({
      resource: "category",
      args: [id()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && id() !== "",
      queryFn: (ctx) => client.categories.get(id(), ctx),
      staleTime: CATEGORIES_STALE,
    }),
    pass(opts),
  );
}

/** One page of categories. */
export function injectCategories(
  params: Signal<{ pageNumber?: number; pageSize?: number }>,
  opts: CatalogOpts = {},
): CreateQueryResult<PaginatedItems<Category>> {
  const { client } = injectEmporix();
  return injectEmporixQuery<
    PaginatedItems<Category>,
    readonly [{ pageNumber?: number; pageSize?: number }]
  >(
    () => ({
      resource: "categories",
      args: [params()] as const,
      site: "full",
      mode: "read-auth",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.categories.list(params(), ctx),
      staleTime: CATEGORIES_STALE,
    }),
    pass(opts),
  );
}

/** The whole category tree. One call, cached for five minutes. */
export function injectCategoryTree(
  opts: CatalogOpts = {},
): CreateQueryResult<CategoryTreeResult> {
  const { client } = injectEmporix();
  return injectEmporixQuery<CategoryTreeResult, readonly []>(
    () => ({
      resource: "category-tree",
      args: [] as const,
      site: "full",
      mode: "read-auth",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.categories.tree(ctx),
      staleTime: CATEGORIES_STALE,
    }),
    pass(opts),
  );
}

/** One page of categories, as an infinite query. Pages start at 1. */
export function injectCategoriesInfinite(
  pageSize: Signal<number>,
  opts: CatalogOpts = {},
): CreateInfiniteQueryResult<InfiniteData<PaginatedItems<Category>, number>> {
  const { client } = injectEmporix();
  return injectEmporixInfinite<Category, readonly [number]>(
    () => ({
      resource: "categories-infinite",
      args: [pageSize()] as const,
      site: "full",
      mode: "read-auth",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      fetchPage: (pageNumber, ctx) =>
        client.categories.list({ pageNumber, pageSize: pageSize() }, ctx),
      staleTime: CATEGORIES_STALE,
    }),
    pass(opts),
  );
}

/** Ancestors of a category, root first. Disabled while the id is empty. */
export function injectCategoryParents(
  categoryId: Signal<string>,
  opts: CatalogOpts = {},
): CreateQueryResult<Category[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Category[], readonly [string]>(
    () => ({
      resource: "category-parents",
      args: [categoryId()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && categoryId() !== "",
      queryFn: (ctx) => client.categories.parents(categoryId(), ctx),
      staleTime: CATEGORIES_STALE,
    }),
    pass(opts),
  );
}

/**
 * Direct children of a category, from `…/subcategories`.
 *
 * Not the same read as {@link injectSubcategories}, which goes through
 * category-to-category assignments. The SDK keeps both because tenants populate
 * them differently; this is the one to drill down with.
 */
export function injectChildCategories(
  categoryId: Signal<string>,
  opts: CatalogOpts = {},
): CreateQueryResult<Category[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Category[], readonly [string]>(
    () => ({
      resource: "child-categories",
      args: [categoryId()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && categoryId() !== "",
      queryFn: (ctx) => client.categories.childCategories(categoryId(), ctx),
      staleTime: CATEGORIES_STALE,
    }),
    pass(opts),
  );
}

/** Child categories via category-to-category assignments. See {@link injectChildCategories}. */
export function injectSubcategories(
  categoryId: Signal<string>,
  params: Signal<{ pageNumber?: number; pageSize?: number }>,
  opts: CatalogOpts = {},
): CreateQueryResult<Category[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<
    Category[],
    readonly [string, { pageNumber?: number; pageSize?: number }]
  >(
    () => ({
      resource: "subcategories",
      args: [categoryId(), params()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && categoryId() !== "",
      queryFn: (ctx) => client.categories.subcategories(categoryId(), params(), ctx),
      staleTime: CATEGORIES_STALE,
    }),
    pass(opts),
  );
}

/** A built Emporix filter query against categories. Disabled while the filter is empty. */
export function injectCategorySearch(
  query: Signal<QueryFor<"CATEGORY"> | undefined>,
  params: Signal<{ pageNumber?: number; pageSize?: number; totalCount?: boolean }>,
  opts: CatalogOpts = {},
): CreateQueryResult<PaginatedItems<Category>> {
  const { client } = injectEmporix();
  return injectEmporixQuery<PaginatedItems<Category>, readonly [string, unknown]>(
    () => {
      const q = query();
      // The stringified filter is the key, not the builder object: two builders
      // that produce the same filter must share one cache entry.
      const asString = q === undefined ? "" : String(q);
      return {
        resource: "category-search",
        args: [asString, params()] as const,
        site: "full",
        mode: "read-auth",
        enabled: (opts.enabled ?? true) && asString.trim() !== "",
        queryFn: (ctx) => client.categories.search(q as QueryFor<"CATEGORY">, params(), ctx),
        staleTime: CATEGORIES_STALE,
      };
    },
    pass(opts),
  );
}

/** The subtree below one category. Disabled while the id is empty. */
export function injectCategoryTreeById(
  categoryId: Signal<string>,
  opts: CatalogOpts = {},
): CreateQueryResult<CategoryNodeResult> {
  const { client } = injectEmporix();
  return injectEmporixQuery<CategoryNodeResult, readonly [string]>(
    () => ({
      resource: "category-tree-by-id",
      args: [categoryId()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && categoryId() !== "",
      queryFn: (ctx) => client.categories.getTree(categoryId(), ctx),
      staleTime: CATEGORIES_STALE,
    }),
    pass(opts),
  );
}

/** Products in a category, one page. */
export function injectProductsInCategory(
  categoryId: Signal<string>,
  params: Signal<{ pageNumber?: number; pageSize?: number }>,
  opts: CatalogOpts = {},
): CreateQueryResult<PaginatedItems<Product>> {
  const { client } = injectEmporix();
  return injectEmporixQuery<
    PaginatedItems<Product>,
    readonly [string, { pageNumber?: number; pageSize?: number }]
  >(
    () => ({
      resource: "products-in-category",
      args: [categoryId(), params()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && categoryId() !== "",
      queryFn: (ctx) => client.categories.productsIn(categoryId(), params(), ctx),
      staleTime: PRODUCTS_STALE,
    }),
    pass(opts),
  );
}

/** Products in a category, paginated. */
export function injectProductsInCategoryInfinite(
  categoryId: Signal<string>,
  pageSize: Signal<number>,
  opts: CatalogOpts = {},
): CreateInfiniteQueryResult<InfiniteData<PaginatedItems<Product>, number>> {
  const { client } = injectEmporix();
  return injectEmporixInfinite<Product, readonly [string, number]>(
    () => ({
      resource: "products-in-category-infinite",
      args: [categoryId(), pageSize()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && categoryId() !== "",
      fetchPage: (pageNumber, ctx) =>
        client.categories.productsIn(categoryId(), { pageNumber, pageSize: pageSize() }, ctx),
      staleTime: PRODUCTS_STALE,
    }),
    pass(opts),
  );
}
