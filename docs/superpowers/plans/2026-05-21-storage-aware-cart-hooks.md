# Storage-Aware Cart Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `useCart`, `useCartMutations`, `useActiveCart` resolve cartId from `storage` when no argument is passed and share a single React-Query cache entry, removing the `useCartMutations(cartId ?? "")` boilerplate across the example apps.

**Architecture:** Make cartId optional on the two cart-aware hooks; resolve from `storage.getCartId()` (mutate-time for mutations, render-time for reads). `useActiveCart` becomes a thin wrapper around `useCart` so both share the canonical `["emporix","cart", id, …]` cache key — optimistic updates from `useCartMutations` now propagate to every cart-aware view. `useCreateCart` invalidates that key on success so `useActiveCart` re-reads storage on the next render.

**Tech Stack:** TypeScript, React, `@tanstack/react-query` v5, Vitest + MSW, pnpm workspaces (`packages/react`).

**Context for the engineer:**
- Spec: `docs/superpowers/specs/2026-05-21-storage-aware-cart-hooks-design.md` — read it first.
- Branch: `feat/storage-aware-cart-hooks` (already created off `main`).
- All implementation lives in **one file**: `packages/react/src/hooks/use-cart.ts`.
- All hook tests live in **two files**: `packages/react/tests/use-cart.test.tsx` (new tests) and `packages/react/tests/use-active-cart.test.tsx` (one existing test gets updated).
- No SDK change. No new public exports.
- `useReadAuth` already lives at `packages/react/src/hooks/internal/use-read-auth.ts` — reuse it; don't reinvent the inline `token ? auth.customer(token) : auth.anonymous()` pattern.
- `EmporixError` is exported from `@viu/emporix-sdk` — import it for the throw path.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/react/src/hooks/use-cart.ts` | All cart hooks | Modify `useCart`, `useCartMutations`, `useActiveCart`, `useCreateCart` |
| `packages/react/tests/use-cart.test.tsx` | useCart / useCartMutations / useCreateCart tests | Add 7 tests |
| `packages/react/tests/use-active-cart.test.tsx` | useActiveCart tests | Update 1 test (data: undefined → null) |
| `examples/vite-spa/src/GuestCheckout.tsx` | vite-spa guest checkout | Drop `?? ""` from `useCartMutations` |
| `examples/next-app-router/app/cart/page.tsx` | Next cart page | Switch to `useActiveCart() + useCartMutations()` |
| `examples/next-app-router/app/guest-checkout/page.tsx` | Next guest checkout | Drop `?? ""` |
| `docs/react.md` | Public docs | Cart-section update |
| `.changeset/storage-aware-cart-hooks.md` | Release notes | Minor bump on `@viu/emporix-sdk-react` |

---

## Task 1: `useCart` reads cartId from storage when no argument is passed

**Files:**
- Modify: `packages/react/src/hooks/use-cart.ts:22-33`
- Test: `packages/react/tests/use-cart.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `packages/react/tests/use-cart.test.tsx` (inside the existing `describe("useCart (read)", ...)` block):

```tsx
it("useCart() with no argument is disabled when storage has no cartId", () => {
  const { result } = renderHook(() => useCart(), { wrapper: wrap() });
  expect(result.current.fetchStatus).toBe("idle");
});

it("useCart() with no argument reads cartId from storage", async () => {
  const storage = createMemoryStorage();
  storage.setCartId("cart1");
  const { result } = renderHook(() => useCart(), { wrapper: wrap(storage) });
  await waitFor(() => expect(result.current.data?.id).toBe("cart1"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-cart.test`
Expected: Both new tests **PASS** the first (idle) one — because `useCart()` with no arg already disables — but **FAIL** the second one (no fetch happens) because storage fallback doesn't exist yet.

If both pass, you've misread the existing impl — re-check `use-cart.ts:23` to confirm `cartId` was just the literal arg.

- [ ] **Step 3: Add the storage fallback**

Replace `packages/react/src/hooks/use-cart.ts:22-33` with:

