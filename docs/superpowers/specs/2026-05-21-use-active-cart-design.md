# `useActiveCart` Hook — Design

## Context

The React layer exposes `useCart(cartId?)` today — a `useQuery` that's disabled when `cartId` is undefined. To render the current cart in a storefront, the consumer must:

1. Read `storage.getCartId()` manually.
2. Decide whether to call `client.carts.getCurrent(...)` or `client.carts.create(...)` for a missing cart.
3. Write the resulting id back to `storage.setCartId(...)`.
4. Then call `useCart(cartId)`.

That's plumbing every storefront needs. The PR #26 customer-cart onboarding hook (`onboardCustomerCart`) already implements steps 2-3 internally on login — but as private helper code, not reusable by other UI surfaces (catalog mini-cart, cart page, etc.).

This change adds `useActiveCart()` as the **single storefront-facing hook for "the active cart"**: it resolves to the cart matching `storage.cartId` if present, or optionally creates a new one via `client.carts.getCurrent({siteCode, create: true})` if missing. Auto-detects customer vs anonymous auth like the other read hooks.

## Goals

- Storefront code goes from "10-line plumbing" to `const { cart } = useActiveCart()`.
- Mirrors the existing `useCart` shape (`UseQueryResult<Cart>`) so consumers can drop it in without learning a new return type.
- `create` is opt-in (default `false`) so catalog pages don't accidentally create empty carts on Emporix.
- Re-uses the `getCurrent` SDK call from the customer-cart onboarding (no new SDK surface).
- Coexists with `useCart(cartId)`: when the consumer already has a `cartId` (e.g. from `useCreateCart.mutateAsync`'s return value), nothing forces them to switch.

## Non-Goals

- Replace `useCart(cartId)`. Both stay exported; `useActiveCart` is the convenience wrapper.
- Cart-merging UI / conflict handling — already covered by `useCustomerSession`'s onboarding for the login flow.
- B2B multi-cart per type — `type` / `legalEntityId` are wired through as opts but the test surface here covers only the default cart type. Multi-type B2B can build on this hook without changes.
- A separate `useEnsureCart()` mutation hook. We fold "ensure" semantics into `useActiveCart({ create: true })` so consumers don't pick between two slightly-different hooks.

## Architecture

### Public API

```typescript
function useActiveCart(opts?: {
  /** When true and storage holds no cartId, calls `getCurrent({create:true})` automatically on mount. Default false. */
  create?: boolean;
  /** Optional Emporix cart type ("shopping", "quote", …) — forwarded to getCurrent. */
  type?: string;
  /** Optional B2B legal-entity id — forwarded to getCurrent. */
  legalEntityId?: string;
  /** Auth-context override; default auto-detect (customer if token in storage, else anonymous). */
  auth?: AuthContext;
}): UseQueryResult<Cart | null>
```

Return type matches `useCart`'s shape (`UseQueryResult<Cart>`), with one extension: `data` may be `null` instead of just `Cart | undefined`. `null` means "no cart exists and `create` was not set" — a deliberate signal so consumers can render an empty-state without confusing it with "still loading" (`undefined`).

### Behavior

Internal flow (pseudocode):

```typescript
const { client, storage } = useEmporix();
const { ctx, kind } = useReadAuth(opts?.auth);

// 1. Cart-id source: storage at mount time (lazy useState init).
const [cartId, setCartId] = useState<string | null>(() => storage.getCartId());

// 2. Bootstrap effect — only runs once per (auth-kind, create-flag) tuple.
useEffect(() => {
  if (cartId !== null) return;
  if (!opts?.create) return;
  const siteCode = client.config?.credentials?.storefront?.context?.siteCode;
  if (!siteCode) return;
  let cancelled = false;
  client.carts.getCurrent(ctx, { siteCode, type: opts.type, legalEntityId: opts.legalEntityId, create: true })
    .then((cart) => {
      if (cancelled) return;
      if (cart?.id) {
        storage.setCartId(cart.id);
        setCartId(cart.id);
      }
    })
    .catch(() => { /* best-effort — surface via useQuery's error below */ });
  return () => { cancelled = true; };
}, [cartId, opts?.create, opts?.type, opts?.legalEntityId, kind, client, storage]);

// 3. Once cartId is known, useQuery handles caching + refetch.
return useQuery({
  queryKey: ["emporix", "active-cart", cartId, { tenant: client.tenant, authKind: kind }],
  enabled: cartId !== null,
  queryFn: () => client.carts.get(cartId!, ctx),
});
```

The query-key intentionally differs from `useCart`'s (`"active-cart"` vs `"cart"`) — both can coexist in the same React Query cache without clashing. After the bootstrap fires and `setCartId(id)` is called, the hook's caller re-renders and the `useQuery` enables itself for the same `cartId`.

### Auth-detection consistency

`useActiveCart` uses the same `useReadAuth(override?)` helper as `useCart`, `useProducts`, etc. (`packages/react/src/hooks/internal/use-read-auth.ts`). No new auth-handling logic — single source of truth.

### Storage-side effect

The hook **writes** `storage.setCartId(...)` only in the bootstrap branch (`opts.create === true`, cartId was null, getCurrent succeeded). It never overwrites an existing cartId, never clears one. Lifecycle:

| Event | Who writes `storage.cartId` |
|---|---|
| `useCreateCart.mutateAsync({...})` succeeds | `useCreateCart` (existing) |
| `useActiveCart({ create: true })` bootstraps a new cart | this hook (new) |
| `useCheckout.placeOrder.mutateAsync(...)` succeeds | consumer (cart is CLOSED, consumer clears it — see vite-spa GuestCheckout) |
| `useCustomerSession.login(...)` succeeds | `useCustomerSession` (existing, via `onboardCustomerCart`) |
| `useCustomerSession.logout()` | `useCustomerSession` clears |

No conflict with the existing writers — `useActiveCart` only writes when nobody else has.

### What if storage's cartId is stale?

If `storage.cartId` points to a cart that Emporix doesn't recognize anymore (closed, expired, or belongs to a different anonymous session that was lost), the inner `client.carts.get(cartId, ctx)` returns a 4xx. `useQuery` surfaces it as `error`. Consumers can react via:

```tsx
const { data: cart, error } = useActiveCart({ create: true });
if (error) return <Button onClick={() => { storage.setCartId(null); /* refetch */ }}>Reset cart</Button>;
```

Out of scope for this hook: auto-recovery (clear stale cartId and re-bootstrap). That's a follow-up if it shows up in real-world telemetry.

## Data Flow

### Catalog mini-cart (read-only, no create)

```
[mount]
  storage.getCartId() → null
  useState init → cartId = null
  useEffect: opts.create undefined → return early
  useQuery: enabled=false → data: undefined
[render] <CartIcon count={data?.items?.length ?? 0} />   // shows "0"
```

### Cart page (auto-create on mount)

```
[mount]
  storage.getCartId() → null
  useState init → cartId = null
  useEffect: opts.create=true, siteCode="main" → fires getCurrent
    ↓
    POST /cart/viu/carts (server creates) → { id: "cart-new", ... }
    storage.setCartId("cart-new")
    setCartId("cart-new")
[re-render]
  useQuery: enabled=true → GET /cart/viu/carts/cart-new → cart with items
[render] <CartPage cart={cart} />
```

### Storefront with existing cartId (after page reload)

```
[mount]
  storage.getCartId() → "cart-existing"
  useState init → cartId = "cart-existing"
  useEffect: cartId !== null → return early
  useQuery: enabled=true → GET /cart/viu/carts/cart-existing → cart
[render] // immediate, no extra POST
```

## Testing

### Unit tests (`packages/react/tests/use-active-cart.test.tsx` — new)

- `useActiveCart()` returns null/disabled when storage.cartId is null and create is false.
- `useActiveCart()` returns the cart when storage.cartId is set on mount.
- `useActiveCart({ create: true })` triggers `getCurrent({siteCode, create:true})` when cartId is null on mount.
- `useActiveCart({ create: true })` writes the resulting cartId back to storage.
- `useActiveCart({ create: true })` skips the bootstrap when `storefront.context.siteCode` is not configured (no-op, no fetch).
- `useActiveCart({ create: true, type: "quote" })` forwards `type` to getCurrent.
- `useActiveCart()` with an existing cartId does NOT call getCurrent (only carts.get).
- Re-running with a different `auth.kind` invalidates the cache (different query-key).

### E2E (`e2e/specs/use-active-cart.spec.ts` — optional follow-up)

Could verify the cart-page-loads-cart flow on the vite-spa once that Example uses `useActiveCart`. Out of scope for this spec — covered by the existing `customer-cart-onboarding` and `guest-checkout` specs in spirit.

## Risk / Compatibility

| Concern | Mitigation |
|---|---|
| New hook collides with `useCart` query-key | Uses `"active-cart"` not `"cart"` as queryKey prefix; both coexist. |
| Auto-create on every storefront visit | `create` defaults to false; opt-in only. |
| Bootstrap fires multiple times in StrictMode | `useEffect` deps stabilize after first success; the `cancelled` guard prevents duplicate writes. |
| Stale cartId in storage | Inner `carts.get` returns 4xx → exposed via useQuery's `error`; consumer can clear. Out of scope: auto-recovery. |
| Consumers conflict with `useCreateCart` | `useActiveCart` only writes storage when no other writer has. Order of operations in practice is consumer-driven — no race expected. |

**Changeset:** minor for `@viu/emporix-sdk-react` (additive hook, no behavior change to existing exports). SDK is untouched.

## File Structure

| File | Change |
|---|---|
| `packages/react/src/hooks/use-cart.ts` | Add `useActiveCart` export (lives next to `useCart`, `useCartMutations`, `useCreateCart`) |
| `packages/react/src/hooks/index.ts` | Re-export `useActiveCart` |
| `packages/react/src/index.ts` | Add `useActiveCart` to root export list |
| `packages/react/tests/use-active-cart.test.tsx` | **CREATE** — 8 tests for the behaviors above |
| `.changeset/use-active-cart.md` | Minor changeset |
| `docs/react.md` | Document `useActiveCart` next to `useCart` |

## Out-of-scope follow-ups

- `useActiveCart` auto-recovery on stale cartId — needs telemetry first to justify.
- B2B multi-type sample (running parallel quote and shopping carts in the same session) — same hook can be used, but a dedicated Example would help adoption.
- vite-spa Example migration to use `useActiveCart` — small UX improvement; doable in a follow-up PR.
- `useMergeCarts()` exposed as a public hook — currently `client.carts.merge` is only called from inside the login-onboarding helper. Until a real consumer asks for the manual-merge button UX, no hook.
