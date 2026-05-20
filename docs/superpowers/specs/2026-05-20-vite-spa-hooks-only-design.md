# vite-spa Hooks-Only Guest Checkout — Design

## Context

The `examples/vite-spa` Example app already uses React hooks (`useProducts`, `useCustomerSession`, `useMatchPrices`) on the Catalog and Login pages, but `GuestCheckout.tsx` reaches directly into the `EmporixClient` for cart create, price match (imperative re-fetch), add item, and place order. This makes the Example a half-and-half reference: clean hook usage on read paths, raw SDK on write paths.

**Goal:** turn `GuestCheckout.tsx` into a fully hook-driven Guest-Checkout reference so the Example demonstrates the React layer end-to-end. To achieve this, the `@viu/emporix-sdk-react` package needs two small additions:

1. `useCheckout` must support anonymous flows (currently throws `useCheckout requires a logged-in customer token` if no token is in storage — see `use-checkout.ts:18`).
2. A `useCreateCart` mutation hook must exist (no hook currently covers cart creation; `client.carts.create` is only reachable through `useEmporix().client`).

The intention is **not** to hide the Emporix surface behind a single mega-hook. Each individual operation stays its own composable hook, matching the existing patterns (`useCartMutations` per-cart-id, `useMatchPrices` as a query, `useCheckout` for order placement).

## Goals

- Zero `client.*` calls in `examples/vite-spa/src/GuestCheckout.tsx` for cart/price/checkout operations. The only remaining `client` read is `client.tenant` for building the product YRN string — that is a config read, not an SDK call.
- New `useCreateCart` hook follows the existing `useCartMutations` design (mutation + cache hydration into `useCart(cartId)` + auto-detect auth from storage).
- `useCheckout` becomes anonymous-friendly via auto-detect, backward-compatible for the existing customer flow.
- The Example remains a useful reference: every hook used has a clear, documented purpose. A reader can copy each hook usage into their own app.

## Non-Goals

- Touch `App.tsx` Catalog or Login pages — already hook-only.
- Touch `examples/next-app-router/app/guest-checkout/page.tsx` — separate Example with Next-specific concerns (server-action vs client-component decisions belong in its own iteration).
- Add a high-level `useGuestCheckout` state-machine wrapper hook — rejected as approach because it would hide the API surface.
- Support quote-based checkout (`placeOrderFromQuote`) for anonymous — out of scope; only the standard `placeOrder` path matters for the guest reference.
- SaaS / SiteCode handling — existing `useCheckout` already accepts these; no signature change needed.

## Architecture

### New: `useCreateCart` (in `packages/react/src/hooks/use-cart-mutations.ts`)

A `useMutation` hook that:

- Accepts a `CartCreateInput` matching the existing `client.carts.create(input, ctx)` SDK signature.
- Auto-detects auth: customer token in storage → `auth.customer(token)`; otherwise → `auth.anonymous()`. Same pattern as `useCartMutations` (line 30-31 of the existing file).
- On success, calls `queryClient.setQueryData(["emporix", "cart", cart.cartId, { tenant, authKind }], cart)` so a following `useCart(cartId)` hit renders from cache without a redundant GET roundtrip.

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
      if (id) {
        const key = ["emporix", "cart", id, { tenant: client.tenant, authKind: ctx.kind }];
        qc.setQueryData(key, cart);
      }
    },
  });
}
```

### Changed: `useCheckout` (in `packages/react/src/hooks/use-checkout.ts`)

Replace the `customerCtx(token)` throw-on-missing-token with an auto-detect helper mirroring `useReadAuth`:

```typescript
function checkoutCtx(token: string | null): AuthContext {
  return token ? auth.customer(token) : auth.anonymous();
}
```

Used in both `placeOrder.mutationFn` and `placeOrderFromQuote.mutationFn`. This is backward-compatible: a stored token continues to produce a customer-bound checkout; absence of a token now produces an anonymous-bound checkout instead of a runtime exception. `usePaymentModes` keeps its existing `enabled: token !== null` guard, since that endpoint is genuinely customer-only.

### Rewritten: `examples/vite-spa/src/GuestCheckout.tsx`

```tsx
import { useState } from "react";
import {
  useEmporix,
  useCreateCart,
  useCartMutations,
  useMatchPrices,
  useCheckout,
} from "@viu/emporix-sdk-react";

const PRODUCT_ID = "0f1e2d3c-4b5a";

