# Storage-Aware Cart Hooks — Design

**Status:** Approved (2026-05-21)
**Scope:** `@viu/emporix-sdk-react` only — no SDK change.
**Breaking?** No. Every existing call signature continues to work.

## Problem

Three cart-aware hooks today require the consumer to thread `cartId` manually:

```tsx
const cartId = storage.getCartId();
const { data: cart } = useCart(cartId);
const { addItem } = useCartMutations(cartId ?? "");   // ← smell: empty-string hack
```

All three example apps (`vite-spa`, `next-app-router/cart`,
`next-app-router/guest-checkout`) carry the same `?? ""` workaround. The
hooks already have `useActiveCart` that resolves cartId from storage —
but it uses a **separate** React-Query cache key
(`["emporix","active-cart",…]` vs the canonical `["emporix","cart",…]`),
so optimistic updates from `useCartMutations` do not propagate to
`useActiveCart` views.

## Goal

1. `useCart()` and `useCartMutations()` accept the cartId as **optional** and
   resolve from `storage` when omitted.
2. `useCartMutations` resolves the cartId at **mutate-time**, not render-time,
   so post-mount writes from `useActiveCart({create:true})` work without races.
3. `useActiveCart`, `useCart`, `useCartMutations`, `prefetchCart`, and
   `useCustomerSession.{login,logout,refresh}` share **one** React-Query cache
   entry per cart: `["emporix","cart", id, { tenant, authKind }]`.

## Non-Goals

- A Storage Pub/Sub watcher. Storage writes that matter are already routed
  through hooks that fire cache invalidations (login, logout, refresh,
  createCart). YAGNI for the additional event channel.
- A `prefetchActiveCart` SSR helper. SSR consumers know the cartId from a
  cookie and use `prefetchCart` already.
- A `createIfMissing` option on `useCartMutations`. Belongs to a future
  full-mode feature if requested.

## Cache Topology

```
emporix.cart.<id>.{tenant,authKind}     ← single cart-cache entry
  ├─ written by:    useCart (queryFn), useCartMutations (onMutate/onSuccess/onError)
  ├─ read by:       useCart, useActiveCart, prefetchCart (SSR)
  └─ invalidated by: useCustomerSession.{login,logout,refresh}, useCreateCart
```

`useActiveCart` becomes a thin wrapper around `useCart` — no second cache
entry, no second fetcher, no possibility of drift.

## API Surface

| Hook | Signature (before) | Signature (after) |
|---|---|---|
| `useCart` | `(cartId?: string, options?)` | `(cartId?: string, options?)` — unchanged signature, new fallback: `storage.getCartId()` when arg omitted |
| `useCartMutations` | `(cartId: string)` | `(cartId?: string)` — same fallback; resolves at mutate-time |
| `useActiveCart` | `(opts?)` | `(opts?)` — unchanged signature; internally delegates to `useCart` |
| `useCreateCart` | `()` | `()` — unchanged signature; `onSuccess` now also `invalidateQueries(["emporix","cart"])` |

## Resolution Rules

**`useCart(cartId?)`**:
1. If `cartId` argument set → use it.
2. Else `storage.getCartId()` at render time.
3. If both null → `enabled: false` (idle).

**`useCartMutations(cartId?)`**:
1. If `cartId` argument set → use it.
2. Else `storage.getCartId()` evaluated **inside** `mutationFn` /
   `onMutate` (mutate-time, not render-time).
3. If both null at mutate-time → throw
   `EmporixError("useCartMutations: no cartId available — pass one explicitly or call useActiveCart({ create: true }) first")`.
   Surfaces via `mutation.error` and `mutateAsync` Promise-rejection.

**`useActiveCart(opts?)`**:
1. `useState`-initializer reads `storage.getCartId()` once.
2. If `opts.create === true` and local cartId is null →
   `client.carts.getCurrent({ siteCode, create: true })` in an effect, then
   `storage.setCartId(...)` + `setCartId(...)`.
