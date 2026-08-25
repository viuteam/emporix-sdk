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
} from "@tanstack/angular-query-experimental";
import { injectEmporix } from "./provide";
import { injectEmporixSite } from "./site";
import { customerTokenSignal } from "./storage-signal";
import { emporixQueryOptions, type EmporixQueryInput } from "./query-options";

export interface EmporixInfiniteInput<T, TArgs extends readonly unknown[]>
  extends EmporixQueryInput<T, TArgs> {
  getNextPageParam: (lastPage: T, allPages: T[]) => unknown;
  initialPageParam: unknown;
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

/** The paginated form. Same contract, plus TanStack's two page-param fields. */
export function injectEmporixInfinite<T, TArgs extends readonly unknown[]>(
  input: () => EmporixInfiniteInput<T, TArgs>,
  opts: { injector?: Injector } = {},
): CreateInfiniteQueryResult<T> {
  if (opts.injector === undefined) assertInInjectionContext(injectEmporixInfinite);
  const injector = opts.injector ?? inject(Injector);
  return runInInjectionContext(injector, () => {
    const { client, storage } = injectEmporix();
    const token = customerTokenSignal(storage, { injector });
    const site = injectEmporixSite();
    return injectInfiniteQuery(
      () => {
        const cfg = input();
        return {
          ...emporixQueryOptions(cfg, {
            tenant: client.tenant,
            token: token(),
            siteCode: site.siteCode(),
            language: site.language(),
          }),
          getNextPageParam: cfg.getNextPageParam,
          initialPageParam: cfg.initialPageParam,
        };
      },
      { injector },
    ) as CreateInfiniteQueryResult<T>;
  });
}
