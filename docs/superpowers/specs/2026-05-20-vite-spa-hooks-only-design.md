# vite-spa Hooks-Only Guest Checkout + Persistent Cart — Design

## Context

The `examples/vite-spa` Example app already uses React hooks (`useProducts`, `useCustomerSession`, `useMatchPrices`) on the Catalog and Login pages, but `GuestCheckout.tsx` reaches directly into the `EmporixClient` for cart create, price match, add item, and place order. This makes the Example a half-and-half reference: clean hook usage on read paths, raw SDK on write paths.

**Additional requirement:** the guest cart must **survive a browser reload / restart** within the natural Emporix anonymous-session lifetime (24h refresh-token TTL; 30-day cart inactivity TTL). A returning guest should see their cart again rather than start from scratch.

This combines two goals into one design because they share infrastructure (storage layer + persistence) and one Example demo (`GuestCheckout.tsx`):

1. **Hooks-only Guest Checkout:** make `GuestCheckout.tsx` fully hook-driven so the Example demonstrates the React layer end-to-end.
2. **Persistent guest cart:** persist (a) the active `cartId` and (b) the anonymous Emporix session (refresh-token + sessionId) so that on reload the SDK refreshes the existing session instead of creating a fresh one, and `useCart(cartId)` returns the same cart.

Both requirements are scoped to anonymous / guest flows. The customer-logged-in flow remains unchanged.

## Goals

- Zero `client.*` calls in `examples/vite-spa/src/GuestCheckout.tsx` for cart / price / checkout operations.
- New `useCreateCart` hook follows the existing `useCartMutations` design (mutation + cache hydration + auto-detect auth).
- `useCheckout` becomes anonymous-friendly via auto-detect, backward-compatible for customer flows.
- `TokenStorage` is renamed/extended to `EmporixStorage` with two added concerns: `cartId` and `anonymousSession`. **Backward-compatible**: the `TokenStorage` name continues to work as an alias, and all existing methods keep their signature.
- `DefaultTokenProvider` optionally accepts an `EmporixStorage` reference. When present, it bootstraps `this.anon` from storage on first use and writes back after every refresh/login. When absent (e.g. node-server example), behavior is identical to today.
- `EmporixProvider` (React) wires the storage so the SDK and the hooks share a single source of truth.
- On reload of the vite-spa SPA, the cart is recovered transparently: `useCart(savedCartId)` hits a 200 because the anonymous session refresh preserves `sessionId`.
- On successful `placeOrder` (cart goes CLOSED on Emporix side), the example clears `cartId` from storage so the next visit starts a fresh guest session.

## Non-Goals

- Touch `App.tsx` Catalog or Login pages — already hook-only.
- Touch `examples/next-app-router/app/guest-checkout/page.tsx` — separate Example with Next-specific persistence concerns (SSR + cookies). Tracked as follow-up.
- Add a high-level `useGuestCheckout` state-machine wrapper hook.
- Support quote-based checkout (`placeOrderFromQuote`) for anonymous — out of scope.
- Persist customer access tokens beyond what already exists (customer-token storage stays as-is).
- Implement a server-side cart-merge UI for the case where a guest later logs in. Cart merging is a known Emporix capability (`POST /cart/{tenant}/carts/{cartId}/merge`) but is a separate feature.

## Emporix Reference (verified against developer.emporix.io)

- **Anonymous access token TTL:** 3599s (1h).
- **Anonymous refresh token TTL:** 86399s (24h). `GET /customerlogin/auth/anonymous/refresh?refresh_token=…&client_id=…` returns a new access token **with the same `sessionId`**.
- **Cart inactivity TTL:** 30 days; after that the cart is auto-deleted.
- **Cart status:** OPEN or CLOSED. A cart goes CLOSED automatically after checkout or after being merged into a customer cart.
- **Cart access:** Anonymous carts are bound to the `sessionId` of the anonymous token used to create them. A request with a different session's token cannot read the cart.