```ts
/** Fetches a cart by id. Falls back to `storage.getCartId()` when no argument is passed; disabled when neither is set. */
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

This also drops the inline `token ? auth.customer : auth.anonymous` block — `useReadAuth` already does that.

You'll need to remove the now-unused `auth` import. Check the top of the file: if no other code in `use-cart.ts` references `auth.customer`/`auth.anonymous` after this task is done, leave the import for now — Task 2 will reuse `useReadAuth` and Task 4 ditto, so the import will be cleaned up in Task 4.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-cart.test`
Expected: PASS for both new tests + all existing tests in the file.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-cart.ts packages/react/tests/use-cart.test.tsx
git commit -m "feat(react): useCart reads cartId from storage when arg omitted"
```

---

## Task 2: `useCartMutations` accepts optional cartId; resolves at mutate-time; throws on missing

**Files:**
- Modify: `packages/react/src/hooks/use-cart.ts:50-110`
- Test: `packages/react/tests/use-cart.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `packages/react/tests/use-cart.test.tsx` (inside the existing `describe("useCartMutations", ...)` block):

```tsx
it("useCartMutations() throws when storage has no cartId at mutate-time", async () => {
  const { result } = renderHook(() => useCartMutations(), { wrapper: wrap() });
  await expect(
    result.current.addItem.mutateAsync({
      product: { id: "p1" },
      quantity: 1,
      price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "EUR" },
    }),
  ).rejects.toThrow(/no cartId available/);
});

it("useCartMutations() resolves cartId at mutate-time (storage set after mount)", async () => {
  const storage = createMemoryStorage();
  const wrapper = wrap(storage);
  const { result } = renderHook(() => useCartMutations(), { wrapper });
  // Render the hook with no cartId — then set storage before mutating.
  storage.setCartId("cart1");
  await act(async () => {
    await result.current.addItem.mutateAsync({
      product: { id: "p1" },
      quantity: 1,
      price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "EUR" },
    });
  });
  // Reaches the existing MSW handler at /cart/acme/carts/cart1/items → success means the
  // mutation picked up the post-mount setCartId.
  expect(result.current.addItem.isSuccess).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-cart.test`
Expected: FAIL — the first test errors because `useCartMutations()` (no arg) is a TypeScript-level error today (param is required) **or** the function silently constructs with `cartId === undefined` and tries to POST `/cart/.../carts/undefined/items` → 404, throws something other than "no cartId available". Either way, the assertion doesn't match.

- [ ] **Step 3: Rewrite `useCartMutations`**

Replace `packages/react/src/hooks/use-cart.ts:50-110` with:

```ts
/**
 * Cart write operations with optimistic cache updates and rollback.
 *
 * `cartId` is optional — when omitted, `storage.getCartId()` is resolved at
 * **mutate-time** (inside `mutationFn`/`onMutate`), so post-mount writes from
 * `useActiveCart({ create: true })` work without a render race. Throws
 * `EmporixError("useCartMutations: no cartId available — …")` when storage
 * is still empty at mutate-time.
 */
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
    return useMutation<
      Cart,
      unknown,
      TVars,
      { previous: Cart | undefined; key: readonly unknown[] }
    >({
      mutationFn: async (vars) => run(resolveId(), vars),
      onMutate: async (vars) => {
        const id = resolveId();
        const key = keyFor(id);
        await qc.cancelQueries({ queryKey: key });
        const previous = qc.getQueryData<Cart>(key);
        if (optimistic) qc.setQueryData<Cart>(key, optimistic(previous, vars));
        return { previous, key };
      },
      onError: (_e, _v, c) => {
        if (c) qc.setQueryData(c.key, c.previous);
      },
      onSuccess: (cart, _v, c) => {
        if (c) qc.setQueryData(c.key, cart);
      },
    });
  }

  return {
    addItem: make(
      (id, v) => client.carts.addItem(id, v, ctx),
      (prev, v) =>
        prev
          ? {
              ...prev,
              // Optimistic placeholder; replaced by the real item on success.
              items: [
                ...(prev.items ?? []),
                {
                  id: `optimistic-${v.product?.id ?? "item"}`,
                  ...v,
                } as unknown as NonNullable<Cart["items"]>[number],
              ],
            }
          : prev,
    ),
    updateItem: make((id, v) => client.carts.updateItem(id, v.itemId, v.patch, ctx)),
    removeItem: make(
      (id, v) => client.carts.removeItem(id, v.itemId, ctx),
      (prev, v) =>
        prev ? { ...prev, items: (prev.items ?? []).filter((i) => i.id !== v.itemId) } : prev,
    ),
    clear: make(
      (id) => client.carts.clear(id, ctx),
      (prev) => (prev ? { ...prev, items: [] } : prev),
    ),
    applyCoupon: make((id, v) => client.carts.applyCoupon(id, v.code, ctx)),
    removeCoupon: make((id, v) => client.carts.removeCoupon(id, v.code, ctx)),
    setShippingAddress: make((id, v) => client.carts.setShippingAddress(id, v, ctx)),
    setBillingAddress: make((id, v) => client.carts.setBillingAddress(id, v, ctx)),
  };
}
```

