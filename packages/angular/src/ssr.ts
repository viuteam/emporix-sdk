/**
 * Server-side rendering helpers.
 *
 * Angular SSR has no tag-based invalidation model, so there is deliberately no
 * analogue to `@viu/emporix-sdk-next`'s cache tags here — `revalidateTag` and
 * RSC boundaries are Next concepts with no Angular counterpart. What this entry
 * is for is hydration: handing a server-rendered query result to the browser so
 * it is not fetched (and billed) a second time.
 *
 * The prefetch helpers that `@viu/emporix-sdk-react/ssr` provides are not in this
 * foundation. This entry exists now because a declared-but-missing export is a
 * broken published artifact, and re-exporting the two primitives is what a
 * consumer needs in the meantime:
 *
 * @example
 * ```ts
 * const PRODUCT = makeStateKey<Product>("emporix.product.p1")
 *
 * // On the server, after fetching:
 * inject(TransferState).set(PRODUCT, product)
 *
 * // In the browser, as initialData for injectEmporixQuery:
 * const seed = inject(TransferState).get(PRODUCT, null)
 * ```
 */
export { makeStateKey, TransferState } from "@angular/core";
export type { StateKey } from "@angular/core";