Consequence for our design: persisting `cartId` alone is **not enough** — without preserving the anonymous `sessionId`, the next page-load creates a new session and the old cart becomes inaccessible. We need to persist the anonymous **refresh token** too, and have the `DefaultTokenProvider` use it on the first call after reload.

## Architecture

### Storage layer (in `@viu/emporix-sdk-react`)

**Current** (`packages/react/src/storage/index.ts`):

```typescript
export interface TokenStorage {
  getCustomerToken(): string | null;
  setCustomerToken(token: string | null): void;
  subscribe?(listener: (token: string | null) => void): () => void;
}
```

**Proposed** (`packages/react/src/storage/index.ts`):

```typescript
/** Pluggable persistence for SDK session state. SSR-safe by default (memory). */
export interface EmporixStorage {
  // Customer token (unchanged).
  getCustomerToken(): string | null;
  setCustomerToken(token: string | null): void;
  subscribe?(listener: (token: string | null) => void): () => void;

  // Active guest / customer cart id (new).
  getCartId(): string | null;
  setCartId(id: string | null): void;

  // Anonymous session — used by DefaultTokenProvider to preserve sessionId
  // across page reloads (new).
  getAnonymousSession(): PersistedAnonymousSession | null;
  setAnonymousSession(session: PersistedAnonymousSession | null): void;
}

/** Minimal subset of `AnonymousSession` that needs to outlive a page load. */
export interface PersistedAnonymousSession {
  refreshToken: string;
  sessionId: string;
  // `accessToken` and `expiresAt` are NOT persisted — the access token is
  // short-lived (1h) and the SDK will refresh it on first use.
}

/** Backward-compat alias. New code should use `EmporixStorage`. */
export type TokenStorage = EmporixStorage;
```

All three implementations (`memory`, `localStorage`, `cookie`) are updated to support the new methods. `localStorage` uses three distinct keys (`emporix.customerToken`, `emporix.cartId`, `emporix.anonymousSession`); the existing `customerToken` key is unchanged for backward compat. `cookie` follows the same pattern.

### SDK token provider (in `@viu/emporix-sdk`)

The SDK is currently storage-agnostic. We introduce a **narrow** persistence hook on `DefaultTokenProvider` that the React layer can wire to its `EmporixStorage`. No SDK dependency on the React package — the interface is defined in the SDK and the React layer adapts.

**New SDK interface** (`packages/sdk/src/core/auth.ts`):

```typescript
/**
 * Persistence callback for anonymous sessions. The SDK calls `read` once on
 * first anonymous-token need (to bootstrap a possibly-existing session from
 * the host) and `write` after every successful login/refresh.
 */
export interface AnonymousSessionStore {
  read(): { refreshToken: string; sessionId: string } | null;
  write(session: { refreshToken: string; sessionId: string } | null): void;
}
```

**Constructor change** (`DefaultTokenProvider`):

```typescript
constructor(
  private readonly cfg: ResolvedConfig,
  private readonly anonStore?: AnonymousSessionStore,  // ← new optional param
) {}
```

**Behavior changes inside `DefaultTokenProvider`:**