3. Delegate to `useCart(cartId ?? undefined)` for the actual fetch + cache.
4. Wrap the result so `data === null` (not `undefined`) when no cartId is
   resolved and `create` was not requested — preserves today's
   "empty-state vs loading" distinction.

## Data Flow

**Typical storefront lifecycle:**

```
1. Page mount
   useActiveCart({ create: true })
     ├─ readSnapshot() → storage.getCartId() = null
     ├─ effect: client.carts.getCurrent({siteCode, create:true})
     │     → cart {id:"c1"} → storage.setCartId("c1") → setCartIdState("c1")
     └─ re-render → useCart("c1") enabled → fetches & caches under
                    ["emporix","cart","c1",{tenant,authKind}]

2. Add-to-cart click
   useCartMutations()                       (no argument)
     ├─ mutationFn called
     ├─ resolveCartId(): storage.getCartId() = "c1"
     ├─ onMutate: key = ["emporix","cart","c1",…], optimistic patch
     ├─ network call: POST /cart/{tenant}/carts/c1/items
     └─ onSuccess: setQueryData(key, freshCart)
                                              ↑
                                              useActiveCart re-renders
                                              (shares the key)

3. Login (cart-onboarding)
   useCustomerSession.login()
     ├─ onboardCustomerCart() → storage.setCartId("customer-cart-id")
     └─ qc.invalidateQueries(["emporix","cart"])  ← invalidates both
                                                     useActiveCart reads
                                                     new storage; useCart
                                                     fetches customer cart
```

## Edge Cases

