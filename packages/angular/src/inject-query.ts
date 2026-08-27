import {
  assertInInjectionContext,
  inject,
  runInInjectionContext,
  Injector,
} from "@angular/core";
import {
  injectInfiniteQuery,
  injectQuery,
  type CreateInfiniteQueryResult,
  type CreateQueryResult,
  type InfiniteData,
} from "@tanstack/angular-query-experimental";
import {
  emporixKey,
  siteMeta,
  type AuthContext,
  type PaginatedItems,
} from "@viu/emporix-sdk";
import { injectEmporix } from "./provide";
import { injectEmporixSite } from "./site";
import { customerTokenSignal } from "./storage-signal";
import { emporixAuth, emporixQueryOptions, type EmporixQueryInput } from "./query-options";

/**
 * A paginated read.
 *
 * `fetchPage` rather than `queryFn`, and no `getNextPageParam`: the cursor logic
 * is Emporix's, not the caller's — every paginated endpoint answers with
 * `pageNumber` and `hasNextPage`, so there is one correct way to advance and no
 * reason to make each call site restate it.
 *
 * This mirrors React's internal `useEmporixInfinite`, and it is a correction: the
 * first version of this interface took a plain `queryFn` and reused
 * `emporixQueryOptions` to build it, which silently dropped TanStack's
 * `pageParam`. Every page after the first would have re-fetched page one.
 */
export interface EmporixInfiniteInput<T, TArgs extends readonly unknown[]>
  extends Omit<EmporixQueryInput<PaginatedItems<T>, TArgs>, "queryFn"> {
  fetchPage: (pageNumber: number, ctx: AuthContext) => Promise<PaginatedItems<T>>;
}

/**
 * A read against Emporix, keyed and auth-resolved by {@link emporixQueryOptions}.
 *
 * `input` is a FUNCTION, matching `injectQuery`'s own contract: it runs in a
 * reactive context on every dependency change, so an `args` array derived from a
 * signal re-keys the query without any extra wiring.
 *
 * @example
 * ```ts
 * class ProductPage {
 *   private readonly emporix = injectEmporix()
 *   id = signal("p1")
 *   product = injectEmporixQuery(() => ({
 *     resource: "product",
 *     args: [this.id()],
 *     site: "full",
 *     mode: "read-auth",
 *     queryFn: (ctx) => this.emporix.client.products.get(this.id(), undefined, ctx),
 *   }))
 * }
 * ```
 */
export function injectEmporixQuery<T, TArgs extends readonly unknown[]>(
  input: () => EmporixQueryInput<T, TArgs>,
  opts: { injector?: Injector } = {},
): CreateQueryResult<T> {
  if (opts.injector === undefined) assertInInjectionContext(injectEmporixQuery);
  const injector = opts.injector ?? inject(Injector);
  return runInInjectionContext(injector, () => {
    const { client, storage } = injectEmporix();
    const token = customerTokenSignal(storage, { injector });
    // A DI lookup, not reactive state, so it is resolved once here. Its
    // signal READS stay inside the callback below, for the same reason token()
    // does.
    const site = injectEmporixSite();
    return injectQuery(
      () =>
        emporixQueryOptions(input(), {
          tenant: client.tenant,
          // Read INSIDE this callback, never outside it. injectQuery runs the
          // callback in a reactive context, so this read is what makes the cache
          // key and the `enabled` gate follow login and logout. Hoisting it
          // above the callback compiles, passes a happy-path test, and leaves a
          // logged-out customer looking at their own orders.
          token: token(),
          siteCode: site.siteCode(),
          language: site.language(),
        }),
      { injector },
    );
  });
}

/**
 * A paginated read against Emporix. Pages start at 1 and stop when the server
 * says `hasNextPage: false` — never a trailing empty fetch.
 *
 * @example
 * ```ts
 * class Catalog {
 *   private readonly emporix = injectEmporix()
 *   products = injectEmporixInfinite<Product, readonly [number]>(() => ({
 *     resource: "products-infinite",
 *     args: [24],
 *     site: "full",
 *     mode: "read-auth",
 *     fetchPage: (pageNumber, ctx) =>
 *       this.emporix.client.products.list({ pageNumber, pageSize: 24 }, ctx),
 *   }))
 * }
 * ```
 */
export function injectEmporixInfinite<T, TArgs extends readonly unknown[]>(
  input: () => EmporixInfiniteInput<T, TArgs>,
  opts: { injector?: Injector } = {},
): CreateInfiniteQueryResult<InfiniteData<PaginatedItems<T>, number>> {
  if (opts.injector === undefined) assertInInjectionContext(injectEmporixInfinite);
  const injector = opts.injector ?? inject(Injector);
  return runInInjectionContext(injector, () => {
    const { client, storage } = injectEmporix();
    const token = customerTokenSignal(storage, { injector });
    const site = injectEmporixSite();
    return injectInfiniteQuery(
      () => {
        const cfg = input();
        const currentToken = token();
        const { authKind, ctx, tokenPresent } = emporixAuth(
          cfg.mode,
          currentToken,
          cfg.authOverride,
        );
        return {
          queryKey: emporixKey(cfg.resource, cfg.args, {
            tenant: client.tenant,
            authKind,
            ...siteMeta(cfg.site, site.siteCode(), site.language()),
          }) as unknown as readonly unknown[],
          initialPageParam: 1,
          // The page param is the whole point of this wrapper. Building queryFn
          // through emporixQueryOptions dropped it, which is why fetchPage takes
          // the number explicitly.
          queryFn: ({ pageParam }: { pageParam: number }) => cfg.fetchPage(pageParam, ctx),
          // Advance from the server's own pageNumber, not from allPages.length:
          // a refetch that drops a middle page would otherwise skip one.
          getNextPageParam: (last: PaginatedItems<T>) =>
            last.hasNextPage ? last.pageNumber + 1 : undefined,
          enabled: (cfg.enabled ?? true) && (cfg.mode === "customer" ? tokenPresent : true),
          ...(cfg.staleTime !== undefined ? { staleTime: cfg.staleTime } : {}),
        };
      },
      { injector },
    ) as unknown as CreateInfiniteQueryResult<InfiniteData<PaginatedItems<T>, number>>;
  });
}