1. **First call to `getAnonymousToken()`** — if `this.anon` is undefined and `anonStore?.read()` returns a non-null persisted session, seed `this.anon` with `{ refreshToken, sessionId, accessToken: "", expiresAt: 0 }`. This forces the next branch in `getAnonymousToken()` to take the refresh path (because `canRefresh = !!this.anon?.refreshToken`).
2. **After every successful `fetchAnonymous("login" | "refresh")`** — call `anonStore?.write({ refreshToken, sessionId })`.
3. **`invalidateAnonymous()` / `expireAnonymous()`** — `invalidate` clears the store (`write(null)`). `expire` keeps it (it's there for forcing a refresh, not a fresh login).
4. **Refresh failure** — current code falls back to a fresh login (`auth.ts:158-160`). After a successful fresh login, the new refresh token replaces the old one in store (already covered by point 2).

Behavior when `anonStore` is undefined (e.g. node-server): identical to today — no persistence, all in memory.

### React provider wiring (in `@viu/emporix-sdk-react`)

`EmporixProvider` already receives a `client` and a `storage`. Today the SDK client is constructed by the consumer, so the React layer can't pass storage into the constructor. We introduce a small post-construction wiring step.

**Option chosen:** `EmporixProvider` uses an effect to install an `AnonymousSessionStore` adapter on the client's token provider. The adapter forwards read/write into the `EmporixStorage`. This wiring is also done synchronously on first render to avoid a race on the very first API call.

```tsx
export function EmporixProvider({ client, storage, queryClient, children }: Props) {
  // Install once, idempotently. The adapter reads/writes from `storage`.
  client.tokenProvider.attachAnonymousStore?.({
    read: () => storage.getAnonymousSession(),
    write: (s) => storage.setAnonymousSession(s),
  });
  return <Ctx.Provider value={{ client, storage, queryClient }}>{children}</Ctx.Provider>;
}
```

`attachAnonymousStore` is added to the `TokenProvider` interface in the SDK as an optional method. Custom token providers don't have to implement it.

### Hook changes (in `@viu/emporix-sdk-react`)

#### New: `useCreateCart` (in `packages/react/src/hooks/use-cart-mutations.ts`)

```typescript
export function useCreateCart(): UseMutationResult<Cart, unknown, CartCreateInput> {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const token = storage.getCustomerToken();
  const ctx: AuthContext = token ? auth.customer(token) : auth.anonymous();
  return useMutation({
    mutationFn: (input: CartCreateInput) => client.carts.create(input, ctx),
    onSuccess: (cart) => {
      const id = cart.cartId;
      if (!id) return;
      const key = ["emporix", "cart", id, { tenant: client.tenant, authKind: ctx.kind }];
      qc.setQueryData(key, cart);
      // Persist so a reload can resume the same cart.
      storage.setCartId(id);
    },
  });
}
```

The persistence side effect (`storage.setCartId(id)`) lives inside the hook so consumers never forget it.

#### Changed: `useCheckout` (in `packages/react/src/hooks/use-checkout.ts`)

Replace `customerCtx(token)` (which throws on missing token) with auto-detect:

```typescript
function checkoutCtx(token: string | null): AuthContext {
  return token ? auth.customer(token) : auth.anonymous();
}
```

Used in both `placeOrder.mutationFn` and `placeOrderFromQuote.mutationFn`. Backward-compatible.

Also, on `placeOrder` success the Example will clear the persisted `cartId` (the Emporix cart is now CLOSED). This is done in `GuestCheckout.tsx`, not inside the hook, because:

- The hook doesn't know if the consumer wants to clear (some consumers may want to keep the cartId around to display a confirmation page that references it).
- The pattern matches `useCartMutations`: the hook does the request and the cache patch; side effects like persistence belong to the consumer or to a dedicated mutation hook.

#### Existing hooks used as-is

- `useCart(cartId)` — already exists, GET only. Used to display the persisted cart on reload.
- `useCartMutations(cartId).addItem` — already exists. Used after `createCart` (and after a reload, if the persisted cart is recovered).
- `useMatchPrices(...)` — already exists. The Example calls `.refetch()` for pre-order price freshness.

### Rewritten: `examples/vite-spa/src/GuestCheckout.tsx`

```tsx
import { useState } from "react";
import {
  useEmporix,
  useCart,
  useCreateCart,
  useCartMutations,
  useMatchPrices,
  useCheckout,
} from "@viu/emporix-sdk-react";

const PRODUCT_ID = "0f1e2d3c-4b5a";

export function GuestCheckout(): React.JSX.Element {
  const { client, storage } = useEmporix();
  // Persisted cart-id is the source of truth. Lazy init reads localStorage once.
  const [cartId, setCartId] = useState<string | null>(() => storage.getCartId());
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // On reload with a persisted cartId, this fires immediately.
  const cart = useCart(cartId ?? undefined);

  const createCart = useCreateCart();
  const prices = useMatchPrices(
    { items: [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }] },
    { enabled: cartId !== null },
  );
  const cartMutations = useCartMutations(cartId ?? "");
  const checkout = useCheckout();

  async function startCart(): Promise<void> {
    setError(null);
    try {
      const created = await createCart.mutateAsync({ currency: "CHF" });
      const id = created.cartId;
      if (!id) throw new Error("cart created without an id");
      const { data: matched } = await prices.refetch();
      const p = matched?.[0];
      if (!p?.priceId) throw new Error("no price resolved for the product");
      await cartMutations.addItem.mutateAsync({
        itemYrn: `urn:yaas:hybris:product:product:${client.tenant};${PRODUCT_ID}`,
        quantity: 1,
        price: {
          priceId: p.priceId,
          originalAmount: p.originalValue ?? 0,
          effectiveAmount: p.effectiveValue ?? 0,
          currency: "CHF",
        },
      });
      // Both useCreateCart and storage.setCartId(id) have already fired; mirror
      // into local state to trigger downstream hooks (prices.enabled, etc.).
      setCartId(id);
    } catch (e) {
      setError(String(e));
    }
  }

  async function placeOrder(): Promise<void> {
    if (!cartId) return;
    setError(null);
    try {
      const { data: fresh } = await prices.refetch();
      const amount = fresh?.[0]?.effectiveValue ?? 0;
      const r = await checkout.placeOrder.mutateAsync({
        input: {
          cartId,
          customer: {
            email: "guest@example.com",
            firstName: "Guest",
            lastName: "Shopper",
            guest: true,
          },
          shipping: { methodId: "free", zoneId: "CH", methodName: "Free Shipping", amount: 0 },
          addresses: [
            { contactName: "Guest Shopper", street: "Rämistrasse 71", zipCode: "8006", city: "Zürich", country: "CH", type: "BILLING" },
            { contactName: "Guest Shopper", street: "Rämistrasse 71", zipCode: "8006", city: "Zürich", country: "CH", type: "SHIPPING" },
          ],
          paymentMethods: [{ provider: "custom", amount }],
        },
      });
      // Cart is CLOSED on Emporix after a successful order — clear local state.
      storage.setCartId(null);
      setCartId(null);
      setOrderId(r.orderId ?? null);
    } catch (e) {
      setError(String(e));
    }
  }

  function resetGuestSession(): void {
    storage.setCartId(null);
    setCartId(null);
    setOrderId(null);
  }

  const showRecovered = cartId !== null && cart.data && !orderId;

  return (
    <main>
      <h1>Guest checkout</h1>
      {!cartId && <button onClick={() => void startCart()}>Start guest cart</button>}
      {showRecovered && <p>Cart: {cartId} ({cart.data?.items?.length ?? 0} item(s))</p>}
      {prices.data && <p>Unit price: {prices.data[0]?.effectiveValue ?? "—"}</p>}
      {cartId && !orderId && <button onClick={() => void placeOrder()}>Place guest order</button>}
      {cartId && !orderId && <button onClick={resetGuestSession}>Discard cart</button>}
      {orderId && <p>Order placed: {orderId}</p>}
      {error && <pre>{error}</pre>}
    </main>
  );
}
```

## Data Flow

### First visit (clean storage)

```
[mount]
  storage.getCartId() → null              → no useCart fetch
  storage.getAnonymousSession() → null    → TokenProvider has no seed

[Start guest cart click]
  createCart.mutateAsync({ currency: "CHF" })
    ↓ TokenProvider.getAnonymousToken() — first call, no anonStore data
      → GET /customerlogin/auth/anonymous/login → 200 { refreshToken, sessionId, ... }
      → anonStore.write({ refreshToken, sessionId }) → localStorage["emporix.anonymousSession"]
    ↓ POST /cart/viu/carts → 201
    ↓ onSuccess: qc.setQueryData(useCart key) + storage.setCartId(id)
  prices.refetch() → POST /price/viu/match-prices-by-context → 200
  cartMutations.addItem.mutateAsync({…}) → POST /cart/viu/carts/{id}/items → 201
  setCartId(id) → re-render

[Place guest order click]
  prices.refetch() → POST /price/viu/match-prices-by-context → 200
  checkout.placeOrder.mutateAsync({ input }) → POST /checkout/viu/checkouts/order → 200
  storage.setCartId(null) → localStorage cleared
  setOrderId(orderId) → render order id
```

### Returning visit (browser reload, cart still OPEN, refresh token within 24h)

```
[mount]
  storage.getCartId() → "6a0d7a35…"
  storage.getAnonymousSession() → { refreshToken, sessionId }
  → useState init: cartId = "6a0d7a35…"

[useCart("6a0d7a35…") fires immediately]
  → first SDK call → TokenProvider.getAnonymousToken()
    → this.anon is undefined → seed from anonStore.read() → forces refresh mode
    → GET /customerlogin/auth/anonymous/refresh → 200 (same sessionId)
    → anonStore.write({ newRefreshToken, sameSessionId })
  → GET /cart/viu/carts/6a0d7a35… → 200 (cart still owned by this sessionId)
  → useCart.data populated → UI renders cart contents
```

### Returning visit (refresh token expired > 24h)

```
[mount]
  storage.getCartId() → "6a0d7a35…"
  storage.getAnonymousSession() → { refreshToken, sessionId } (refreshToken stale)

[useCart fires]
  → TokenProvider.getAnonymousToken() seeds from anonStore → tries refresh
  → GET /…/anonymous/refresh → 4xx (refresh token expired)
  → catch → fallback fetchAnonymous("login") → new sessionId
  → anonStore.write({ newRefreshToken, newSessionId })
  → GET /cart/viu/carts/6a0d7a35… → 403 or 404 (cart belongs to old sessionId)
  → useCart.error
  → UI: surface error, offer "Discard cart" → reset
```

This degraded path is intentional. We don't pre-validate at mount; we let the GET fail visibly. The user can click "Discard cart" to clear and start over.

## Testing

### Unit tests (SDK)

`packages/sdk/tests/token-provider-anon.test.ts` — extend with:

- `DefaultTokenProvider` constructed with `anonStore`: bootstraps from `read()` on first call, takes the refresh branch, writes back after refresh.
- `DefaultTokenProvider` constructed without `anonStore`: identical to today's behavior (in-memory only).
- After refresh failure, falls back to fresh login and writes the new session.
- `invalidateAnonymous()` calls `anonStore.write(null)`.

### Unit tests (React)

- `packages/react/tests/storage.test.ts` — extend each of memory / localStorage / cookie implementations with: `setCartId/getCartId` round-trip; `setAnonymousSession/getAnonymousSession` round-trip; clearing both with `null`.
- `packages/react/tests/use-cart-mutations.test.tsx` — `useCreateCart` returns Cart on success; hydrates `useCart` cache; persists `cartId` via `storage.setCartId`; auto-detect customer vs anonymous.
- `packages/react/tests/use-checkout.test.tsx` — anonymous path: `placeOrder.mutate` works without token; customer path unchanged.
- `packages/react/tests/provider.test.tsx` — `EmporixProvider` calls `client.tokenProvider.attachAnonymousStore` (when present) with adapters into the supplied storage.

### Integration / runtime

- `pnpm -r build`, `pnpm -r test` — all green.
- vite-spa runtime smoke against the `viu` tenant:
  1. Fresh load → click "Start guest cart" → cart id appears, unit price appears.
  2. Reload page → cart id appears immediately from storage; `useCart` GET returns 200; item count rendered. Confirm in Network panel that the first auth call is `…/anonymous/refresh` (not `login`).
  3. Click "Place guest order" → order id appears; reload → "Start guest cart" button shown again (cart cleared).
  4. Manual stale-session test (developer: hand-edit `localStorage["emporix.anonymousSession"]` to break the refresh token) → reload → error path surfaces → "Discard cart" resets cleanly.

## Risk / Compatibility

| Change | Risk | Mitigation |
|---|---|---|
| `TokenStorage` → `EmporixStorage` (rename + extension) | Low. Type alias keeps `TokenStorage` working; all new methods are additive. | Public API surface check: `git grep TokenStorage`; alias kept indefinitely. |
| `DefaultTokenProvider` constructor takes optional `anonStore` | None — optional parameter. Behavior with `undefined` is identical to today. | Tests cover both with-store and without-store paths. |
| `attachAnonymousStore` on `TokenProvider` interface | Marked optional; custom implementations don't have to implement. | Document in changeset. |
| `useCheckout` auto-detect Auth | Low — removes a runtime throw. No existing caller depends on it. | Test customer path still works. |
| `useCreateCart` new hook | None — additive. | Tests + changeset. |
| `localStorage` writes for anonymous refresh token | Token lives 24h. Storing it in `localStorage` is consistent with how customer tokens are stored today (same risk profile). | Document SameSite/Secure expectations for cookie storage; flag XSS surface in docs/auth.md. |

**Changeset:** minor bump for both `@viu/emporix-sdk` (new optional anon-store API on TokenProvider) and `@viu/emporix-sdk-react` (storage extension + new hook + useCheckout auto-detect).

## File Structure

| File | Change |
|---|---|
| `packages/sdk/src/core/auth.ts` | Add `AnonymousSessionStore` interface; extend `TokenProvider` with optional `attachAnonymousStore`; `DefaultTokenProvider` constructor + bootstrap-from-store + write-after-refresh |
| `packages/sdk/src/index.ts` | Re-export `AnonymousSessionStore` |
| `packages/sdk/tests/token-provider-anon.test.ts` | Add tests for the persistence wiring |
| `packages/react/src/storage/index.ts` | Rename `TokenStorage` → `EmporixStorage` (alias kept); add `getCartId/setCartId/getAnonymousSession/setAnonymousSession`; new `PersistedAnonymousSession` type |
| `packages/react/src/storage/memory.ts` | Implement new methods |
| `packages/react/src/storage/local-storage.ts` | Implement new methods; two new keys (`emporix.cartId`, `emporix.anonymousSession`) |
| `packages/react/src/storage/cookie.ts` | Implement new methods; matching cookie names |
| `packages/react/src/provider.tsx` | Wire `attachAnonymousStore` from storage into the client's token provider |
| `packages/react/src/hooks/use-cart-mutations.ts` | Add `useCreateCart` export; persist `cartId` on success |
| `packages/react/src/hooks/use-checkout.ts` | Replace `customerCtx` with `checkoutCtx` (auto-detect) |
| `packages/react/src/hooks/index.ts` | Re-export `useCreateCart` |
| `packages/react/tests/storage.test.ts` | Extend storage tests for cartId + anon session |
| `packages/react/tests/use-cart-mutations.test.tsx` | Tests for `useCreateCart` |
| `packages/react/tests/use-checkout.test.tsx` | Anonymous-path tests |
| `packages/react/tests/provider.test.tsx` | Verify storage ↔ token-provider wiring |
| `examples/vite-spa/src/GuestCheckout.tsx` | Rewrite as hook-only composition with `useCart` recovery + persistent `cartId` |
| `.changeset/vite-spa-hooks-only-persistent-cart.md` | Minor changeset covering both packages |
| `docs/react.md` | Document `useCreateCart`, `useCheckout` anonymous support, storage extension, persistent guest cart pattern |
| `docs/auth.md` | Note anonymous-session persistence storage location + security expectations |

## Out-of-the-loop / Follow-ups

- `examples/next-app-router/app/guest-checkout/page.tsx` — same hook-only + persistence treatment in a Next-flavored way (server-action vs client-component; cookies vs localStorage). Tracked as a separate plan.
- Cart merging on customer login (`POST /cart/{tenant}/carts/{cartId}/merge`) — currently the anonymous cart and the customer cart stay separate. Adding a hook + Example for merge belongs in a follow-up plan when the use case is requested.
- `accessToken` for anonymous sessions is **not** persisted (it's short-lived and the refresh on first use is fast). If we ever discover a latency reason to also persist the access token, it's an additive change to `PersistedAnonymousSession` plus the three storage implementations.