Also update the imports at the top of `use-cart.ts`. Add `EmporixError`:

```ts
import {
  EmporixError,
  type AuthContext,
  type Cart,
  type CartAddress,
  type CartItemInput,
  type CartItemUpdate,
  type CartCreated,
  type CreateCartInput,
} from "@viu/emporix-sdk";
```

(Remove the `auth` import — `useReadAuth` is now the only source of `AuthContext`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-cart.test`
Expected: PASS for both new `useCartMutations` tests + all existing tests in the file (the 3 existing tests pass an explicit `"cart1"` arg, which continues to work).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-cart.ts packages/react/tests/use-cart.test.tsx
git commit -m "feat(react): useCartMutations accepts optional cartId; resolves at mutate-time"
```

---

## Task 3: `useActiveCart` becomes a thin wrapper around `useCart` (shared cache key)

**Files:**
- Modify: `packages/react/src/hooks/use-cart.ts:149-202`
- Update test: `packages/react/tests/use-active-cart.test.tsx` (1 assertion)
- Add tests: `packages/react/tests/use-cart.test.tsx`

- [ ] **Step 1: Write the failing tests (cache sharing + optimistic propagation)**

Append to `packages/react/tests/use-cart.test.tsx` (top-level, after the existing `describe` blocks):

```tsx
describe("useActiveCart + useCart cache sharing", () => {
  it("useActiveCart and useCart share the cache when both target the same cart", async () => {
    let cartFetches = 0;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts/cart-shared", () => {
        cartFetches += 1;
        return HttpResponse.json({ id: "cart-shared", items: [] });
      }),
    );
    const storage = createMemoryStorage();
    storage.setCartId("cart-shared");
    const wrapper = wrap(storage);
    const { result } = renderHook(
      () => ({ active: useActiveCart(), explicit: useCart("cart-shared") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.active.data?.id).toBe("cart-shared"));
    await waitFor(() => expect(result.current.explicit.data?.id).toBe("cart-shared"));
    expect(cartFetches).toBe(1);
  });

  it("optimistic update from useCartMutations propagates to useActiveCart", async () => {
    const storage = createMemoryStorage();
    storage.setCartId("cart1");
    const wrapper = wrap(storage);
    const { result } = renderHook(
      () => ({ active: useActiveCart(), mut: useCartMutations() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.active.data?.id).toBe("cart1"));
    expect(result.current.active.data?.items).toHaveLength(0);
    await act(async () => {
      await result.current.mut.addItem.mutateAsync({
        product: { id: "p1" },
        quantity: 1,
        price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "EUR" },
      });
    });
    // After mutation, useActiveCart reflects the updated cart from the shared cache.
    await waitFor(() => expect(result.current.active.data?.items).toHaveLength(1));
  });
});
```

Also at the top of `use-cart.test.tsx`, add `useActiveCart` to the named imports from `../src/hooks/use-cart`:

```tsx
import { useCart, useCartMutations, useCreateCart, useActiveCart } from "../src/hooks/use-cart";
```

- [ ] **Step 2: Update the existing `useActiveCart` "data: undefined → null" test**

Open `packages/react/tests/use-active-cart.test.tsx` and find the test:

```tsx
it("returns disabled state when storage.cartId is null and create is false", () => {
  const storage = createMemoryStorage();
  const { result } = renderHook(() => useActiveCart(), { wrapper: wrap(storage) });
  expect(result.current.fetchStatus).toBe("idle");
  expect(result.current.data).toBeUndefined();
});
```

Replace it with:

```tsx
it("returns null (not undefined) when storage.cartId is null and create is false", () => {
  const storage = createMemoryStorage();
  const { result } = renderHook(() => useActiveCart(), { wrapper: wrap(storage) });
  expect(result.current.fetchStatus).toBe("idle");
  // The wrapper exposes the documented `data: null = no cart, create not requested` signal.
  expect(result.current.data).toBeNull();
});
```

This aligns the test with what `docs/react.md` already documents (`data: null` as empty-state signal).

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-cart.test use-active-cart.test`
Expected: FAIL — cache-sharing test sees `cartFetches === 2` (each hook has its own key), optimistic-propagation test sees `useActiveCart.data.items.length === 0` (mutations write to the `cart` key, useActiveCart still subscribed to `active-cart`), and the updated existing test fails because the current impl returns `undefined`, not `null`.

- [ ] **Step 4: Rewrite `useActiveCart` as a wrapper**

Replace `packages/react/src/hooks/use-cart.ts:149-202` with:

```ts
/**
 * Resolves to "the active cart": the cart matching `storage.cartId` if one is
 * present. With `create: true`, bootstraps a new cart via
 * `client.carts.getCurrent({siteCode, create: true})` when storage is empty —
 * useful on cart-page mounts where you want a cart unconditionally.
 *
 * Internally delegates to `useCart` so both hooks share the canonical
 * `["emporix","cart", id, …]` cache entry — optimistic updates from
 * `useCartMutations` propagate automatically.
 *
 * Returns `UseQueryResult<Cart | null>`. `data: null` means "no cart yet and
 * create was not requested" — a deliberate signal so an empty-state can
 * render without confusing it with the loading state.
 */
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
    if (cartId !== null) return;
    if (!opts?.create) return;
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
        if (cancelled) return;
        if (cart?.id) {
          storage.setCartId(cart.id);
          setCartId(cart.id);
        }
      })
      .catch(() => {
        // Best-effort bootstrap; downstream useCart error surfaces real issues.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartId, opts?.create, opts?.type, opts?.legalEntityId, kind]);

  // Delegate to useCart with the canonical cache key. When cartId state is null,
  // wrap data → null to expose the documented empty-state signal.
  const inner = useCart(cartId ?? undefined, opts?.auth ? { auth: opts.auth } : {});
  const data: Cart | null | undefined = cartId === null ? null : inner.data;
  return { ...inner, data } as UseQueryResult<Cart | null>;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-cart.test use-active-cart.test`
Expected: PASS — both new cache-sharing tests, the updated `data: null` test, and **all other `useActiveCart` tests** stay green (the bootstrap-via-`getCurrent` + storage-set behavior is preserved).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-cart.ts packages/react/tests/use-cart.test.tsx packages/react/tests/use-active-cart.test.tsx
git commit -m "feat(react)!: useActiveCart wraps useCart; cart cache is unified"
```

Note: the `!` in the subject signals an internal-cache-key change. Public API is non-breaking; the changeset (Task 6) is `minor`. The `!` reflects the documented `data: undefined → null` correction for the no-cart-no-create case.

---

## Task 4: `useCreateCart` invalidates `["emporix","cart"]` on success

**Files:**
- Modify: `packages/react/src/hooks/use-cart.ts:120-134`
- Test: `packages/react/tests/use-cart.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/use-cart.test.tsx` (inside the existing `describe("useCreateCart", ...)` block):

```tsx
it("invalidates [emporix,cart] queries on success", async () => {
  server.use(
    http.post("https://api.emporix.io/cart/acme/carts", () =>
      HttpResponse.json({ cartId: "cart-new", yrn: "yrn:cart:cart-new" }, { status: 201 }),
    ),
  );
  const storage = createMemoryStorage();
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
  const { result } = renderHook(() => useCreateCart(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ currency: "CHF" });
  });
  expect(invalidateSpy).toHaveBeenCalledWith(
    expect.objectContaining({ queryKey: ["emporix", "cart"] }),
  );
});
```

At the top of `use-cart.test.tsx`, add `vi` to the vitest imports if not already present:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-cart.test`
Expected: FAIL — current `useCreateCart` only persists `storage.setCartId`; it does not invalidate any query.

- [ ] **Step 3: Add the invalidation**

Replace `packages/react/src/hooks/use-cart.ts:120-134` with:

```ts
/**
 * Creates a cart. Auto-detects auth (customer if a token is stored, else
 * anonymous). On success, persists `cartId` via `storage.setCartId` so a later
 * page reload can resume the same cart with the same anonymous session, then
 * invalidates `["emporix","cart"]` so `useActiveCart` re-reads storage on the
 * next render.
 *
 * Note: the SDK's `carts.create` returns `CartCreated = { cartId, yrn }`, not
 * the full `Cart`. The full cart is loaded on demand by `useCart(cartId)` /
 * `useActiveCart()`.
 */
export function useCreateCart(): UseMutationResult<
  CartCreated,
  unknown,
  CreateCartInput | undefined
> {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const { ctx } = useReadAuth();
  return useMutation<CartCreated, unknown, CreateCartInput | undefined>({
    mutationFn: (input) => client.carts.create(input, ctx),
    onSuccess: async (cart) => {
      if (cart.cartId) storage.setCartId(cart.cartId);
      await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-cart.test`
Expected: PASS for the new test + all existing `useCreateCart` tests (the two storage-persistence tests are unaffected since they assert post-mutation storage state, not query-invalidation count).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-cart.ts packages/react/tests/use-cart.test.tsx
git commit -m "feat(react): useCreateCart invalidates [emporix,cart] on success"
```

---

## Task 5: Migrate the three example apps off the `?? ""` boilerplate

**Files:**
- Modify: `examples/vite-spa/src/GuestCheckout.tsx`
- Modify: `examples/next-app-router/app/cart/page.tsx`
- Modify: `examples/next-app-router/app/guest-checkout/page.tsx`

- [ ] **Step 1: Update `examples/vite-spa/src/GuestCheckout.tsx`**

Find:
```tsx
const cartMutations = useCartMutations(cartId ?? "");
```

Replace with:
```tsx
const cartMutations = useCartMutations();
```

Leave the surrounding code (cart state, `cartId` variable) untouched — `cartId` may still be used for `useCart(cartId)` in the same file. If it is, also drop the explicit arg there: replace `useCart(cartId)` with `useCart()`.

- [ ] **Step 2: Update `examples/next-app-router/app/cart/page.tsx`**

Find:
```tsx
const cart = useCart(cartId);
const { addItem } = useCartMutations(cartId ?? "");
```

Replace with:
```tsx
const cart = useActiveCart();
const { addItem } = useCartMutations();
```

(The cart page is a strong fit for `useActiveCart` — it's the canonical "show me whatever cart is in storage" surface. Drop any now-unused `useCart` import.)

Verify the imports at the top of the file: replace `import { useCart, useCartMutations } from "@viu/emporix-sdk-react"` with `import { useActiveCart, useCartMutations } from "@viu/emporix-sdk-react"`.

- [ ] **Step 3: Update `examples/next-app-router/app/guest-checkout/page.tsx`**

Find:
```tsx
const cartMutations = useCartMutations(cartId ?? "");
```

Replace with:
```tsx
const cartMutations = useCartMutations();
```

Leave the surrounding `cartId` state alone — it may still be referenced for display or `useCart`.

- [ ] **Step 4: Build the SDK & React packages, then typecheck the examples**

Examples typecheck against `dist/` of the published packages, so build first:

```bash
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react build
pnpm -F @viu/emporix-examples-vite-spa typecheck
pnpm -F @viu/emporix-examples-next-app-router typecheck
```

Expected: all green.

If `next-env.d.ts` / `tsconfig.tsbuildinfo` show up as modified in `git status` after this, that's expected (Next auto-regenerates them). Don't commit them — they're caught by `.gitignore` patterns or will be discarded with `git checkout --` before the final commit.

- [ ] **Step 5: Commit**

```bash
git add examples/vite-spa/src/GuestCheckout.tsx \
        examples/next-app-router/app/cart/page.tsx \
        examples/next-app-router/app/guest-checkout/page.tsx
git checkout -- examples/next-app-router/next-env.d.ts examples/next-app-router/tsconfig.json examples/next-app-router/tsconfig.tsbuildinfo 2>/dev/null || true
git commit -m "feat(examples): use storage-defaulted cart hooks (drop ?? \"\" boilerplate)"
```

---

## Task 6: Documentation + changeset

**Files:**
- Modify: `docs/react.md`
- Create: `.changeset/storage-aware-cart-hooks.md`

- [ ] **Step 1: Update `docs/react.md` cart section**

Find the `useCartMutations` paragraph (around line 73 — describes `addItem`, `updateItem`, etc.) and replace with:

```markdown
`useCartMutations(cartId?)` returns `addItem`, `updateItem`, `removeItem`,
`clear`, `applyCoupon`, `removeCoupon`, `setShippingAddress`,
`setBillingAddress` — each a react-query mutation that optimistically patches
the cart cache and rolls back on error. When `cartId` is omitted, the active
cartId is read from `storage` at mutate-time; if storage is empty when a
mutation runs, it rejects with `EmporixError("useCartMutations: no cartId
available …")`. Pair with `useActiveCart` to drop manual cart-id threading:

```tsx
const { data: cart } = useActiveCart({ create: true });
const { addItem } = useCartMutations(); // shares the cart cache with useActiveCart
```
```

Also, in the existing `useActiveCart` section, add this sentence at the end of the "and `useCart(cartId)` coexist" paragraph (around line 106-108):

```markdown
`useActiveCart` and `useCart(cartId)` share the same React-Query cache entry
when they target the same cart, so optimistic updates from `useCartMutations`
propagate to every cart-aware view.
```

And in the `useCart` paragraph (Query hooks section, around line 45-48), update:

```markdown
Query hooks (`useProduct(s)`, `useProductsInfinite`, `useCategory(ies)`,
`useCategoryTree`, `useCart`) accept `{ auth }` to override the per-call token
kind. Default: `customer` if a token is stored, else `anonymous`. `useCart` is
disabled until a `cartId` is supplied — either explicitly via `useCart(id)` or
implicitly via `storage.getCartId()` when called as `useCart()`.
```

- [ ] **Step 2: Create the changeset**

Create `.changeset/storage-aware-cart-hooks.md`:

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add docs/react.md .changeset/storage-aware-cart-hooks.md
git commit -m "docs(react): document storage-aware cart hooks; changeset"
```

---

## Final Verification

- [ ] **Step 1: Full monorepo green**

```bash
pnpm -r build
pnpm -r test
pnpm typecheck
```
Expected: all green. Test count should be **at least +7** on `@viu/emporix-sdk-react` (101 → 108 or higher, depending on subtest decomposition).

- [ ] **Step 2: No leftover `?? ""` cart boilerplate**

```bash
git grep -nE "useCartMutations\(.+\?\? \"\"\)" packages/ examples/ docs/ 2>/dev/null
```
Expected: no matches.

- [ ] **Step 3: Optional — Live E2E sanity check**

```bash
pnpm e2e
```
Expected: 6/6 pass (the existing suite already covers the cart-mutation paths against the `viu` tenant).

If `e2e/.env.local` is not configured, this step is skipped cleanly — that's fine.

- [ ] **Step 4: Confirm branch state**

```bash
git log --oneline origin/main..HEAD
```
Expected: 7 commits — one per task, in order:
1. spec
2. useCart storage fallback
3. useCartMutations optional + mutate-time
4. useActiveCart wrapper
5. useCreateCart invalidation
6. examples migration
7. docs + changeset

---

## Follow-up (out of scope, may emerge from review)

- Storage Pub/Sub (full-mode variant): expose a `storage.subscribe('cartId', cb)` so `useActiveCart` can react to cross-component storage writes without relying on cache-invalidations. Only worth it if a real consumer surfaces a missing-invalidation case.
- `prefetchActiveCart` for SSR: skip — SSR consumers already know the cartId from a cookie and use `prefetchCart`.