| Scenario | Behavior |
|---|---|
| `useCart()` no-arg, storage empty | `enabled: false`, `fetchStatus: "idle"` (matches today's `useCart(undefined)`) |
| `useCart("explicit")` parallel to `useActiveCart()` with same storage-id | One network request, one cache entry — both hooks share the key |
| `useCartMutations()` called before `useActiveCart({create:true})` finished bootstrap | `mutateAsync` rejects with `EmporixError("no cartId available…")`. Consumer disables buttons via `useActiveCart.isLoading` |
| Storage changes mid-mount (logout) | `useActiveCart` reads storage in `useState` initializer + effect; `useCustomerSession.logout` invalidates `["emporix","cart"]` → re-render → fresh storage read |
| Optimistic update + server error | Rollback unchanged (`onError → setQueryData(key, previous)`) — key consistency preserved across `onMutate`/`onError`/`onSuccess` via `context.key` capture |
| `useCreateCart` parallel to `useActiveCart` | `useCreateCart.onSuccess` writes storage + `invalidateQueries(["emporix","cart"])` so `useActiveCart` picks up the new storage cartId on next render |
| SSR via `prefetchCart` | Unchanged — already on the canonical key; client-side `useCart` and `useActiveCart` get a cache hit on hydration |
| Multi-cart (B2B quote + shopping) | Consumer passes cartId explicitly: `useCartMutations(quoteCartId)` vs `useCartMutations(shoppingCartId)`. Independent cache entries via the `id` component of the key |

## Implementation Sketches

**`useCart`:**

```ts
export function useCart(cartId?: string, options: QueryOpts = {}): UseQueryResult<Cart> {
  const { client, storage } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  const resolvedId = cartId ?? storage.getCartId() ?? undefined;
  return useQuery({
    queryKey: ["emporix", "cart", resolvedId ?? null, { tenant: client.tenant, authKind: kind }],
    enabled: resolvedId !== undefined,
    queryFn: () => client.carts.get(resolvedId as string, ctx),
  });
}
```

**`useCartMutations`:**

```ts
export function useCartMutations(cartId?: string): CartMutationsApi {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const { ctx, kind } = useReadAuth();

  const resolveId = (): string => {
    const id = cartId ?? storage.getCartId();
    if (!id) {
      throw new EmporixError(
        "useCartMutations: no cartId available — pass one explicitly or call useActiveCart({ create: true }) first",
      );
    }
    return id;
  };
  const keyFor = (id: string) =>
    ["emporix", "cart", id, { tenant: client.tenant, authKind: kind }] as const;

  function make<TVars>(
    run: (id: string, vars: TVars) => Promise<Cart>,
    optimistic?: (prev: Cart | undefined, vars: TVars) => Cart | undefined,
  ): Mut<TVars> {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMutation<Cart, unknown, TVars, { previous: Cart | undefined; key: readonly unknown[] }>({
      mutationFn: async (vars) => run(resolveId(), vars),
      onMutate: async (vars) => {
        const id = resolveId(); // throws here if storage went empty; surfaces via mutation.error
        const key = keyFor(id);
        await qc.cancelQueries({ queryKey: key });
        const previous = qc.getQueryData<Cart>(key);
        if (optimistic) qc.setQueryData<Cart>(key, optimistic(previous, vars));
        return { previous, key };
      },
      onError: (_e, _v, c) => { if (c) qc.setQueryData(c.key, c.previous); },
      onSuccess: (cart, _v, c) => { if (c) qc.setQueryData(c.key, cart); },
    });
  }

  return {
    addItem: make((id, v) => client.carts.addItem(id, v, ctx), /* optimistic same as today */),
    updateItem: make((id, v) => client.carts.updateItem(id, v.itemId, v.patch, ctx)),
    removeItem: make((id, v) => client.carts.removeItem(id, v.itemId, ctx), /* optimistic same */),
    clear: make((id) => client.carts.clear(id, ctx), (prev) => prev ? { ...prev, items: [] } : prev),
    applyCoupon: make((id, v) => client.carts.applyCoupon(id, v.code, ctx)),
    removeCoupon: make((id, v) => client.carts.removeCoupon(id, v.code, ctx)),
    setShippingAddress: make((id, v) => client.carts.setShippingAddress(id, v, ctx)),
    setBillingAddress: make((id, v) => client.carts.setBillingAddress(id, v, ctx)),
  };
}
```

**`useActiveCart` (wrapper):**

```ts
export function useActiveCart(opts?: {
  create?: boolean;
  type?: string;
  legalEntityId?: string;
  auth?: AuthContext;
}): UseQueryResult<Cart | null> {
  const { client, storage } = useEmporix();
  const { ctx, kind } = useReadAuth(opts?.auth);
  const [cartId, setCartId] = useState<string | null>(() => storage.getCartId());

  useEffect(() => {
    if (cartId !== null || !opts?.create) return;
    const siteCode = client.config?.credentials?.storefront?.context?.siteCode;
    if (!siteCode) return;
    let cancelled = false;
    client.carts
      .getCurrent(ctx, {
        siteCode,
        ...(opts.type !== undefined ? { type: opts.type } : {}),
        ...(opts.legalEntityId !== undefined ? { legalEntityId: opts.legalEntityId } : {}),
        create: true,
      })
      .then((cart) => {
        if (cancelled || !cart?.id) return;
        storage.setCartId(cart.id);
        setCartId(cart.id);
      })
      .catch(() => { /* downstream useCart surfaces real errors */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartId, opts?.create, opts?.type, opts?.legalEntityId, kind]);

  const inner = useCart(cartId ?? undefined, opts?.auth ? { auth: opts.auth } : {});
  return {
    ...inner,
    data: cartId === null ? null : inner.data,
  } as UseQueryResult<Cart | null>;
}
```

**`useCreateCart` (add invalidation):**

```ts
export function useCreateCart(): UseMutationResult<CartCreated, unknown, CreateCartInput | undefined> {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const { ctx } = useReadAuth();
  return useMutation({
    mutationFn: (input) => client.carts.create(input, ctx),
    onSuccess: async (cart) => {
      if (cart.cartId) storage.setCartId(cart.cartId);
      await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
    },
  });
}
```

## Test Plan

All tests added to existing files — no new test files.

| Test | File | What it verifies |
|---|---|---|
| `useCart()` no-arg, storage empty | `tests/use-cart.test.tsx` | `fetchStatus === "idle"`, no network call |
| `useCart()` no-arg, `storage.setCartId("c1")` pre-mount | `tests/use-cart.test.tsx` | Fetches via storage default; `data.id === "c1"` |
| `useCart("explicit")` + `useActiveCart()` on same storage cart | `tests/use-cart.test.tsx` | One network call, one cache entry |
| `useCartMutations()` no-arg, storage empty, `mutateAsync` | `tests/use-cart.test.tsx` | Rejects with `EmporixError` containing "no cartId available" |
| `useCartMutations()` resolves at mutate-time | `tests/use-cart.test.tsx` | Set storage post-mount → mutate → request hits the right cart-id path |
| Optimistic update from `useCartMutations` reaches `useActiveCart` | `tests/use-cart.test.tsx` | Co-render both; addItem → `useActiveCart.data.items.length` reflects optimistic patch |
| `useCreateCart.onSuccess` invalidates `["emporix","cart"]` | `tests/use-cart.test.tsx` | Spy on `qc.invalidateQueries`; observe the call |
| `useActiveCart` existing tests stay green | `tests/use-active-cart.test.tsx` | Cache-key change is internal; external behavior preserved |

## Migration

| File | Before | After |
|---|---|---|
| `examples/vite-spa/src/GuestCheckout.tsx` | `useCartMutations(cartId ?? "")` | `useCartMutations()` |
| `examples/next-app-router/app/cart/page.tsx` | `useCart(cartId); useCartMutations(cartId ?? "")` | `useCart(); useCartMutations()` (or `useActiveCart()` for cart page) |
| `examples/next-app-router/app/guest-checkout/page.tsx` | `useCartMutations(cartId ?? "")` | `useCartMutations()` |

## Documentation

- `docs/react.md` cart section — show `useCartMutations()` no-arg pattern;
  note the auto-resolve from storage.
- Add a one-line cross-reference in the `useActiveCart` section: "shares
  the cache with `useCart` — optimistic mutations propagate."

## Changeset

```markdown
---
"@viu/emporix-sdk-react": minor
---

`useCart` and `useCartMutations` now read the active cartId from
`storage` when their `cartId` argument is omitted. Pair with
`useActiveCart` to drop the `useCartMutations(cartId ?? "")`
boilerplate:

- `useCart()` — disabled until storage has a cartId, then auto-resolves.
- `useCartMutations()` — resolves cartId at mutate-time; throws
  `EmporixError("no cartId available…")` if storage is empty when a
  mutation runs.

`useActiveCart` is now a thin wrapper around `useCart` and shares the
same React-Query cache key. Optimistic updates from `useCartMutations`
now propagate to every cart-aware view in one place.

`useCreateCart` additionally invalidates `["emporix","cart"]` on success
so `useActiveCart` picks up the new storage cartId on the next render.

No breaking changes — every old call signature still works.
```

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Consumers subscribed directly to `["emporix","active-cart",…]` | Key was never publicly documented; grep across `examples/`, `docs/`, `tests/` confirms only the hook's own implementation uses it. Changeset mentions the internal key change. |
| Mutate-time storage-read finds `null` while `useActiveCart` bootstrap still in flight | Hook throws with explicit message; docs show `useActiveCart({create:true})` + `isLoading` pattern to disable buttons. |
| `useCreateCart` invalidation triggers extra refetches | Desired — replaces manual refetch-after-create dance. React-Query's default dedup prevents double network calls. |
| `useActiveCart` wrapper breaks `data: null` semantics | Test covers explicitly: `cartId === null → data === null`, otherwise `data === inner.data`. |
