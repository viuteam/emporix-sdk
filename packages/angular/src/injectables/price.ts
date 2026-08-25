import { type Injector, type Signal } from "@angular/core";
import type { CreateQueryResult } from "@tanstack/angular-query-experimental";
import { injectEmporix } from "../provide";
import { injectEmporixQuery } from "../inject-query";
import type { EmporixClient, PriceMatch, PriceMatchByContextInput } from "@viu/emporix-sdk";

type AvailabilityResult = Awaited<ReturnType<EmporixClient["availability"]["get"]>>;

/** 1 minute — prices move with promotions. */
const PRICES_STALE = 60_000;
/** 30 seconds — stock changes, but not per render. */
const AVAILABILITY_STALE = 30_000;

export interface PriceOpts {
  injector?: Injector;
  enabled?: boolean;
}

const pass = (o: PriceOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};

/**
 * Resolve prices for a set of items in the active price context.
 *
 * Separate from the product read on purpose: Emporix resolves price by currency,
 * site and target location, so a price belongs to a product *in a context*, not
 * to the product. Switching currency has to re-resolve prices without re-fetching
 * the catalog — which is why `site: "full"` matters here.
 *
 * Disabled while `items` is empty, so a grid's first render costs nothing.
 */
export function injectMatchPrices(
  input: Signal<PriceMatchByContextInput>,
  opts: PriceOpts = {},
): CreateQueryResult<PriceMatch[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<PriceMatch[], readonly [PriceMatchByContextInput]>(
    () => ({
      resource: "match-prices",
      args: [input()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && (input().items?.length ?? 0) > 0,
      queryFn: (ctx) => client.prices.matchByContext(input(), ctx),
      staleTime: PRICES_STALE,
    }),
    pass(opts),
  );
}

/**
 * Like {@link injectMatchPrices} but chunks a large `items` array.
 *
 * Result order is **not** guaranteed — match by `priceId` or `itemRef.id`. The
 * chunk size and concurrency land in the cache key, because two different
 * chunkings of the same items are two different request patterns and one must not
 * be served the other's cached answer.
 */
export function injectMatchPricesChunked(
  input: Signal<PriceMatchByContextInput>,
  chunking: Signal<{ chunkSize?: number; concurrency?: number }> = (() => ({})) as Signal<{
    chunkSize?: number;
    concurrency?: number;
  }>,
  opts: PriceOpts = {},
): CreateQueryResult<PriceMatch[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<
    PriceMatch[],
    readonly [PriceMatchByContextInput, { chunkSize?: number; concurrency?: number }]
  >(
    () => ({
      resource: "match-prices-chunked",
      args: [input(), chunking()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && (input().items?.length ?? 0) > 0,
      queryFn: (ctx) => client.prices.matchByContextChunked(input(), chunking(), ctx),
      staleTime: PRICES_STALE,
    }),
    pass(opts),
  );
}

/**
 * Stock for one product at one site.
 *
 * `defaultAvailableOnNotFound` lands in the key: the same product read with and
 * without that fallback yields different answers, so they cannot share an entry.
 */
export function injectAvailability(
  productId: Signal<string>,
  siteCode: Signal<string | null>,
  opts: PriceOpts & { defaultAvailableOnNotFound?: boolean } = {},
): CreateQueryResult<AvailabilityResult> {
  const { client } = injectEmporix();
  const fallback = opts.defaultAvailableOnNotFound ?? false;
  return injectEmporixQuery<AvailabilityResult, readonly [string, string | null, boolean]>(
    () => ({
      resource: "availability",
      args: [productId(), siteCode(), fallback] as const,
      site: "none",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && productId() !== "" && siteCode() !== null,
      queryFn: (ctx) =>
        client.availability.get(productId(), siteCode() as string, ctx, {
          defaultAvailableOnNotFound: fallback,
        }),
      staleTime: AVAILABILITY_STALE,
    }),
    pass(opts),
  );
}
