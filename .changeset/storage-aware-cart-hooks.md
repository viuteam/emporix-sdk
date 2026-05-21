---
"@viu/emporix-sdk-react": minor
---

`useCart` and `useCartMutations` now read the active cartId from `storage`
when their `cartId` argument is omitted. Pair with `useActiveCart` to drop
the `useCartMutations(cartId ?? "")` boilerplate:

- `useCart()` — disabled until storage has a cartId, then auto-resolves.
- `useCartMutations()` — resolves cartId at mutate-time; throws
  `EmporixError("no cartId available…")` if storage is empty when a
  mutation runs.

`useActiveCart` is now a thin wrapper around `useCart` and shares the same
React-Query cache key. Optimistic updates from `useCartMutations` now
propagate to every cart-aware view in one place.

`useCreateCart` additionally invalidates `["emporix","cart"]` on success so
`useActiveCart` picks up the new storage cartId on the next render.

`useActiveCart`'s `data` now correctly returns `null` (not `undefined`)
when storage has no cartId and `create` was not requested — matches the
documented empty-state signal.

No breaking changes — every old call signature still works.