export function GuestCheckout(): React.JSX.Element {
  const { client } = useEmporix();          // only for client.tenant in the YRN string
  const [cartId, setCartId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      const cart = await createCart.mutateAsync({ currency: "CHF" });
      const id = cart.cartId;
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
      setOrderId(r.orderId ?? null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main>
      <h1>Guest checkout</h1>
      {!cartId && <button onClick={() => void startCart()}>Start guest cart</button>}
      {cartId && <p>Cart: {cartId}</p>}
      {prices.data && <p>Unit price: {prices.data[0]?.effectiveValue ?? "—"}</p>}
      {cartId && !orderId && <button onClick={() => void placeOrder()}>Place guest order</button>}
      {orderId && <p>Order placed: {orderId}</p>}
      {error && <pre>{error}</pre>}
    </main>
  );
}
```

Notes on the rewrite:

- `useCartMutations(cartId ?? "")` — passes an empty string when no cart exists. Safe because the consumer only calls `addItem.mutateAsync` after `createCart` resolved and `id` is verified. The mutation closure captures the cart id at mutation time. A slightly stricter alternative would gate `useCartMutations` behind `cartId !== null` via a wrapper, but the existing API doesn't support that without changes — out of scope.
- The two price refreshes both use `prices.refetch()` — same React-Query primitive, no additional hook. This matches the existing "stateless on prices" comment in the current code.
- `useEmporix()` still imported for `client.tenant`. That's a config read of the provider context, not an SDK operation — acceptable for a YRN string composition.

## Data Flow

```
[Start guest cart click]
  ↓
useCreateCart.mutateAsync({ currency: "CHF" })   → POST /cart/viu/carts             (201)
  ↓ onSuccess: qc.setQueryData(useCart key, cart)
prices.refetch()                                  → POST /price/viu/match-prices-…  (200)
  ↓
cartMutations.addItem.mutateAsync({ … })          → POST /cart/viu/carts/{id}/items (201)
  ↓ onSuccess: qc.setQueryData(useCart key, cart)
setCartId(id)                                     → re-render with cart + price

[Place guest order click]
  ↓
prices.refetch()                                  → POST /price/viu/match-prices-…  (200)
  ↓
checkout.placeOrder.mutateAsync({ input })        → POST /checkout/viu/checkouts/order (200)
  ↓
setOrderId(orderId)                               → re-render order id
```

Identical to today's network behavior — same 7 HTTP calls in the same order. The only change is **where** in the React tree those calls originate (hooks instead of raw client).

## Testing

### Unit tests

- `packages/react/tests/use-cart-mutations.test.tsx`:
  - `useCreateCart` returns a Cart on mutation success.
  - `useCreateCart` hydrates `useCart(cartId)` cache so the following render renders without an extra GET.
  - `useCreateCart` uses `auth.anonymous()` when no token in storage, `auth.customer(token)` when token present.

- `packages/react/tests/use-checkout.test.tsx` (exists; extend):
  - `useCheckout().placeOrder` succeeds without a stored token (anonymous path).
  - `useCheckout().placeOrder` still uses `auth.customer(token)` when a token is stored.
  - `usePaymentModes` is still disabled without a token (unchanged behavior).

### Integration / runtime

- `pnpm -F @viu/emporix-sdk-react test` — all unit tests pass.
- `pnpm -F @viu/emporix-sdk-react build`, `pnpm -F @viu/emporix-examples-vite-spa build` — typecheck + build green.
- vite-spa runtime smoke test (Chrome DevTools MCP): start dev server, navigate to `/guest`, click "Start guest cart", verify cart id + unit price render and no console errors. Click "Place guest order", verify order id renders. Confirm in Network panel that the exact 7 HTTP calls happen in the documented order. (We already did this on the current code in this session; the rewrite should be behavior-identical.)

## Risk / Compatibility

| Change | Risk | Mitigation |
|---|---|---|
| `useCheckout` auto-detect | Low — removes a runtime throw. No existing caller depends on it. | Test customer-path still works. |
| `useCreateCart` (additive) | None — new export. | Add tests; document in changeset. |
| GuestCheckout.tsx rewrite | Behavioral parity — same network calls. | Runtime smoke against `viu` tenant verifies the order ID flow. |

**Changeset:** minor bump for `@viu/emporix-sdk-react` (additive hook + auth-permissiveness expansion). No SDK change.

## File Structure

| File | Change |
|---|---|
| `packages/react/src/hooks/use-cart-mutations.ts` | Add `useCreateCart` export at end of file |
| `packages/react/src/hooks/use-checkout.ts` | Replace `customerCtx` with `checkoutCtx` (auto-detect); apply in both mutationFns |
| `packages/react/src/hooks/index.ts` | Re-export `useCreateCart` |
| `packages/react/tests/use-cart-mutations.test.tsx` | Add `useCreateCart` tests |
| `packages/react/tests/use-checkout.test.tsx` | Extend with anonymous-path tests |
| `examples/vite-spa/src/GuestCheckout.tsx` | Rewrite as hook-only composition |
| `.changeset/vite-spa-hooks-only.md` | Minor changeset for `@viu/emporix-sdk-react` |
| `docs/react.md` | Add `useCreateCart` to the hooks reference; note `useCheckout` anonymous support |

## Out-of-the-loop

Once this lands, the next-app-router Example still mixes raw client and hooks in its own `guest-checkout/page.tsx`. A follow-up could mirror this design there — separate plan, when the priority is set.
