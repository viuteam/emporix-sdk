import { type Injector, type Signal } from "@angular/core";
import type {
  CreateInfiniteQueryResult,
  CreateQueryResult,
  InfiniteData,
} from "@tanstack/angular-query-experimental";
import type { Category, EmporixClient, PaginatedItems, Product } from "@viu/emporix-sdk";
import { injectEmporix } from "../provide";
import { injectEmporixInfinite, injectEmporixQuery } from "../inject-query";

type Segments = Awaited<ReturnType<EmporixClient["segments"]["list"]>>;
type SegmentItems = Awaited<ReturnType<EmporixClient["segments"]["listItems"]>>;
type SegmentCategoryTree = Awaited<ReturnType<EmporixClient["segments"]["getCategoryTree"]>>;
type SegmentsQuery = Parameters<EmporixClient["segments"]["list"]>[0];
type ItemsQuery = NonNullable<Parameters<EmporixClient["segments"]["listItems"]>[0]>;
type TreeQuery = Parameters<EmporixClient["segments"]["getCategoryTree"]>[0];

/**
 * Segment reads.
 *
 * **These are the one place in this package whose cache keys are not
 * byte-identical to React's.** React's segment hooks hand-roll
 * `["emporix", "segment", "list", { … }]` instead of calling `emporixKey`; these
 * go through `injectEmporixQuery` like every other read here, so their keys are
 * `["emporix", "segments", …]`. Closing the gap means fixing the React side, not
 * hand-rolling keys here — a hand-rolled key would also drop out of the
 * `["emporix"]`-scoped defaults and invalidation.
 *
 * 5 minutes: segment membership is admin-driven, not shopper-driven.
 */
const SEGMENTS_STALE = 5 * 60_000;

export interface SegmentOpts {
  injector?: Injector;
  enabled?: boolean;
}

const pass = (o: SegmentOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};

/** Segments the signed-in customer belongs to (`segment_read_own`). */
export function injectMySegments(
  query: Signal<SegmentsQuery>,
  opts: SegmentOpts = {},
): CreateQueryResult<Segments> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Segments, readonly [SegmentsQuery]>(
    () => ({
      resource: "segments",
      args: [query()] as const,
      site: "full",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.segments.list(query(), ctx),
      staleTime: SEGMENTS_STALE,
    }),
    pass(opts),
  );
}

/** Raw PRODUCT + CATEGORY assignments across the caller's active segments. */
export function injectMySegmentItems(
  query: Signal<ItemsQuery>,
  opts: SegmentOpts = {},
): CreateQueryResult<SegmentItems> {
  const { client } = injectEmporix();
  return injectEmporixQuery<SegmentItems, readonly [ItemsQuery]>(
    () => ({
      resource: "segment-items",
      args: [query()] as const,
      site: "full",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.segments.listItems(query(), ctx),
      staleTime: SEGMENTS_STALE,
    }),
    pass(opts),
  );
}

/**
 * One page of the caller's segment products, hydrated into real products.
 *
 * The facade resolves the assignments into products with one bulk lookup, so
 * this is a single read rather than an N+1.
 */
export function injectMySegmentProducts(
  query: Signal<ItemsQuery>,
  opts: SegmentOpts = {},
): CreateQueryResult<PaginatedItems<Product>> {
  const { client } = injectEmporix();
  return injectEmporixQuery<PaginatedItems<Product>, readonly [ItemsQuery]>(
    () => ({
      resource: "segment-products",
      args: [query()] as const,
      site: "full",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.segments.listMyProducts(query(), ctx),
      staleTime: SEGMENTS_STALE,
    }),
    pass(opts),
  );
}

/**
 * {@link injectMySegmentProducts} as an infinite read.
 *
 * One quirk inherited from the facade: `hasNextPage` is `sourceItems.length ===
 * pageSize`, so a segment whose assignment count is an exact multiple of the page
 * size reports one more page than exists and the last «Load more» yields nothing.
 * Rendering the empty result rather than hiding the button is the honest
 * behaviour — the alternative is a speculative extra request on every list.
 */
export function injectMySegmentProductsInfinite(
  query: Signal<ItemsQuery>,
  pageSize: Signal<number>,
  opts: SegmentOpts = {},
): CreateInfiniteQueryResult<InfiniteData<PaginatedItems<Product>, number>> {
  const { client } = injectEmporix();
  return injectEmporixInfinite<Product, readonly [ItemsQuery, number]>(
    () => ({
      resource: "segment-products-infinite",
      args: [query(), pageSize()] as const,
      site: "full",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      fetchPage: (pageNumber, ctx) =>
        client.segments.listMyProducts({ ...query(), pageNumber, pageSize: pageSize() }, ctx),
      staleTime: SEGMENTS_STALE,
    }),
    pass(opts),
  );
}

/** One page of the caller's segment categories, hydrated into real categories. */
export function injectMySegmentCategories(
  query: Signal<ItemsQuery>,
  opts: SegmentOpts = {},
): CreateQueryResult<PaginatedItems<Category>> {
  const { client } = injectEmporix();
  return injectEmporixQuery<PaginatedItems<Category>, readonly [ItemsQuery]>(
    () => ({
      resource: "segment-categories",
      args: [query()] as const,
      site: "full",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.segments.listMyCategories(query(), ctx),
      staleTime: SEGMENTS_STALE,
    }),
    pass(opts),
  );
}

/** {@link injectMySegmentCategories} as an infinite read. Same `hasNextPage` caveat. */
export function injectMySegmentCategoriesInfinite(
  query: Signal<ItemsQuery>,
  pageSize: Signal<number>,
  opts: SegmentOpts = {},
): CreateInfiniteQueryResult<InfiniteData<PaginatedItems<Category>, number>> {
  const { client } = injectEmporix();
  return injectEmporixInfinite<Category, readonly [ItemsQuery, number]>(
    () => ({
      resource: "segment-categories-infinite",
      args: [query(), pageSize()] as const,
      site: "full",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      fetchPage: (pageNumber, ctx) =>
        client.segments.listMyCategories({ ...query(), pageNumber, pageSize: pageSize() }, ctx),
      staleTime: SEGMENTS_STALE,
    }),
    pass(opts),
  );
}

/** The caller's segment categories as a tree, for navigation. */
export function injectMySegmentCategoryTree(
  query: Signal<TreeQuery>,
  opts: SegmentOpts = {},
): CreateQueryResult<SegmentCategoryTree> {
  const { client } = injectEmporix();
  return injectEmporixQuery<SegmentCategoryTree, readonly [TreeQuery]>(
    () => ({
      resource: "segment-category-tree",
      args: [query()] as const,
      site: "full",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.segments.getCategoryTree(query(), ctx),
      staleTime: SEGMENTS_STALE,
    }),
    pass(opts),
  );
}
